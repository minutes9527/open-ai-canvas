import type { PluginHostContext, PluginManifestV2, RegisteredPlugin } from "../plugin-types";
import { registerPlugin } from "../plugin-registry";
import { VideoPluginError, type AnalysisResult, type VideoAnalysisKeyframe, type VideoPlugin, type VideoTranscript } from "../video-plugin";
import { fingerprintVideoSource } from "../video-source";

export const FRAMESCRIPT_VIDEO_ENGINE_ID = "framescript-video-engine";
export const DEFAULT_FRAMESCRIPT_BASE_URL = "http://127.0.0.1:8001";

const manifest: PluginManifestV2 = {
    apiVersion: "yingce.plugin/v2",
    id: FRAMESCRIPT_VIDEO_ENGINE_ID,
    name: "FrameScript Video Engine",
    version: "0.5.0",
    description: "连接本机 FrameScript，提供候选抽帧、转录与确认后的逐帧视频理解。",
    permissions: ["media.read"],
    configuration: { fields: [
        { name: "baseUrl", type: "url", label: "FrameScript 本机服务地址", required: true, default: DEFAULT_FRAMESCRIPT_BASE_URL, description: "仅允许 localhost 或 127.0.0.1 的 HTTP 根地址。" },
        { name: "changeThreshold", type: "number", label: "候选帧变化阈值", default: 0.32, description: "0.01–1；当前基线使用画面差异，不代表人物追踪。" },
        { name: "samplingIntervalMs", type: "number", label: "扫描间隔（毫秒）", default: 400, description: "100–2000；影响采样精度，不决定最终保留帧数量。" },
    ] },
    contributes: { videoPlugins: [{
        id: FRAMESCRIPT_VIDEO_ENGINE_ID, label: "FrameScript Video Engine", type: "video", stage: "ready",
        capabilities: ["adaptive-keyframe-extraction", "video-analysis", "transcription", "prompt-extraction", "scene-understanding", "asset-analysis"],
        plannedCapabilities: ["timeline", "compile", "render", "export"],
    }] },
};
const frameScriptCapabilities = manifest.contributes.videoPlugins![0].capabilities;

export const frameScriptVideoEnginePlugin: RegisteredPlugin = {
    manifest,
    source: "bundled",
    createVideoPlugin: (context, contributionId) => {
        if (contributionId !== FRAMESCRIPT_VIDEO_ENGINE_ID) throw new VideoPluginError("not-registered", "FrameScript 未声明该视频能力");
        return createFrameScriptVideoEngine(context);
    },
};

registerPlugin(frameScriptVideoEnginePlugin);

