/**
 * Web 应用启动入口
 *
 * Responsibilities:
 * - 在首屏渲染前安装共享视觉变量。
 * - 为静态反馈弹窗提供与应用一致的主题，然后挂载 React 应用。
 *
 * Notes:
 * - 路由和业务状态仍由应用外壳管理。
 */
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { ConfigProvider } from "antd";
import zhCN from "antd/locale/zh_CN";
import App from "./App";
import { APP_THEME } from "./theme/app-theme";
import { applyDesignTokens } from "./theme/design-tokens";
import "./styles.css";

applyDesignTokens(document.documentElement);
// 静态 Modal.confirm/error 不在应用 Provider 内，单独接入同一主题。
ConfigProvider.config({
  holderRender: (children) => (
    <ConfigProvider theme={APP_THEME} locale={zhCN}>
      {children}
    </ConfigProvider>
  ),
});

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>
);
