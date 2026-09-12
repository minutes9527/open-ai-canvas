import { describe, expect, test } from "bun:test";
import { frameScriptVideoEnginePlugin } from "@/lib/plugins/builtin/framescript-video-engine";
import "@/lib/plugins/builtin/mock-video-renderer";
import { getRegisteredPlugin } from "@/lib/plugins/plugin-registry";
import type { PluginHostContext } from "@/lib/plugins/plugin-types";
import { VideoPipeline } from "@/services/video-pipeline";

const storage = { get: async () => null, set: async () => {}, remove: async () => {} };

describe("video plugin execution boundaries", () => {
    test("registers both the real FrameScript plugin and the Mock Renderer", () => {
        expect(getRegisteredPlugin("framescript-video-engine")?.manifest.contributes.videoPlugins?.[0].type).toBe("video");
        expect(getRegisteredPlugin("mock-video-renderer")?.manifest.contributes.videoPlugins?.[0].capabilities).toEqual(["compile", "render"]);
    });

    test("does not resolve or submit media for unconfirmed visual analysis", async () => {
        const context: PluginHostContext = {
            manifest: frameScriptVideoEnginePlugin.manifest,
            permissions: new Set(["media.read"]), storage, config: {},
            services: { media: { resolve: async () => { throw new Error("must not resolve before confirmation"); } } },
        };
        const plugin = frameScriptVideoEnginePlugin.createVideoPlugin!(context, "framescript-video-engine");
        await expect(plugin.analyze!({ media: { kind: "resource", id: "video-1" }, operations: ["video-analysis"] })).rejects.toThrow("请先人工筛选并确认候选帧");
    });

    test("queues a simulated renderer job through the existing registry", async () => {
        const pipeline = new VideoPipeline((plugin) => ({
            enabled: true,
            context: { manifest: plugin.manifest, permissions: new Set(plugin.manifest.permissions), storage, config: {}, services: {} },
        }));
        const project = await pipeline.compile({ pluginId: "mock-video-renderer", contributionId: "mock-video-renderer" }, {
            schema: "yingce.video-ir", version: 1,
            composition: { width: 720, height: 1280, frameRate: { numerator: 30, denominator: 1 }, background: "#000" }, durationFrames: 1, tracks: [], assets: [], clips: [],
        });
        const result = await pipeline.render({ pluginId: "mock-video-renderer", contributionId: "mock-video-renderer" }, project);
        expect(result).toMatchObject({ status: "queued", simulated: true });
    });
});
