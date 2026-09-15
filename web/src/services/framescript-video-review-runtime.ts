import { FRAMESCRIPT_VIDEO_ENGINE_ID } from "@/lib/plugins/builtin/framescript-video-engine";
import { getRegisteredPlugin } from "@/lib/plugins/plugin-registry";
import { VideoPluginError } from "@/lib/plugins/video-plugin";
import { isPluginEffectivelyEnabled, usePluginStore } from "@/stores/use-plugin-store";
import { useConfigStore } from "@/stores/use-config-store";

import { createPluginHostContext } from "./plugin-host";
import { VideoPipeline, type VideoProvider } from "./video-pipeline";
import { VideoReviewWorkflow } from "./video-review-workflow";
import { createVideoReviewPersistence } from "./video-review-persistence";

const provider: VideoProvider = {
    pluginId: FRAMESCRIPT_VIDEO_ENGINE_ID,
    contributionId: FRAMESCRIPT_VIDEO_ENGINE_ID,
};

/** Creates the one approved host path for the canvas FrameScript workflow. */
export function createFrameScriptVideoReviewRuntime() {
    const plugin = getRegisteredPlugin(FRAMESCRIPT_VIDEO_ENGINE_ID);
    if (!plugin) throw new VideoPluginError("not-registered", "FrameScript Video Engine 尚未注册");

    const installation = usePluginStore.getState().installations.find((item) => item.manifest.id === FRAMESCRIPT_VIDEO_ENGINE_ID);
    if (!installation) throw new VideoPluginError("disabled", "请先在插件中心安装并启用 FrameScript Video Engine");

    const context = createPluginHostContext(plugin, installation, useConfigStore.getState().config);
    const pipeline = new VideoPipeline((registeredPlugin) => {
        if (registeredPlugin.manifest.id !== FRAMESCRIPT_VIDEO_ENGINE_ID) return undefined;
        return {
            enabled: isPluginEffectivelyEnabled(FRAMESCRIPT_VIDEO_ENGINE_ID, installation.enabled),
            context,
        };
    });

    const persistence = createVideoReviewPersistence(context);
    return { provider, workflow: new VideoReviewWorkflow(pipeline), persistence };
}
