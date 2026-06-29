/**
 * 聊天流运行注册表
 *
 * 将正在执行的 `/api/chat` SSE 请求从单个页面组件生命周期中解耦。
 * 用户切换对话时，原对话的流会继续被消费并保存在对应 thread 快照中；
 * 只有用户点击停止或关闭页面时才主动通知服务端中断。
 *
 * Responsibilities:
 * - 按 threadId 管理运行中的 AbortController、消息快照和订阅者
 * - 消费 SSE 事件并把增量结果应用到对应助手消息
 * - 在手动停止或页面关闭时调用 `/api/chat/stop`
 *
 * Notes:
 * - 本模块只保存运行期内存快照，历史权威数据仍来自 API 持久化消息。
 */

import { stopChatGeneration as requestStopChatGeneration } from "../../api/chat-api";
import type {
  HumanInTheLoopResume,
  Message,
  StreamEvent,
} from "../../types";
import { applyStreamEvent } from "../../utils/apply-stream-event";
import { mapErrorToChinese } from "../../utils/errors";

interface ChatRunSnapshot {
  messages: Message[];
  isLoading: boolean;
  error: string | null;
}

interface ChatRunState extends ChatRunSnapshot {
  controller: AbortController | null;
  listeners: Set<(snapshot: ChatRunSnapshot) => void>;
}

interface StartChatRunInput {
  threadId: string;
  requestFormId?: string;
  priorMessages: Message[];
  userText: string;
  webSearchEnabled?: boolean;
  hitlResume?: HumanInTheLoopResume;
  onThreadTitleChange: (threadId: string, title: string) => void;
}

const runs = new Map<string, ChatRunState>();
let beforeUnloadBound = false;

/**
 * 订阅指定 thread 的运行快照。
 */
export function subscribeChatRun(
  threadId: string,
  listener: (snapshot: ChatRunSnapshot) => void,
): () => void {
  const state = ensureRunState(threadId);
  state.listeners.add(listener);
  listener(toSnapshot(state));

  bindBeforeUnloadStop();

  return () => {
    state.listeners.delete(listener);
  };
}

/**
 * 读取当前仍在运行的快照；已结束的快照不覆盖数据库历史。
 */
export function getActiveChatRunSnapshot(
  threadId: string,
): ChatRunSnapshot | null {
  const state = runs.get(threadId);
  return state?.isLoading ? toSnapshot(state) : null;
}

/**
 * 启动指定 thread 的聊天流。
 */
export async function startChatRun(input: StartChatRunInput): Promise<void> {
  const existing = runs.get(input.threadId);
  if (existing?.isLoading) return;

  const state = ensureRunState(input.threadId);
  const userMsg: Message = {
    id: crypto.randomUUID(),
    role: "user",
    content: input.userText,
    timestamp: Date.now(),
  };
  const agentMsgId = crypto.randomUUID();
  const agentMsg: Message = {
    id: agentMsgId,
    role: "agent",
    content: "",
    timestamp: Date.now(),
  };
  const controller = new AbortController();

  state.messages = [...input.priorMessages, userMsg, agentMsg];
  state.isLoading = true;
  state.error = null;
  state.controller = controller;
  emit(input.threadId);

  try {
    const requestMessages = [...input.priorMessages, userMsg].map((message) => ({
      id: message.id,
      role:
        message.role === "agent" ? ("assistant" as const) : ("user" as const),
      content: serializeMessageContentForRequest(message),
      timestamp: new Date(message.timestamp).toISOString(),
      sessionId: "local",
      ...(message.thinking ? { reasoningContent: message.thinking } : {}),
    }));

    const resp = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chatId: input.threadId,
        enabledTools: input.webSearchEnabled ? ["web_search"] : [],
        requestFormId: input.requestFormId,
        hitlResume: input.hitlResume,
        messages: requestMessages,
      }),
      signal: controller.signal,
    });

    if (!resp.ok) {
      throw new Error(`Server error: ${resp.status}`);
    }

    const reader = resp.body?.getReader();
    if (!reader) {
      throw new Error("No response body");
    }

    await readChatStream(
      reader,
      input.threadId,
      agentMsgId,
      input.onThreadTitleChange,
    );
  } catch (error: unknown) {
    if (!(error instanceof Error && error.name === "AbortError")) {
      state.error = mapErrorToChinese(error);
    }
  } finally {
    state.isLoading = false;
    state.controller = null;
    emit(input.threadId);
  }
}

/**
 * 手动停止指定 thread 的运行。
 */
