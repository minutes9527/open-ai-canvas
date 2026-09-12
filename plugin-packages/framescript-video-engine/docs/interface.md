# FrameScript Video Engine 接口

插件贡献统一为 `type: "video"`。当前可执行能力为：

- `adaptive-keyframe-extraction`
- `transcription`
- `video-analysis`
- `scene-understanding`
- `asset-analysis`
- `prompt-extraction`

准备阶段仅抽取候选帧及可选转录；画面分析必须使用当前视频、当前指纹和当前 revision 的人工确认快照。`timeline`、`compile`、`render`、`export` 是规划能力，当前不可调用。

配置字段：`baseUrl`、`changeThreshold`、`samplingIntervalMs`。

响应：准备阶段返回候选帧、时长、实际检测器与可选转录；确认后的分析返回逐帧说明与提示词。失败时不自动把帧按数组顺序重新配对。

宿主在调用前检查插件启用状态、`media.read` 权限和素材归属。FrameScript 只可配置为本机 `http://localhost` 或 `http://127.0.0.1` 根地址，插件不会接收用户 API Key。

<!-- YINGCE_MANIFEST_CONTRACT_START -->
## Manifest 完整接口定义

以下 JSON 与插件包内实际 `manifest.json` 逐字段一致，覆盖插件身份、权限、配置、鉴权、参数、校验、创建、Agent、查询、取消、结果下载、响应和 Agent 响应映射。`documentation` 字段的值就是当前完整文档；为避免文档在自身内部无限递归，JSON 中仅用等义占位文本表示正文。

```json
{
  "apiVersion": "yingce.plugin/v2",
  "id": "framescript-video-engine",
  "name": "FrameScript Video Engine",
  "version": "0.5.0",
  "description": "连接本机 FrameScript，提供候选抽帧、转录与确认后的逐帧视频理解。",
  "documentation": "<当前插件的完整 documentation，由 README.md 与 docs/interface.md 拼接而成；为避免 JSON 递归，此处不重复展开正文。>",
  "permissions": [
    "media.read"
  ],
  "configuration": {
    "fields": [
      {
        "name": "baseUrl",
        "type": "url",
        "label": "FrameScript 本机服务地址",
        "required": true,
        "default": "http://127.0.0.1:8001",
        "description": "仅允许 localhost 或 127.0.0.1 的 HTTP 根地址。"
      },
      {
        "name": "changeThreshold",
        "type": "number",
        "label": "候选帧变化阈值",
        "default": 0.32,
        "description": "0.01–1；当前基线使用画面差异，不代表人物追踪。"
      },
      {
        "name": "samplingIntervalMs",
        "type": "number",
        "label": "扫描间隔（毫秒）",
        "default": 400,
        "description": "100–2000；影响采样精度，不决定最终保留帧数量。"
      }
    ]
  },
  "contributes": {
    "videoPlugins": [
      {
        "id": "framescript-video-engine",
        "label": "FrameScript Video Engine",
        "type": "video",
        "stage": "ready",
        "capabilities": [
          "adaptive-keyframe-extraction",
          "video-analysis",
          "transcription",
          "prompt-extraction",
          "scene-understanding",
          "asset-analysis"
        ],
        "plannedCapabilities": [
          "timeline",
          "compile",
          "render",
          "export"
        ]
      }
    ]
  }
}
```
<!-- YINGCE_MANIFEST_CONTRACT_END -->
