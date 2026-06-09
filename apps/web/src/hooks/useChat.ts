import { useState, useCallback, useRef } from "react";
import type { Message, StreamEvent } from "../types";

function toRequestMessages(msgs: Message[]) {
  return msgs.map((m) => ({
    id: m.id,
    role: m.role === "agent" ? ("assistant" as const) : ("user" as const),
    content: m.content,
    timestamp: new Date(m.timestamp).toISOString(),
    sessionId: "local",
    ...(m.thinking ? { reasoningContent: m.thinking } : {}),
  }));
}

function mapErrorToChinese(err: Error | string): string {
  const message = typeof err === "string" ? err : err.message;
  if (message.includes("Failed to fetch") || message.includes("NetworkError")) {
    return "网络连接失败，请检查网络后重试";
  }
  if (message.includes("AbortError")) return "";
  const statusMatch = message.match(/Server error: (\d+)/);
  if (statusMatch) {
    const code = parseInt(statusMatch[1]!);
    if (code === 429) return "请求过于频繁，请稍后再试";
    if (code >= 500) return "服务器繁忙，请稍后重试";
    if (code === 401 || code === 403) return "鉴权失败，请检查 API Key 配置";
  }
  if (message.includes("No response body")) return "服务器未返回有效响应";
  return "连接中断，请点击重试";
}

export function useChat() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [undoAvailable, setUndoAvailable] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const lastSentTextRef = useRef<string | null>(null);

  const stopGeneration = useCallback(() => {
    if (abortRef.current) {
      abortRef.current.abort();
      abortRef.current = null;
    }
    setIsLoading(false);
  }, []);

  const undoLastMessage = useCallback(() => {
    setMessages((prev) => {
      if (prev.length < 2) return prev;
      const lastUserIdx = (() => {
        for (let i = prev.length - 1; i >= 0; i--) {
          if (prev[i]!.role === "user") return i;
        }
        return -1;
      })();
      if (lastUserIdx === -1) return prev;
      return prev.slice(0, lastUserIdx);
    });
    setUndoAvailable(false);
    lastSentTextRef.current = null;
  }, []);

  const sendMessage = useCallback(
    async (text: string) => {
      if (!text.trim() || isLoading) return;

      setError(null);
      setIsLoading(true);
      setUndoAvailable(true);
      lastSentTextRef.current = text;

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

      const requestMessages = [...messages, userMsg];

      setMessages((prev) => [...prev, userMsg, agentMsg]);

      const controller = new AbortController();
      abortRef.current = controller;

      try {
        const resp = await fetch("/api/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ messages: toRequestMessages(requestMessages) }),
          signal: controller.signal,
        });

        if (!resp.ok) {
          const errorMsg = `Server error: ${resp.status}`;
          setError(mapErrorToChinese(new Error(errorMsg)));
          setMessages((prev) =>
            prev.map((m) =>
              m.id === agentMsgId ? { ...m, content: m.content + `\n[错误: ${errorMsg}]` } : m
            )
          );
          return;
        }

        const reader = resp.body?.getReader();
        if (!reader) {
          setError(mapErrorToChinese(new Error("No response body")));
          return;
        }

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
              const event: StreamEvent = JSON.parse(payload);
              setMessages((prev) =>
                prev.map((m) => {
                  if (m.id !== agentMsgId) return m;
                  switch (event.type) {
                    case "thinking":
                      return { ...m, thinking: (m.thinking ?? "") + (event.content ?? "") };
                    case "text":
                      return { ...m, content: m.content + (event.content ?? "") };
                    case "question-form-start":
                      return { ...m, questionForm: { state: "generating" } };
                    case "question-form-complete":
                      return { ...m, questionForm: { state: "complete", content: event.content } };
                    case "todo-update":
                      return {
                        ...m,
                        todos: (event.todos ?? []).map((t) => ({
                          index: t.index,
                          content: t.content,
                          status: t.status as "pending" | "in_progress" | "completed",
                        })),
                      };
                    case "tool-call":
                      return { ...m, toolCalls: [...(m.toolCalls ?? []), { name: event.toolName ?? "unknown", args: event.toolArgs }] };
                    case "tool-result":
                      return { ...m, toolCalls: (m.toolCalls ?? []).map((tc, i) =>
                        i === (m.toolCalls?.length ?? 1) - 1 ? { ...tc, result: event.toolResult } : tc
                      ) };
                    case "finish":
                      return { ...m, usage: event.usage };
                    case "error":
                      return { ...m, content: m.content + `\n[Error: ${JSON.stringify(event.error)}]` };
                    default:
                      return m;
                  }
                })
              );
            } catch { /* ignore */ }
          }
        }
      } catch (err: any) {
        if (err.name === "AbortError") return;
        const friendly = mapErrorToChinese(err);
        setError(friendly);
        setMessages((prev) =>
          prev.map((m) =>
            m.id === agentMsgId ? { ...m, content: m.content + `\n[错误: ${err instanceof Error ? err.message : String(err)}]` } : m
          )
        );
      } finally {
        setIsLoading(false);
        abortRef.current = null;
      }
    },
    [isLoading, messages]
  );

  const clearMessages = useCallback(() => {
    setMessages([]);
    setError(null);
    setUndoAvailable(false);
    lastSentTextRef.current = null;
  }, []);

  return { messages, isLoading, error, undoAvailable, sendMessage, stopGeneration, undoLastMessage, clearMessages };
}