export function stopChatRun(threadId: string): void {
  const state = runs.get(threadId);
  void requestStopChatGeneration(threadId);

  if (state?.controller) {
    state.controller.abort();
    state.controller = null;
  }
  if (state) {
    state.isLoading = false;
    emit(threadId);
  }
}

/**
 * 浏览器关闭时中断所有仍在运行的对话。
 */
function stopAllActiveRunsOnUnload(): void {
  for (const [threadId, state] of runs) {
    if (!state.isLoading) continue;
    const payload = JSON.stringify({ chatId: threadId });
    if (navigator.sendBeacon) {
      navigator.sendBeacon(
        "/api/chat/stop",
        new Blob([payload], { type: "application/json" }),
      );
    } else {
      void fetch("/api/chat/stop", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: payload,
        keepalive: true,
      });
    }
    state.controller?.abort();
  }
}

/**
 * 懒绑定关闭页面中断逻辑，避免 SSR 或测试环境访问 window。
 */
function bindBeforeUnloadStop(): void {
  if (beforeUnloadBound || typeof window === "undefined") return;
  beforeUnloadBound = true;
  window.addEventListener("beforeunload", stopAllActiveRunsOnUnload);
}

/**
 * 读取聊天 SSE 流并更新指定 thread 的助手消息。
 */
async function readChatStream(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  threadId: string,
  agentMsgId: string,
  onThreadTitleChange: (threadId: string, title: string) => void,
) {
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() || "";

    for (const line of lines) {
      if (!line.startsWith("data: ")) continue;
      const payload = line.slice(6).trim();
      if (payload === "[DONE]") continue;

      try {
        const event = JSON.parse(payload) as StreamEvent;
        if (
          event.type === "conversation-title" &&
          event.chatId &&
          event.title
        ) {
          onThreadTitleChange(event.chatId, event.title);
          continue;
        }

        updateMessages(threadId, (messages) =>
          messages.map((message) => {
            if (message.id !== agentMsgId) return message;
            return applyStreamEvent(message, event);
          }),
        );
      } catch {
        // 忽略格式异常的流片段，继续消费后续 SSE。
      }
    }
  }
}

/**
 * 将前端拆分展示的结构化卡片还原为后端恢复工作流所需的 tagged block 历史。
 */
function serializeMessageContentForRequest(message: Message): string {
  if (message.role === "user") return message.content;

  const parts = [message.content.trim()].filter(Boolean);
  appendTaggedContent(parts, "user-input", message.userInput?.content);
  appendTaggedContent(parts, "request-analysis", message.requestAnalysis?.content);
  appendTaggedContent(parts, "task-execution", message.plannerExecution?.content);

  for (const result of message.executorResults ?? []) {
    parts.push(
      `<executor-result>\n${JSON.stringify(result, null, 2)}\n</executor-result>`,
    );
  }

  return parts.join("\n\n");
}

/**
 * 兼容实时流和历史恢复：已有标签保留，纯 JSON 补齐标签。
 */
function appendTaggedContent(
  parts: string[],
  tagName: string,
  content: string | undefined,
): void {
  const trimmed = content?.trim();
  if (!trimmed) return;

  if (new RegExp(`^<${tagName}\\b`, "i").test(trimmed)) {
    parts.push(trimmed);
    return;
  }

  parts.push(`<${tagName}>\n${trimmed}\n</${tagName}>`);
}

/**
 * 确保 thread 存在运行状态。
 */
function ensureRunState(threadId: string): ChatRunState {
  const existing = runs.get(threadId);
  if (existing) return existing;

  const created: ChatRunState = {
    messages: [],
    isLoading: false,
    error: null,
    controller: null,
    listeners: new Set(),
  };
  runs.set(threadId, created);
  return created;
}

/**
 * 更新消息快照。
 */
function updateMessages(
  threadId: string,
  updater: (messages: Message[]) => Message[],
): void {
  const state = ensureRunState(threadId);
  state.messages = updater(state.messages);
  emit(threadId);
}

/**
 * 通知订阅者。
 */
function emit(threadId: string): void {
  const state = runs.get(threadId);
  if (!state) return;

  const snapshot = toSnapshot(state);
  for (const listener of state.listeners) {
    listener(snapshot);
  }
}

/**
 * 生成不可变快照，避免页面层误改注册表状态。
 */
function toSnapshot(state: ChatRunState): ChatRunSnapshot {
  return {
    messages: state.messages,
    isLoading: state.isLoading,
    error: state.error,
  };
}
