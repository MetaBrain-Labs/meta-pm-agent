# 前端视觉与交互规范

本文是 `meta-pm-agent` Web 前端的风格入口。后续 Agent 在修改 UI 前应先阅读本文，再检查相关组件和调用方。本文约束展示层，不授权修改业务逻辑或扩大任务范围。

## 产品方向

采用极简 AI Workspace / Desktop Productivity Tool 风格，参考 Linear、Notion、OpenAI Desktop 的克制感及工作区组织方式。参考图用于视觉方向与信息架构，不要求逐像素复制。

- 中性色为主，白色及近白背景，大量留白，细边框，统一圆角，极弱阴影。
- 近黑色作为主要强调色。绿色、橙色、红色只用于少量语义状态和危险操作。
- 强调工作区、对话区、Inspector 和多栏布局；让内容与当前任务成为视觉重点。
- 避免传统 Admin Dashboard 的彩色统计大卡片、重复面板标题、Card 套 Card 和大面积高饱和背景。
- 桌面优先，窄屏保持主要操作可用；不能直接把参考图中的多列固定宽度作为所有屏幕的布局。

项目页参考图中的大面积彩色封面与上述目标冲突时，以中性、克制的视觉原则为准。参考图中 MRD、BRD、分享、同步 Git 等操作不能据此被当作已实现功能。

## 唯一视觉来源

| 文件 | 职责 |
| --- | --- |
| `apps/web/src/theme/design-tokens.ts` | 设计变量唯一来源，并同步为 `--ds-*` CSS 变量 |
| `apps/web/src/theme/app-theme.ts` | Ant Design 6 全局 token 与组件主题映射 |
| `apps/web/src/styles.css` | Tailwind token 映射、基础排版与现有页面兼容样式 |
| `apps/web/src/main.tsx` | 首屏前安装 CSS 变量，为静态反馈提供主题 |
| `apps/web/src/theme/README.md` | 组件接口、CSS 命名、示例和验证命令 |

不要在页面中重新定义一套颜色、圆角或控件高度。更改共享变量时同时审视主页面、浮层、禁用、校验和危险操作状态；组件主题必须符合当前安装的 Ant Design 6 类型。不得为视觉调整更换 UI Framework 或升级依赖。

## 基础尺度

| 类别 | 默认值与用途 |
| --- | --- |
| 页面背景 | `#fafafa` |
| 一级 / 二级背景 | `#ffffff / #f7f7f7` |
| Hover / Active 背景 | `#f2f2f2 / #ebebeb` |
| 主 / 次 / 弱文字 | `#171717 / #737373 / #8a8a8a` |
| 边框 / 分隔线 | `#e5e5e5 / #ededed`，1px |
| 主强调色 / Hover / Active | `#171717 / #333333 / #000000` |
| 成功 / 警告 / 错误 | `#287653 / #a36518 / #bf4141`，配浅色状态底 |
| 圆角 | 6px 小元素，8px 控件与内容表面，12px 浮层；圆形图标按钮保留圆形 |
| 间距 | 4px 基准，常用 8、12、16、24、32、48px |
| 控件高度 | 小 32px，默认 38px，大 44px |
| 字号 | 辅助 12px，界面 14px，正文 16px，分区标题 20px，页面标题 24px |
| 字体 | 现有思源黑体与系统无衬线回退；代码使用等宽字体 |
| 阴影 | 普通内容表面无阴影；浮层使用共享极弱阴影 |
| 动效 | 120–200ms，默认 160ms；不使用装饰性渐变、弹跳、光晕动画 |

此表便于理解默认风格，实际实现值以 `design-tokens.ts` 为准，不能把表中数值复制成另一套样式来源。弱文字用于辅助信息，不能承担关键操作或错误信息；状态必须同时提供文案或图标。

## 组件与交互规则

