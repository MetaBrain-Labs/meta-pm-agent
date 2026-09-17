# Web Design System

`design-tokens.ts` 是视觉变量的唯一来源。`app-theme.ts` 将其映射到 Ant Design 6；`main.tsx` 在渲染前安装 `--ds-*` CSS 变量，并为静态 `Modal.confirm/error` 等反馈提供同一主题。

## 基础尺度

| 用途 | Token / CSS 变量 | 默认值 |
| --- | --- | --- |
| 页面 / 一级 / 二级背景 | `color.page / surface / secondary` | `#fafafa / #ffffff / #f7f7f7` |
| Hover / Active | `color.hover / active` | `#f2f2f2 / #ebebeb` |
| 主 / 次 / 弱文字 | `color.text / textSecondary / textWeak` | `#171717 / #737373 / #8a8a8a` |
| 边框 / 分隔线 | `color.border / divider` | `#e5e5e5 / #ededed` |
| 主强调色 | `color.primary` | `#171717` |
| 成功 / 警告 / 错误 | `color.success / warning / error` | `#287653 / #a36518 / #bf4141` |
| 圆角 | `radius.small / base / large` | `6 / 8 / 12px` |
| 间距 | `spacing.xs / sm / md / lg / xl / xxl / spacious` | `4 / 8 / 12 / 16 / 24 / 32 / 48px` |
| 控件高度 | `controlHeight.small / base / large` | `32 / 38 / 44px` |
| 字号 | `typography.size.micro / caption / small / control / base / body / title / heading / metric / display` | `10 / 11 / 12 / 13 / 14 / 16 / 20 / 24 / 26 / 32px` |
| 字体族 | `typography.ui / content / mono` | 思源黑体 / 霞鹜文楷 Lite / SF Mono |
| 字重 | `typography.weight.regular / medium / strong` | `400 / 500 / 600` |
| 交互过渡 | `motion.fast / base / slow` | `120 / 160 / 200ms` |
| 内容 / 浮层阴影 | `shadow.surface / popup` | 无阴影 / 极弱阴影 |

CSS 命名将组名和 camelCase 转为 kebab-case，例如 `color.textSecondary` 对应 `--ds-color-text-secondary`，`controlHeight.base` 对应 `--ds-control-base`。尺寸为 px，动效为 ms，行高和字重不带单位。

## 双字体系统

字体分两种角色，不要混用：

| 角色 | Token | 字体 | 职责 |
| --- | --- | --- | --- |
| **UI / 强调** | `--ds-font-ui`（别名 `--ui`、`--body`） | 思源黑体 | 结构与强调：导航、标题、控件、表格、标签、状态、Agent / 任务 / 模型名、路径、ID、时间、Token、Cost 等元信息 |
| **内容 / 阅读** | `--ds-font-content`（别名 `--reading`） | 霞鹜文楷 Lite | 内容与阅读：对话正文、Markdown 正文、文档正文、较长说明与帮助文案 |
| **代码** | `--ds-font-mono`（别名 `--mono`） | SF Mono | 代码块、行内代码、路径与 ID 的等宽展示 |

约定：

- **Ant Design 全局 `fontFamily` 始终是思源黑体**（`app-theme.ts`）。不要把它改成文楷，否则 Button / Select / Table / Tag / Modal / Menu / Tabs 会被一起切换。
- 文楷只通过语义 class 应用于内容区域：在内容容器上使用 `.font-reading`（长正文）或 `.font-reading-compact`（紧凑内容），或直接使用 `font-family: var(--reading)`。
- **文楷只有 Regular（400）**。`@font-face` 只声明 400，并使用 `font-synthesis: none` 禁止合成粗体。内容里的 `strong` / `b` / `font-semibold` / `font-bold` 会自动切回思源黑体的真实字重表达强调；需要 ≥500 的文案本身就应该使用 UI 字体。
- 内容正文行高比 UI 略宽（正文 1.85，紧凑内容 1.7），因为文楷字形比思源黑体略松。
- Markdown 内的 `h1`–`h6` 与 `table` 使用 UI 字体，`code` / `pre` / `kbd` 使用等宽字体。
- `--ds-font-*` 由脚本注入，`styles.css` 顶部提供了同名静态兜底值，脚本未执行时也不会回退到浏览器默认衬线字体。

## 使用约定

- 直接使用 Ant Design 的 `Button`、`Input`、`Select`、`Tag`、`Tabs`、`Table` 等组件。主题已统一正常、Hover、Active、禁用及校验状态，不再添加纯样式包装组件。
- 主要动作使用 `type="primary"`；危险动作保留 `danger`；状态标签优先使用 `success / warning / error`，不能只依赖颜色传达状态。
- 页面布局优先使用 Tailwind：`bg-canvas`、`bg-surface`、`bg-surface-muted`、`text-ink`、`text-ink-mute`、`border-line`、`border-divider`、`rounded-md`、`gap-4`、`p-6`、`transition-colors`。颜色、圆角、4px 间距基准和默认过渡时间都连接共享 token。
- 普通文字默认使用思源黑体及系统回退，代码使用等宽字体。阅读型内容使用霞鹜文楷 Lite（见上文「双字体系统」）；`--ds-font-reading-display` 保留给需要展示书法感的个别场景。
- 非 Ant Design 交互元素使用原生 `button / a`，保留键盘焦点。复杂控件继续使用 Ant Design 的交互和可访问性能力。
- 不添加大面积强调色、卡片嵌套、装饰性渐变、弹跳或光晕动画。持续加载指示与短交互过渡是不同用途；保留必要的加载指示。

## 共享组件

```tsx
import { Button } from "antd";
import { Surface } from "../components/ui/Surface";
import { SectionHeader } from "../components/ui/SectionHeader";
import { AppModal } from "../components/modals/AppModal";

<Surface className="p-6">
  <SectionHeader
    title="分区标题"
    description="简短说明"
    actions={<Button>操作</Button>}
  />
</Surface>

<AppModal open={open} title="标题" onCancel={onClose} onOk={onSubmit}>
  内容
</AppModal>
```

`Surface` 只提供背景、圆角和可选边框，无默认内边距或阴影；可以设置 `as="section"` 保留区域语义、`tone="muted"` 或 `bordered={false}`。不要仅为增加边框而包裹已有 Card。

`SectionHeader` 通过 `level={2 | 3}` 保留标题层级，操作区可换行。`AppModal` 完整透传 `ModalProps`，保留原生关闭、焦点、生命周期行为，并支持对象/回调式 `styles` 覆盖；它不管理表单和开关状态。

## 本阶段范围与后续迁移

已接入项目路径弹窗、设置弹窗和本地存储面板，旧 `--surface / --ink / --primary / --line` 等变量作为兼容别名保留。全局控件外观覆盖已移入主题；长问题选项换行等内容布局规则保留。

现有页面的专用布局、局部硬编码 Tailwind 配色与部分局部 `!important` 将在对应页面迁移时逐项替换。本阶段不改路由、业务状态、API、图谱过滤或 G6 生命周期，也不新增 MRD/BRD 功能。

## 验证

使用 `pnpm --filter web exec tsc --noEmit` 和 `pnpm exec turbo run build --filter=web` 检查类型及依赖构建。执行 `pnpm --filter web lint` 时，现有 Next ESLint 配置可能缺少 Next 编译后的 parser；不能把根级空的 lint/typecheck 任务当成有效覆盖。Web 使用 `pnpm --filter web test:ui` 运行断言脚本（布局、封面、分隔条、任务历史、面板登记、执行时间线、空会话、交付文档、面板回落、同步状态、字体系统）。
