/**
 * 聊天消息气泡组件
 *
 * 渲染用户消息、助手消息、Agent 推理过程、结构化业务卡片、工具调用和 token 用量浮层。
 * 组件按 Agent 类型把运行过程放到对应阶段附近，避免不同 Agent 的信息混在一起。
 *
 * Responsibilities:
 * - 展示用户与助手消息正文
 * - 渲染 Conversation、Request、Planner 和 Executor 的阶段性卡片
 * - 展示可折叠的实时 token 用量和费用明细
 *
 * Notes:
 * - 本组件只负责展示和本地交互，不直接请求 API。
 */

import {
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { Spin, Tooltip } from "antd";
import {
  CaretRightOutlined,
  ReloadOutlined,
  LoadingOutlined,
  PartitionOutlined,
} from "@ant-design/icons";
import type { Message, TokenUsageInfo } from "../types";
import { ProseBlock } from "./ProseBlock";
import {
  PlannerExecutionCard,
  PlannerExecutionLoadingCard,
  PlannerReviewStatusCard,
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
  const conversationToolCalls = getToolCallsForAgent(message, "conversation");
  const requestToolCalls = getToolCallsForAgent(message, "request");
  const plannerToolCalls = getToolCallsForAgent(message, "planner");
  const productDirectorToolCalls = getToolCallsForAgent(
    message,
    "product_director",
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
    isAgentActive(message, "planner") &&
    !message.plannerExecution;
  const hasTokenUsage =
    (message.tokenUsages?.length ?? 0) > 0 || Boolean(message.usage);
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
      {hasTokenUsage && (
        <TokenUsageFloatingBox
          usages={message.tokenUsages ?? []}
          legacyUsage={message.usage}
          open={usageOpen}
          onToggle={() => setUsageOpen(!usageOpen)}
        />
      )}

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

      <AgentToolCalls toolCalls={conversationToolCalls} />

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

      <AgentToolCalls toolCalls={requestToolCalls} />

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
          active={streamActive && isAgentActive(message, block.agentType)}
        />
      ))}

      <AgentToolCalls toolCalls={plannerToolCalls} />

      {plannerDagGenerating && <PlannerExecutionLoadingCard />}

      {message.plannerExecution && (
        <PlannerExecutionCard
          plan={message.plannerExecution.plan}
          executorResults={message.executorResults}
          activeAgent={message.activeAgent}
          activeAgents={message.activeAgents}
        />
      )}

      {EXECUTOR_AGENT_TYPES.map((agentType) => {
        const block = executorReasoningBlocks?.find(
          (item) => item.agentType === agentType,
        );
        const toolCalls = getToolCallsForAgent(message, agentType);
        if (!block && toolCalls.length === 0) return null;

        return (
          <div key={agentType}>
            {block && (
              <ThinkingBox
                agentType={block.agentType}
                label={getReasoningLabel(block.agentType)}
                content={block.content}
                active={streamActive && isAgentActive(message, block.agentType)}
              />
            )}
            <AgentToolCalls toolCalls={toolCalls} />
          </div>
        );
      })}

      {message.plannerReview && (
        <PlannerReviewStatusCard state={message.plannerReview.state} />
      )}

      {productDirectorReasoningBlocks?.map((block) => (
        <ThinkingBox
          key={block.agentType}
          agentType={block.agentType}
          label={getReasoningLabel(block.agentType)}
          content={block.content}
          active={streamActive && isAgentActive(message, block.agentType)}
        />
      ))}

      <AgentToolCalls toolCalls={productDirectorToolCalls} />

      {otherReasoningBlocks?.map((block) => (
        <ThinkingBox
          key={block.agentType}
          agentType={block.agentType}
          label={getReasoningLabel(block.agentType)}
          content={block.content}
          active={streamActive && isAgentActive(message, block.agentType)}
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
        !message.plannerReview &&
        !message.agentError && (
          <div className="assistant-bubble is-loading">
            <Spin
              indicator={<LoadingOutlined style={{ color: "var(--primary)" }} />}
              size="small"
            />{" "}
            思考中
          </div>
        )}

    </div>
  );
}

/**
 * 展示当前助手消息内各 Agent 的 token 和费用用量，可折叠以减少聊天区干扰。
 */
