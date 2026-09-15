/**
 * Ant Design 全局主题配置。
 *
 * Responsibilities:
 * - 统一组件颜色、尺寸与界面字体。
 *
 * Notes:
 * - 字体资源与回退顺序由全局样式变量管理，应用外壳只负责组合渲染。
 */
/** 全局组件主题，保证弹窗与主界面使用同一套界面字体。 */
export const APP_THEME = {
  token: {
    colorPrimary: "#115eab",
    colorSuccess: "#059669",
    colorWarning: "#d97706",
    colorError: "#dc2626",
    borderRadius: 8,
    colorBgContainer: "#ffffff",
    colorBgLayout: "#f4f7fb",
    colorBgElevated: "#ffffff",
    colorText: "#111827",
    colorTextSecondary: "#4b5563",
    colorTextTertiary: "#6b7280",
    colorBorder: "#d9e1ec",
    colorBorderSecondary: "#e8edf5",
    fontFamily: "var(--sans)",
    fontSize: 14,
    controlHeight: 38,
    lineHeight: 1.55,
  },
  components: {
    Button: { fontWeight: 600, primaryShadow: "none" },
    Input: {
      activeBorderColor: "#115eab",
      hoverBorderColor: "#9bb5da",
    },
    Layout: {
      bodyBg: "#f4f7fb",
      siderBg: "#ffffff",
    },
  },
};
