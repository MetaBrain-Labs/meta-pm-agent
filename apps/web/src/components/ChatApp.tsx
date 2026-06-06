import {
  useState,
  useRef,
  useEffect,
  useCallback,
  useMemo,
  type FormEvent,
} from "react";
import type { Message } from "../types";
import { MessageBubble } from "./MessageBubble";
import { Sidebar } from "./Sidebar";

interface Props {
  messages: Message[];
  isLoading: boolean;
  error: string | null;
  threadId: string;
  onSend: (text: string) => void;
  onClear: () => void;
  onLoadThread: (threadId: string) => void;
  onNewThread: () => void;
}

export function ChatApp({
  messages,
  isLoading,
  error,
  threadId,
  onSend,
  onClear,
  onLoadThread,
  onNewThread,
}: Props) {
  const [input, setInput] = useState("");
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [userScrolled, setUserScrolled] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const isAtBottom = useCallback(() => {
    const el = containerRef.current;
    if (!el) return true;
    return el.scrollHeight - el.scrollTop - el.clientHeight < 40;
  }, []);

  const scrollToBottom = useCallback(() => {
    if (containerRef.current) {
      containerRef.current.scrollTop = containerRef.current.scrollHeight;
    }
  }, []);

  // Auto-follow bottom unless user has scrolled away
  useEffect(() => {
    if (!userScrolled) {
      scrollToBottom();
    }
  }, [messages, userScrolled, scrollToBottom]);

  const handleScroll = useCallback(() => {
    setUserScrolled(!isAtBottom());
  }, [isAtBottom]);

  const lastAgentIdx = (() => {
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i]!.role === "agent") return i;
    }
    return -1;
  })();

  const nextUserContentByAssistantId = (() => {
    const map = new Map<string, string>();
    for (let i = 0; i < messages.length - 1; i++) {
      const m = messages[i]!;
      const next = messages[i + 1]!;
      if (m.role === "agent" && next.role === "user") {
        map.set(m.id, next.content);
      }
    }
    return map;
  })();

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (!input.trim() || isLoading) return;
    onSend(input.trim());
    setInput("");
    setUserScrolled(false);
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit(e as unknown as FormEvent);
    }
  };

  const handleInput = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setInput(e.target.value);
    e.target.style.height = "auto";
    e.target.style.height = Math.min(e.target.scrollHeight, 120) + "px";
  };

  // Increment when messages length changes → triggers sidebar refresh
  const sidebarKey = useMemo(() => messages.length, [messages.length]);

  return (
    <div className="app-layout">
      <Sidebar
        currentThreadId={threadId}
        onSelectThread={(tid) => {
          setUserScrolled(false);
          onLoadThread(tid);
        }}
        onNewThread={() => {
          setUserScrolled(false);
          onNewThread();
        }}
        collapsed={!sidebarOpen}
        onToggle={() => setSidebarOpen((v) => !v)}
        refreshKey={sidebarKey}
      />

      <div className="chat-main">
        <header>
          {!sidebarOpen && (
            <button
              className="sidebar-toggle-btn"
              onClick={() => setSidebarOpen(true)}
            >
              ☰
            </button>
          )}
          <span className="dot" />
          Question Form Agent
        </header>

        <div
          className="chat-container"
          ref={containerRef}
          onScroll={handleScroll}
        >
          {userScrolled && (
            <div className="sticky flex justify-center items-center top-5 right-5 z-10">
              <button
                className="
                  w-12 h-12
                  rounded-full

                  bg-[#21262d]
                  c-#e1e4e8

                  border border-[#30363d]
                  shadow-lg

                  flex items-center justify-center

                  transition-all duration-300 ease-out

                  hover:bg-[#30363d]
                  hover:c-[#8b949e]
                  hover:scale-110
                  hover:-translate-y-1
                  hover:shadow-2xl

                  active:scale-95
                "
                onClick={() => {
                  scrollToBottom();
                  setUserScrolled(false);
                }}
                title="滚动到底部"
              >
                ↓
              </button>
            </div>
          )}
          {messages.length === 0 && (
            <div className="empty-state">输入消息，开始与 Agent 对话</div>
          )}

          {messages.map((msg, i) => (
            <MessageBubble
              key={msg.id}
              message={msg}
              isLast={i === lastAgentIdx}
              streaming={
                isLoading && i === messages.length - 1 && msg.role === "agent"
              }
              nextUserContent={nextUserContentByAssistantId.get(msg.id)}
              onFormSubmit={onSend}
            />
          ))}

          {error && (
            <div className="error-banner">
              {error}
              <button onClick={onClear}>✕</button>
            </div>
          )}
        </div>

        <form className="input-area" onSubmit={handleSubmit}>
          <textarea
            ref={textareaRef}
            value={input}
            onChange={handleInput}
            onKeyDown={handleKeyDown}
            rows={1}
            placeholder="输入你的消息... (Enter 发送, Shift+Enter 换行)"
            disabled={isLoading}
          />
          <button type="submit" disabled={isLoading || !input.trim()}>
            {isLoading ? <span className="spinner" /> : <span>发送</span>}
          </button>
        </form>
      </div>
    </div>
  );
}
