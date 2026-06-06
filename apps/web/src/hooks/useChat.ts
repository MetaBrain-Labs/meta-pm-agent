import { useState, useCallback, useRef, useEffect } from "react";
import type { Message, StreamEvent } from "../types";

const STORAGE_KEY = "chat_threads_state";

function loadThreadId(): string | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw);
    return data?.threadId ?? null;
  } catch { return null; }
}

function saveThreadId(threadId: string) {
  try {
    const existing = localStorage.getItem(STORAGE_KEY);
    const data = existing ? JSON.parse(existing) : {};
    data.threadId = threadId;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  } catch { /* ignore */ }
}

function loadMessages(): Message[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const data = JSON.parse(raw);
    return Array.isArray(data.messages) ? data.messages : [];
  } catch { return []; }
}

function saveMessages(messages: Message[]) {
  try {
    const existing = localStorage.getItem(STORAGE_KEY);
    const data = existing ? JSON.parse(existing) : {};
    data.messages = messages;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  } catch { /* ignore */ }
}

export function useChat() {
  const [messages, setMessages] = useState<Message[]>(loadMessages);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [threadId, setThreadId] = useState<string>(() => loadThreadId() ?? crypto.randomUUID());
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    saveThreadId(threadId);
  }, [threadId]);

  useEffect(() => {
    saveMessages(messages);
  }, [messages]);

  const sendMessage = useCallback(
    async (text: string) => {
      if (!text.trim() || isLoading) return;

      setError(null);
      setIsLoading(true);

      const userMsg: Message = {
        id: crypto.randomUUID(),
        role: "user",
        content: text,
        timestamp: Date.now(),
      };
      setMessages((prev) => [...prev, userMsg]);

      const agentMsgId = crypto.randomUUID();
      const agentMsg: Message = {
        id: agentMsgId,
        role: "agent",
        content: "",
        timestamp: Date.now(),
      };
      setMessages((prev) => [...prev, agentMsg]);

      const controller = new AbortController();
      abortRef.current = controller;

      try {
        const resp = await fetch("/api/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ message: text, threadId }),
          signal: controller.signal,
        });

        if (!resp.ok) throw new Error(`Server error: ${resp.status}`);

        const reader = resp.body?.getReader();
        if (!reader) throw new Error("No response body");

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
        const msg = err instanceof Error ? err.message : String(err);
        setError(msg);
        setMessages((prev) =>
          prev.map((m) =>
            m.id === agentMsgId ? { ...m, content: m.content + `\n[错误: ${msg}]` } : m
          )
        );
      } finally {
        setIsLoading(false);
        abortRef.current = null;
      }
    },
    [isLoading, threadId]
  );

  const loadThread = useCallback(async (tId: string) => {
    setError(null);
    setIsLoading(true);
    try {
      const resp = await fetch(`/api/threads/${tId}/messages`);
      if (!resp.ok) throw new Error(`Server error: ${resp.status}`);
      const data = await resp.json();
      const msgs: Message[] = (data.messages ?? []).map((m: any) => ({
        id: m.id,
        role: m.role === "agent" || m.role === "assistant" ? "agent" : "user",
        content: m.content ?? "",
        timestamp: new Date(m.createdAt).getTime(),
      }));
      setMessages(msgs);
      setThreadId(tId);
    } catch (err: any) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsLoading(false);
    }
  }, []);

  const newThread = useCallback(() => {
    setMessages([]);
    setError(null);
    setThreadId(crypto.randomUUID());
  }, []);

  const clearMessages = useCallback(() => {
    setMessages([]);
    setError(null);
  }, []);

  return { messages, isLoading, error, threadId, sendMessage, loadThread, newThread, clearMessages };
}
