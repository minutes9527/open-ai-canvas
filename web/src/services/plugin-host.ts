import axios from "axios";

import { createClientId } from "@/lib/client-id";
import { channelRequest } from "@/services/api/custom-channel-relay";
import { requestToolResponse, type ResponseFunctionTool, type ResponseInputMessage, type ToolChoice } from "@/services/api/image";
import { pluginStorageFor } from "@/lib/plugins/plugin-storage";
import { getMediaBlob } from "@/services/file-storage";
import { getResource, resourceStorageKey } from "@/services/api/resources";
import { loadAssetsForUse } from "@/services/user-data-sync";
import { buildApiUrl, encodeChannelModel, isSystemProxyBaseUrl, modelOptionName, resolveModelRequestConfig, type AiConfig } from "@/stores/use-config-store";
import { useAssetStore, type Asset } from "@/stores/use-asset-store";
import type { PluginHostContext, PluginInstallation, PluginMediaReference, PluginTextRequest, RegisteredPlugin, ResolvedPluginMedia } from "@/lib/plugins/plugin-types";

export function createPluginHostContext(plugin: RegisteredPlugin, installation: PluginInstallation, aiConfig: AiConfig): PluginHostContext {
    const permissions = new Set(plugin.manifest.permissions);
    const resolvePluginModelConfig = (model?: string) => {
        const channelId = typeof installation.config.channelId === "string" ? installation.config.channelId.trim() : "";
        if (!channelId) throw new Error("FrameScript 尚未关联 Canvas 系统渠道，请先在插件设置中选择渠道");
        const channel = aiConfig.channels.find((candidate) => candidate.id === channelId && candidate.scope === "system" && candidate.enabled !== false);
        if (!channel) throw new Error("FrameScript 关联的 Canvas 系统渠道不存在或已停用");
        const requested = typeof model === "string" && model.trim()
            ? modelOptionName(model).trim()
            : modelOptionName(String(installation.config.visionModel || "")).trim();
        if (!requested) {
            throw new Error(`FrameScript 模型不在关联系统渠道中：${requested || "未选择模型"}`);
        }
        // The plugin settings page loads the full admin channel catalog, while
        // the runtime config may still contain an older/publicly filtered
        // model list. Keep the selected system channel as the authority and
        // let the Canvas backend validate the model against its live catalog.
        // Augment only the in-memory runtime copy so we never persist stale
        // catalog data back to user settings.
        const runtimeChannels = channel.models.some((candidate) => modelOptionName(candidate).trim() === requested)
            ? aiConfig.channels
            : aiConfig.channels.map((candidate) => candidate.id === channel.id
                ? { ...candidate, models: [...candidate.models, requested] }
                : candidate);
        const runtimeConfig = runtimeChannels === aiConfig.channels ? aiConfig : { ...aiConfig, channels: runtimeChannels };
        // Keep the channel-qualified model on the config. requestToolResponse
        // resolves the config once more, so a bare model could accidentally
        // match another channel that exposes the same model name.
        return { ...resolveModelRequestConfig(runtimeConfig, encodeChannelModel(channel.id, requested)), channels: runtimeChannels, model: encodeChannelModel(channel.id, requested) };
    };
    return {
        manifest: plugin.manifest,
        permissions,
        storage: pluginStorageFor(plugin.manifest.id),
        config: installation.config,
        services: {
            ai: {
                text: {
                    requestToolResponse: async (request: PluginTextRequest) => {
                        if (!permissions.has("ai.text")) throw new Error("插件没有调用文本模型的权限");
                        const requestConfig = resolvePluginModelConfig(request.model);
                        const response = await requestToolResponse(
                            requestConfig,
                            request.messages as ResponseInputMessage[],
                            (request.tools || []) as ResponseFunctionTool[],
                            (request.toolChoice || "auto") as ToolChoice,
                            request.onDelta,
                            { signal: request.signal },
                        );
                        return {
                            content: response.content,
                            toolCalls: response.toolCalls.map((call) => ({ name: call.function.name, arguments: call.function.arguments })),
                        };
                    },
                },
                audio: {
                    transcribe: async (request) => {
                        if (!permissions.has("ai.audio")) throw new Error("插件没有调用语音转写模型的权限");
                        const requestConfig = resolvePluginModelConfig(request.model || String(installation.config.transcriptionModel || ""));
                        const form = new FormData();
                        form.append("file", request.file, request.fileName);
                        form.append("model", modelOptionName(requestConfig.model));
                        const headers = {
                            Authorization: `Bearer ${requestConfig.apiKey}`,
                            ...(isSystemProxyBaseUrl(requestConfig.baseUrl) ? { "X-Canvas-Scene": "audio", "X-Idempotency-Key": createClientId() } : {}),
                        };
                        try {
                            const upstreamUrl = buildApiUrl(requestConfig.baseUrl, "/audio/transcriptions");
                            const relay = channelRequest(requestConfig, upstreamUrl, headers);
                            const response = await axios.post<unknown>(relay.url, form, {
                                headers: relay.headers,
                                withCredentials: relay.credentials === "include",
                                signal: request.signal,
                            });
                            return parseAudioTranscriptionResponse(response.data);
                        } catch (error) {
                            throw new Error(`系统渠道语音转写失败：${audioTranscriptionError(error)}`);
                        }
                    },
                },
            },
            media: {
                resolve: (reference, signal) => resolvePluginMedia(reference, permissions.has("media.read"), signal),
            },
        },
    };
}