- 优先直接使用 Ant Design 的 Button、Input、Select、Dropdown、Modal、Drawer、Tabs、Table、Tooltip、Tag、Menu。外观通过 ConfigProvider 统一；不创建仅透传 props、没有减少重复样式的 AppButton/AppInput 等包装。
- `Surface` 用于确实需要背景或细边框的内容表面，不默认添加内边距和阴影。布局区域优先依赖间距与分隔线，不应每个区域都套 Surface。
- `SectionHeader` 统一标题、说明与可选操作区，并保留 h2/h3 层级。
- `AppModal` 用于自定义内容弹窗的居中与遮罩默认值，完整透传 Ant Design 6 ModalProps。开关、关闭、提交、焦点和销毁策略仍由原调用方与 Ant Design 管理。
- 主要动作使用近黑色 primary；次要动作使用普通或 text 按钮；危险操作使用 danger。不要把所有操作都提升为主要动作。
- 输入框正常状态使用细边框，Hover 轻微加深，Focus 使用中性边框及弱焦点环。不能通过 `!important` 覆盖 Ant Design 的 error、warning 或 disabled 状态。
- 表格用于可扫描的结构化数据；Tabs 表达同一工作区中的视图切换；Dropdown 放置次要操作；Inspector 放置当前选中对象的详情。
- 原生交互元素保留键盘可用性和可见焦点。Tooltip 不能成为图标按钮唯一的可访问名称。长中文、长路径、长问题选项需能换行或明确省略。
- 持续加载提示可以保留必要状态动画；交互过渡与加载周期不是同一时间尺度。尊重减少动态效果的系统偏好。
- 布局优先使用现有 Tailwind，语义颜色如 `bg-surface`、`text-ink-mute`、`border-line`，统一圆角如 `rounded-md`；避免新增全局控件覆盖和局部 `!important`。需要组件样式时先确认现有主题或 utility 能否表达。

## 信息架构方向与实施边界

后续页面可逐步形成「全局 Sidebar → Conversation → 项目工作区 / Inspector」结构，工作区包括项目概览、当前对话任务轮次、知识图谱和交付文档。窄屏通过折叠或单视图切换呈现，不能为压缩宽度删除功能。

本阶段只建立 Design System，少量接入项目路径弹窗、设置弹窗、本地存储面板；尚未实施新的 Shell、多栏 Inspector 或各业务页面的全面重构。旧页面的局部硬编码颜色、尺寸和专用布局按对应页面阶段迁移，不能声称全部页面已统一。

必须保留：

- 路由 `/workplace`、`/chat/:workspaceId`、`/chat/:workspaceId/:threadId`、`/documents/:workspaceId`。
- 原有页面功能、API contract、业务 DTO 和持久化结构；不得修改后端、数据库、Agent / Planner / Executor / Knowledge Graph 业务逻辑。
- `App.tsx` 的 Provider 与页面组合边界、`useAppShell.ts` 的状态归属以及已有组件复用。
- SSE 与停止/恢复行为、Agent 身份、阶段顺序、表单生命周期、历史恢复和已完成任务显示。
- 共享 `KnowledgeGraphView.tsx` 的 G6 渲染和生命周期逻辑、过滤、选择、详情和零尺寸初始化能力；图谱类型配色不应被普通界面强调色替代。
- 项目路径手工输入与现有目录选择行为、文档后台运行和下载能力。PRD 是唯一启用的文档类型，不根据参考图增加 MRD/BRD 控件。

本文不替代 `AGENTS.md` 的工程要求。用户明确授权的本次任务范围优先；不为了风格统一做无关重构、删除功能或改动业务数据。

## 后续 Agent 完成 UI 修改前

1. 确认改动只涉及授权范围，检查原调用方与业务约束。
2. 复用 token、Ant Design 主题和已有组件，检查默认、Hover、Focus、Active、禁用、校验、加载、空态与危险操作。
3. 检查桌面和窄屏、长内容、弹窗及键盘焦点；视觉检查不能代替类型和功能检查。
4. 执行适用的类型检查、构建、lint 和已有测试；如工具链或环境阻塞，如实报告原因，不能把未完成检查当作通过。
5. 审查差异，排除 API、业务状态、图谱逻辑、依赖版本及生成文件的意外变更。未经用户明确授权不提交代码。
