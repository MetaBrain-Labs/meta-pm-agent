/**
 * 前端设计变量
 *
 * Responsibilities:
 * - 为 Ant Design、Tailwind 和现有样式提供唯一的视觉变量来源。
 * - 在首屏渲染前同步 CSS 变量，避免主题与页面样式各自维护颜色。
 *
 * Notes:
 * - 仅定义展示规则，不读取或修改业务状态；图谱类型配色由图谱组件管理。
 */

/** 工作区的颜色、尺寸、字体、阴影和动效尺度。尺寸单位为 px。 */
export const DESIGN_TOKENS = {
  color: {
    page: "#fafafa",
    surface: "#ffffff",
    secondary: "#f7f7f7",
    hover: "#f2f2f2",
    active: "#ebebeb",
    text: "#171717",
    textSoft: "#404040",
    textSecondary: "#737373",
    textWeak: "#8a8a8a",
    textDisabled: "#a3a3a3",
    border: "#e5e5e5",
    divider: "#ededed",
    borderHover: "#b8b8b8",
    primary: "#171717",
    primaryHover: "#333333",
    primaryActive: "#000000",
    onPrimary: "#ffffff",
    focusOutline: "rgba(23, 23, 23, 0.10)",
    legacyAccent: "#756d80",
    success: "#287653",
    successSoft: "#edf6f0",
    warning: "#a36518",
    warningSoft: "#fbf3e8",
    error: "#bf4141",
    errorSoft: "#fbeeee",
    mask: "rgba(0, 0, 0, 0.24)",
  },
  /**
   * 项目封面底色。
   *
   * 刻意压低彩度并提升明度：每个色的 RGB 通道极差不超过 10/255，渲染后是
   * 近白的可辨识底色，而不是大面积色块，因此不会破坏整体黑白视觉体系。
   * 图谱类型配色不受此表影响。
   */
  cover: [
    { tint: "#eef0f4", ink: "#4f5665" },
    { tint: "#edeef7", ink: "#4e5370" },
    { tint: "#f0edf5", ink: "#5f5473" },
    { tint: "#f3edf2", ink: "#715367" },
    { tint: "#f6efec", ink: "#74584b" },
    { tint: "#f4f2eb", ink: "#66623f" },
    { tint: "#eaf2ed", ink: "#436452" },
    { tint: "#e9f2f3", ink: "#44646b" },
  ],
  radius: { button: 4, small: 6, base: 8, large: 12, pill: 999 },
  spacing: { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32, spacious: 48 },
  controlHeight: { small: 32, base: 38, large: 44 },
  /** 桌面多栏骨架尺寸；只描述栏宽与顶栏高度，不固定整个页面宽度。 */
  layout: {
    sidebar: 240,
    sidebarCollapsed: 64,
    conversationMin: 360,
    conversation: 420,
    conversationMax: 440,
    workspaceHeader: 56,
  },
  typography: {
    /**
     * 双字体系统。
     *
     * ui：思源黑体，负责「结构与强调」——导航、标题、控件、表格、标签、状态、
     * Agent / 任务 / 模型名、路径、ID、时间、Token、Cost 等元信息。这些内容
     * 需要高辨识度与紧凑排版，始终使用本字体。
     *
     * content：霞鹜文楷 Lite，负责「内容与阅读」——对话正文、Markdown 正文、
     * 文档正文、较长说明与帮助文案。回退链保留思源黑体，缺字时不会跳字体。
     *
     * 文楷只有 Regular 字重：≥500 的内容一律回到 ui 字体，见 styles.css 中的
     * `.font-*` 规则（同时用 font-synthesis: none 禁止合成粗体）。
     */
    ui: '"Source Han Sans CN", "PingFang SC", "Microsoft YaHei", -apple-system, BlinkMacSystemFont, system-ui, sans-serif',
    content:
      '"LXGW WenKai Lite", "Source Han Sans CN", "PingFang SC", "Microsoft YaHei", -apple-system, BlinkMacSystemFont, system-ui, sans-serif',
    sans: '"Source Han Sans CN", "PingFang SC", "Microsoft YaHei", -apple-system, BlinkMacSystemFont, system-ui, sans-serif',
    mono: '"SF Mono", Consolas, Menlo, monospace',
    readingDisplay: '"LXGW WenKai Lite", "KaiTi", "STKaiti", sans-serif',
    /**
     * 字号刻度。
     *
     * micro / caption 用于标签与元信息，small / control 用于次要正文与控件，
     * base 起为正文与标题。新增字号前先确认现有档位够用，避免出现语义重叠的散值。
     */
    size: {
      micro: 10,
      caption: 11,
      small: 12,
      control: 13,
      base: 14,
      body: 16,
      title: 20,
      heading: 24,
      /** 概览指标数值；比标题更大，是唯一使用该档位的地方。 */
      metric: 26,
      display: 32,
    },
    lineHeight: 1.6, headingLineHeight: 1.4,
    weight: { regular: 400, medium: 500, strong: 600 },
  },
  shadow: {
    surface: "none",
    popup: "0 4px 16px rgba(0, 0, 0, 0.06), 0 1px 4px rgba(0, 0, 0, 0.04)",
    focus: "0 0 0 2px rgba(23, 23, 23, 0.10)",
    errorFocus: "0 0 0 2px rgba(191, 65, 65, 0.10)",
    warningFocus: "0 0 0 2px rgba(163, 101, 24, 0.10)",
  },
  motion: { fast: 120, base: 160, slow: 200 },
  /**
   * 加载反馈时序。
   *
   * 短请求不闪 Loader：延迟超过 delay 才显示；一旦显示至少保留 minVisible，
   * 避免"出现即消失"的闪烁。两个值集中在这里，不允许各页面自行写死毫秒数。
   */
  loading: { delay: 180, minVisible: 420 },
} as const;

