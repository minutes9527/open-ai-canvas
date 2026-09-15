import { AlertCircle, Check, CheckCircle2, Clapperboard, Download, FileAudio, Frame, LoaderCircle, PlaySquare, Sparkles, Waves } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";

import { AppModal } from "@/components/ui/product/app-modal";
import { frameScriptReviewStatusLabel, frameScriptSkillContext, createDefaultFrameScriptVideoReviewState, sameFrameScriptVideoSourceBinding, type FrameScriptVideoReviewNodeState, type FrameScriptVideoSourceBinding } from "@/lib/framescript-video-review/contracts";
import { confirmVideoReview, transcriptForRange } from "@/lib/plugins/video-review";
import type { AnalysisResult } from "@/lib/plugins/video-plugin";
import { separateVideoScreenText } from "@/lib/plugins/video-text-separation";
import { frameScriptOriginalAnalysisForFrame, frameScriptShotDurationSeconds } from "@/lib/framescript-video-review/storyboard-content";
import type { VideoResourceRef } from "@/lib/video-engine/video-ir";
import { resourceIdFromStorageKey } from "@/services/api/resources";
import { resolveMediaUrl } from "@/services/file-storage";
import { createFrameScriptVideoReviewRuntime } from "@/services/framescript-video-review-runtime";
import type { CanvasNodeData } from "@/types/canvas";

import { useCanvasNodeActions, type FrameScriptCanvasFrame, type FrameScriptCanvasStoryboardFrame } from "../canvas-node-action-context";
import { useUpstreamNodes } from "../canvas-node-graph-context";

type FrameScriptVideoReviewNodeContentProps = {
    node: CanvasNodeData;
};

export function FrameScriptVideoReviewNodeContent({ node }: FrameScriptVideoReviewNodeContentProps) {
    const { updateNode, updateMetadata } = useCanvasNodeActions();
    const upstream = useUpstreamNodes(node.id);
    const source = upstream.find((candidate) => candidate.type === "video");
    const state = node.metadata?.framescriptVideoReview || createDefaultFrameScriptVideoReviewState();
    const [open, setOpen] = useState(false);
    const sourceRef = source ? videoReferenceForNode(source) : null;
    const sourceBinding = source ? videoBindingForNode(source) : null;
    const staleSource = Boolean(state.source && (!source || !sourceRef || !sourceBinding
        || state.sourceNodeId !== source.id
        || !sameFrameScriptVideoSourceBinding(state.sourceBinding, sourceBinding)
        || state.source.kind !== sourceRef.kind
        || state.source.id !== sourceRef.id));

    const updateState = (patch: Partial<FrameScriptVideoReviewNodeState>) => {
        const contextPatch = patch.breakdown
            ? { content: frameScriptSkillContext(patch.breakdown) }
            : Object.hasOwn(patch, "breakdown") ? { content: "" } : {};
        const next = {
            ...(node.metadata?.framescriptVideoReview || createDefaultFrameScriptVideoReviewState()),
            ...patch,
            schemaVersion: 1 as const,
            updatedAt: new Date().toISOString(),
        };
        if (updateNode) {
            updateNode(node.id, (current) => ({
                ...current,
                metadata: {
                    ...current.metadata,
                    framescriptVideoReview: {
                        ...(current.metadata?.framescriptVideoReview || createDefaultFrameScriptVideoReviewState()),
                        ...patch,
                        schemaVersion: 1 as const,
                        updatedAt: next.updatedAt,
                    },
                    ...contextPatch,
                },
            }));
            return;
        }
        updateMetadata?.(node.id, { framescriptVideoReview: next, ...contextPatch });
    };

    return <>
        <div className="flex h-full min-h-0 flex-col gap-3 overflow-hidden p-4 pt-10 text-[12px] text-white">
            <div className="flex items-start gap-2.5">
                <span className="grid size-8 shrink-0 place-items-center rounded-xl bg-cyan-400/12 text-cyan-300 ring-1 ring-cyan-300/20"><Sparkles className="size-4" /></span>
                <div className="min-w-0 flex-1">
                    <div className="truncate text-[13px] font-semibold">FrameScript Video Engine</div>
                    <p className="mt-0.5 text-[11px] text-white/45">候选抽帧 · 语音转写 · 确认后理解</p>
                </div>
                <StatusPill status={state.status} />
            </div>

            <div className="grid grid-cols-3 gap-1.5 rounded-xl border border-white/8 bg-black/20 p-2">
                <Step icon={<PlaySquare className="size-3.5" />} label="视频" active={Boolean(source)} done={Boolean(source)} />
                <Step icon={<Frame className="size-3.5" />} label="人工复核" active={state.status !== "idle"} done={Boolean(state.review)} />
                <Step icon={<Sparkles className="size-3.5" />} label="Skill 上下文" active={Boolean(state.breakdown)} done={Boolean(state.breakdown)} />
            </div>

            {source ? <div className="flex min-w-0 items-center gap-2 rounded-lg bg-white/[0.045] px-2.5 py-2 text-[11px] text-white/65">
                <Clapperboard className="size-3.5 shrink-0 text-cyan-300" />
                <span className="truncate">{source.title || "已连接视频"}</span>
                {state.draft?.transcript ? <FileAudio className="ml-auto size-3.5 shrink-0 text-emerald-300" /> : null}
            </div> : <div className="rounded-lg border border-dashed border-white/15 px-2.5 py-2 text-[11px] text-white/45">从左侧连接一个已保存的视频素材</div>}

            {state.draft ? <div className="flex items-center gap-2 text-[11px] text-white/55">
                <span>{state.draft.frames.length} 个候选画面</span><span className="h-3 w-px bg-white/15" />
                <span>{state.review?.frames.length || 0} 个已确认</span>
                {state.draft.transcript ? <span className="ml-auto text-emerald-300/85">已转写</span> : null}
            </div> : null}

            {state.errorMessage ? <div className="line-clamp-2 flex items-start gap-1.5 text-[11px] leading-4 text-amber-200"><AlertCircle className="mt-0.5 size-3 shrink-0" />{state.errorMessage}</div> : null}
            {staleSource ? <div className="flex items-start gap-1.5 text-[11px] leading-4 text-amber-200"><AlertCircle className="mt-0.5 size-3 shrink-0" />原视频已变化，请重新准备候选帧。</div> : null}

            <button type="button" className="mt-auto inline-flex h-8 w-full items-center justify-center gap-1.5 rounded-lg bg-cyan-400 px-3 text-[12px] font-semibold text-slate-950 transition hover:bg-cyan-300 disabled:cursor-not-allowed disabled:bg-white/10 disabled:text-white/45" disabled={!source || !sourceRef} onClick={(event) => { event.stopPropagation(); setOpen(true); }}>
                {state.status === "preparing" || state.status === "analyzing" ? <LoaderCircle className="size-3.5 animate-spin" /> : <Sparkles className="size-3.5" />}
                {state.breakdown ? "查看分析结果" : state.draft ? "打开人工复核" : "开始视频复核"}
            </button>
        </div>
        <FrameScriptReviewModal
            open={open}
            node={node}
            source={source}
            sourceRef={sourceRef}
            sourceBinding={sourceBinding}
            state={state}
            staleSource={staleSource}
            onClose={() => setOpen(false)}
            onUpdate={updateState}
        />
    </>;
}

