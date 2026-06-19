import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
} from "react";
import { Button, Dropdown, FloatButton, Input, Tooltip } from "antd";
import BorderBeam from "antd/es/border-beam";
import {
  ArrowDownOutlined,
  ArrowLeftOutlined,
  ClearOutlined,
  DownOutlined,
  PaperClipOutlined,
  SearchOutlined,
  SendOutlined,
  StopOutlined,
} from "@ant-design/icons";
import type { Message } from "../types";
import { MessageBubble } from "./MessageBubble";

const { TextArea } = Input;

const EXAMPLE_QUERIES = [
  "帮我梳理这个产品的核心需求",
  "为当前项目拆一版 MVP 计划",
  "生成一份迭代风险清单",
  "把今天的讨论整理成待办事项",
];

const ACTIVE_MODEL = "DeepSeek V4 Pro";

interface Props {
  workspaceName: string;
  messages: Message[];
  isLoading: boolean;
  error: string | null;
  disabledReason?: string | null;
  onSend: (text: string, options?: { webSearchEnabled?: boolean }) => void;
  onStop: () => void;
  onClear: () => void;
  onBack: () => void;
}

export function ChatApp({
  workspaceName,
  messages,
  isLoading,
  error,
  disabledReason,
  onSend,
  onStop,
  onClear,
  onBack,
}: Props) {
  const [input, setInput] = useState("");
  const [webSearchEnabled, setWebSearchEnabled] = useState(false);
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
      const message = messages[i]!;
      const next = messages[i + 1]!;
      if (message.role === "agent" && next.role === "user") {
        map.set(message.id, next.content);
      }
    }
    return map;
  })();

  const doSubmit = useCallback(() => {
    if (!input.trim() || isLoading || disabledReason) return;
    onSend(input.trim(), { webSearchEnabled });
    setInput("");
    setUserScrolled(false);
  }, [disabledReason, input, isLoading, onSend, webSearchEnabled]);

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    doSubmit();
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      doSubmit();
    }
  };

  const handleExampleClick = (query: string) => {
    if (disabledReason || isLoading) return;
    onSend(query, { webSearchEnabled });
    setUserScrolled(false);
  };

  return (
    <div className="chat-workspace">
      <div className="chat-topbar">
        <div className="chat-topbar-title">
          <Tooltip title="返回工作区">
            <Button
              type="text"
              shape="circle"
              icon={<ArrowLeftOutlined />}
              onClick={onBack}
            />
          </Tooltip>
          <span>{workspaceName}</span>
        </div>
      </div>

      <div className="chat-canvas">
        <div
          ref={containerRef}
          onScroll={handleScroll}
          className="chat-scroll scrollbar-none items-center"
        >
          {messages.length === 0 && (
            <div className="chat-empty">
              <h1>今天想推进什么？</h1>
              <p>围绕需求、计划、文档和风险继续推进项目。</p>
              <div className="chat-suggestions">
                {EXAMPLE_QUERIES.map((query) => (
                  <button
                    key={query}
                    type="button"
                    disabled={isLoading || Boolean(disabledReason)}
                    onClick={() => handleExampleClick(query)}
                  >
                    {query}
                  </button>
                ))}
              </div>
            </div>
          )}

          {messages.map((message, index) => (
            <MessageBubble
              key={message.id}
              message={message}
              isLast={index === lastAgentIdx}
              streaming={
                isLoading &&
                index === messages.length - 1 &&
                message.role === "agent"
              }
              nextUserContent={nextUserContentByAssistantId.get(message.id)}
              onFormSubmit={(text) => onSend(text, { webSearchEnabled })}
            />
          ))}

          {error && (
            <div className="chat-error">
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
        <BorderBeam
          color={[
            { color: "#1677ff", percent: 0 },
            { color: "#36cfc9", percent: 54 },
            { color: "#95de64", percent: 100 },
          ]}
          outset={0}
        >
          <div className="chat-composer-border-beam">
            <form onSubmit={handleSubmit} className="chat-composer">
              <TextArea
                value={input}
                onChange={(event) => setInput(event.target.value)}
                onKeyDown={handleKeyDown}
                rows={1}
                placeholder={disabledReason || "输入消息"}
                disabled={isLoading || Boolean(disabledReason)}
                autoSize={{ minRows: 3, maxRows: 7 }}
              />

              <div className="chat-composer-bar">
                <Tooltip title="添加附件">
                  <Button
                    type="text"
                    shape="circle"
                    icon={<PaperClipOutlined />}
                  />
                </Tooltip>
                <Tooltip
                  title={
                    webSearchEnabled
                      ? "联网搜索已开启"
                      : "开启联网搜索"
                  }
                >
                  <Button
                    type={webSearchEnabled ? "primary" : "text"}
                    shape="circle"
                    icon={<SearchOutlined />}
                    aria-label="联网搜索"
                    aria-pressed={webSearchEnabled}
                    disabled={isLoading || Boolean(disabledReason)}
                    onClick={() => setWebSearchEnabled((enabled) => !enabled)}
                  />
                </Tooltip>
                <Dropdown
                  trigger={["click"]}
                  menu={{
                    selectable: true,
                    selectedKeys: [ACTIVE_MODEL],
                    items: [{ key: ACTIVE_MODEL, label: ACTIVE_MODEL }],
                  }}
                >
                  <button type="button" className="model-selector">
                    <span>{ACTIVE_MODEL}</span>
                    <DownOutlined />
                  </button>
                </Dropdown>
                <div className="chat-composer-actions">
                  {isLoading ? (
                    <Tooltip title="停止生成">
                      <Button
                        type="primary"
                        shape="circle"
                        danger
                        icon={<StopOutlined />}
                        onClick={onStop}
                      />
                    </Tooltip>
                  ) : (
                    <Tooltip title="发送">
                      <Button
                        type="primary"
                        shape="circle"
                        htmlType="submit"
                        icon={<SendOutlined />}
                        disabled={!input.trim() || Boolean(disabledReason)}
                      />
                    </Tooltip>
                  )}
                </div>
              </div>
            </form>
          </div>
        </BorderBeam>
      </div>
    </div>
  );
}
