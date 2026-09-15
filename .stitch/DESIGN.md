---
name: 影策 Canvas Workspace
colors:
  background: '#0f0f0f'
  surface: '#181818'
  surface-strong: '#2a2a2a'
  overlay: '#0a0a0b'
  foreground: '#ffffff'
  text-muted: '#a8a8a8'
  text-faint: '#666666'
  border: '#222222'
  border-strong: '#333333'
  accent: '#f5f5f5'
  accent-soft: 'rgba(255,255,255,0.09)'
  success: '#16a34a'
  warning: '#d97706'
  error: '#dc2626'
  video: '#d52d89'
  frame: '#34a853'
typography:
  display:
    fontFamily: Inter Variable
    fontSize: 36px
    fontWeight: '700'
    lineHeight: 44px
    letterSpacing: '-0.02em'
  title:
    fontFamily: Inter Variable
    fontSize: 22px
    fontWeight: '650'
    lineHeight: 30px
    letterSpacing: '-0.01em'
  heading:
    fontFamily: Inter Variable
    fontSize: 16px
    fontWeight: '600'
    lineHeight: 24px
    letterSpacing: '0'
  body:
    fontFamily: Inter Variable
    fontSize: 14px
    fontWeight: '400'
    lineHeight: 22px
    letterSpacing: '0'
  caption:
    fontFamily: Inter Variable
    fontSize: 12px
    fontWeight: '500'
    lineHeight: 18px
    letterSpacing: '0'
rounded:
  xs: 4px
  sm: 6px
  md: 8px
  lg: 12px
  xl: 14px
  overlay: 16px
  full: 9999px
spacing:
  unit: 4px
  xs: 4px
  sm: 8px
  md: 16px
  lg: 24px
  xl: 32px
  safe-area: 16px
---

# Design System: 影策 Canvas Workspace

## 1. Visual Theme & Atmosphere

影策的画布是克制、专业的深色创作工作台：近黑色空间与极细网格将媒体、提示词、工作流节点作为视觉主角。界面不依赖大面积品牌色，而以白灰层级、半透明浮层和清晰的连线建立复杂任务的秩序。

FrameScript 的入口应像画布中的一个可靠处理步骤，而非独立工具页。它从视频节点右侧自然接出，沿着“候选帧 → 人工确认 → 分析结果 → Skill”形成能一眼读懂的有向工作流。完成、待确认和错误只使用有限的状态色，避免破坏画布的安静感。

## 2. Color Palette & Roles

### Primary Foundation

- **Carbon Canvas** `#0f0f0f`：画布及页面底色。
- **Obsidian Surface** `#181818`：普通节点、侧栏与承载面。
- **Slate Raised Surface** `#2a2a2a`：选中、强调及密集信息区域。
- **Hairline Border** `#222222`：默认边界；强调边界使用 `#333333`。
- **Grid Mist** `rgba(255,255,255,0.026)`：画布空间网格，仅作定位辅助。

### Accent & Interactive

- **Paper Accent** `#f5f5f5`：主操作与活动图标，在深色画布中保持高可读性。
- **Soft Selection** `rgba(255,255,255,0.09)`：悬停、已选控制与连接目标提示。
- **Video Magenta** `#d52d89`：视频节点类别。
- **Frame Green** `#34a853`：已确认参考帧类别。

### Typography & Text Hierarchy

- **Snow White** `#ffffff`：标题、关键数值与主操作。
- **Silver Body** `#a8a8a8`：正文、状态与辅助说明。
- **Steel Hint** `#888888`：次级元数据。
- **Mist Hint** `#666666`：占位、禁用及非关键标签。

### Functional States

- **Success Green** `#16a34a`：可用、完成、已确认。
- **Warning Amber** `#d97706`：等待人工确认或存在风险。
- **Error Red** `#dc2626`：失败与不可执行状态。

## 3. Typography Rules

使用 Inter Variable 与中文系统无衬线回退；正文强调小字号下的稳定可读性，代码和时间线数据使用 JetBrains Mono。页面展示标题可到 36px，但画布节点主要采用 16px 标题、14px 正文、12px 辅助和 10–11px 标签。标题字距略收紧，说明文字保持舒展行高。

## 4. Component Stylings

### Canvas Nodes

节点采用 12–16px 圆角、深色实体表面和 1px hairline。媒体节点保留素材本身比例，视频预览优先占据节点主体；动作及状态位于底部操作带。节点类型通过小型彩色图标或细色带表达，不能只依赖颜色区分。

### FrameScript Workflow Node

FrameScript 节点以“视频理解”图标、步骤状态和紧凑摘要构成：输入区显示已连接视频，处理中展示扫描进度，待确认时显示候选帧数和醒目的“人工筛选”按钮，确认后展示转写与分析摘要。节点必须有输入/输出端口，并使“分析结果 → Skill”成为默认推荐连线。

### Review Contact Sheet

候选帧以等高、多列素材卡展示，竖向素材优先五列、横向素材优先三列。保持原始比例、减少黑边；每张卡含时间码、触发原因、变化分数和选择状态。多选工具栏固定在面板底部，确认动作需要展示所选帧数量。

### Buttons, Inputs & States

主按钮使用白灰实心背景与黑色文字；次级按钮为透明或低对比表面加细描边。标准控件高度约 36px，键盘焦点使用柔和白色环而不是霓虹发光。动画快速但克制：悬停 120–160ms，面板/状态切换 180–240ms。

### Floating Panels

人工筛选及结果详情使用 16px 圆角的高层浮面，背景接近 `#0a0a0b`，辅以 `rgba(255,255,255,0.22)` 边界与深黑阴影。面板固定在画布安全区内，不遮挡当前视频节点的连接关系。

## 5. Layout Principles

画布遵循 4px 基线、16px 安全边距与 34px 空间网格。工作流从左向右：视频输入在左，FrameScript 居中，Skill/文案节点在右。浮层不取代画布关系：只有需要人工挑选大量帧时才展开为右侧检查面板或居中对话层。

桌面端确保视频、FrameScript 和 Skill 三个节点在首屏可读；窄屏下保留单列步骤卡与底部确认栏。所有图标按钮需有文字或 aria 标签；状态文字与颜色同时存在。

## 6. Design System Notes for Stitch Generation

### Language to Use

“深色专业创作画布”、“电影制作工作流”、“安静的高密度工具面板”、“白灰分层、低饱和状态色”、“可追踪的有向节点流”。避免游戏化霓虹、过度玻璃拟态和大面积渐变。

### Component Prompts

1. 在黑色网格无限画布中展示三个相连节点：竖版视频预览、FrameScript 视频理解步骤、Skill 文案卡；FrameScript 节点处于“等待人工确认候选帧”状态。
2. 设计 FrameScript 候选帧复核浮层：自适应三列或五列的原比例缩略图、时间码、变化原因、选中勾选与底部确认栏。
3. 设计确认后的分析节点：左侧已确认帧数量与转写状态，右侧显示“输出到 Skill”端口和简短的分镜提示词摘要。

### Incremental Iteration

先生成工作流入口与候选帧复核两个状态；确认节点密度与操作层级后，再扩展转写详情、逐帧分析结果与 Skill 连接的状态变化。不要把未实现的 MP4 渲染或导出能力放入界面。
