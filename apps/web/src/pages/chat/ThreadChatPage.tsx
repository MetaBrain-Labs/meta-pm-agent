/**
 * 线程聊天页面容器
 *
 * 负责会话消息恢复、新会话创建、用户消息提交以及 `/api/chat` SSE 流消费。
 * 发送请求时会把前端拆分展示的结构化卡片还原为 tagged block，确保后端可以恢复 LangGraph 工作流上下文。
 *
 * Responsibilities:
 * - 管理线程消息、本地加载状态和停止生成动作
 * - 创建聊天记录并提交用户消息到 API
 * - 消费 SSE 事件并增量更新当前助手消息
 *
 * Notes:
 * - 本文件只做页面级状态编排，不直接实现具体消息卡片展示。
 */

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
} from "react";
import { ChatApp } from "../../components/ChatApp";
import {
  createChatRecord,
  fetchChatMessages,
  stopChatGeneration as requestStopChatGeneration,
} from "../../api/chat-api";
import {
  DEFAULT_CHAT_TITLE,
  NO_WORKSPACE_MESSAGE,
} from "../../constants/app";
import type {
  HumanInTheLoopResume,
  Message,
  StreamEvent,
  ThreadInfo,
} from "../../types";
import { mapErrorToChinese } from "../../utils/errors";
import { applyStreamEvent } from "../../utils/apply-stream-event";

interface ThreadChatPageProps {
  workspaceId: string | null;
  workspaceName: string;
  thread: ThreadInfo | null;
  creationError: string | null;
  onNewThread: (thread: ThreadInfo) => void;
  onThreadMessageStarted: (threadId: string) => void;
  onThreadTitleChange: (threadId: string, title: string) => void;
  onBack: () => void;
}

/**
 * 聊天页，负责会话消息恢复、新会话创建和 `/api/chat` SSE 消费。
 */
