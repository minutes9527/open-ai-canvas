import type { AnalysisResult, VideoAnalysisKeyframe, VideoTranscript } from "./video-plugin";
import { VideoPluginError } from "./video-plugin";
import type { VideoResourceRef } from "@/lib/video-engine/video-ir";

export type ReviewFrame = VideoAnalysisKeyframe & { id: string; shotId?: string };

/** Portable descriptors only. Original media stays in the authorized resource store. */
export type VideoReviewDraft = {
    schema: "yingce.video-review";
    version: 1;
    state: "awaiting-review";
    source: VideoResourceRef;
    sourceFingerprint: string;
    revision: number;
    durationMs: number;
    frames: readonly ReviewFrame[];
    transcript?: VideoTranscript;
    screenText: readonly { frameId: string; text: string; confidence?: number }[];
    detectors: readonly string[];
};

export type ConfirmedVideoReview = {
    state: "confirmed";
    source: VideoResourceRef;
    sourceFingerprint: string;
    revision: number;
    frames: readonly ReviewFrame[];
};

/** Analysis output remains separate from Video IR and is explicitly unverified. */
export type VideoBreakdown = {
    schema: "yingce.video-breakdown";
    version: 1;
    review: ConfirmedVideoReview;
    transcript?: VideoTranscript;
    screenText: VideoReviewDraft["screenText"];
    analysis: AnalysisResult;
    evidenceStatus: "model-output-unverified";
};

export function createVideoReviewDraft(source: VideoResourceRef, result: AnalysisResult): VideoReviewDraft {
    if (!result?.sourceFingerprint || !Number.isFinite(result.durationMs) || result.durationMs! <= 0 || !Array.isArray(result.keyframes) || !result.keyframes.length) fail("视频准备结果缺少原视频指纹、时长或候选帧");
    const frames = Array.from(result.keyframes, (frame) => ({ ...frame, id: `frame-${frame?.timeMs}` }));
    const draft: VideoReviewDraft = {
        schema: "yingce.video-review",
        version: 1,
        state: "awaiting-review",
        source,
        sourceFingerprint: result.sourceFingerprint,
        revision: 1,
        durationMs: result.durationMs!,
        frames,
        transcript: result.transcript,
        screenText: [],
        detectors: result.detectors ?? [],
    };
    validateVideoReviewDraft(draft);
    return structuredClone({ ...draft, frames: frames.sort((a, b) => a.timeMs - b.timeMs) });
}

/** Confirmation is explicit and produces a detached snapshot, not a mutable UI selection. */
export function confirmVideoReview(draft: VideoReviewDraft, selectedIds: readonly string[]): ConfirmedVideoReview {
    validateVideoReviewDraft(draft);
    if (!Array.isArray(selectedIds) || !selectedIds.length || Array.from(selectedIds).some((id) => typeof id !== "string" || !id.trim()) || new Set(selectedIds).size !== selectedIds.length) fail("请确认至少一张不重复的候选帧");
    const byId = new Map(draft.frames.map((frame) => [frame.id, frame]));
    const frames = selectedIds
        .map((id) => {
            const frame = byId.get(id);
            if (!frame) fail("确认中包含不属于当前视频的候选帧");
            return frame;
        })
        .sort((a, b) => a.timeMs - b.timeMs);
    return structuredClone({ state: "confirmed", source: draft.source, sourceFingerprint: draft.sourceFingerprint, revision: draft.revision, frames });
}

export function assertVideoReview(draft: VideoReviewDraft, review: ConfirmedVideoReview) {
    validateVideoReviewDraft(draft);
    if (review?.state !== "confirmed" || review.revision !== draft.revision || review.sourceFingerprint !== draft.sourceFingerprint || review.source?.id !== draft.source.id || review.source?.kind !== draft.source.kind)
        fail("人工确认已过期或不属于当前视频，请重新确认");
    validateFrames(review.frames, draft.durationMs);
    const expected = confirmVideoReview(
        draft,
        review.frames.map((frame) => frame.id),
    );
    if (expected.frames.some((frame, index) => frame.id !== review.frames[index]?.id || frame.timeMs !== review.frames[index]?.timeMs || frame.shotId !== review.frames[index]?.shotId)) fail("候选帧已变更，请重新确认");
}

export function validateVideoReviewDraft(draft: VideoReviewDraft) {
    if (
        draft?.schema !== "yingce.video-review" ||
        draft.version !== 1 ||
        draft.state !== "awaiting-review" ||
        !Number.isSafeInteger(draft.revision) ||
        draft.revision < 1 ||
        typeof draft.sourceFingerprint !== "string" ||
        !/^[a-f0-9]{64}$/.test(draft.sourceFingerprint) ||
        !draft.source ||
        !["asset", "resource"].includes(draft.source.kind) ||
        typeof draft.source.id !== "string" ||
        !/^[\w-]{1,200}$/.test(draft.source.id) ||
        !Array.isArray(draft.frames) ||
        !draft.frames.length
    )
        fail("视频复核草稿无效");
    validateFrames(draft.frames, draft.durationMs);
}

/** Manual changes are a new candidate revision and deliberately invalidate confirmation. */
export function editVideoReviewFrame(draft: VideoReviewDraft, timeMs: number, replaceId?: string): VideoReviewDraft {
    validateVideoReviewDraft(draft);
    if (replaceId && !draft.frames.some((frame) => frame.id === replaceId)) fail("被替换的候选帧不存在");
    const frame: ReviewFrame = { id: `frame-${timeMs}`, timeMs, score: 0, reasons: ["manual"], hardTrigger: false };
    const frames = [...draft.frames.filter((entry) => entry.id !== replaceId), frame].sort((left, right) => left.timeMs - right.timeMs);
    validateFrames(frames, draft.durationMs);
    return structuredClone({ ...draft, frames, revision: draft.revision + 1, screenText: draft.screenText.filter((entry) => entry.frameId !== replaceId) });
}

export function transcriptForRange(transcript: VideoTranscript | undefined, startMs: number, endMs: number) {
    return transcript?.segments.filter((segment) => segment.startMs < endMs && segment.endMs > startMs) ?? [];
}

function validateFrames(frames: readonly ReviewFrame[], durationMs: number) {
    if (!Array.isArray(frames) || !frames.length || !Number.isFinite(durationMs) || durationMs <= 0) fail("候选帧数据无效");
    const ids = new Set<string>();
    const times = new Set<number>();
    for (const frame of frames) {
        if (
            !frame ||
            typeof frame !== "object" ||
            typeof frame.id !== "string" ||
            !frame.id.trim() ||
            ids.has(frame.id) ||
            times.has(frame.timeMs) ||
            !Number.isInteger(frame.timeMs) ||
            frame.timeMs < 0 ||
            frame.timeMs >= durationMs ||
            !Number.isFinite(frame.score) ||
            frame.score < 0 ||
            frame.score > 1 ||
            (frame.quality !== undefined && (!Number.isFinite(frame.quality) || frame.quality < 0 || frame.quality > 1)) ||
            (frame.eventTimeMs !== undefined && (!Number.isInteger(frame.eventTimeMs) || frame.eventTimeMs < 0 || frame.eventTimeMs >= durationMs))
        )
            fail("候选帧数据无效");
        ids.add(frame.id);
        times.add(frame.timeMs);
    }
}

function fail(message: string): never {
    throw new VideoPluginError("invalid-input", message);
}