function createFrameScriptVideoEngine(context: PluginHostContext): VideoPlugin {
    const baseUrl = normalizeBaseUrl(context.config.baseUrl);
    return {
        id: FRAMESCRIPT_VIDEO_ENGINE_ID,
        name: manifest.name,
        type: "video",
        capabilities: frameScriptCapabilities,
        getAvailability: () => context.services?.media?.resolve ? { available: true } : { available: false, reason: "FrameScript 缺少受权的媒体读取服务" },
        analyze: async (input, options) => {
            const signal = options?.signal;
            signal?.throwIfAborted();
            const preparing = input.operations.includes("adaptive-keyframe-extraction");
            const visual = input.operations.some((operation) => operation !== "adaptive-keyframe-extraction" && operation !== "transcription");
            // This is the irreversible boundary: raw frames never reach analysis
            // endpoints unless the caller supplies a current explicit confirmation.
            if (preparing && (visual || input.review)) throw new VideoPluginError("invalid-input", "准备候选帧后须人工确认，不能同时启动画面分析");
            if (visual && !input.review) throw new VideoPluginError("invalid-input", "请先人工筛选并确认候选帧，再进行画面分析");
            if (input.review && (input.review.state !== "confirmed" || !input.review.frames.length || input.review.source.id !== input.media.id || input.review.source.kind !== input.media.kind || input.operations.includes("transcription"))) {
                throw new VideoPluginError("invalid-input", "人工确认无效；筛选后不重复转录");
            }
            const resolve = context.services?.media?.resolve;
            if (!resolve) throw new VideoPluginError("runtime-unavailable", "FrameScript 缺少受权的媒体读取服务");
            const media = await resolve(input.media, signal);
            if (media.kind !== "video") throw new VideoPluginError("invalid-input", "FrameScript 当前需要已保存的视频素材");
            const sourceFingerprint = preparing || input.review ? await fingerprintVideoSource(media.blob, signal) : undefined;
            if (input.review?.sourceFingerprint !== undefined && input.review.sourceFingerprint !== sourceFingerprint) throw new VideoPluginError("invalid-input", "原视频已变化，请重新准备并确认候选帧");

            const [scan, transcript] = await Promise.all([
                preparing ? scanCandidateFrames(media.blob, context.config, signal) : Promise.resolve<FrameScan | undefined>(undefined),
                input.operations.includes("transcription") ? transcribe(baseUrl, media.blob, media.fileName, signal) : Promise.resolve<VideoTranscript | undefined>(undefined),
            ]);
            const frames = input.review?.frames ?? scan?.keyframes ?? [];
            const durationMs = scan?.durationMs ?? media.durationMs;
            if (visual && (!frames.length || !durationMs)) throw new VideoPluginError("invalid-input", "没有可分析的已确认画面");
            const segments: Array<{ startMs: number; endMs: number; keyframe: VideoAnalysisKeyframe; description?: string; prompt?: string }> = frames.map((frame, index) => ({ startMs: frame.timeMs, endMs: frames[index + 1]?.timeMs ?? Math.max(frame.timeMs + 1, durationMs ?? frame.timeMs + 1), keyframe: frame }));
            const summaries: string[] = [];
            if (visual) {
                for (let offset = 0; offset < frames.length; offset += 6) {
                    const batch = frames.slice(offset, offset + 6);
                    const images = await captureFrames(media.blob, batch, signal);
                    if (input.operations.some((operation) => ["video-analysis", "scene-understanding", "asset-analysis"].includes(operation))) {
                        const response = await request<{ script_text?: string; frame_notes?: unknown }>(baseUrl, "/api/extract-script", { frames: images, file_name: media.fileName }, signal);
                        if (!Array.isArray(response.frame_notes) || response.frame_notes.length !== batch.length || response.frame_notes.some((item) => typeof item !== "string" || !item.trim())) {
                            throw new VideoPluginError("runtime-unavailable", "FrameScript 画面分析结果不完整，未自动错位配对");
                        }
                        response.frame_notes.forEach((description, index) => { segments[offset + index].description = description as string; });
                        if (response.script_text) summaries.push(response.script_text);
                    }
                    if (input.operations.includes("prompt-extraction")) {
                        const response = await request<{ prompt_text?: string; frames?: Array<{ id?: string; prompt_cn?: string; prompt_en?: string }> }>(baseUrl, "/api/generate-image-prompts", {
                            file_name: media.fileName,
                            prompt_template: "scene",
                            frames: images.map((image, index) => ({ id: String(index + 1), image_base64: image, timestamp: formatTime(batch[index].timeMs) })),
                        }, signal);
                        const returned = new Map(response.frames?.map((item) => [String(item.id ?? ""), [item.prompt_cn, item.prompt_en].filter((text): text is string => typeof text === "string" && Boolean(text)).join("\n")] as const) ?? []);
                        if (returned.size !== batch.length || [...returned.keys()].some((id) => !/^\d+$/.test(id) || Number(id) < 1 || Number(id) > batch.length)) throw new VideoPluginError("runtime-unavailable", "FrameScript 未返回全部选中帧的提示词");
                        batch.forEach((_frame, index) => { segments[offset + index].prompt = returned.get(String(index + 1)); });
                        if (response.prompt_text) summaries.push(response.prompt_text);
                    }
                }
            }
            return { pluginId: FRAMESCRIPT_VIDEO_ENGINE_ID, status: "completed", segments, summary: summaries.join("\n\n") || undefined, keyframes: scan?.keyframes, transcript, sourceFingerprint, durationMs, detectors: scan?.detectors } satisfies AnalysisResult;
        },
    };
}

