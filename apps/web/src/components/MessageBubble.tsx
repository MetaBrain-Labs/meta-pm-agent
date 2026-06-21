import {
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { Spin } from "antd";
import {
  CaretRightOutlined,
  ReloadOutlined,
  LoadingOutlined,
} from "@ant-design/icons";
import type { Message } from "../types";
import { ProseBlock } from "./ProseBlock";
import {
  PlannerExecutionCard,
  PlannerExecutionLoadingCard,
} from "./PlannerExecutionCard";
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
  onRetry?: () => void;
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
  onRetry,
}: Props) {
  const [usageOpen, setUsageOpen] = useState(false);
  const [locallySubmitted, setLocallySubmitted] = useState<Set<string>>(
    () => new Set(),
  );

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
  const plannerReasoningBlocks = message.reasoningBlocks?.filter(
    (block) => block.agentType === "planner",
  );
  const executorReasoningBlocks = message.reasoningBlocks?.filter((block) =>
    isExecutorAgent(block.agentType),
  );
  const productDirectorReasoningBlocks = message.reasoningBlocks?.filter(
    (block) => block.agentType === "product_director",
  );
  const requestError =
    message.agentError?.agentType === "request" ? message.agentError : null;
  const otherError =
    message.agentError && message.agentError.agentType !== "request"
      ? message.agentError
      : null;
  const otherReasoningBlocks = message.reasoningBlocks?.filter(
    (block) =>
      ![
        "request",
        "planner",
        "product_director",
        ...EXECUTOR_AGENT_TYPES,
      ].includes(block.agentType),
  );
  const plannerDagGenerating =
    streamActive &&
    message.activeAgent === "planner" &&
    !message.plannerExecution;
  const handleFormSubmit = useCallback(
    (formId: string, text: string) => {
      if (!onFormSubmit) return;

      // 表单提交后立即进入本地只读态，避免等待历史消息恢复期间重复提交。
      setLocallySubmitted((prev) => {
        const next = new Set(prev);
        next.add(formId);
        return next;
      });
      onFormSubmit(text);
    },
    [onFormSubmit],
  );

  return (
    <div className="flex w-full flex-col self-stretch">
      {message.thinking && (
        <ThinkingBox
          agentType="conversation"
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
            onSubmitForm={handleFormSubmit}
          />
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
          agentType={block.agentType}
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

      {requestError && (
        <AgentErrorCard
          agentType="request"
          message={requestError.message}
          onRetry={onRetry}
        />
      )}

      {plannerReasoningBlocks?.map((block) => (
        <ThinkingBox
          key={block.agentType}
          agentType={block.agentType}
          label={getReasoningLabel(block.agentType)}
          content={block.content}
          active={streamActive && message.activeAgent === block.agentType}
        />
      ))}

      {plannerDagGenerating && <PlannerExecutionLoadingCard />}

      {message.plannerExecution && (
        <PlannerExecutionCard
          plan={message.plannerExecution.plan}
          executorResults={message.executorResults}
          activeAgent={message.activeAgent}
        />
      )}

      {executorReasoningBlocks?.map((block) => (
        <ThinkingBox
          key={block.agentType}
          agentType={block.agentType}
          label={getReasoningLabel(block.agentType)}
          content={block.content}
          active={streamActive && message.activeAgent === block.agentType}
        />
      ))}

      {productDirectorReasoningBlocks?.map((block) => (
        <ThinkingBox
          key={block.agentType}
          agentType={block.agentType}
          label={getReasoningLabel(block.agentType)}
          content={block.content}
          active={streamActive && message.activeAgent === block.agentType}
        />
      ))}

      {otherReasoningBlocks?.map((block) => (
        <ThinkingBox
          key={block.agentType}
          agentType={block.agentType}
          label={getReasoningLabel(block.agentType)}
          content={block.content}
          active={streamActive && message.activeAgent === block.agentType}
        />
      ))}

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
              onSubmitForm={handleFormSubmit}
            />
          )}
        </div>
      )}

      {otherError && (
        <AgentErrorCard
          agentType={otherError.agentType}
          message={otherError.message}
          onRetry={onRetry}
        />
      )}

      {!message.content &&
        !message.thinking &&
        !message.reasoningBlocks?.length &&
        !message.questionForm &&
        !message.userInput &&
        !message.requestAnalysis &&
        !message.plannerExecution &&
        !message.agentError && (
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
 * 展示 Agent 阶段错误，并提供重试入口。
 */
function AgentErrorCard({
  agentType,
  message,
  onRetry,
}: {
  agentType?: string;
  message: string;
  onRetry?: () => void;
}) {
  return (
    <div className="mb-2 rounded-lg border border-[#fca5a5] bg-[#fef2f2] px-4 py-3 text-[#991b1b]">
      <div className="mb-1 flex items-center justify-between gap-3">
        <span className="text-[13px] font-extrabold">
          {getAgentLabel(agentType ?? "agent")} 执行失败
        </span>
        {onRetry && (
          <button
            type="button"
            className="inline-flex cursor-pointer items-center gap-1 rounded-md border border-[#fca5a5] bg-white px-2 py-1 text-[12px] font-bold text-[#991b1b]"
            onClick={onRetry}
          >
            <ReloadOutlined />
            重试
          </button>
        )}
      </div>
      <div className="whitespace-pre-wrap text-[13px] leading-relaxed">
        {message}
      </div>
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
  agentType,
  label,
  content,
  active,
}: {
  agentType: string;
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
    <div
      className="mb-2 overflow-hidden rounded-lg border border-[var(--line-soft)] bg-white"
      data-agent-thinking={agentType}
    >
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
  if (agentType === "conversation_confirmation") {
    return "思考过程（Conversation Agent）";
  }
  if (agentType === "planner") return "思考过程（Planner Agent）";
  if (agentType === "product_director") {
    return "思考过程（ProductDirector Agent）";
  }
  return `思考过程（${getAgentLabel(agentType)}）`;
}

const EXECUTOR_AGENT_TYPES = [
  "product_strategy",
  "user_insight",
  "solution_decision",
  "feature_arch",
  "tech_design",
  "data_ops",
];

const AGENT_LABELS: Record<string, string> = {
  request: "Request Agent",
  planner: "Planner Agent",
  product_director: "ProductDirector Agent",
  product_strategy: "Product Strategy Agent",
  user_insight: "User Insight Agent",
  solution_decision: "Solution Decision Agent",
  feature_arch: "Feature Architecture Agent",
  tech_design: "Technical Design Agent",
  data_ops: "Data Operations Agent",
};

/**
 * 判断是否属于 Executor Agent。
 */
function isExecutorAgent(agentType: string): boolean {
  return EXECUTOR_AGENT_TYPES.includes(agentType);
}

/**
 * 将 Agent 类型转换为展示名。
 */
function getAgentLabel(agentType: string): string {
  return AGENT_LABELS[agentType] ?? `${agentType} Agent`;
}
