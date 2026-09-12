import { requestToolResponse, type ResponseFunctionTool, type ResponseInputMessage, type ToolChoice } from "@/services/api/image";
import { pluginStorageFor } from "@/lib/plugins/plugin-storage";
import { getMediaBlob } from "@/services/file-storage";
import { getResource, resourceStorageKey } from "@/services/api/resources";
import { loadAssetsForUse } from "@/services/user-data-sync";
import type { AiConfig } from "@/stores/use-config-store";
import { useAssetStore, type Asset } from "@/stores/use-asset-store";
import type { PluginHostContext, PluginInstallation, PluginMediaReference, PluginTextRequest, RegisteredPlugin, ResolvedPluginMedia } from "@/lib/plugins/plugin-types";

export function createPluginHostContext(plugin: RegisteredPlugin, installation: PluginInstallation, aiConfig: AiConfig): PluginHostContext {
    const permissions = new Set(plugin.manifest.permissions);
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
                        const response = await requestToolResponse(
                            { ...aiConfig, model: request.model?.trim() || aiConfig.textModel },
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
            },
            media: {
                resolve: (reference, signal) => resolvePluginMedia(reference, permissions.has("media.read"), signal),
            },
        },
    };
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
