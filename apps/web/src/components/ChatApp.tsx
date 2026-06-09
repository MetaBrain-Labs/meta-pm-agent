import {
  useState,
  useRef,
  useEffect,
  useCallback,
  type FormEvent,
} from "react";
import type { Message } from "../types";
import { MessageBubble } from "./MessageBubble";
import { Icon } from "./Icon";

const EXAMPLE_QUERIES = [
  "帮我梳理一个电商 App 的需求",
  "规划一个 SaaS 产品的 MVP 阶段",
  "分析一下这个项目的技术风险",
];

interface Props {
  messages: Message[];
  isLoading: boolean;
  error: string | null;
  undoAvailable: boolean;
  onSend: (text: string) => void;
  onStop: () => void;
  onUndo: () => void;
  onClear: () => void;
}

export function ChatApp({
  messages,
  isLoading,
  error,
  undoAvailable,
  onSend,
  onStop,
  onUndo,
  onClear,
}: Props) {
  const [input, setInput] = useState("");
  const [userScrolled, setUserScrolled] = useState(false);
  const [showUndo, setShowUndo] = useState(false);
  const undoTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
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
    setShowUndo(true);
    if (undoTimeoutRef.current) clearTimeout(undoTimeoutRef.current);
    undoTimeoutRef.current = setTimeout(() => setShowUndo(false), 5000);
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
    }
  };

  useEffect(() => {
    return () => {
      if (undoTimeoutRef.current) clearTimeout(undoTimeoutRef.current);
    };
  }, []);

  useEffect(() => {
    if (!undoAvailable && showUndo) {
      setShowUndo(false);
    }
  }, [undoAvailable, showUndo]);

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

  const handleExampleClick = (query: string) => {
    onSend(query);
    setUserScrolled(false);
    setShowUndo(true);
    if (undoTimeoutRef.current) clearTimeout(undoTimeoutRef.current);
    undoTimeoutRef.current = setTimeout(() => setShowUndo(false), 5000);
  };

  return (
    <div className="chat-main">
      <header>
        <span className="dot" />
        项目管理助手
      </header>

      <div
        className="chat-container"
        ref={containerRef}
        onScroll={handleScroll}
      >
        {userScrolled && (
          <button
            className="scroll-bottom-btn"
            onClick={() => {
              scrollToBottom();
              setUserScrolled(false);
            }}
            title="滚动到底部"
          >
            <Icon name="chevron-down" size={18} />
          </button>
        )}

        {showUndo && undoAvailable && (
          <div className="undo-toast">
            <span>消息已发送</span>
            <button onClick={() => { onUndo(); setShowUndo(false); }}>撤销</button>
            <button className="undo-toast-close" onClick={() => setShowUndo(false)}>
              <Icon name="close" size={12} />
            </button>
          </div>
        )}

        {messages.length === 0 && (
          <div className="empty-state">
            <p className="empty-state-title">项目管理助手</p>
            <p className="empty-state-desc">我能帮你梳理需求、规划任务、分析风险。试试下面的例子：</p>
            <div className="examples-grid">
              {EXAMPLE_QUERIES.map((q) => (
                <button
                  key={q}
                  className="example-chip"
                  onClick={() => handleExampleClick(q)}
                  disabled={isLoading}
                >
                  {q}
                </button>
              ))}
            </div>
          </div>
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
            <span>{error}</span>
            <div className="error-banner-actions">
              <button onClick={onClear}>清除</button>
            </div>
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
          placeholder="输入消息... (Enter 发送, Shift+Enter 换行，/ 聚焦输入)"
          disabled={isLoading}
        />
        {isLoading ? (
          <button
            type="button"
            className="stop-btn"
            onClick={onStop}
            title="停止生成"
          >
            <Icon name="stop" size={16} />
          </button>
        ) : (
          <button type="submit" disabled={!input.trim()} title="发送">
            <Icon name="send" size={16} />
          </button>
        )}
      </form>
    </div>
  );
}
