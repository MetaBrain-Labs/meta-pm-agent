import { useCallback, useEffect, useRef, useState } from "react";
import { ChatApp } from "../../components/ChatApp";
import {
  createChatRecord,
  fetchChatMessages,
} from "../../api/chat-api";
import {
  DEFAULT_CHAT_TITLE,
  NO_WORKSPACE_MESSAGE,
} from "../../constants/app";
import type { Message, StreamEvent, ThreadInfo } from "../../types";
import { mapErrorToChinese } from "../../utils/errors";
import { applyStreamEvent } from "../../utils/apply-stream-event";

interface ThreadChatPageProps {
  workspaceId: string | null;
  workspaceName: string;
  thread: ThreadInfo | null;
  creationError: string | null;
  onNewThread: (thread: ThreadInfo) => void;
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
  onBack,
}: ThreadChatPageProps) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const workspaceIdRef = useRef<string | null>(workspaceId);
  const threadIdRef = useRef<string | null>(thread?.id ?? null);
  const requestFormIdRef = useRef<string | undefined>(thread?.requestFormId);
  const messagesRef = useRef<Message[]>(messages);
  const creatingRef = useRef(false);

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
    if (creatingRef.current) {
      creatingRef.current = false;
      threadIdRef.current = thread?.id ?? null;
      requestFormIdRef.current = thread?.requestFormId;
      return;
    }

    threadIdRef.current = thread?.id ?? null;
    requestFormIdRef.current = thread?.requestFormId;

    if (thread?.id) {
      setMessages([]);
      let cancelled = false;

      fetchChatMessages(thread.id)
        .then((serverMessages) => {
          if (cancelled) return;
          // 历史消息以数据库为准，不再读取或回写浏览器本地缓存。
          setMessages(serverMessages);
        })
        .catch((error) => {
          console.error("[chat] Failed to load messages:", error);
        });

      return () => {
        cancelled = true;
      };
    }

    setMessages([]);
    setError(null);
  }, [thread]);

  const stopGeneration = useCallback(() => {
    if (abortRef.current) {
      abortRef.current.abort();
      abortRef.current = null;
    }
    setIsLoading(false);
  }, []);

  const sendMessage = useCallback(
    async (text: string) => {
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
            text.slice(0, 30) || DEFAULT_CHAT_TITLE,
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
          content: message.content || message.userInput?.content || "",
          timestamp: new Date(message.timestamp).toISOString(),
          sessionId: "local",
          ...(message.thinking ? { reasoningContent: message.thinking } : {}),
        }));

        const resp = await fetch("/api/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            chatId: threadId,
            requestFormId: requestFormIdRef.current,
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

        await readChatStream(reader, agentMsgId, setMessages);
      } catch (error: unknown) {
        if (error instanceof Error && error.name === "AbortError") return;
        setError(mapErrorToChinese(error));
      } finally {
        setIsLoading(false);
        abortRef.current = null;
      }
    },
    [isLoading, onNewThread],
  );

  const clearMessages = useCallback(() => {
    setMessages([]);
    setError(null);
  }, []);

  return (
    <ChatApp
      workspaceName={workspaceName}
      messages={messages}
      isLoading={isLoading}
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
  setMessages: React.Dispatch<React.SetStateAction<Message[]>>,
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
