import type { VideoResourceRef } from "@/lib/video-engine/video-ir";
import { VideoPluginError, type VideoAnalysisOperation, type VideoPluginOptions } from "@/lib/plugins/video-plugin";
import { assertVideoReview, createVideoReviewDraft, transcriptForRange, type ConfirmedVideoReview, type VideoBreakdown, type VideoReviewDraft } from "@/lib/plugins/video-review";
import type { VideoPipeline, VideoProvider } from "./video-pipeline";

/** Orchestration only. It does not keep UI state or create another plugin runtime. */
export class VideoReviewWorkflow {
    constructor(private readonly pipeline: Pick<VideoPipeline, "analyze">) {}

    async prepare(provider: VideoProvider, source: VideoResourceRef, transcribe: boolean, options?: VideoPluginOptions) {
        const result = await this.pipeline.analyze(provider, {
            media: source,
            operations: transcribe ? ["adaptive-keyframe-extraction", "transcription"] : ["adaptive-keyframe-extraction"],
        }, options);
        return createVideoReviewDraft(source, result);
    }

    async analyzeSelected(provider: VideoProvider, draft: VideoReviewDraft, review: ConfirmedVideoReview, operations: readonly VideoAnalysisOperation[], options?: VideoPluginOptions): Promise<VideoBreakdown> {
        const draftSnapshot = structuredClone(draft);
        const reviewSnapshot = structuredClone(review);
        assertVideoReview(draftSnapshot, reviewSnapshot);
        if (!operations.length || operations.some((operation) => !["video-analysis", "scene-understanding", "asset-analysis", "prompt-extraction"].includes(operation))) {
            throw new VideoPluginError("invalid-input", "筛选后仅允许画面分析，不重复抽帧或转录");
        }
        const analysis = await this.pipeline.analyze(provider, { media: draftSnapshot.source, operations, review: reviewSnapshot, reviewDraft: draftSnapshot }, options);
        return structuredClone({
            schema: "yingce.video-breakdown", version: 1, review: reviewSnapshot, transcript: draftSnapshot.transcript,
            screenText: draftSnapshot.screenText.filter((entry) => reviewSnapshot.frames.some((frame) => frame.id === entry.frameId)),
            analysis: { ...analysis, segments: analysis.segments.map((segment) => ({ ...segment, transcript: transcriptForRange(draftSnapshot.transcript, segment.startMs, segment.endMs).map((part) => part.originalText).join("\n") || undefined })) },
            evidenceStatus: "model-output-unverified",
        });
    }
}
