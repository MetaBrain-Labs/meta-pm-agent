/**
 * Ant Design 全局主题配置。
 *
 * Responsibilities:
 * - 统一组件颜色、尺寸与界面字体。
 *
 * Notes:
 * - 仅配置展示层；控件状态与交互仍由 Ant Design 和原调用方管理。
 */
import type { ThemeConfig } from "antd";
import { DESIGN_TOKENS } from "./design-tokens";

const { color: c, radius: r, spacing: s, typography: t, controlHeight: h, shadow, motion } = DESIGN_TOKENS;

/** 主界面与静态反馈弹窗共同使用的克制、中性主题。 */
export const APP_THEME = {
  token: {
    colorPrimary: c.primary,
    colorPrimaryHover: c.primaryHover,
    colorPrimaryActive: c.primaryActive,
    colorPrimaryBg: c.secondary,
    colorPrimaryBgHover: c.hover,
    colorPrimaryBorder: c.borderHover,
    colorPrimaryBorderHover: c.primaryHover,
    colorInfo: c.primary,
    /*
     * 信息 / 进行中标记（Tag color="processing" 等）必须与 success / warning / error
     * 用同一套「极浅底 + 同色文字」。colorInfo 是本项目的近黑主色，只让它派生会得到
     * 深灰底（#575757），标签会变成看不清文字的深色药丸，因此显式给出浅底与描边。
     */
    colorInfoBg: c.secondary,
    colorInfoBorder: c.border,
    colorLink: c.primary,
    colorLinkHover: c.primaryHover,
    colorLinkActive: c.primaryActive,
    colorSuccess: c.success,
    colorSuccessBg: c.successSoft,
    colorWarning: c.warning,
    colorWarningBg: c.warningSoft,
    colorError: c.error,
    colorErrorBg: c.errorSoft,
    colorText: c.text,
    colorTextSecondary: c.textSecondary,
    colorTextTertiary: c.textWeak,
    colorTextQuaternary: c.textDisabled,
    colorTextDisabled: c.textDisabled,
    colorTextLightSolid: c.onPrimary,
    colorBgBase: c.surface,
    colorBgContainer: c.surface,
    colorBgElevated: c.surface,
    colorBgLayout: c.page,
    colorBgContainerDisabled: c.secondary,
    colorBgMask: c.mask,
    colorBorder: c.border,
    colorBorderSecondary: c.divider,
    colorSplit: c.divider,
    colorFillAlter: c.secondary,
    colorFillTertiary: c.hover,
    colorFillSecondary: c.active,
    controlItemBgHover: c.hover,
    controlItemBgActive: c.active,
    controlItemBgActiveHover: c.hover,
    controlOutline: c.focusOutline,
    controlOutlineWidth: 2,
    lineWidth: 1,
    borderRadius: r.base,
    borderRadiusSM: r.small,
    borderRadiusLG: r.large,
    borderRadiusXS: r.small,
    fontFamily: t.sans,
    fontFamilyCode: t.mono,
    fontSize: t.size.base,
    fontSizeSM: t.size.small,
    fontSizeLG: t.size.body,
    fontSizeHeading1: t.size.display,
    fontSizeHeading2: t.size.heading,
    fontSizeHeading3: t.size.title,
    fontSizeHeading4: t.size.body,
    fontSizeHeading5: t.size.base,
    fontWeightStrong: t.weight.strong,
    lineHeight: t.lineHeight,
    controlHeight: h.base,
    controlHeightSM: h.small,
    controlHeightLG: h.large,
    paddingXS: s.sm,
    paddingSM: s.md,
    padding: s.lg,
    paddingLG: s.xl,
    paddingXL: s.xxl,
    marginXS: s.sm,
    marginSM: s.md,
    margin: s.lg,
    marginLG: s.xl,
    marginXL: s.xxl,
    boxShadow: shadow.popup,
    boxShadowSecondary: shadow.popup,
    boxShadowTertiary: shadow.surface,
    motionDurationFast: `${motion.fast / 1000}s`,
    motionDurationMid: `${motion.base / 1000}s`,
    motionDurationSlow: `${motion.slow / 1000}s`,
    motionEaseInOut: "ease-in-out",
  },
  components: {
    Button: {
      /*
       * 按钮圆角独立于输入类控件的 8px：按钮是成组出现的短标签，
       * 4px 更贴近项目克制的灰阶语言，默认尺寸与小尺寸保持同一圆角。
       */
      borderRadius: r.button,
      borderRadiusSM: r.button,
      /*
       * 文字按钮与纯图标按钮是次级动作，静息态用次级灰、hover 与按下回到主文字色，
       * 与 .kg-updated-link / .doc-cell-muted 的「次级 → 加深」保持同一条语言；
       * 纯图标按钮的图标略放大，避免细线在小尺寸按钮里糊成一团。
       */
      textTextColor: c.textSecondary,
      textTextHoverColor: c.text,
      textTextActiveColor: c.text,
      onlyIconSize: t.size.body,
      onlyIconSizeSM: t.size.base,
      fontWeight: t.weight.medium,
      defaultShadow: shadow.surface,
      primaryShadow: shadow.surface,
      dangerShadow: shadow.surface,
      defaultBg: c.surface,
      defaultColor: c.text,
      defaultBorderColor: c.border,
      defaultHoverBg: c.hover,
      defaultHoverColor: c.text,
      defaultHoverBorderColor: c.borderHover,
      defaultActiveBg: c.active,
      defaultActiveColor: c.text,
      defaultActiveBorderColor: c.borderHover,
      textHoverBg: c.hover,
    },
    Input: {
      hoverBorderColor: c.borderHover,
      activeBorderColor: c.primary,
      activeShadow: shadow.focus,
      errorActiveShadow: shadow.errorFocus,
      warningActiveShadow: shadow.warningFocus,
      addonBg: c.secondary,
      hoverBg: c.surface,
      activeBg: c.surface,
    },
    Select: {
      selectorBg: c.surface,
      optionActiveBg: c.hover,
      optionSelectedBg: c.active,
      optionSelectedColor: c.text,
      optionSelectedFontWeight: t.weight.medium,
      multipleItemBg: c.secondary,
      hoverBorderColor: c.borderHover,
      activeBorderColor: c.primary,
      activeOutlineColor: c.focusOutline,
    },
    Dropdown: { paddingBlock: s.xs, borderRadiusLG: r.base, boxShadowSecondary: shadow.popup },
    Modal: { headerBg: c.surface, contentBg: c.surface, footerBg: "transparent", titleColor: c.text, titleFontSize: t.size.body },
    Drawer: { colorBgElevated: c.surface, footerPaddingBlock: s.md, footerPaddingInline: s.xl },
    Tabs: {
      itemColor: c.textSecondary, itemSelectedColor: c.text, itemHoverColor: c.text,
      itemActiveColor: c.primaryActive, inkBarColor: c.primary,
      cardBg: c.secondary, titleFontSize: t.size.base, horizontalItemGutter: s.xl,
    },
    Table: {
      headerBg: c.secondary, headerColor: c.textSecondary,
      headerSortActiveBg: c.active, headerSortHoverBg: c.hover,
      headerSplitColor: c.divider, borderColor: c.divider,
      rowHoverBg: c.hover, rowSelectedBg: c.active,
      rowSelectedHoverBg: c.hover, rowExpandedBg: c.secondary,
      cellPaddingBlock: s.md, cellPaddingInline: s.lg,
    },
    Tooltip: { colorBgSpotlight: c.primary, borderRadius: r.small, boxShadowSecondary: shadow.surface },
    Tag: { defaultBg: c.secondary, defaultColor: c.textSecondary, borderRadiusSM: r.small },
    Menu: {
      itemBg: "transparent", itemColor: c.textSecondary,
      itemHoverColor: c.text, itemSelectedColor: c.text,
      itemHoverBg: c.hover, itemSelectedBg: c.active, itemActiveBg: c.active,
      subMenuItemBg: "transparent", popupBg: c.surface,
      itemBorderRadius: r.base, itemHeight: h.large,
      itemMarginBlock: 3, itemMarginInline: 10,
    },
    Card: { borderRadiusLG: r.base, boxShadowTertiary: shadow.surface, headerHeight: h.large },
    Layout: { bodyBg: c.page, siderBg: c.surface, headerBg: c.surface },
    Collapse: { headerBg: c.secondary, contentBg: c.surface },
    Form: { labelColor: c.text, labelFontSize: t.size.base },
  },
} satisfies ThemeConfig;