function TokenUsageFloatingBox({
  usages,
  legacyUsage,
  open,
  onToggle,
}: {
  usages: TokenUsageInfo[];
  legacyUsage?: Record<string, unknown>;
  open: boolean;
  onToggle: () => void;
}) {
  const rows =
    usages.length > 0
      ? hydrateParallelTokenUsages(usages)
      : legacyUsage
        ? [legacyUsageToTokenUsage(legacyUsage)]
        : [];
  if (rows.length === 0) return null;

  const totalTokens = rows.reduce((sum, item) => sum + item.totalTokens, 0);
  const totalCost = rows.reduce((sum, item) => sum + item.costTotal, 0);

  return (
    <div className="sticky top-2 z-20 mb-2 ml-auto w-fit max-w-full rounded-lg border border-[var(--line-soft)] bg-white/95 shadow-[0_12px_28px_-24px_rgba(15,23,42,0.45)] backdrop-blur">
      <button
        type="button"
        className="flex w-full cursor-pointer items-center gap-2 border-0 bg-transparent px-3 py-2 text-left text-[12px] font-bold text-[var(--ink-mute)]"
        onClick={onToggle}
      >
        <CaretRightOutlined
          style={{
            fontSize: 10,
            transition: "transform 0.2s",
            transform: open ? "rotate(90deg)" : "rotate(0deg)",
            color: "var(--primary)",
          }}
        />
        <span>Token 用量</span>
        <span className="text-[var(--ink)]">
          {formatCost(totalCost)} yuan
        </span>
        <span className="text-[var(--ink-faint)]">
          {formatTokens(totalTokens)}
        </span>
      </button>
      {open && (
        <div className="min-w-[280px] max-w-[min(520px,calc(100vw-48px))] border-t border-[var(--line-soft)] px-3 py-2">
          <div className="grid grid-cols-[minmax(132px,1fr)_auto_auto_auto] gap-x-3 gap-y-1 text-[11px] leading-5 text-[var(--ink-faint)]">
            <span>Agent</span>
            <span className="text-right">输入</span>
            <span className="text-right">输出</span>
            <span className="text-right">费用</span>
            {rows.map((usage, index) => (
              <TokenUsageRow
                key={usage.id ?? `${usage.agentType}-${usage.createdAt ?? index}`}
                usage={usage}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * 渲染单个 Agent 的 token 用量明细。
 */
function TokenUsageRow({ usage }: { usage: TokenUsageInfo }) {
  const parallelAgents = (usage.parallelAgents ?? []).filter(
    (agentType) => agentType !== usage.agentType,
  );

  return (
    <>
      <span className="flex min-w-0 items-center gap-1 text-[var(--ink-mute)]">
        {parallelAgents.length > 0 && (
          <Tooltip
            title={`与 ${parallelAgents.map(getAgentLabel).join("、")} 并行执行`}
          >
            <PartitionOutlined className="shrink-0 text-[var(--primary)]" />
          </Tooltip>
        )}
        <span className="truncate">{getAgentLabel(usage.agentType)}</span>
        {usage.durationMs > 0 && (
          <span className="shrink-0 text-[var(--ink-faint)]">
            {formatDuration(usage.durationMs)}
          </span>
        )}
      </span>
      <span className="text-right text-[var(--ink-mute)]">
        {formatTokens(usage.inputTokens)}
      </span>
      <span className="text-right text-[var(--ink-mute)]">
        {formatTokens(usage.outputTokens)}
      </span>
      <span className="text-right font-semibold text-[var(--ink)]">
        {formatCost(usage.costTotal)}
      </span>
    </>
  );
}

/**
 * 历史 token 用量没有显式并行批次时，根据执行时间窗口推断重叠 Executor。
 */
function hydrateParallelTokenUsages(
  usages: TokenUsageInfo[],
): TokenUsageInfo[] {
  return usages.map((usage) => {
    if (usage.parallelAgents?.length || !isExecutorAgent(usage.agentType)) {
      return usage;
    }

    const interval = getTokenUsageInterval(usage);
    if (!interval) return usage;

    const parallelAgents = usages
      .filter((candidate) => {
        if (candidate === usage || !isExecutorAgent(candidate.agentType)) {
          return false;
        }
        const candidateInterval = getTokenUsageInterval(candidate);
        return candidateInterval
          ? intervalsOverlap(interval, candidateInterval)
          : false;
      })
      .map((candidate) => candidate.agentType);

    return parallelAgents.length > 0
      ? { ...usage, parallelAgents: [usage.agentType, ...parallelAgents] }
      : usage;
  });
}

/**
 * 根据 token 记录的结束时间和耗时推算执行窗口。
 */
function getTokenUsageInterval(
  usage: TokenUsageInfo,
): { start: number; end: number } | null {
  if (!usage.createdAt || usage.durationMs <= 0) return null;
  const end = Date.parse(usage.createdAt);
  if (!Number.isFinite(end)) return null;
  return { start: end - usage.durationMs, end };
}

/**
 * 判断两个执行窗口是否有重叠。
 */
function intervalsOverlap(
  left: { start: number; end: number },
  right: { start: number; end: number },
): boolean {
  return left.start <= right.end && right.start <= left.end;
}

/**
 * 渲染指定 Agent 的工具调用卡片。
 */
function AgentToolCalls({
  toolCalls,
}: {
  toolCalls: NonNullable<Message["toolCalls"]>;
}) {
  if (toolCalls.length === 0) return null;
  return <ToolCallsCard toolCalls={toolCalls} />;
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
    return "思考过程（Planner Agent）";
  }
  return `思考过程（${getAgentLabel(agentType)}）`;
}

const EXECUTOR_AGENT_TYPES = [
  "executor-product-strategy",
  "executor-market-research",
  "executor-gtm",
  "executor-product-discovery",
  "executor-product-execution",
  "executor-marketing-growth",
  "executor-data-analytics",
  "executor-ai-shipping",
  "executor-toolkit",
  "executor-interface-craft",
];

const AGENT_LABELS: Record<string, string> = {
  request: "Request Agent",
  planner: "Planner Agent",
  product_director: "Planner Agent",
  "executor-product-strategy": "Product Strategy Executor",
  "executor-market-research": "Market Research Executor",
  "executor-gtm": "Go-to-Market Executor",
  "executor-product-discovery": "Product Discovery Executor",
  "executor-product-execution": "Product Execution Executor",
  "executor-marketing-growth": "Marketing Growth Executor",
  "executor-data-analytics": "Data Analytics Executor",
  "executor-ai-shipping": "AI Shipping Executor",
  "executor-toolkit": "Toolkit Executor",
  "executor-interface-craft": "Interface Craft Executor",
};

/**
 * 判断是否属于 Executor Agent。
 */
function isExecutorAgent(agentType: string): boolean {
  return EXECUTOR_AGENT_TYPES.includes(agentType);
}

/**
 * 判断指定 Agent 是否处于当前运行集合中，兼容旧的单 activeAgent 字段。
 */
function isAgentActive(message: Message, agentType: string): boolean {
  return (
    message.activeAgent === agentType ||
    (message.activeAgents ?? []).includes(agentType)
  );
}

/**
 * 读取指定 Agent 的工具调用；历史消息缺少 agentType 时回退到 message.type。
 */
function getToolCallsForAgent(
  message: Message,
  agentType: string,
): NonNullable<Message["toolCalls"]> {
  return (message.toolCalls ?? []).filter((toolCall) => {
    const owner = toolCall.agentType ?? message.type;
    return owner === agentType;
  });
}

/**
 * 兼容旧的 finish.usage 汇总结构，统一转换成 token 用量行。
 */
function legacyUsageToTokenUsage(
  usage: Record<string, unknown>,
): TokenUsageInfo {
  return {
    agentType: "total",
    inputTokens: toNumber(usage.inputTokens),
    cacheHitInputTokens: toNumber(usage.cacheHitInputTokens),
    cacheMissInputTokens: toNumber(usage.cacheMissInputTokens),
    outputTokens: toNumber(usage.outputTokens),
    totalTokens: toNumber(usage.totalTokens),
    costInput: toNumber(usage.costInput),
    costOutput: toNumber(usage.costOutput),
    costTotal: toNumber(usage.costTotal),
    durationMs: toNumber(usage.durationMs),
  };
}

/**
 * 将未知数值字段转换成安全数字，避免异常 payload 撑破展示。
 */
function toNumber(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

/**
 * 格式化 token 数，保持紧凑且可扫读。
 */
function formatTokens(value: number): string {
  return new Intl.NumberFormat("zh-CN").format(value);
}

/**
 * 格式化人民币成本，小额费用保留到 8 位。
 */
function formatCost(value: number): string {
  return new Intl.NumberFormat("zh-CN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 8,
  }).format(value);
}

/**
 * 格式化 Agent 执行耗时。
 */
function formatDuration(durationMs: number): string {
  if (durationMs < 1000) return `${durationMs}ms`;
  return `${(durationMs / 1000).toFixed(1)}s`;
}

/**
 * 将 Agent 类型转换为展示名。
 */
function getAgentLabel(agentType: string): string {
  if (agentType === "total") return "总计";
  return AGENT_LABELS[agentType] ?? `${agentType} Agent`;
}
