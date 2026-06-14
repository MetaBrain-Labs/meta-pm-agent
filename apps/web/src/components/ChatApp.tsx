import {
  useState,
  useRef,
  useEffect,
  useCallback,
  type FormEvent,
} from "react";
import { Input, Button, Space, Typography, Flex } from "antd";
import {
  SendOutlined,
  StopOutlined,
  ArrowDownOutlined,
} from "@ant-design/icons";
import type { Message } from "../types";
import { MessageBubble } from "./MessageBubble";

const { TextArea } = Input;
const { Text } = Typography;

const EXAMPLE_QUERIES = [
  "帮我梳理一个电商 App 的需求",
  "规划一个 SaaS 产品的 MVP 阶段",
  "分析一下这个项目的技术风险",
];

interface Props {
  messages: Message[];
  isLoading: boolean;
  error: string | null;
  onSend: (text: string) => void;
  onStop: () => void;
  onClear: () => void;
}

export function ChatApp({
  messages,
  isLoading,
  error,
  onSend,
  onStop,
  onClear,
}: Props) {
  const [input, setInput] = useState("");
  const [userScrolled, setUserScrolled] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

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

  const doSubmit = useCallback(() => {
    if (!input.trim() || isLoading) return;
    onSend(input.trim());
    setInput("");
    setUserScrolled(false);
  }, [input, isLoading, onSend]);

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    doSubmit();
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      doSubmit();
    }
  };

  const handleExampleClick = (query: string) => {
    onSend(query);
    setUserScrolled(false);
  };

  return (
    <div
      className="h-full flex flex-col"
      style={{ background: "var(--paper)", position: "relative", zIndex: 2 }}
    >
      {/* Header — editorial topbar style */}
      <Flex
        align="center"
        gap={12}
        className="shrink-0 !px-5 !py-3"
        style={{
          background: "var(--paper-warm)",
          borderBottom: "1px solid var(--line-soft)",
          fontFamily: "'Inter Tight', sans-serif",
          color: "var(--ink)",
        }}
      >
        <span
          className="w-2 h-2 rounded-full shrink-0"
          style={{
            background: "var(--coral)",
            animation: "pulse 2.4s ease-in-out infinite",
          }}
        />
        <span
          style={{
            fontFamily: "'Inter Tight', sans-serif",
            fontWeight: 700,
            fontSize: 15,
            letterSpacing: "-0.012em",
            color: "var(--ink)",
          }}
        >
          项目管理助手
        </span>
        <span
          className="ml-auto"
          style={{
            fontFamily: "'Inter Tight', sans-serif",
            color: "var(--ink-faint)",
            fontWeight: 500,
            fontSize: 10.5,
            letterSpacing: "0.18em",
            textTransform: "uppercase",
          }}
        >
          PM · Agent
        </span>
      </Flex>

      {/* Messages area */}
      <div className="flex-1 flex flex-col min-h-0">
        <div
          ref={containerRef}
          onScroll={handleScroll}
          className="flex-1 overflow-y-auto px-5 py-4 flex flex-col gap-4 scrollbar-none"
        >
          {/* Scroll-to-bottom button */}
          {userScrolled && (
            <Button
              shape="circle"
              icon={<ArrowDownOutlined />}
              size="small"
              className="sticky bottom-4 left-1/2 -translate-x-1/2 z-10"
              style={{ boxShadow: "0 4px 16px rgba(21, 20, 15, 0.15)" }}
              onClick={() => {
                scrollToBottom();
                setUserScrolled(false);
              }}
            />
          )}

          {/* Empty state */}
          {messages.length === 0 && (
            <Flex
              vertical
              align="center"
              justify="center"
              flex={1}
              gap={16}
              className="!px-5 !py-10"
            >
              <h1
                style={{
                  fontFamily: "'Inter Tight', sans-serif",
                  fontWeight: 800,
                  fontSize: 28,
                  color: "var(--ink)",
                  letterSpacing: "-0.024em",
                }}
              >
                项目管理助手
                <span style={{ color: "var(--coral)" }}>.</span>
              </h1>
              <Text
                style={{ color: "var(--ink-mute)", fontSize: 14 }}
                className="text-center max-w-[400px]"
              >
                我能帮你梳理需求、规划任务、分析风险。试试下面的例子：
              </Text>
              <Flex vertical gap={8} className="!mt-2 w-full max-w-[360px]">
                {EXAMPLE_QUERIES.map((q) => (
                  <Button
                    key={q}
                    block
                    disabled={isLoading}
                    onClick={() => handleExampleClick(q)}
                    className="text-xs text-left h-auto py-2.5 px-4"
                    style={{
                      borderColor: "var(--line)",
                      color: "var(--ink-mute)",
                      background: "var(--bone)",
                      borderRadius: 10,
                      fontFamily: "var(--body)",
                      transition: "all 0.18s ease",
                    }}
                    onMouseEnter={(e) => {
                      (e.currentTarget as HTMLElement).style.borderColor =
                        "var(--coral)";
                      (e.currentTarget as HTMLElement).style.color =
                        "var(--coral)";
                    }}
                    onMouseLeave={(e) => {
                      (e.currentTarget as HTMLElement).style.borderColor =
                        "var(--line)";
                      (e.currentTarget as HTMLElement).style.color =
                        "var(--ink-mute)";
                    }}
                  >
                    {q}
                  </Button>
                ))}
              </Flex>
            </Flex>
          )}

          {/* Messages */}
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

          {/* Error banner */}
          {error && (
            <Flex
              align="center"
              justify="space-between"
              gap={10}
              className="shrink-0 !p-2.5 rounded-lg text-[13px]"
              style={{
                background: "rgba(237, 111, 92, 0.08)",
                border: "1px solid rgba(237, 111, 92, 0.25)",
                color: "var(--coral)",
                fontFamily: "var(--body)",
              }}
            >
              <span>{error}</span>
              <Button size="small" danger onClick={onClear}>
                清除
              </Button>
            </Flex>
          )}
        </div>

        {/* Input area */}
        <form
          onSubmit={handleSubmit}
          className="shrink-0 flex gap-2.5 items-end px-5 py-3"
          style={{
            background: "var(--paper-warm)",
            borderTop: "1px solid var(--line)",
          }}
        >
          <TextArea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            rows={1}
            placeholder="输入消息... (Enter 发送, Shift+Enter 换行)"
            disabled={isLoading}
            autoSize={{ minRows: 1, maxRows: 4 }}
            className="flex-1 rounded-lg"
          />
          <Space>
            {isLoading ? (
              <Button
                type="primary"
                danger
                icon={<StopOutlined />}
                onClick={onStop}
              >
                停止
              </Button>
            ) : (
              <Button
                type="primary"
                htmlType="submit"
                icon={<SendOutlined />}
                disabled={!input.trim()}
              >
                发送
              </Button>
            )}
          </Space>
        </form>
      </div>
    </div>
  );
}
