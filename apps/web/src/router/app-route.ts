/**
 * 前端应用路由工具
 *
 * 解析浏览器路径并构造工作区、聊天和文档生成页面路径。该模块只处理轻量
 * history 操作，不依赖 React Router。
 *
 * Responsibilities:
 * - 将 URL pathname 转换成 AppRoute
 * - 构造聊天页与策划产出文档页路径
 * - 推送或替换浏览器历史记录
 */

export type AppRoute =
  | { name: "workspace" }
  | { name: "chat"; workspaceId: string; threadId: string | null }
  | { name: "documents"; workspaceId: string };

/**
 * 将浏览器路径恢复为应用内部路由状态。
 */
export function parseAppRoute(pathname = window.location.pathname): AppRoute {
  const parts = pathname.split("/").filter(Boolean);
  if (parts[0] === "chat" && parts[1]) {
    return {
      name: "chat",
      workspaceId: decodeURIComponent(parts[1]),
      threadId: parts[2] ? decodeURIComponent(parts[2]) : null,
    };
  }
  if (parts[0] === "documents" && parts[1]) {
    return {
      name: "documents",
      workspaceId: decodeURIComponent(parts[1]),
    };
  }

  return { name: "workspace" };
}

/**
 * 构造工作区和会话对应的聊天路径。
 */
export function buildChatPath(
  workspaceId: string,
  threadId?: string | null,
): string {
  const base = `/chat/${encodeURIComponent(workspaceId)}`;
  return threadId ? `${base}/${encodeURIComponent(threadId)}` : base;
}

/**
 * 构造工作区文档生成页面路径。
 */
export function buildDocumentsPath(workspaceId: string): string {
  return `/documents/${encodeURIComponent(workspaceId)}`;
}

/**
 * 在不触发导航事件的情况下替换当前路径。
 */
export function replacePath(path: string) {
  if (window.location.pathname !== path) {
    window.history.replaceState(null, "", path);
  }
}

/**
 * 推入新路径并通知应用重新解析路由。
 */
export function pushPath(path: string) {
  if (window.location.pathname !== path) {
    window.history.pushState(null, "", path);
    window.dispatchEvent(new PopStateEvent("popstate"));
  }
}
