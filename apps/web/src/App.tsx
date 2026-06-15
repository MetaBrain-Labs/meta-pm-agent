import { useState, useCallback, useRef, useEffect } from "react";
import { Layout, ConfigProvider } from "antd";
import zhCN from "antd/locale/zh_CN";
import { ChatApp } from "./components/ChatApp";
import { Sidebar } from "./components/Sidebar";
import type { ThreadInfo, Message, StreamEvent } from "./types";
import { applyStreamEvent } from "./utils/apply-stream-event";

const STORAGE_KEY = "pm-agent-threads";

function loadThreads(): ThreadInfo[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function saveThreads(threads: ThreadInfo[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(threads));
}

function loadMessages(threadId: string): Message[] {
  try {
    const raw = localStorage.getItem(`pm-msgs-${threadId}`);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function saveMessages(threadId: string, messages: Message[]) {
  localStorage.setItem(`pm-msgs-${threadId}`, JSON.stringify(messages));
}

export default function App() {
  const [threads, setThreads] = useState<ThreadInfo[]>(() => loadThreads());
  const [activeThreadId, setActiveThreadId] = useState<string | null>(null);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);

  const handleNewThread = useCallback((id: string, title: string) => {
    const now = new Date().toISOString();
    const newThread: ThreadInfo = { id, title, createdAt: now, updatedAt: now };
    setThreads((prev) => {
      const updated = [newThread, ...prev];
      saveThreads(updated);
      return updated;
    });
    setActiveThreadId(id);
  }, []);

  const handleSelectThread = useCallback((id: string) => {
    setActiveThreadId(id);
  }, []);

  const handleNewChat = useCallback(() => {
    setActiveThreadId(null);
  }, []);

  return (
    <ConfigProvider
      theme={{
        token: {
          colorPrimary: "#2563eb",
          colorSuccess: "#059669",
          colorWarning: "#d97706",
          colorError: "#dc2626",
          borderRadius: 8,
          colorBgContainer: "#ffffff",
          colorBgLayout: "#f4f7fb",
          colorBgElevated: "#ffffff",
          colorText: "#111827",
          colorTextSecondary: "#4b5563",
          colorTextTertiary: "#6b7280",
          colorBorder: "#d9e1ec",
          colorBorderSecondary: "#e8edf5",
          fontFamily: "'Inter', -apple-system, system-ui, sans-serif",
          fontSize: 14,
          controlHeight: 38,
          lineHeight: 1.55,
        },
        components: {
          Button: {
            fontWeight: 600,
            primaryShadow: "0 10px 22px -12px rgba(37, 99, 235, 0.75)",
          },
          Input: {
            activeBorderColor: "#2563eb",
            hoverBorderColor: "#9bb5da",
          },
          Layout: {
            bodyBg: "#f4f7fb",
            siderBg: "#ffffff",
          },
        },
      }}
      locale={zhCN}
    >
      <Layout className="h-screen app-shell" style={{ gap: 0 }}>
        <Sidebar
          threads={threads}
          activeId={activeThreadId}
          collapsed={sidebarCollapsed}
          onSelect={handleSelectThread}
          onNew={handleNewChat}
          onToggle={() => setSidebarCollapsed(!sidebarCollapsed)}
        />
        <Layout style={{ background: 'transparent' }}>
          <ThreadChatView
            threadId={activeThreadId}
            onNewThread={handleNewThread}
          />
        </Layout>
      </Layout>
    </ConfigProvider>
  );
}

function ThreadChatView({
  threadId,
  onNewThread,
}: {
  threadId: string | null;
  onNewThread: (id: string, title: string) => void;
}) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const threadIdRef = useRef<string | null>(threadId);
  const messagesRef = useRef<Message[]>(messages);
  const creatingRef = useRef(false);

  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  useEffect(() => {
    if (creatingRef.current) {
      creatingRef.current = false;
      threadIdRef.current = threadId;
      return;
    }
    threadIdRef.current = threadId;
    if (threadId) {
      setMessages(loadMessages(threadId));
    } else {
      setMessages([]);
    }
    setError(null);
  }, [threadId]);

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

      let tid = threadIdRef.current;
      if (!tid) {
        tid = crypto.randomUUID();
        creatingRef.current = true;
        threadIdRef.current = tid;
        onNewThread(tid, text.slice(0, 30));
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

      setMessages((prev) => {
        const next = [...prev, userMsg, agentMsg];
        const currentTid = threadIdRef.current;
        if (currentTid) saveMessages(currentTid, next);
        return next;
      });

      const controller = new AbortController();
      abortRef.current = controller;

      try {
        const priorMessages = tid ? loadMessages(tid).filter((m) => m.id !== userMsg.id && m.id !== agentMsgId) : [];
        const requestMessages = [...priorMessages, userMsg].map((m) => ({
          id: m.id,
          role: m.role === "agent" ? ("assistant" as const) : ("user" as const),
          content: m.content,
          timestamp: new Date(m.timestamp).toISOString(),
          sessionId: "local",
          ...(m.thinking ? { reasoningContent: m.thinking } : {}),
        }));

        const resp = await fetch("/api/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ messages: requestMessages }),
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
              setMessages((prev) => {
                const next = prev.map((m) => {
                  if (m.id !== agentMsgId) return m;
                  return applyStreamEvent(m, event);
                });
                const currentTid = threadIdRef.current;
                if (currentTid) saveMessages(currentTid, next);
                return next;
              });
            } catch { /* ignore */ }
          }
        }
      } catch (err: any) {
        if (err.name === "AbortError") return;
        const friendly = mapErrorToChinese(err);
        setError(friendly);
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
    const tid = threadIdRef.current;
    if (tid) saveMessages(tid, []);
  }, []);

  return (
    <ChatApp
      messages={messages}
      isLoading={isLoading}
      error={error}
      onSend={sendMessage}
      onStop={stopGeneration}
      onClear={clearMessages}
    />
  );
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
