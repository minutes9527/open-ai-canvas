import type { VideoIR, VideoResourceRef } from "@/lib/video-engine/video-ir";
import type { ConfirmedVideoReview } from "./video-review";

export const VIDEO_ANALYSIS_OPERATIONS = ["adaptive-keyframe-extraction", "video-analysis", "transcription", "prompt-extraction", "scene-understanding", "asset-analysis"] as const;
export type VideoAnalysisOperation = (typeof VIDEO_ANALYSIS_OPERATIONS)[number];
export type VideoPluginType = "video";
export const VIDEO_PLUGIN_CAPABILITIES = [...VIDEO_ANALYSIS_OPERATIONS, "timeline", "compile", "render", "export"] as const;
export type VideoCapability = (typeof VIDEO_PLUGIN_CAPABILITIES)[number];

export type VideoPluginContribution = {
    id: string;
    label: string;
    type: VideoPluginType;
    stage: "scaffold" | "ready";
    capabilities: VideoCapability[];
    /** Roadmap only: never grants permissions or makes an operation callable. */
    plannedCapabilities?: VideoCapability[];
};

export const VIDEO_PLUGIN_PERMISSIONS = {
    "adaptive-keyframe-extraction": ["media.read"],
    "video-analysis": ["media.read"],
    transcription: ["media.read"],
    "prompt-extraction": ["media.read"],
    "scene-understanding": ["media.read"],
    "asset-analysis": ["media.read"],
    timeline: ["media.read"],
    compile: ["media.read"],
    render: ["media.read", "generation.run"],
    export: ["media.read", "generation.run"],
} as const;

/** Saved media is required; IR supplies optional engine-neutral analysis context. */
export type VideoInput = {
    media: VideoResourceRef;
    videoIR?: VideoIR;
    operations: readonly VideoAnalysisOperation[];
    /** Only explicit, current user confirmations may reach a visual model. */
    review?: ConfirmedVideoReview;
};
export type VideoKeyframeReason =
    | "manual"
    | "opening"
    | "closing"
    | "scene-cut"
    | "scene-change"
    | "subject-entered"
    | "subject-reentered"
    | "product-interaction"
    | "occlusion-changed"
    | "visual-change"
    | "semantic-change"
    | "person-movement"
    | "person-scale-change"
    | "pose-change"
    | "camera-movement"
    | "text-change"
    | "expression-change"
    | "max-gap";
export type VideoAnalysisKeyframe = {
    timeMs: number;
    eventTimeMs?: number;
    quality?: number;
    qualityMethod?: "local-laplacian-exposure-v1";
    qualityAdjusted?: boolean;
    score: number;
    reasons: readonly VideoKeyframeReason[];
    hardTrigger: boolean;
    width?: number;
    height?: number;
};
export type VideoTranscriptSegment = { startMs: number; endMs: number; speaker?: string; originalText: string; cleanedText?: string; confidence?: number; shotIds?: readonly string[] };
export type VideoTranscript = { text: string; segments: readonly VideoTranscriptSegment[] };
export type AnalysisResult = {
    pluginId: string;
    status: "completed";
    segments: ReadonlyArray<{
        startMs: number;
        endMs: number;
        transcript?: string;
        prompt?: string;
        description?: string;
        /** References only; binary media remains in the resource store. */
        assets?: readonly VideoResourceRef[];
        keyframe?: VideoAnalysisKeyframe;
    }>;
    summary?: string;
    keyframes?: readonly VideoAnalysisKeyframe[];
    transcript?: VideoTranscript;
    sourceFingerprint?: string;
    durationMs?: number;
    /** Detectors that actually ran, not planned capabilities. */
    detectors?: readonly string[];
};
export type RenderProject = { engineId: string; format: string; version: number; content: Readonly<Record<string, unknown>> };
export type RenderResult = { status: "queued"; jobId: string; simulated: boolean } | { status: "completed"; resourceId: string; mimeType: string; durationSeconds: number; simulated: false };
export type VideoPluginAvailability = { available: true } | { available: false; reason: string };
export type VideoPluginOptions = { signal?: AbortSignal };

export interface VideoPlugin {
    readonly id: string;
    readonly name: string;
    readonly type: VideoPluginType;
    readonly capabilities: readonly VideoCapability[];
    getAvailability(): VideoPluginAvailability;
    analyze?(input: VideoInput, options?: VideoPluginOptions): Promise<AnalysisResult>;
    compile?(videoIR: VideoIR, options?: VideoPluginOptions): Promise<RenderProject>;
    render?(project: RenderProject, options?: VideoPluginOptions): Promise<RenderResult>;
    export?(project: RenderProject, options?: VideoPluginOptions): Promise<RenderResult>;
}

/** Convenience contracts, not exclusive plugin categories; one plugin can implement both. */
export interface VideoAnalyzerPlugin extends VideoPlugin {
    analyze(input: VideoInput, options?: VideoPluginOptions): Promise<AnalysisResult>;
}

export interface VideoRendererPlugin extends VideoPlugin {
    compile(videoIR: VideoIR, options?: VideoPluginOptions): Promise<RenderProject>;
    render(project: RenderProject, options?: VideoPluginOptions): Promise<RenderResult>;
}

export class VideoPluginError extends Error {
    constructor(
        public readonly code: "not-registered" | "disabled" | "permission-denied" | "runtime-unavailable" | "engine-mismatch" | "type-mismatch" | "invalid-input",
        message: string,
    ) {
        super(message);
        this.name = "VideoPluginError";
    }
}
