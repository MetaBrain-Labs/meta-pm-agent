import { useState, useEffect, useRef, useCallback } from "react";
import { Spin, Tag, Flex } from "antd";
import {
  LoadingOutlined,
  CheckCircleOutlined,
  ToolOutlined,
  CaretRightOutlined,
} from "@ant-design/icons";
import type { Message } from "../types";
import { ProseBlock } from "./ProseBlock";
import { TodoCard } from "./TodoCard";

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

const TAG_STYLE: React.CSSProperties = {
  fontFamily: "var(--sans)",
  fontSize: 11,
  borderRadius: 6,
  border: "none",
  letterSpacing: "0.04em",
  fontWeight: 500,
};

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
      <div className="flex flex-col max-w-[85%] self-end">
        <div
          className="px-5 py-3 rounded-2xl rounded-br-md! text-white whitespace-pre-wrap wrap-break-word"
          style={{
            background: "var(--coral)",
            boxShadow: "0 8px 20px -8px rgba(237, 111, 92, 0.45)",
            fontFamily: "'Inter', sans-serif",
            fontSize: 14,
            lineHeight: 1.6,
          }}
        >
          {message.content}
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col max-w-[85%] self-start">
      {message.thinking && (
        <ThinkingBox
          content={message.thinking}
          hasResponse={!!message.content}
        />
      )}

      {message.todos && message.todos.length > 0 && (
        <TodoCard todos={message.todos} />
      )}

      {message.toolCalls && message.toolCalls.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mb-1.5">
          {message.toolCalls.map((tc, i) => {
            const completed = tc.result !== undefined;
            return (
              <Tag
                key={i}
                icon={completed ? <CheckCircleOutlined /> : <ToolOutlined />}
                style={{
                  ...TAG_STYLE,
                  background: completed
                    ? "rgba(110, 116, 72, 0.1)"
                    : "rgba(237, 111, 92, 0.08)",
                  color: completed ? "var(--olive)" : "var(--coral)",
                  borderColor: completed
                    ? "rgba(110, 116, 72, 0.25)"
                    : "rgba(237, 111, 92, 0.2)",
                }}
                title={
                  tc.result !== undefined
                    ? JSON.stringify(tc.result, null, 2).slice(0, 500)
                    : JSON.stringify(tc.args, null, 2)
                }
              >
                {mapToolName(tc.name)}
              </Tag>
            );
          })}
        </div>
      )}

      {message.content && (
        <div
          className="px-5 py-4 rounded-2xl !rounded-bl-md"
          style={{
            background: "var(--bone)",
            border: "1px solid var(--line-soft)",
            boxShadow: "0 4px 16px rgba(21, 20, 15, 0.08)",
            fontFamily: "'Inter', sans-serif",
            fontSize: 14,
            lineHeight: 1.65,
          }}
        >
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
        </div>
      )}

      {message.questionForm && (
        <div>
          {message.questionForm.state === "generating" ? (
            <QFGenerating label="正在生成 Question Form" />
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
            <QFGenerating label="正在生成需求上下文" />
          ) : (
            <ProseBlock
              text={message.compressBlock?.content || ""}
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

      {!message.content &&
        !message.thinking &&
        !message.questionForm &&
        !message.compressBlock && (
          <div
            className="px-5 py-3.5 rounded-2xl !rounded-bl-md"
            style={{
              background: "var(--bone)",
              border: "1px solid var(--line-soft)",
              boxShadow: "0 4px 16px rgba(21, 20, 15, 0.08)",
              color: "var(--ink-mute)",
              fontFamily: "'Inter', sans-serif",
            }}
          >
            <Spin
              indicator={<LoadingOutlined style={{ color: "var(--coral)" }} />}
              size="small"
            />{" "}
            思考中
          </div>
        )}

      {message.usage && (
        <div
          className="text-[11px] mt-1 pl-1"
          style={{ color: "var(--ink-faint)" }}
        >
          <button
            type="button"
            className="inline-flex items-center gap-1 bg-transparent border-none cursor-pointer text-[11px] p-0.5"
            style={{ color: "var(--ink-faint)" }}
            onClick={() => setUsageOpen(!usageOpen)}
          >
            <CaretRightOutlined
              style={{
                fontSize: 10,
                transition: "transform 0.2s",
                transform: usageOpen ? "rotate(90deg)" : "rotate(0deg)",
              }}
            />
            <span>Token 用量</span>
          </button>
          {usageOpen && (
            <span className="ml-1.5" style={{ color: "var(--ink-mute)" }}>
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

function QFGenerating({ label }: { label: string }) {
  return (
    <Flex
      align="center"
      gap={12}
      className="!p-5 rounded-lg !mb-2"
      style={{
        background: "var(--bone)",
        border: "1px solid var(--line)",
        fontFamily: "'Inter', sans-serif",
      }}
    >
      <div
        className="w-5 h-5 rounded-full border-2"
        style={{
          borderColor: "var(--coral)",
          animation: "qf-pulse 1.4s ease-out infinite",
        }}
      />
      <span
        className="text-[13px]"
        style={{
          color: "var(--ink-faint)",
          fontFamily: "'Inter Tight', sans-serif",
          fontWeight: 500,
        }}
      >
        {label}
      </span>
      <div className="flex gap-1 ml-auto">
        {[0, 1, 2].map((i) => (
          <span
            key={i}
            className="w-1.5 h-1.5 rounded-full"
            style={{
              background: "var(--coral)",
              animation: `qf-bounce 1.2s ease-in-out infinite`,
              animationDelay: `${i * 0.2}s`,
            }}
          />
        ))}
      </div>
    </Flex>
  );
}

function ThinkingBox({
  content,
  hasResponse,
}: {
  content: string;
  hasResponse: boolean;
}) {
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
      className="rounded-lg mb-2 overflow-hidden"
      style={{
        background: "var(--bone)",
        border: "1px solid var(--line-soft)",
      }}
    >
      <Flex
        align="center"
        gap={6}
        className="!px-4 !py-2 cursor-pointer select-none"
        style={{
          color: "var(--ink-faint)",
          fontFamily: "'Inter Tight', sans-serif",
          fontSize: 13,
          fontWeight: 500,
        }}
        onClick={() => setOpen(!open)}
      >
        <CaretRightOutlined
          style={{
            fontSize: 10,
            transition: "transform 0.2s",
            transform: open ? "rotate(90deg)" : "rotate(0deg)",
            color: "var(--coral)",
          }}
        />
        <span>
          思考过程
          {!hasResponse && <span className="loading-dots" />}
        </span>
      </Flex>
      {open && (
        <div
          ref={contentRef}
          onScroll={handleScroll}
          className="px-4 pb-3 text-[13px] whitespace-pre-wrap max-h-[300px] overflow-y-auto leading-relaxed scrollbar-none-thin"
          style={{
            color: "var(--ink-mute)",
            borderTop: "1px solid var(--line-soft)",
            fontFamily: "'Inter', sans-serif",
            fontSize: 13,
            lineHeight: 1.6,
          }}
        >
          {content}
        </div>
      )}
    </div>
  );
}
