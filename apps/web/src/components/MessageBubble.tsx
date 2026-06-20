import {
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { Spin } from "antd";
import {
  CaretRightOutlined,
  LoadingOutlined,
} from "@ant-design/icons";
import type { Message } from "../types";
import { ProseBlock } from "./ProseBlock";
import { RequestAnalysisCard } from "./RequestAnalysisCard";
import { TodoCard } from "./TodoCard";
import { ToolCallsCard } from "./ToolCallsCard";
import { UserInputCard } from "./UserInputCard";

interface Props {
  message: Message;
  isLast: boolean;
  streaming: boolean;
  nextUserContent?: string;
  onFormSubmit?: (text: string) => void;
}

/**
 * 渲染单条聊天消息，并按 Agent 阶段放置推理、整理和分析卡片。
 */
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
      <div className="flex max-w-[min(760px,88%)] flex-col self-end">
        <div
          className="whitespace-pre-wrap wrap-break-word rounded-[18px] rounded-br-md px-4 py-3 text-white"
          style={{
            background: "var(--primary)",
            fontFamily: "var(--body)",
            fontSize: 14,
            lineHeight: 1.6,
          }}
        >
          {message.content}
        </div>
      </div>
    );
  }

  const streamActive = isLast && streaming;
  const requestReasoningBlocks = message.reasoningBlocks?.filter(
    (block) => block.agentType === "request",
  );
  const otherReasoningBlocks = message.reasoningBlocks?.filter(
    (block) => block.agentType !== "request",
  );

  return (
    <div className="flex w-full flex-col self-stretch">
      {message.thinking && (
        <ThinkingBox
          label={getReasoningLabel("conversation")}
          content={message.thinking}
          active={
            streamActive &&
            !message.content &&
            !message.questionForm &&
            !message.userInput &&
            !message.requestAnalysis
          }
        />
      )}

      {message.todos && message.todos.length > 0 && (
        <TodoCard todos={message.todos} />
      )}

      {message.toolCalls && message.toolCalls.length > 0 && (
        <ToolCallsCard toolCalls={message.toolCalls} />
      )}

      {message.content && (
        <div className="assistant-bubble">
          <ProseBlock
            text={message.content}
            toolCalls={message.toolCalls}
            isLastAssistant={isLast}
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
            <QFGenerating label="正在生成问题表单" />
          ) : (
            <ProseBlock
              text={message.questionForm.content || ""}
              isLastAssistant={isLast}
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

      {message.userInput && (
        <div>
          {message.userInput.state === "generating" ? (
            <QFGenerating label="正在整理用户输入" />
          ) : (
            <UserInputCard raw={message.userInput.content || ""} />
          )}
        </div>
      )}

      {requestReasoningBlocks?.map((block) => (
        <ThinkingBox
          key={block.agentType}
          label={getReasoningLabel(block.agentType)}
          content={block.content}
          active={
            streamActive && message.requestAnalysis?.state !== "complete"
          }
        />
      ))}

      {message.requestAnalysis && (
        <div>
          {message.requestAnalysis.state === "generating" ? (
            <QFGenerating label="Request Agent 正在分析请求" />
          ) : (
            <RequestAnalysisCard
              raw={message.requestAnalysis.content}
              analysis={message.requestAnalysis.analysis}
            />
          )}
        </div>
      )}

      {otherReasoningBlocks?.map((block) => (
        <ThinkingBox
          key={block.agentType}
          label={getReasoningLabel(block.agentType)}
          content={block.content}
          active={streamActive}
        />
      ))}

      {!message.content &&
        !message.thinking &&
        !message.reasoningBlocks?.length &&
        !message.questionForm &&
        !message.userInput &&
        !message.requestAnalysis && (
          <div className="assistant-bubble is-loading">
            <Spin
              indicator={<LoadingOutlined style={{ color: "var(--primary)" }} />}
              size="small"
            />{" "}
            思考中
          </div>
        )}

      {message.usage && (
        <div className="mt-1 pl-1 text-[11px] text-[var(--ink-faint)]">
          <button
            type="button"
            className="inline-flex cursor-pointer items-center gap-1 border-none bg-transparent p-0.5 text-[11px] text-[var(--ink-faint)]"
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
            <span className="ml-1.5 text-[var(--ink-mute)]">
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

/**
 * 渲染生成中状态，用于表单、用户输入整理和 Request Agent 分析。
 */
function QFGenerating({ label }: { label: string }) {
  return (
    <div className="mb-2 flex items-center gap-3 rounded-lg border border-[var(--line-soft)] bg-white p-5">
      <div
        className="h-5 w-5 rounded-full border-2"
        style={{
          borderColor: "var(--primary)",
          animation: "qf-pulse 1.4s ease-out infinite",
        }}
      />
      <span className="text-[13px] font-bold text-[var(--ink-faint)]">
        {label}
      </span>
      <div className="ml-auto flex gap-1">
        {[0, 1, 2].map((index) => (
          <span
            key={index}
            className="h-1.5 w-1.5 rounded-full bg-[var(--primary)]"
            style={{
              animation: "qf-bounce 1.2s ease-in-out infinite",
              animationDelay: `${index * 0.2}s`,
            }}
          />
        ))}
      </div>
    </div>
  );
}

/**
 * 展示 Agent 推理过程，流式阶段保持自动滚动。
 */
function ThinkingBox({
  label,
  content,
  active,
}: {
  label: string;
  content: string;
  active: boolean;
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
    <div className="mb-2 overflow-hidden rounded-lg border border-[var(--line-soft)] bg-white">
      <button
        type="button"
        className="flex w-full cursor-pointer select-none items-center gap-1.5 border-none bg-white px-4 py-2 text-left text-[13px] font-bold text-[var(--ink-faint)]"
        onClick={() => setOpen(!open)}
      >
        <CaretRightOutlined
          style={{
            fontSize: 10,
            transition: "transform 0.2s",
            transform: open ? "rotate(90deg)" : "rotate(0deg)",
            color: "var(--primary)",
          }}
        />
        <span className="thinking-label">
          {label}
          {active && <span className="loading-dots" />}
        </span>
      </button>
      {open && (
        <div
          ref={contentRef}
          onScroll={handleScroll}
          className="themed-scrollbar max-h-[300px] overflow-y-auto whitespace-pre-wrap border-t border-[var(--line-soft)] px-4 pb-3 text-[13px] leading-relaxed text-[var(--ink-mute)]"
        >
          {content}
        </div>
      )}
    </div>
  );
}

/**
 * 将 Agent 类型转换为前端推理过程标题。
 */
function getReasoningLabel(agentType: string): string {
  if (agentType === "request") return "思考过程（Request Agent）";
  if (agentType === "conversation") return "思考过程（Conversation Agent）";
  return `思考过程（${agentType} Agent）`;
}
