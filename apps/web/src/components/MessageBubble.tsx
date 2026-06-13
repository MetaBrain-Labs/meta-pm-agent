import { useState, useEffect, useRef, useCallback } from "react";
import { Spin, Tag } from "antd";
import {
  LoadingOutlined,
  CheckCircleOutlined,
  ToolOutlined,
  CaretRightOutlined,
} from "@ant-design/icons";
import type { Message } from "../types";
import { ProseBlock } from "./ProseBlock";
import { TodoCard } from "./TodoCard";
import { Icon } from "./Icon";

const TOOL_NAME_LABELS: Record<string, string> = {
  write_todos: "生成任务",
  ask_user: "询问用户",
  search_knowledge: "搜索知识库",
  read_file: "读取文件",
  write_file: "写入文件",
  execute_command: "执行命令",
  generate_artifact: "生成文档",
  web_search: "网页搜索",
  web_fetch: "抓取页面",
};

function mapToolName(name: string): string {
  return TOOL_NAME_LABELS[name] ?? name;
}

interface Props {
  message: Message;
  isLast: boolean;
  streaming: boolean;
  nextUserContent?: string;
  onFormSubmit?: (text: string) => void;
}

export function MessageBubble({
  message,
  isLast,
  streaming,
  nextUserContent,
  onFormSubmit,
}: Props) {
  const [usageOpen, setUsageOpen] = useState(false);
  const [locallySubmitted] = useState<Set<string>>(() => new Set());

  if (message.role === "user") {
    return (
      <div className="message-row user">
        <div className="message-bubble user-bubble">{message.content}</div>
      </div>
    );
  }

  return (
    <div className="message-row agent">
      {message.thinking && (
        <ThinkingBox content={message.thinking} hasResponse={!!message.content} />
      )}

      {message.todos && message.todos.length > 0 && (
        <TodoCard todos={message.todos} />
      )}

      {message.toolCalls && message.toolCalls.length > 0 && (
        <div className="tool-calls-row">
          {message.toolCalls.map((tc, i) => (
            <Tag
              key={i}
              color={tc.result !== undefined ? "success" : "orange"}
              icon={tc.result !== undefined ? <CheckCircleOutlined /> : <ToolOutlined />}
              title={
                tc.result !== undefined
                  ? JSON.stringify(tc.result, null, 2).slice(0, 500)
                  : JSON.stringify(tc.args, null, 2)
              }
            >
              {mapToolName(tc.name)}
            </Tag>
          ))}
        </div>
      )}

      {message.content && (
        <ProseBlock
          text={message.content || ""}
          isLastAssistant={!!isLast}
          streaming={streaming}
          nextUserContent={nextUserContent}
          locallySubmitted={locallySubmitted}
          onSubmitForm={(_formId, text) => {
            onFormSubmit?.(text);
          }}
        />
      )}

      {message.questionForm && (
        <div>
          {message.questionForm.state === "generating" ? (
            <div className="qf-generating">
              <div className="qf-pulse-ring" />
              <div className="qf-label">正在生成 Question Form</div>
              <div className="qf-dots">
                <span />
                <span />
                <span />
              </div>
            </div>
          ) : (
            <ProseBlock
              text={message.questionForm.content || ""}
              isLastAssistant={!!isLast}
              streaming={streaming}
              nextUserContent={nextUserContent}
              locallySubmitted={locallySubmitted}
              onSubmitForm={(_formId, text) => {
                onFormSubmit?.(text);
              }}
            />
          )}
        </div>
      )}

      {message.compressBlock && (
        <div>
          {message.compressBlock.state === "generating" ? (
            <div className="qf-generating">
              <div className="qf-pulse-ring" />
              <div className="qf-label">正在生成需求上下文</div>
              <div className="qf-dots">
                <span />
                <span />
                <span />
              </div>
            </div>
          ) : (
            <ProseBlock
              text={message.compressBlock.content || ""}
              isLastAssistant={!!isLast}
              streaming={streaming}
              nextUserContent={nextUserContent}
              locallySubmitted={locallySubmitted}
              onSubmitForm={(_formId, text) => {
                onFormSubmit?.(text);
              }}
            />
          )}
        </div>
      )}

      {!message.content && !message.thinking && !message.questionForm && !message.compressBlock && (
        <div className="message-bubble agent-bubble">
          <Spin indicator={<LoadingOutlined />} size="small" />
          {" "}思考中
        </div>
      )}

      {message.usage && (
        <div className="usage-line">
          <button
            className="usage-line-toggle"
            onClick={() => setUsageOpen(!usageOpen)}
          >
            <Icon name={usageOpen ? "chevron-down" : "chevron-right"} size={10} />
            <span>Token 用量</span>
          </button>
          {usageOpen && (
            <span className="usage-line-detail">
              输入 {String(message.usage?.inputTokens ?? "-")} · 输出{" "}
              {String(message.usage?.outputTokens ?? "-")} · 合计{" "}
              {String(message.usage?.totalTokens ?? "-")}
            </span>
          )}
        </div>
      )}
    </div>
  );
}

function ThinkingBox({ content, hasResponse }: { content: string; hasResponse: boolean }) {
  const [open, setOpen] = useState(true);
  const [userScrolled, setUserScrolled] = useState(false);
  const contentRef = useRef<HTMLDivElement>(null);

  const isAtBottom = useCallback(() => {
    const el = contentRef.current;
    if (!el) return true;
    return el.scrollHeight - el.scrollTop - el.clientHeight < 30;
  }, []);

  useEffect(() => {
    if (!userScrolled && contentRef.current && open) {
      contentRef.current.scrollTop = contentRef.current.scrollHeight;
    }
  }, [content, open, userScrolled]);

  const handleScroll = useCallback(() => {
    setUserScrolled(!isAtBottom());
  }, [isAtBottom]);

  return (
    <div
      style={{
        background: "#fafafa",
        border: "1px solid #e8e8e8",
        borderRadius: 8,
        marginBottom: 8,
        overflow: "hidden",
      }}
    >
      <div
        onClick={() => setOpen(!open)}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 6,
          padding: "6px 12px",
          cursor: "pointer",
          userSelect: "none",
          fontSize: 13,
          color: "#888",
        }}
      >
        <CaretRightOutlined
          style={{ fontSize: 10, transition: "transform 0.2s", transform: open ? "rotate(90deg)" : "rotate(0deg)" }}
        />
        <span>
          思考过程
          {!hasResponse && <span className="loading-dots" />}
        </span>
      </div>
      {open && (
        <div
          ref={contentRef}
          onScroll={handleScroll}
          style={{
            padding: "0 12px 8px",
            color: "#888",
            fontSize: 13,
            whiteSpace: "pre-wrap",
            maxHeight: 300,
            overflowY: "auto",
            lineHeight: 1.55,
          }}
        >
          {content}
        </div>
      )}
    </div>
  );
}