/** 将视觉变量写入指定根元素；应用入口调用一次，不承担主题切换或数据持久化。 */
export function applyDesignTokens(root: HTMLElement): void {
  const { color, radius, spacing, controlHeight, layout, typography, shadow, motion, loading } = DESIGN_TOKENS;
  const groups = {
    color,
    radius,
    spacing,
    control: controlHeight,
    layout,
    fontSize: typography.size,
    shadow,
    motion,
    loading,
  };
  for (const [group, values] of Object.entries(groups)) {
    for (const [name, value] of Object.entries(values)) {
      const cssGroup = group.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`);
      const cssName = name.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`);
      const unit = typeof value === "number" ? (group === "motion" ? "ms" : "px") : "";
      root.style.setProperty(`--ds-${cssGroup}-${cssName}`, `${value}${unit}`);
    }
  }
  // 封面底色是数组，单独展开为可索引的 CSS 变量。
  DESIGN_TOKENS.cover.forEach((entry, index) => {
    root.style.setProperty(`--ds-cover-tint-${index}`, entry.tint);
    root.style.setProperty(`--ds-cover-ink-${index}`, entry.ink);
  });
  root.style.setProperty("--ds-cover-count", String(DESIGN_TOKENS.cover.length));
  root.style.setProperty("--ds-font-sans", typography.sans);
  root.style.setProperty("--ds-font-ui", typography.ui);
  root.style.setProperty("--ds-font-content", typography.content);
  root.style.setProperty("--ds-font-mono", typography.mono);
  root.style.setProperty("--ds-font-reading-display", typography.readingDisplay);
  root.style.setProperty("--ds-line-height", String(typography.lineHeight));
  root.style.setProperty("--ds-heading-line-height", String(typography.headingLineHeight));
  for (const [name, value] of Object.entries(typography.weight)) {
    root.style.setProperty(`--ds-font-weight-${name}`, String(value));
  }
}