export function ThreadChatPage({
  workspaceId,
  workspaceName,
  thread,
  creationError,
  onNewThread,
  onThreadMessageStarted,
  onThreadTitleChange,
  onBack,
}: ThreadChatPageProps) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isMessagesLoading, setIsMessagesLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const workspaceIdRef = useRef<string | null>(workspaceId);
  const threadIdRef = useRef<string | null>(thread?.id ?? null);
  const requestFormIdRef = useRef<string | undefined>(thread?.requestFormId);
  const messagesRef = useRef<Message[]>(messages);
  const creatingRef = useRef(false);
  const threadId = thread?.id ?? null;
  const requestFormId = thread?.requestFormId;

  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  useEffect(() => {
    if (creationError) {
      setError(creationError);
    }
  }, [creationError]);

  useEffect(() => {
    workspaceIdRef.current = workspaceId;
    setError(null);
  }, [workspaceId]);

  useEffect(() => {
    threadIdRef.current = threadId;
    requestFormIdRef.current = requestFormId;
  }, [requestFormId, threadId]);

  useEffect(() => {
    if (creatingRef.current) {
      creatingRef.current = false;
      return;
    }

    if (threadId) {
      setMessages([]);
      setIsMessagesLoading(true);
      let cancelled = false;

      fetchChatMessages(threadId)
        .then((serverMessages) => {
          if (cancelled) return;
          // 历史消息以数据库为准；会话元信息变化不触发重载。
          setMessages(serverMessages);
        })
        .catch((error) => {
          if (cancelled) return;
          console.error("[chat] Failed to load messages:", error);
        })
        .finally(() => {
          if (!cancelled) setIsMessagesLoading(false);
        });

      return () => {
        cancelled = true;
      };
    }

    setMessages([]);
    setError(null);
  }, [threadId]);

  const stopGeneration = useCallback(() => {
    const currentThreadId = threadIdRef.current;
    if (currentThreadId) {
      // 先通知服务端中止模型调用，再断开当前浏览器流。
      void requestStopChatGeneration(currentThreadId);
    }

    if (abortRef.current) {
      abortRef.current.abort();
      abortRef.current = null;
    }
    setIsLoading(false);
  }, []);

  const sendMessage = useCallback(
    async (
      text: string,
      options?: {
        webSearchEnabled?: boolean;
        hitlResume?: HumanInTheLoopResume;
      },
    ) => {
      if (!text.trim() || isLoading) return;

      const currentWorkspaceId = workspaceIdRef.current;
      if (!currentWorkspaceId) {
        setError(NO_WORKSPACE_MESSAGE);
        return;
      }

      let threadId = threadIdRef.current;
      const hasExistingThread = Boolean(threadId);
      if (!threadId) {
        try {
          const newThread = await createChatRecord(
            currentWorkspaceId,
            DEFAULT_CHAT_TITLE,
          );
          threadId = newThread.id;
          creatingRef.current = true;
          threadIdRef.current = threadId;
          requestFormIdRef.current = newThread.requestFormId;
          onNewThread(newThread);
        } catch (error: unknown) {
          setError(mapErrorToChinese(error));
          return;
        }
      }

      onThreadMessageStarted(threadId);

      setError(null);
      setIsLoading(true);

      const userMsg: Message = {
        id: crypto.randomUUID(),
        role: "user",
        content: text,
        timestamp: Date.now(),
      };

      const agentMsgId = crypto.randomUUID();
      const agentMsg: Message = {
        id: agentMsgId,
        role: "agent",
        content: "",
        timestamp: Date.now(),
      };
      const priorMessages = hasExistingThread ? messagesRef.current : [];

      setMessages((prev) => [...prev, userMsg, agentMsg]);

      const controller = new AbortController();
      abortRef.current = controller;

      try {
        const requestMessages = [...priorMessages, userMsg].map((message) => ({
          id: message.id,
          role:
            message.role === "agent"
              ? ("assistant" as const)
              : ("user" as const),
          content: serializeMessageContentForRequest(message),
          timestamp: new Date(message.timestamp).toISOString(),
          sessionId: "local",
          ...(message.thinking ? { reasoningContent: message.thinking } : {}),
        }));

        const resp = await fetch("/api/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            chatId: threadId,
            enabledTools: options?.webSearchEnabled ? ["web_search"] : [],
            requestFormId: requestFormIdRef.current,
            hitlResume: options?.hitlResume,
            messages: requestMessages,
          }),
          signal: controller.signal,
        });

        if (!resp.ok) {
          const errorMsg = `Server error: ${resp.status}`;
          setError(mapErrorToChinese(new Error(errorMsg)));
          return;
        }

        const reader = resp.body?.getReader();
        if (!reader) {
          setError(mapErrorToChinese(new Error("No response body")));
          return;
        }

        await readChatStream(
          reader,
          agentMsgId,
          setMessages,
          onThreadTitleChange,
        );
      } catch (error: unknown) {
        if (error instanceof Error && error.name === "AbortError") return;
        setError(mapErrorToChinese(error));
      } finally {
        setIsLoading(false);
        abortRef.current = null;
      }
    },
    [isLoading, onNewThread, onThreadMessageStarted, onThreadTitleChange],
  );

  const clearMessages = useCallback(() => {
    setMessages([]);
    setError(null);
  }, []);

  return (
    <ChatApp
      workspaceId={workspaceId}
      workspaceName={workspaceName}
      messages={messages}
      isLoading={isLoading}
      isMessagesLoading={isMessagesLoading}
      error={error}
      disabledReason={workspaceId ? null : NO_WORKSPACE_MESSAGE}
      onSend={sendMessage}
      onStop={stopGeneration}
      onClear={clearMessages}
      onBack={onBack}
    />
  );
}

/**
 * 读取聊天 SSE 流，并把事件应用到当前助手消息上。
 */
async function readChatStream(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  agentMsgId: string,
  setMessages: Dispatch<SetStateAction<Message[]>>,
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

        setMessages((prev) =>
          prev.map((message) => {
            if (message.id !== agentMsgId) return message;
            return applyStreamEvent(message, event);
          }),
        );
      } catch {
        // 忽略格式异常的流片段，继续读取后续 SSE 数据。
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
 * 兼容实时流和历史恢复两种来源：已有标签则原样保留，纯 JSON 则补齐标签。
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
