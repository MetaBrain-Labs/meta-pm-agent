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

/** 已收到但可能晚于连接断开到达的 stop 请求记录，用于抑制异常断连报告的竞态误报。 */
interface RecordedStopRequest {
  origin: ChatAbortOrigin;
  at: number;
}

const recentStopRequests = new Map<string, RecordedStopRequest>();

/** stop 请求在连接断开后允许补记并改写中止来源的宽限窗口。 */
export const STOP_REQUEST_GRACE_MS = 2_000;

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
  // 新一轮运行开始即作废上一次运行的 stop 补记记录。
  recentStopRequests.delete(chatId);
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
  // 即使控制器已被传输层断开抢先中止，也记录 stop 来源，
  // 供报告抑制逻辑在宽限窗口内把用户主动停止/离开与异常断连区分开。
  recentStopRequests.set(chatId, { origin, at: Date.now() });
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

/**
 * 判定写入异常中止报告时应采用的有效中止来源。
 *
 * 传输层断开（client_disconnect）与 /api/chat/stop 到达之间存在竞态：
 * 页面卸载的 stop 请求可能晚于连接断开才被处理。若宽限窗口内存在
 * manual_stop/page_unload 补记，则以该来源为准，避免把用户主动离开误报为异常断连。
 *
 * @param now 判定时刻，测试可注入以模拟宽限窗口过期。
 */
export function resolveEffectiveAbortOrigin(
  chatId: string | undefined,
  signal: AbortSignal,
  now: number = Date.now(),
): ChatAbortOrigin | "unknown" {
  if (chatId) {
    const recorded = recentStopRequests.get(chatId);
    if (recorded) {
      recentStopRequests.delete(chatId);
      if (now - recorded.at <= STOP_REQUEST_GRACE_MS) {
        return recorded.origin;
      }
    }
  }
  return resolveChatAbortOrigin(signal);
}

/** 判断指定会话是否仍存在未中止的运行。 */
export function isChatRunActive(chatId: string): boolean {
  const controllers = activeChatRuns.get(chatId);
  return Boolean(
    controllers &&
      [...controllers].some((controller) => !controller.signal.aborted),
  );
}