type FrameScan = { keyframes: VideoAnalysisKeyframe[]; durationMs: number; detectors: string[] };

async function scanCandidateFrames(blob: Blob, config: Readonly<Record<string, string | number | boolean>>, signal?: AbortSignal): Promise<FrameScan> {
    const interval = numberConfig(config.samplingIntervalMs, 400, 100, 2_000, "samplingIntervalMs");
    const threshold = numberConfig(config.changeThreshold, 0.32, 0.01, 1, "changeThreshold");
    const url = URL.createObjectURL(blob);
    const video = document.createElement("video");
    video.muted = true; video.playsInline = true; video.preload = "auto";
    try {
        await videoEvent(video, "loadeddata", () => { video.src = url; video.load(); }, signal);
        const durationMs = Math.floor(video.duration * 1000);
        if (!Number.isFinite(durationMs) || durationMs < 1 || !video.videoWidth || !video.videoHeight) throw new VideoPluginError("runtime-unavailable", "无法读取视频时长或尺寸");
        const canvas = document.createElement("canvas");
        const scale = 192 / Math.max(video.videoWidth, video.videoHeight);
        canvas.width = Math.max(2, Math.round(video.videoWidth * scale)); canvas.height = Math.max(2, Math.round(video.videoHeight * scale));
        const context = canvas.getContext("2d", { willReadFrequently: true });
        if (!context) throw new VideoPluginError("runtime-unavailable", "无法创建候选帧画布");
        const last = Math.max(0, durationMs - 1); const frames: VideoAnalysisKeyframe[] = [];
        let previous: Uint8ClampedArray | undefined; let selected: Uint8ClampedArray | undefined;
        for (let timeMs = 0; ; timeMs = Math.min(last, timeMs + interval)) {
            signal?.throwIfAborted();
            if (Math.abs(video.currentTime * 1000 - timeMs) > 1) await videoEvent(video, "seeked", () => { video.currentTime = timeMs / 1000; }, signal);
            context.drawImage(video, 0, 0, canvas.width, canvas.height);
            const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
            const adjacent = previous ? pixelDifference(previous, pixels) : 0;
            const retained = selected ? pixelDifference(selected, pixels) : 0;
            const boundary = timeMs === 0 ? "opening" : timeMs === last ? "closing" : undefined;
            const score = Math.max(adjacent, retained);
            if (boundary || score >= threshold) {
                frames.push({ timeMs, score: Math.round(score * 10_000) / 10_000, reasons: boundary ? [boundary] : ["visual-change"], hardTrigger: Boolean(boundary), width: video.videoWidth, height: video.videoHeight });
                selected = pixels;
            }
            previous = pixels;
            if (timeMs === last) break;
        }
        return { keyframes: frames, durationMs, detectors: ["adjacent-pixel-difference", "retained-pixel-difference"] };
    } finally { video.pause(); video.removeAttribute("src"); video.load(); URL.revokeObjectURL(url); }
}

async function captureFrames(blob: Blob, frames: readonly VideoAnalysisKeyframe[], signal?: AbortSignal) {
    const url = URL.createObjectURL(blob); const video = document.createElement("video"); video.muted = true; video.playsInline = true;
    try {
        await videoEvent(video, "loadeddata", () => { video.src = url; video.load(); }, signal);
        const canvas = document.createElement("canvas"); canvas.width = video.videoWidth; canvas.height = video.videoHeight;
        const context = canvas.getContext("2d"); if (!context) throw new VideoPluginError("runtime-unavailable", "无法创建原帧画布");
        const result: string[] = [];
        for (const frame of frames) { signal?.throwIfAborted(); await videoEvent(video, "seeked", () => { video.currentTime = frame.timeMs / 1000; }, signal); context.drawImage(video, 0, 0); result.push(canvas.toDataURL("image/jpeg", 0.92)); }
        return result;
    } finally { video.pause(); video.removeAttribute("src"); video.load(); URL.revokeObjectURL(url); }
}

