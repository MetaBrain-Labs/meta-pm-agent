export type AppRoute =
  | { name: "workspace" }
  | { name: "chat"; workspaceId: string; threadId: string | null };

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