function FrameScriptReviewModal({ open, node, source, sourceRef, sourceBinding, state, staleSource, onClose, onUpdate }: {
    open: boolean;
    node: CanvasNodeData;
    source?: CanvasNodeData;
    sourceRef: VideoResourceRef | null;
    sourceBinding: FrameScriptVideoSourceBinding | null;
    state: FrameScriptVideoReviewNodeState;
    staleSource: boolean;
    onClose: () => void;
    onUpdate: (patch: Partial<FrameScriptVideoReviewNodeState>) => void;
}) {
    const { addFrameScriptImageNodes, addFrameScriptStoryboardNode } = useCanvasNodeActions();
    const [selectedIds, setSelectedIds] = useState<string[]>([]);
    const [sourceUrl, setSourceUrl] = useState("");
    const [thumbnails, setThumbnails] = useState<Record<string, string>>({});
    const [thumbnailFailures, setThumbnailFailures] = useState<Record<string, true>>({});
    const requestTokenRef = useRef(0);
    const activeRequestRef = useRef(false);
    const persistenceTokenRef = useRef<string | null>(null);
    const restoredCheckpointRef = useRef("");
    const restoredSelectionRef = useRef<string[] | null>(null);
    const currentBindingRef = useRef<FrameScriptVideoSourceBinding | null>(sourceBinding);
    const onUpdateRef = useRef(onUpdate);
    currentBindingRef.current = sourceBinding;
    onUpdateRef.current = onUpdate;
    const busy = !staleSource && (state.status === "preparing" || state.status === "analyzing");
    const draft = state.draft;

    useEffect(() => {
        if (!open) return;
        const confirmed = state.review?.frames?.length ? state.review.frames : state.breakdown?.review.frames;
        setSelectedIds(confirmed?.map((frame) => frame.id) || restoredSelectionRef.current || []);
    }, [draft?.revision, open, state.breakdown?.review.frames, state.review]);

    useEffect(() => {
        requestTokenRef.current += 1;
        activeRequestRef.current = false;
        persistenceTokenRef.current = null;
        restoredCheckpointRef.current = "";
        restoredSelectionRef.current = null;
    }, [sourceBinding?.assetId, sourceBinding?.nodeId, sourceBinding?.storageKey]);

    // A page refresh cannot resume an in-flight browser request. The single
    // checkpoint recovery path below converts that transient state into a
    // fresh manual-review state while preserving the storage write token.
    useEffect(() => {
        const interrupted = state.status === "preparing" || state.status === "analyzing";
        if (!open || !sourceRef || staleSource || (draft && !interrupted) || activeRequestRef.current) return;
        const checkpointKey = `${sourceRef.kind}:${sourceRef.id}`;
        if (restoredCheckpointRef.current === checkpointKey) return;
        restoredCheckpointRef.current = checkpointKey;
        let live = true;
        void (async () => {
            try {
                const runtime = createFrameScriptVideoReviewRuntime();
                const restored = await runtime.persistence.load(sourceRef);
                if (!live) return;
                if (restored.status === "missing") {
                    if (state.status === "preparing" || state.status === "analyzing") onUpdateRef.current({ status: "error", errorMessage: "页面已刷新，之前的本地处理无法恢复；请重新准备候选帧。", draft: undefined, review: undefined, breakdown: undefined, persistenceToken: undefined });
                    return;
                }
                if (restored.status !== "restored") {
                    if (state.status === "preparing" || state.status === "analyzing") onUpdateRef.current({ status: "error", errorMessage: "原视频已变化，请重新准备候选帧。", draft: undefined, review: undefined, breakdown: undefined, persistenceToken: undefined });
                    return;
                }
                restoredSelectionRef.current = restored.selectedIds;
                persistenceTokenRef.current = restored.writeToken;
                onUpdateRef.current({
                    status: "awaiting-review",
                    source: sourceRef,
                    sourceNodeId: source?.id,
                    sourceBinding: sourceBinding || undefined,
                    sourceTitle: source?.title,
                    draft: restored.draft,
                    review: undefined,
                    breakdown: undefined,
                    persistenceToken: restored.writeToken,
                    errorMessage: undefined,
                });
            } catch (error) {
                // Checkpoint recovery is best-effort; durable canvas metadata remains authoritative.
                if (live && (state.status === "preparing" || state.status === "analyzing")) onUpdateRef.current({ status: "error", errorMessage: reviewErrorMessage(error), draft: undefined, review: undefined, breakdown: undefined, persistenceToken: undefined });
            }
        })();
        return () => {
            live = false;
            // If the modal closes while recovery is pending, allow the next
            // open to start a fresh checkpoint load instead of treating the
            // cancelled attempt as already restored.
            if (restoredCheckpointRef.current === checkpointKey) restoredCheckpointRef.current = "";
        };
    }, [draft, open, source?.id, sourceBinding?.assetId, sourceBinding?.nodeId, sourceBinding?.storageKey, sourceRef?.id, sourceRef?.kind, staleSource, state.status]);

    useEffect(() => {
        let live = true;
        const fallback = source?.metadata?.previewContent || source?.metadata?.content || "";
        setSourceUrl(fallback);
        const storageKey = source?.metadata?.storageKey;
        if (!storageKey) return () => { live = false; };
        void resolveMediaUrl(storageKey, fallback).then((url) => { if (live) setSourceUrl(url || fallback); }).catch(() => { if (live) setSourceUrl(fallback); });
        return () => { live = false; };
    }, [source?.id, source?.metadata?.content, source?.metadata?.previewContent, source?.metadata?.storageKey]);

    useEffect(() => {
        const persistedFrames = state.review?.frames?.length
            ? state.review.frames
            : state.breakdown?.review.frames?.length
                ? state.breakdown.review.frames
                : (state.breakdown?.analysis.keyframes || []).map((frame) => ({ ...frame, id: `frame-${frame.timeMs}` }));
        const previewFrames = draft?.frames?.length ? draft.frames : persistedFrames;
        if (!open || !previewFrames.length || !sourceUrl) return;
        let live = true;
        const urls: string[] = [];
        const frames = previewFrames;
        let cursor = 0;
        setThumbnails({});
        setThumbnailFailures({});
        const worker = async () => {
            while (live) {
                const frame = frames[cursor++];
                if (!frame) return;
                try {
                    const url = await captureVideoThumbnail(sourceUrl, frame.timeMs);
                    urls.push(url);
                    if (live) setThumbnails((current) => ({ ...current, [frame.id]: url }));
                    else URL.revokeObjectURL(url);
                } catch {
                    if (live) setThumbnailFailures((current) => ({ ...current, [frame.id]: true }));
                }
            }
        };
        void Promise.all(Array.from({ length: Math.min(4, frames.length) }, worker));
        return () => {
            live = false;
            urls.forEach((url) => URL.revokeObjectURL(url));
        };
    }, [draft?.revision, open, sourceUrl, state.breakdown?.analysis.keyframes, state.breakdown?.review.frames, state.review?.frames]);

    const prepare = async () => {
        if (!source || !sourceRef || !sourceBinding) return;
        const token = ++requestTokenRef.current;
        const requestBinding = sourceBinding;
        activeRequestRef.current = true;
        onUpdate({ status: "preparing", source: sourceRef, sourceNodeId: source.id, sourceBinding: requestBinding, sourceTitle: source.title, errorMessage: undefined, draft: undefined, review: undefined, breakdown: undefined, persistenceToken: undefined });
        try {
            const runtime = createFrameScriptVideoReviewRuntime();
            const nextDraft = await runtime.workflow.prepare(runtime.provider, sourceRef, true);
            try {
                const checkpoint = await runtime.persistence.save(nextDraft, [], null);
                persistenceTokenRef.current = checkpoint.writeToken;
            } catch {
                // Canvas metadata still preserves the draft if browser storage is unavailable.
            }
            if (token !== requestTokenRef.current || !sameFrameScriptVideoSourceBinding(currentBindingRef.current, requestBinding)) return;
            activeRequestRef.current = false;
            onUpdate({ status: "awaiting-review", source: sourceRef, sourceNodeId: source.id, sourceBinding: requestBinding, sourceTitle: source.title, draft: nextDraft, review: undefined, breakdown: undefined, persistenceToken: persistenceTokenRef.current || undefined, errorMessage: undefined });
        } catch (error) {
            if (token !== requestTokenRef.current || !sameFrameScriptVideoSourceBinding(currentBindingRef.current, requestBinding)) return;
            activeRequestRef.current = false;
            onUpdate({ status: "error", errorMessage: reviewErrorMessage(error) });
        }
    };

    const confirm = async () => {
        if (!draft || staleSource || !sourceBinding || activeRequestRef.current) return;
        const token = ++requestTokenRef.current;
        const requestBinding = sourceBinding;
        activeRequestRef.current = true;
        try {
            const review = confirmVideoReview(draft, selectedIds);
            try {
                const runtime = createFrameScriptVideoReviewRuntime();
                const checkpoint = await runtime.persistence.save(draft, selectedIds, persistenceTokenRef.current ?? state.persistenceToken ?? null);
                persistenceTokenRef.current = checkpoint.writeToken;
            } catch (error) {
                // The confirmed snapshot is still written to the canvas node below.
                if (error instanceof Error && "code" in error && (error as { code?: string }).code !== "runtime-unavailable") throw error;
            }
            if (token !== requestTokenRef.current || !sameFrameScriptVideoSourceBinding(currentBindingRef.current, requestBinding)) return;
            activeRequestRef.current = false;
            onUpdate({ status: "awaiting-review", review, persistenceToken: persistenceTokenRef.current || state.persistenceToken || undefined, errorMessage: undefined });
        } catch (error) {
            if (token !== requestTokenRef.current || !sameFrameScriptVideoSourceBinding(currentBindingRef.current, requestBinding)) return;
            activeRequestRef.current = false;
            onUpdate({ status: "error", errorMessage: reviewErrorMessage(error) });
        }
    };

    const analyze = async () => {
        if (!draft || !state.review || staleSource || !reviewMatchesSelection || !sourceBinding) return;
        const token = ++requestTokenRef.current;
        const requestBinding = sourceBinding;
        activeRequestRef.current = true;
        onUpdate({ status: "analyzing", errorMessage: undefined });
        try {
            const runtime = createFrameScriptVideoReviewRuntime();
            const breakdown = await runtime.workflow.analyzeSelected(runtime.provider, draft, state.review, ["video-analysis", "scene-understanding", "asset-analysis", "prompt-extraction"]);
            if (token !== requestTokenRef.current || !sameFrameScriptVideoSourceBinding(currentBindingRef.current, requestBinding)) return;
            activeRequestRef.current = false;
            onUpdate({
                status: "completed",
                breakdown,
                errorMessage: undefined,
            });
        } catch (error) {
            if (token !== requestTokenRef.current || !sameFrameScriptVideoSourceBinding(currentBindingRef.current, requestBinding)) return;
            activeRequestRef.current = false;
            onUpdate({ status: "error", errorMessage: reviewErrorMessage(error) });
        }
    };

    const selectedCount = selectedIds.length;
    const selectedSet = new Set(selectedIds);
    const activeReview = state.review?.frames?.length ? state.review : state.breakdown?.review;
    const selectedPreviewsReady = Boolean(selectedIds.length) && selectedIds.every((id) => Boolean(thumbnails[id]) && !thumbnailFailures[id]);
    const reviewMatchesSelection = Boolean(activeReview
        && activeReview.frames.length === selectedIds.length
        && activeReview.frames.every((frame) => selectedSet.has(frame.id)));
    const summary = state.breakdown?.analysis.summary || state.breakdown?.analysis.segments.map((segment) => segment.description || segment.prompt).filter(Boolean).join("\n\n");
    const buildConfirmedFrames = (): FrameScriptCanvasStoryboardFrame[] => {
        if (!sourceRef) return [];
        const sourceFrames = draft?.frames?.length ? draft.frames : activeReview?.frames || [];
        const confirmed = selectedIds.flatMap((id) => {
            const frame = sourceFrames.find((candidate) => candidate.id === id);
            const imageUrl = thumbnails[id];
            return frame && imageUrl ? [{ frame, imageUrl }] : [];
        }).sort((left, right) => left.frame.timeMs - right.frame.timeMs);
        return confirmed.map(({ frame, imageUrl }, index) => {
            const nextTimeMs = confirmed[index + 1]?.frame.timeMs ?? draft?.durationMs ?? frame.timeMs + 1000;
            const endMs = Math.max(frame.timeMs + 1000, nextTimeMs);
            const segment = state.breakdown?.analysis.segments.find((candidate) => candidate.startMs <= frame.timeMs && candidate.endMs > frame.timeMs)
                || state.breakdown?.analysis.segments.find((candidate) => candidate.startMs < endMs && candidate.endMs > frame.timeMs);
            const transcript = transcriptForRange(state.breakdown?.transcript || draft?.transcript, frame.timeMs, endMs)
                .map((item) => item.cleanedText || item.originalText)
                .filter(Boolean)
                .join(" ");
            const description = separateVideoScreenText(segment?.description);
            const prompt = separateVideoScreenText(segment?.prompt);
            const screenText = [segment?.screenText, description.screenText, prompt.screenText].filter(Boolean).join("；") || undefined;
            return {
                id: frame.id,
                originalAnalysis: frameScriptOriginalAnalysisForFrame(state.breakdown, frame.id),
                index: index + 1,
                timeMs: frame.timeMs,
                imageUrl,
                sourceVideoId: sourceRef.id,
                reasons: [...frame.reasons],
                durationSeconds: frameScriptShotDurationSeconds(frame.timeMs, endMs),
                description: description.visual || segment?.description,
                imageGenerationPrompt: prompt.visual || description.visual || segment?.prompt || segment?.description,
                videoMotionPrompt: description.visual || prompt.visual || segment?.description || segment?.prompt,
                dialogue: segment?.transcript || transcript,
                screenText,
            };
        });
    };
    const exportConfirmedFrames = async () => {
        if (!addFrameScriptImageNodes || !activeReview || !reviewMatchesSelection || !sourceRef) return;
        const frames: FrameScriptCanvasFrame[] = buildConfirmedFrames();
        if (!frames.length) return;
        await addFrameScriptImageNodes(node, frames);
    };
    const exportStoryboard = async () => {
        if (!addFrameScriptStoryboardNode || !activeReview || !reviewMatchesSelection || !sourceRef) return;
        const frames = buildConfirmedFrames();
        if (!frames.length) return;
        await addFrameScriptStoryboardNode(node, frames);
    };

    return <AppModal open={open} onCancel={onClose} footer={null} width="min(1120px, calc(100vw - 32px))" centered flush title={null}>
        <div className="flex max-h-[min(780px,calc(100vh-48px))] min-h-[560px] overflow-hidden bg-[#111315] text-white">
            <section className="flex min-w-0 flex-1 flex-col border-r border-white/10">
                <header className="flex items-start justify-between gap-4 border-b border-white/10 px-6 py-5">
                    <div className="min-w-0"><div className="flex items-center gap-2 text-base font-semibold"><Sparkles className="size-4 text-cyan-300" />FrameScript 视频复核</div><p className="mt-1 text-xs text-white/45">先提取候选帧和原声转写；只有人工确认后才会发送选中画面做理解。</p>{state.errorMessage ? <div role="alert" className="mt-3 flex items-start gap-2 rounded-lg border border-amber-300/25 bg-amber-300/8 px-3 py-2 text-xs leading-5 text-amber-100"><AlertCircle className="mt-0.5 size-3.5 shrink-0" />{state.errorMessage}</div> : null}</div>
                    <StatusPill status={state.status} />
                </header>

                <div className="thin-scrollbar min-h-0 flex-1 overflow-y-auto px-6 py-5">
                    {!source || !sourceRef ? <EmptyState icon={<PlaySquare className="size-5" />} title="连接一个已保存的视频" description="请从视频节点拖线到 FrameScript 节点；原视频会由宿主按权限读取。" />
                        : !draft || staleSource ? <PrepareState source={source} busy={busy} staleSource={staleSource} onPrepare={() => void prepare()} />
                        : state.breakdown ? <AnalysisResult summary={summary} segments={state.breakdown.analysis.segments} reviewFrames={state.review?.frames?.length ? state.review.frames : state.breakdown.review.frames} thumbnails={thumbnails} selectedCount={state.review?.frames?.length || state.breakdown.review.frames.length} transcript={state.breakdown.transcript?.text || draft.transcript?.text} />
                        : <CandidateReview draft={draft} thumbnails={thumbnails} thumbnailFailures={thumbnailFailures} selectedSet={selectedSet} transcript={draft.transcript?.text} onToggle={(id) => setSelectedIds((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id])} />}
                </div>

                {draft && !state.breakdown && !staleSource ? <footer className="flex items-center justify-between gap-4 border-t border-white/10 px-6 py-4">
                    <div className="min-w-0 text-xs text-white/45">{draft.transcript ? <span className="inline-flex items-center gap-1 text-emerald-300/90"><Waves className="size-3.5" />原视频已并行转写</span> : "未检测到可用语音转写"}<span className="ml-3 hidden text-white/35 xl:inline">确认后开始逐帧分析，完成后可生成分镜复刻。</span></div>
                    <div className="flex items-center gap-2">
                        {state.review && reviewMatchesSelection ? <button type="button" disabled={busy || !selectedPreviewsReady || !addFrameScriptImageNodes} className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-cyan-300/45 px-3 text-xs font-semibold text-cyan-200 disabled:opacity-50" onClick={() => void exportConfirmedFrames()}><Download className="size-3.5" />导出已确认分镜</button> : null}
                        {state.review && reviewMatchesSelection ? <button type="button" disabled className="hidden h-9 items-center gap-1.5 rounded-lg border border-white/15 px-3 text-xs font-semibold text-white/45 sm:inline-flex" title="完成逐帧分析后可导出分镜复刻"><Clapperboard className="size-3.5" />分析后导出分镜复刻</button> : null}
                        {reviewMatchesSelection ? <button type="button" disabled={busy || !selectedPreviewsReady} className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-cyan-400 px-4 text-xs font-semibold text-slate-950 disabled:opacity-50" onClick={() => void analyze()}>{busy ? <LoaderCircle className="size-3.5 animate-spin" /> : <Sparkles className="size-3.5" />}开始逐帧分析</button>
                            : <button type="button" disabled={!selectedCount || busy || !selectedPreviewsReady} className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-cyan-400 px-4 text-xs font-semibold text-slate-950 disabled:opacity-50" onClick={() => void confirm()}><Check className="size-3.5" />确认 {selectedCount} 个候选画面</button>}
                    </div>
                </footer> : null}
                {draft && state.breakdown && activeReview && reviewMatchesSelection && !staleSource ? <footer className="flex flex-wrap items-center justify-end gap-3 border-t border-white/10 px-6 py-4"><button type="button" disabled={!selectedPreviewsReady || !addFrameScriptImageNodes} className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-cyan-300/45 px-3 text-xs font-semibold text-cyan-200 disabled:opacity-50" onClick={() => void exportConfirmedFrames()}><Download className="size-3.5" />导出确认分镜图片</button><button type="button" disabled={!selectedPreviewsReady || !addFrameScriptStoryboardNode} className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-cyan-400 px-3 text-xs font-semibold text-slate-950 disabled:opacity-50" onClick={() => void exportStoryboard()}><Clapperboard className="size-3.5" />导出分镜复刻</button></footer> : null}
            </section>
            <aside className="hidden w-[276px] shrink-0 bg-white/[0.025] p-5 lg:block">
                <div className="text-xs font-semibold text-white/85">工作流边界</div>
                <ol className="mt-4 space-y-4 text-xs leading-5 text-white/50">
                    <li className="flex gap-2"><span className="grid size-5 shrink-0 place-items-center rounded-full bg-cyan-400/15 text-[10px] text-cyan-200">1</span><span>抽帧按照实际画面变化取样；当前已运行的检测器会完整记录。</span></li>
                    <li className="flex gap-2"><span className="grid size-5 shrink-0 place-items-center rounded-full bg-cyan-400/15 text-[10px] text-cyan-200">2</span><span>候选画面必须由你筛选确认，未确认的帧不会进入画面分析。</span></li>
                    <li className="flex gap-2"><span className="grid size-5 shrink-0 place-items-center rounded-full bg-cyan-400/15 text-[10px] text-cyan-200">3</span><span>完成后可将此节点连到 Skill，作为结构化分析上下文。</span></li>
                </ol>
                {node.title ? <div className="mt-8 rounded-lg border border-white/8 bg-black/20 p-3 text-[11px] text-white/45">节点：{node.title}</div> : null}
            </aside>
        </div>
    </AppModal>;
}

function PrepareState({ source, busy, staleSource, onPrepare }: { source: CanvasNodeData; busy: boolean; staleSource: boolean; onPrepare: () => void }) {
    return <div className="mx-auto flex max-w-md flex-col items-center py-20 text-center"><span className="grid size-14 place-items-center rounded-2xl bg-cyan-400/10 text-cyan-200"><Frame className="size-6" /></span><h3 className="mt-5 text-base font-semibold">{staleSource ? "视频内容已更新" : "准备候选帧复核"}</h3><p className="mt-2 text-sm leading-6 text-white/50">{staleSource ? "重新扫描后会使旧的人工确认失效。" : `将为「${source.title || "当前视频"}」提取候选画面，并并行转写原视频声音。`}</p><button type="button" disabled={busy} className="mt-6 inline-flex h-10 items-center gap-2 rounded-lg bg-cyan-400 px-4 text-sm font-semibold text-slate-950 disabled:opacity-50" onClick={onPrepare}>{busy ? <LoaderCircle className="size-4 animate-spin" /> : <PlaySquare className="size-4" />}{busy ? "正在准备…" : staleSource ? "重新准备复核" : "提取候选帧并转写"}</button></div>;
}

function CandidateReview({ draft, thumbnails, thumbnailFailures, selectedSet, transcript, onToggle }: { draft: NonNullable<FrameScriptVideoReviewNodeState["draft"]>; thumbnails: Record<string, string>; thumbnailFailures: Record<string, true>; selectedSet: Set<string>; transcript?: string; onToggle: (id: string) => void }) {
    return <div><div className="flex flex-wrap items-end justify-between gap-3"><div><h3 className="text-sm font-semibold">候选帧人工复核</h3><p className="mt-1 text-xs text-white/45">只可选择已显示的画面；确认后会生成画面文案、画面字幕和对应语音/台词。</p></div><span className="text-xs text-white/40">{draft.frames.length} 个候选 · {draft.detectors.join("、") || "本地检测"}</span></div><div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-4">{draft.frames.map((frame) => { const selected = selectedSet.has(frame.id); const preview = thumbnails[frame.id]; const failed = thumbnailFailures[frame.id]; const ready = Boolean(preview); return <button type="button" key={frame.id} aria-pressed={selected} disabled={!ready && !selected} className={`group relative overflow-hidden rounded-xl border text-left transition disabled:cursor-not-allowed disabled:opacity-55 ${selected ? "border-cyan-300 ring-1 ring-cyan-300/70" : "border-white/10 hover:border-white/30"}`} onClick={() => onToggle(frame.id)}><div className="relative bg-white/[0.04]">{preview ? <img src={preview} alt={`${formatTime(frame.timeMs)} 候选画面`} className="block h-auto w-full object-contain" /> : <div className="grid aspect-video size-full place-items-center gap-1 text-[10px] text-white/30"><Frame className="size-4" /><span>{failed ? "预览读取失败" : "预览准备中"}</span></div>}{selected ? <span className="absolute right-2 top-2 grid size-5 place-items-center rounded-full bg-cyan-300 text-slate-950"><Check className="size-3" /></span> : null}</div><div className="space-y-1 p-2"><div className="flex justify-between gap-2 text-[11px] font-semibold"><span>{formatTime(frame.timeMs)}</span><span className="text-white/45">{Math.round(frame.score * 100)}%</span></div><div className="truncate text-[10px] text-white/45">{frame.reasons.map(reasonLabel).join(" · ")}</div></div></button>; })}</div>{transcript ? <details className="mt-5 rounded-xl border border-white/10 bg-black/15 p-3"><summary className="cursor-pointer text-xs text-white/70">原视频语音转文字</summary><p className="mt-3 whitespace-pre-wrap text-xs leading-6 text-white/55">{transcript}</p></details> : <div className="mt-5 rounded-xl border border-dashed border-white/10 p-3 text-xs text-white/35">当前未检测到可用的原视频语音转文字。</div>}</div>;
}

function AnalysisResult({ summary, segments, reviewFrames, thumbnails, selectedCount, transcript }: { summary?: string; segments: AnalysisResult["segments"]; reviewFrames: readonly { id: string; timeMs: number }[]; thumbnails: Record<string, string>; selectedCount: number; transcript?: string }) {
    const orderedSegments = [...segments].sort((left, right) => left.startMs - right.startMs);
    const frameByTime = new Map(reviewFrames.map((frame) => [frame.timeMs, frame]));
    const frameForSegment = (segment: AnalysisResult["segments"][number], index: number) => {
        const targetTime = segment.keyframe?.timeMs ?? segment.startMs;
        const exact = frameByTime.get(targetTime);
        if (exact) return exact;
        const nearest = reviewFrames
            .map((frame) => ({ frame, distance: Math.abs(frame.timeMs - targetTime) }))
            .sort((left, right) => left.distance - right.distance)[0];
        return nearest?.distance <= 1500 ? nearest.frame : reviewFrames[index];
    };
    const overall = separateVideoScreenText(summary);
    return <div>
        <div className="flex items-center gap-2">
            <span className="grid size-7 place-items-center rounded-full bg-emerald-400/15 text-emerald-300"><CheckCircle2 className="size-4" /></span>
            <div><h3 className="text-sm font-semibold">已生成视频理解上下文</h3><p className="text-xs text-white/45">基于 {selectedCount} 个经人工确认的画面。</p></div>
        </div>
        <div className="mt-5 grid grid-cols-1 items-start gap-3 sm:grid-cols-2">
            {orderedSegments.length ? orderedSegments.map((segment, index) => {
                const frame = frameForSegment(segment, index);
                const preview = frame ? thumbnails[frame.id] : undefined;
                const description = separateVideoScreenText(segment.description);
                const prompt = separateVideoScreenText(segment.prompt);
                const screenText = [segment.screenText, description.screenText, prompt.screenText].filter(Boolean).join("；");
                return <article key={`${segment.startMs}-${index}`} className="overflow-hidden rounded-xl border border-white/10 bg-black/20">
                    <div className="overflow-hidden bg-black/25">{preview ? <img src={preview} alt={`镜头 ${index + 1} 原始画面`} className="block h-auto w-full object-contain" /> : <div className="grid h-36 w-full place-items-center text-[10px] text-white/35">原帧读取中</div>}</div>
                    <div className="p-3">
                        <div className="flex items-center justify-between gap-2 text-xs"><span className="font-semibold text-cyan-200">镜头 {index + 1}</span><span className="text-white/40">{formatTime(segment.startMs)}–{formatTime(segment.endMs)}</span></div>
                        <p className="mt-2 line-clamp-4 text-xs leading-5 text-white/75"><span className="text-white/45">画面文案：</span>{prompt.visual || description.visual || "—"}</p>
                        {screenText ? <p className="mt-1 line-clamp-2 text-xs leading-5 text-amber-200/80"><span className="text-white/45">画面字幕：</span>{screenText}</p> : null}
                        {segment.transcript ? <p className="mt-1 line-clamp-2 text-xs leading-5 text-emerald-200/75"><span className="text-white/45">语音/台词：</span>{segment.transcript}</p> : null}
                    </div>
                </article>;
            }) : <div className="rounded-xl border border-white/10 bg-black/20 p-4 text-xs leading-6 text-white/55">分析已返回结构化分段结果，可连接到 Skill 作为上下文。</div>}
        </div>
        {overall.visual ? <details className="mt-4 rounded-xl border border-white/10 p-3"><summary className="cursor-pointer text-xs text-white/65">整体分析摘要</summary><pre className="mt-3 whitespace-pre-wrap text-xs leading-6 text-white/60">{overall.visual}</pre></details> : null}
        {transcript ? <details className="mt-4 rounded-xl border border-white/10 p-3"><summary className="cursor-pointer text-xs text-white/65">原视频语音转写</summary><p className="mt-3 whitespace-pre-wrap text-xs leading-6 text-white/50">{transcript}</p></details> : null}
    </div>;
}

function EmptyState({ icon, title, description }: { icon: ReactNode; title: string; description: string }) { return <div className="mx-auto flex max-w-sm flex-col items-center py-24 text-center"><span className="grid size-12 place-items-center rounded-2xl bg-white/[0.05] text-white/50">{icon}</span><h3 className="mt-4 text-sm font-semibold">{title}</h3><p className="mt-2 text-xs leading-5 text-white/45">{description}</p></div>; }
function Step({ icon, label, active, done }: { icon: ReactNode; label: string; active: boolean; done: boolean }) { return <div className={`flex min-w-0 flex-col items-center gap-1 rounded-lg py-1.5 text-[10px] ${active ? "text-cyan-200" : "text-white/35"}`}><span className={`grid size-5 place-items-center rounded-md ${done ? "bg-cyan-300 text-slate-950" : active ? "bg-cyan-300/15" : "bg-white/5"}`}>{done ? <Check className="size-3" /> : icon}</span><span className="truncate">{label}</span></div>; }
function StatusPill({ status }: { status: FrameScriptVideoReviewNodeState["status"] }) { const tone = status === "completed" ? "bg-emerald-400/12 text-emerald-300" : status === "error" ? "bg-amber-400/12 text-amber-200" : status === "awaiting-review" ? "bg-cyan-400/12 text-cyan-200" : "bg-white/[0.07] text-white/55"; return <span className={`shrink-0 rounded-full px-2 py-1 text-[10px] font-medium ${tone}`}>{frameScriptReviewStatusLabel(status)}</span>; }

function videoReferenceForNode(node: CanvasNodeData): VideoResourceRef | null {
    const resourceId = resourceIdFromStorageKey(node.metadata?.storageKey);
    if (resourceId) return { kind: "resource", id: resourceId };
    if (node.metadata?.assetId) return { kind: "asset", id: node.metadata.assetId };
    return null;
}

function videoBindingForNode(node: CanvasNodeData): FrameScriptVideoSourceBinding {
    return {
        nodeId: node.id,
        storageKey: node.metadata?.storageKey || undefined,
        assetId: node.metadata?.assetId || undefined,
    };
}

function reviewErrorMessage(error: unknown) { return error instanceof Error ? error.message : "FrameScript 视频复核失败，请稍后重试"; }
function formatTime(ms: number) { const total = Math.max(0, Math.floor(ms / 1000)); return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`; }
function reasonLabel(reason: string) { return ({ opening: "开场", closing: "收尾", "visual-change": "画面变化", "scene-cut": "切镜", "scene-change": "场景变化", "motion-change": "运动变化", "person-movement": "人物运动", "text-change": "字幕变化", manual: "人工保留" } as Record<string, string>)[reason] || reason; }

async function captureVideoThumbnail(sourceUrl: string, timeMs: number) {
    const video = document.createElement("video");
    video.muted = true;
    video.playsInline = true;
    video.preload = "auto";
    const loaded = waitForVideoEvent(video, "loadeddata");
    video.src = sourceUrl;
    video.load();
    await loaded;
    const seeked = waitForVideoEvent(video, "seeked");
    video.currentTime = Math.max(0, Math.min(timeMs / 1000, Math.max(0, video.duration - 0.02)));
    await seeked;
    const max = 480;
    const ratio = Math.min(1, max / Math.max(video.videoWidth, video.videoHeight));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(2, Math.round(video.videoWidth * ratio));
    canvas.height = Math.max(2, Math.round(video.videoHeight * ratio));
    const context = canvas.getContext("2d");
    if (!context) throw new Error("无法创建预览画布");
    context.drawImage(video, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob((value) => value ? resolve(value) : reject(new Error("无法生成预览")), "image/jpeg", 0.82));
    video.removeAttribute("src");
    video.load();
    return URL.createObjectURL(blob);
}

function waitForVideoEvent(video: HTMLVideoElement, event: "loadeddata" | "seeked") { return new Promise<void>((resolve, reject) => { const timeout = window.setTimeout(() => done(new Error("读取视频预览超时")), 12_000); const done = (error?: Error) => { window.clearTimeout(timeout); video.removeEventListener(event, onDone); video.removeEventListener("error", onError); error ? reject(error) : resolve(); }; const onDone = () => done(); const onError = () => done(new Error("读取视频预览失败")); video.addEventListener(event, onDone, { once: true }); video.addEventListener("error", onError, { once: true }); }); }
