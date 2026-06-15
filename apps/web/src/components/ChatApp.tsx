import {
  useState,
  useRef,
  useEffect,
  useCallback,
  type FormEvent,
} from "react";
import { Input, Button, Typography, Tooltip, Badge, FloatButton } from "antd";
import {
  SendOutlined,
  StopOutlined,
  ArrowDownOutlined,
  ClearOutlined,
  BulbOutlined,
  ProjectOutlined,
} from "@ant-design/icons";
import type { Message } from "../types";
import { MessageBubble } from "./MessageBubble";

const { TextArea } = Input;
const { Text } = Typography;

const EXAMPLE_QUERIES = [
  "帮我梳理一个电商 App 的需求",
  "规划一个 SaaS 产品的 MVP 阶段",
  "分析一下这个项目的技术风险",
  "新增了一个需求，帮我评估对现有计划的影响",
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
    <div className="relative z-[1] flex h-full flex-col bg-transparent">
      <header className="flex shrink-0 items-center gap-3 border-b border-[var(--line-soft)] bg-white/85 px-6 py-4 backdrop-blur md:px-8">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[var(--primary-soft)] text-[var(--primary)]">
          <ProjectOutlined />
        </span>
        <div className="min-w-0 flex-1">
          <div className="truncate font-[var(--sans)] text-[15px] font-bold text-[var(--ink)]">
            项目管理助手
          </div>
          <Text className="block truncate text-xs text-[var(--ink-faint)]">
            需求拆解、计划推进、风险分析
          </Text>
        </div>
        <Badge
          className="ml-auto shrink-0"
          status={isLoading ? "processing" : "success"}
          text={
            <span className="font-[var(--sans)] text-xs font-semibold text-[var(--ink-mute)]">
              {isLoading ? "生成中" : "就绪"}
            </span>
          }
        />
      </header>

      <div className="relative flex min-h-0 flex-1 flex-col">
        <div
          ref={containerRef}
          onScroll={handleScroll}
          className="scrollbar-none flex flex-1 flex-col gap-4 overflow-y-auto px-4 pb-6 pt-5 md:px-8"
        >
          {messages.length === 0 && (
            <div className="grid min-h-full flex-1 place-items-center py-10">
              <div className="flex w-full max-w-3xl flex-col items-center gap-[18px] px-4 text-center">
                <div className="inline-flex h-12 w-12 items-center justify-center rounded-xl bg-[var(--primary)] text-xl text-white shadow-[0_18px_34px_-22px_rgba(37,99,235,0.9)]">
                  <BulbOutlined />
                </div>
                <div>
                  <h1 className="m-0 font-[var(--sans)] text-2xl font-extrabold text-[var(--ink)] md:text-3xl">
                    把模糊想法整理成可执行计划
                  </h1>
                  <p className="mx-auto mt-2 max-w-xl text-sm leading-6 text-[var(--ink-mute)]">
                    适合做需求澄清、任务拆分、里程碑规划和风险复盘。选择一个起点，或直接输入当前问题。
                  </p>
                </div>
                <div className="grid w-full gap-2 text-left md:grid-cols-2">
                  {EXAMPLE_QUERIES.map((q) => (
                    <Button
                      key={q}
                      disabled={isLoading}
                      onClick={() => handleExampleClick(q)}
                      className="justify-start px-4 py-3 text-left text-sm"
                      style={{
                        height: "auto",
                        minHeight: 48,
                        whiteSpace: "normal",
                        lineHeight: 1.5,
                        textAlign: "left",
                        justifyContent: "flex-start",
                      }}
                    >
                      {q}
                    </Button>
                  ))}
                </div>
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
            <div className="flex shrink-0 items-center justify-between gap-2.5 rounded-lg border border-red-200 bg-red-50 p-3 text-[13px] text-red-700">
              <span>{error}</span>
              <Button
                size="small"
                danger
                icon={<ClearOutlined />}
                onClick={onClear}
              >
                清除
              </Button>
            </div>
          )}
        </div>

        <FloatButton
          icon={<ArrowDownOutlined style={{ color: "#ffffff" }} />}
          className={`scroll-to-bottom ${userScrolled ? "is-visible" : ""}`}
          onClick={() => {
            scrollToBottom();
            setUserScrolled(false);
          }}
        />

        <form
          onSubmit={handleSubmit}
          className="shrink-0 border-t border-[var(--line-soft)] bg-white px-4 py-3 md:px-8"
        >
          <div className="mx-auto flex w-full max-w-4xl items-end gap-2">
            <TextArea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              rows={1}
              placeholder="输入消息"
              disabled={isLoading}
              autoSize={{ minRows: 1, maxRows: 5 }}
              className="flex-1"
            />
            {isLoading ? (
              <Tooltip title="停止生成">
                <Button
                  type="primary"
                  danger
                  icon={<StopOutlined />}
                  onClick={onStop}
                />
              </Tooltip>
            ) : (
              <Tooltip title="发送">
                <Button
                  type="primary"
                  htmlType="submit"
                  icon={<SendOutlined />}
                  disabled={!input.trim()}
                />
              </Tooltip>
            )}
          </div>
        </form>
      </div>
    </div>
  );
}
