/**
 * Chat 运行注册表
 *
 * 集中维护当前 API 进程内正在执行的会话 AbortController，供停止接口和模型列表切换保护复用。
 *
 * Responsibilities:
 * - 注册和清理会话运行
 * - 携带来源中止指定会话
 * - 判断会话是否仍处于运行态
 */

const activeChatRuns = new Map<string, Set<AbortController>>();

/** 聊天运行的中止来源，用于区分用户操作、页面卸载与异常连接断开。 */
export type ChatAbortOrigin =
  | "manual_stop"
  | "page_unload"
  | "client_disconnect";

/** 注册一个会话运行控制器，并保留并发请求。 */
export function registerChatRun(
  chatId: string,
  controller: AbortController,
): void {
  const controllers = activeChatRuns.get(chatId) ?? new Set<AbortController>();
  controllers.add(controller);
  activeChatRuns.set(chatId, controllers);
}

/** 清理已结束的指定会话运行控制器。 */
export function unregisterChatRun(
  chatId: string,
  controller: AbortController,
): void {
  const controllers = activeChatRuns.get(chatId);
  controllers?.delete(controller);
  if (controllers?.size === 0) {
    activeChatRuns.delete(chatId);
  }
}

/** 中止指定会话当前进程内的全部运行。 */
export function abortChatRun(
  chatId: string,
  origin: ChatAbortOrigin = "manual_stop",
): boolean {
  const controllers = activeChatRuns.get(chatId);
  for (const controller of controllers ?? []) {
    if (!controller.signal.aborted) controller.abort(origin);
  }
  return Boolean(controllers?.size);
}

/** 从 AbortSignal 的标准 reason 中恢复可信中止来源。 */
export function resolveChatAbortOrigin(
  signal: AbortSignal,
): ChatAbortOrigin | "unknown" {
  return signal.reason === "manual_stop" ||
    signal.reason === "page_unload" ||
    signal.reason === "client_disconnect"
    ? signal.reason
    : "unknown";
}

/** 判断指定会话是否仍存在未中止的运行。 */
export function isChatRunActive(chatId: string): boolean {
  const controllers = activeChatRuns.get(chatId);
  return Boolean(
    controllers &&
      [...controllers].some((controller) => !controller.signal.aborted),
  );
}