function timeToMs(value: unknown, fallback: number) {
    const number = typeof value === "number" ? value : typeof value === "string" ? Number(value) : Number.NaN;
    return Number.isFinite(number) ? Math.max(0, Math.round(number < 1000 ? number * 1000 : number)) : fallback;
}

/** Host-owned resolver: the plugin never sees storage keys, asset URLs or account IDs. */
async function resolvePluginMedia(reference: PluginMediaReference, permitted: boolean, signal?: AbortSignal): Promise<ResolvedPluginMedia> {
    if (!permitted) throw new Error("插件没有读取媒体的权限");
    signal?.throwIfAborted();
    if (!reference?.id || !/^[\w-]{1,200}$/.test(reference.id) || !["asset", "resource"].includes(reference.kind)) throw new Error("媒体引用无效");

    if (reference.kind === "resource") {
        const resource = await getResource(reference.id);
        signal?.throwIfAborted();
        const blob = await getMediaBlob(resourceStorageKey(reference.id));
        if (!blob) throw new Error("无法读取媒体文件");
        return {
            blob,
            kind: normalizeKind(resource.kind),
            fileName: mediaFileName(reference.id, resource.mimeType || blob.type),
            mimeType: resource.mimeType || blob.type || "application/octet-stream",
            durationMs: resource.durationMs,
        };
    }

    // This path first refreshes user-scoped assets. It never resolves a raw URL
    // from a caller-supplied reference.
    await loadAssetsForUse([reference.id]);
    signal?.throwIfAborted();
    const asset = useAssetStore.getState().assets.find((candidate) => candidate.id === reference.id);
    if (!asset) throw new Error("媒体素材不存在或无权访问");
    const stored = storedMediaForAsset(asset);
    if (!stored.storageKey) throw new Error("当前素材没有可供插件读取的已保存媒体");
    const blob = await getMediaBlob(stored.storageKey);
    if (!blob) throw new Error("无法读取媒体文件，请重新上传后再试");
    return {
        blob,
        kind: normalizeKind(asset.kind),
        fileName: mediaFileName(asset.title || reference.id, stored.mimeType || blob.type),
        mimeType: stored.mimeType || blob.type || "application/octet-stream",
        durationMs: stored.durationMs,
    };
}

function storedMediaForAsset(asset: Asset) {
    if (asset.kind === "video" || asset.kind === "audio") return { storageKey: asset.data.storageKey, mimeType: asset.data.mimeType, durationMs: asset.data.durationMs };
    if (asset.kind === "model") return { storageKey: asset.data.storageKey, mimeType: asset.data.mimeType, durationMs: undefined };
    if (asset.kind === "image") return { storageKey: asset.data.storageKey, mimeType: asset.data.mimeType, durationMs: undefined };
    return { storageKey: undefined, mimeType: undefined, durationMs: undefined };
}

function normalizeKind(kind: string): ResolvedPluginMedia["kind"] {
    return kind === "image" || kind === "video" || kind === "audio" ? kind : "file";
}

function mediaFileName(value: string, mimeType: string) {
    const safe = value.trim().replace(/[\\/:*?"<>|\u0000-\u001f]/g, "-").slice(0, 120) || "media";
    if (/\.[a-z0-9]{2,5}$/i.test(safe)) return safe;
    const extension = ({ "video/mp4": ".mp4", "video/quicktime": ".mov", "audio/mpeg": ".mp3", "audio/wav": ".wav", "image/png": ".png", "image/jpeg": ".jpg" } as Record<string, string>)[mimeType];
    return `${safe}${extension || ""}`;
}


export function parseAudioTranscriptionResponse(payload: unknown) {
    const data = payload && typeof payload === "object" && !Array.isArray(payload) ? payload as Record<string, unknown> : {};
    const text = [data.text, data.transcript, data.content].find((value): value is string => typeof value === "string" && value.trim().length > 0)?.trim() || "";
    if (!text) throw new Error("系统渠道未返回有效的转写文本");
    const segments = Array.isArray(data.segments)
        ? data.segments.flatMap((value) => {
            if (!value || typeof value !== "object" || Array.isArray(value)) return [];
            const item = value as Record<string, unknown>;
            const segmentText = [item.text, item.original_text, item.content].find((candidate): candidate is string => typeof candidate === "string" && candidate.trim().length > 0)?.trim();
            if (!segmentText) return [];
            const startMs = timeToMs(item.start_ms ?? item.start, 0);
            const endMs = Math.max(startMs, timeToMs(item.end_ms ?? item.end, startMs));
            return [{ startMs, endMs, text: segmentText }];
        })
        : undefined;
    return { text, ...(segments?.length ? { segments } : {}) };
}

function audioTranscriptionError(error: unknown) {
    if (axios.isAxiosError(error)) {
        const body = error.response?.data;
        if (body && typeof body === "object" && !Array.isArray(body)) {
            const record = body as Record<string, unknown>;
            const nested = record.error && typeof record.error === "object" && !Array.isArray(record.error) ? record.error as Record<string, unknown> : undefined;
            const message = nested?.message ?? record.message ?? record.error;
            if (typeof message === "string" && message.trim()) return message.trim();
        }
        if (error.message) return error.message;
    }
    return error instanceof Error && error.message ? error.message : "请求未完成";
}