async function transcribe(baseUrl: string, blob: Blob, fileName: string, signal?: AbortSignal): Promise<VideoTranscript> {
    const body = new FormData(); body.append("file", blob, fileName); body.append("file_name", fileName);
    const result = await request<{ transcript?: unknown }>(baseUrl, "/api/transcribe-audio-file", body, signal);
    if (typeof result.transcript !== "string") throw new VideoPluginError("runtime-unavailable", "FrameScript 未返回有效转录文本");
    return { text: result.transcript, segments: [] };
}

async function request<T>(baseUrl: string, path: string, body: unknown, signal?: AbortSignal): Promise<T> {
    try {
        const init: RequestInit = body instanceof FormData ? { method: "POST", body, signal } : { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), signal };
        const response = await fetch(baseUrl + path, { ...init, credentials: "omit", redirect: "error" });
        if (!response.ok) throw new VideoPluginError("runtime-unavailable", `FrameScript 请求失败（${response.status}）`);
        const result = await response.json();
        if (!result || typeof result !== "object" || result.status === "error" || result.status === "failed") throw new VideoPluginError("runtime-unavailable", "FrameScript 未完成请求");
        return result as T;
    } catch (error) { if (error instanceof VideoPluginError || (error instanceof DOMException && error.name === "AbortError")) throw error; throw new VideoPluginError("runtime-unavailable", "无法连接 FrameScript，请确认本机助手已在 127.0.0.1:8001 运行"); }
}

function normalizeBaseUrl(value: unknown) { const candidate = typeof value === "string" && value.trim() ? value.trim() : DEFAULT_FRAMESCRIPT_BASE_URL; try { const url = new URL(candidate); if (url.protocol !== "http:" || !["localhost", "127.0.0.1"].includes(url.hostname) || url.username || url.password || url.search || url.hash || url.pathname !== "/") throw new Error(); return url.origin; } catch { throw new VideoPluginError("invalid-input", "FrameScript 服务地址必须是本机 HTTP 根地址"); } }
function numberConfig(value: unknown, fallback: number, min: number, max: number, name: string) { if (value === undefined) return fallback; if (typeof value !== "number" || !Number.isFinite(value) || value < min || value > max) throw new VideoPluginError("invalid-input", `抽帧参数 ${name} 无效`); return value; }
function pixelDifference(left: Uint8ClampedArray, right: Uint8ClampedArray) { let total = 0; for (let index = 0; index < left.length; index += 4) total += Math.abs(left[index] - right[index]) + Math.abs(left[index + 1] - right[index + 1]) + Math.abs(left[index + 2] - right[index + 2]); return total / (left.length / 4 * 3 * 255); }
function formatTime(value: number) { const seconds = Math.floor(value / 1000); return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}.${String(value % 1000).padStart(3, "0")}`; }
function videoEvent(video: HTMLVideoElement, event: "loadeddata" | "seeked", start: () => void, signal?: AbortSignal) { return new Promise<void>((resolve, reject) => { const cleanup = () => { clearTimeout(timer); video.removeEventListener(event, done); video.removeEventListener("error", fail); signal?.removeEventListener("abort", abort); }; const done = () => { cleanup(); resolve(); }; const fail = () => { cleanup(); reject(new VideoPluginError("runtime-unavailable", "视频读取或定位失败")); }; const abort = () => { cleanup(); reject(signal?.reason ?? new DOMException("已取消", "AbortError")); }; const timer = setTimeout(fail, 20_000); video.addEventListener(event, done, { once: true }); video.addEventListener("error", fail, { once: true }); signal?.addEventListener("abort", abort, { once: true }); try { start(); } catch (error) { cleanup(); reject(error); } }); }
