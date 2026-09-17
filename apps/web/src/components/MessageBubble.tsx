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
  memo,
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { Collapse, Modal, Tag, Tooltip } from "antd";
import { GlobalLoader } from "./ui/GlobalLoader";
import {
  ApartmentOutlined,
  CaretRightOutlined,
  CheckCircleOutlined,
  ReloadOutlined,
  PartitionOutlined,
} from "@ant-design/icons";
import type {
  HumanInTheLoopInterrupt,
  HumanInTheLoopResume,
  Message,
  SubagentTrace,
  TokenUsageInfo,
} from "../types";
import { buildChatPath } from "../router/app-route";
import { ProseBlock } from "./ProseBlock";
import {
  CritiqueAgentReviewCard,
  PlannerExecutionCard,
  PlannerExecutionLoadingCard,
} from "./PlannerExecutionCard";
import { RequestAnalysisCard } from "./RequestAnalysisCard";
import { TodoCard } from "./TodoCard";
import { ToolCallsCard } from "./ToolCallsCard";
import { UserInputCard } from "./UserInputCard";
import {
  buildExecutionSteps,
  buildRunHint,
  ExecutionRunGroup,
  type ExecutionStep,
} from "./ConversationExecution";
import { buildTaskStatus } from "../utils/workflow-tasks";

type MessageBubbleViewMode = "combined" | "main" | "process";

interface Props {
  message: Message;
  isLast: boolean;
  streaming: boolean;
  viewMode?: MessageBubbleViewMode;
  nextUserContent?: string;
  /**
   * 已本地提交过的表单 ID。
   *
   * 提交后的只读态由上层持有，因为交互中的 Question Form 已经移到输入框位置，
   * 上层需要用它判断"还有没有待回答的问题"。
   */
  submittedFormIds: Set<string>;
  /** 表单提交回调；由上层登记 submittedFormIds 后转发。 */
  onFormSubmitted?: (
    formId: string,
    text: string,
    hitlResume?: HumanInTheLoopResume,
  ) => void;
  /**
   * 是否把交互中的 HITL 表单渲染在消息流里。
   *
   * 默认 false：交互中的表单由输入框位置承担，消息流只保留正文与只读结果。
   */
  renderInteractiveHitl?: boolean;
  /**
   * 重试回调。
   *
   * 由消息 ID 触发而不是每条消息各生成一个闭包，调用方因此可以提供稳定引用，
   * 让尚未变化的历史消息在流式期间跳过整棵子树的重渲染与 Markdown 重新解析。
   */
  onRetry?: (messageId: string) => void;
}

/**
 * 渲染单条聊天消息，并按 Agent 阶段放置推理、整理和分析卡片。
 *
 * Notes:
 * - 使用 React.memo：流式期间消息数组每 50ms 更新一次，历史消息的内容没有变化，
 *   不应重复解析 Markdown 或重建 DOM 子树。
 */
export const MessageBubble = memo(function MessageBubble({
  message,
  isLast,
  streaming,
  viewMode = "combined",
  nextUserContent,
  submittedFormIds,
  onFormSubmitted,
  renderInteractiveHitl = false,
  onRetry,
}: Props) {
  const showMainContent = viewMode !== "process";
  const showProcessContent = viewMode !== "main";

  if (message.role === "user") {
    if (!showMainContent) return null;

    const formAnswers = parseFormAnswersMessage(message.content);

    return (
      <div className="flex min-w-0 max-w-[min(760px,88%)] flex-col self-end"
        data-chat-message-id={message.id} data-chat-message-role={message.role}>
        {formAnswers ? (
          <FormAnswersCard answers={formAnswers} />
        ) : (
          <div
            className="font-reading whitespace-pre-wrap wrap-break-word rounded-[18px] rounded-br-md px-4 py-3 text-white"
            style={{
              background: "var(--primary)",
              fontFamily: "var(--body)",
              fontSize: 14,
              lineHeight: 1.6,
            }}
          >
            {message.content}
          </div>
        )}
      </div>
    );
  }

  const streamActive = isLast && streaming;
  const requestError =
    message.agentError?.agentType === "request" ? message.agentError : null;
  const otherError =
    message.agentError && message.agentError.agentType !== "request"
      ? message.agentError
      : null;
  const plannerDagGenerating =
    streamActive &&
    isAgentActive(message, "planner") &&
    !message.plannerExecution;
  const hasVisibleProcessContent = Boolean(
    message.thinking ||
    message.reasoningBlocks?.length ||
    message.toolCalls?.length ||
    message.subagentTraces?.length,
  );
  // 当前消息上正在运行的 Agent 列表，供左栏执行态卡片展示。
  const runningAgents = message.activeAgents?.length
    ? message.activeAgents
    : message.activeAgent
      ? [message.activeAgent]
      : [];
  const showLoadingPlaceholder =
    !message.content &&
    !message.questionForm &&
    !message.humanInterrupt &&
    !message.userInput &&
    !message.requestAnalysis &&
    !message.plannerExecution &&
    !message.plannerReview &&
    !message.workflowCompletion &&
    !message.documentEvidenceResolutionComplete &&
    !message.agentError &&
    !message.interrupted;
  const handleFormSubmit = useCallback(
    (formId: string, text: string, hitlResume?: HumanInTheLoopResume) => {
      // 提交后由上层登记只读态，避免等待历史恢复期间重复提交。
      onFormSubmitted?.(formId, text, hitlResume);
    },
    [onFormSubmitted],
  );
  /** 把稳定的回调引用收敛为本条消息的重试动作。 */
  const handleRetry = useCallback(() => {
    onRetry?.(message.id);
  }, [message.id, onRetry]);

  /**
   * 执行时间线步骤。
   *
   * 有 Planner 计划时以任务为步骤（状态与「任务历史」面板同一份推导）；没有计划
   * 的轮次退化为「按 Agent」的步骤，保证纯对话轮次也能看到执行过程。
   * 只做展示映射，不改变任何字段。
   */
  const executionSteps = (() => {
    const resolveAgent = (agentType: string) => ({
      toolCalls: getToolCallsForAgent(message, agentType),
      tokenUsage: findTokenUsageForAgent(message, agentType),
      thinking: message.reasoningBlocks?.find(
        (block) => block.agentType === agentType,
      )?.content,
      subagents: getSubagentTracesForParent(message, agentType),
    });

    const taskStatus = message.plannerExecution
      ? buildTaskStatus(
          message.plannerExecution.plan.tasks,
          message.executorResults ?? [],
          message.activeAgent,
          message.activeAgents,
        )
      : new Map();

    const planSteps = buildExecutionSteps({
      plan: message.plannerExecution?.plan ?? null,
      results: message.executorResults ?? [],
      statusByTaskId: taskStatus,
      resolveAgent,
    });

    // 计划之外的 Agent（理解需求、请求分析、规划、审查）也进入同一条时间线。
    const planAgents = new Set(
      message.plannerExecution?.plan.tasks.map((task) => task.assigned_agent) ?? [],
    );
    const extraAgents = AGENT_TIMELINE_ORDER.filter(
      (agentType) => !planAgents.has(agentType) && hasAgentActivity(message, agentType),
    );
    // 兜底：以固定顺序覆盖不到、但确实留下了过程的 Agent 类型也不能丢。
    const knownAgents = new Set([...AGENT_TIMELINE_ORDER, ...planAgents]);
    const unknownAgents = [
      ...new Set([
        ...(message.reasoningBlocks?.map((block) => block.agentType) ?? []),
        ...(message.toolCalls?.map((toolCall) => toolCall.agentType ?? "") ?? []),
      ]),
    ].filter(
      (agentType) => agentType && !knownAgents.has(agentType),
    );

    const extraSteps: ExecutionStep[] = [...extraAgents, ...unknownAgents].map(
      (agentType) => {
        const agent = resolveAgent(agentType);
        const running = streamActive && isAgentActive(message, agentType);
        return {
          id: `agent-${agentType}`,
          title: getAgentStepTitle(agentType),
          agentLabel: getAgentLabel(agentType),
          agentType,
          status: running ? "running" : "completed",
          durationMs: agent.tokenUsage?.durationMs,
          toolCalls: agent.toolCalls,
          tokenUsage: agent.tokenUsage,
          thinking: agent.thinking,
          subagents: agent.subagents,
          content: buildStepContent(message, agentType),
        };
      },
    );

    return [...extraSteps, ...planSteps];
  })();
  const hasExecution = executionSteps.length > 0;
  const executionActive =
    streamActive && executionSteps.some((step) => step.status === "running");

  if (viewMode === "process" && !hasVisibleProcessContent && !streamActive) {
    return null;
  }

  if (viewMode === "process" && !hasVisibleProcessContent && streamActive) {
    return (
      <div className="flex w-full flex-col self-stretch">
        {/*
          消息已提交但还没有任何业务状态到达：这是真实的空窗期，使用局部加载
          指示。一旦 Agent Run / Planner / Executor / Tool / HITL 出现，这段
          占位整体消失，由执行时间线接管。
        */}
        <div className="mb-2 flex items-center gap-2 rounded-lg border border-[var(--line-soft)] bg-white px-4 py-3">
          <GlobalLoader scope="inline" loading label="等待 Agent 过程" />
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-w-0 w-full flex-col self-stretch"
      data-chat-message-id={showMainContent ? message.id : undefined} data-chat-message-role={message.role}>
      {/*
       * 执行时间线：一次请求的所有 Agent 收在同一个分组里，一级只显示状态、
       * 执行描述与 Agent 名；Token / Cost / 工具参数等进入展开后的运行详情。
       * 正文（最终回答）排在其后，成为视觉主体。
       */}
      {showProcessContent && hasExecution && (
        <ExecutionRunGroup
          steps={executionSteps}
          active={executionActive}
          hint={buildRunHint(executionSteps)}
        />
      )}

      {showMainContent && message.content && (
        <div className="assistant-bubble">
          <ProseBlock
            text={message.content}
            toolCalls={message.toolCalls}
            isLastAssistant={isLast}
            streaming={streaming}
            nextUserContent={nextUserContent}
            submittedFormIds={submittedFormIds}
            onSubmitForm={handleFormSubmit}
          />
        </div>
      )}

      {showMainContent && requestError && (
        <AgentErrorCard
          agentType="request"
          message={requestError.message}
          onRetry={handleRetry}
        />
      )}

      {/*
       * 规划与审查的详细结构收进「运行详情」：一级只保留时间线，
       * DAG 与任务明细默认折叠，需要时展开（能力不删）。
       */}
      {showProcessContent && (plannerDagGenerating || message.plannerExecution) && (
        <details className="exec-extra">
          <summary>
            {plannerDagGenerating
              ? "正在生成执行 DAG"
              : `查看 Planner DAG（${message.plannerExecution?.plan.tasks.length ?? 0} 个任务）`}
          </summary>
          <div className="exec-extra-body">
            {plannerDagGenerating ? (
              <PlannerExecutionLoadingCard />
            ) : (
              message.plannerExecution && (
                <PlannerExecutionCard
                  plan={message.plannerExecution.plan}
                  executorResults={message.executorResults}
                  activeAgent={message.activeAgent}
                  activeAgents={message.activeAgents}
                />
              )
            )}
          </div>
        </details>
      )}

      {showProcessContent && message.plannerReview && (
        <details className="exec-extra">
          <summary>
            {message.plannerReview.state === "generating"
              ? "Critique Agent 正在审查"
              : "查看 Critique 审查结果"}
          </summary>
          <div className="exec-extra-body">
            <CritiqueAgentReviewCard
              state={message.plannerReview.state}
              result={message.plannerReview.result}
            />
          </div>
        </details>
      )}

      {/*
       * 「用户输入整理」「Request Agent 分析」已并入执行时间线对应步骤的运行详情，
       * 这里不再单独渲染，避免同一份内容在对话里出现两次。
       */}

      {showMainContent && message.todos && message.todos.length > 0 && (
        <TodoCard todos={message.todos} />
      )}

      {/* 知识图谱更新：保留为独立事件行，不夹在折叠详情里。 */}
      {showMainContent && message.documentEvidenceResolutionComplete && (
        <KnowledgeGraphUpdatedEvent
          workspaceId={message.documentEvidenceResolutionComplete.workspaceId}
        />
      )}

      {showMainContent && message.workflowCompletion && (
        <WorkflowCompletionCard content={message.workflowCompletion.content} />
      )}

      {/*
       * 交互中的 HITL 表单移到输入框位置（由上层渲染），这里只在历史回放或
       * 明确要求时渲染，避免同一个表单在消息流和输入区出现两次。
       */}
      {showMainContent && message.humanInterrupt && renderInteractiveHitl && (
        <HumanInterruptBlock
          interrupt={message.humanInterrupt.interrupt}
          isLastAssistant={isLast}
          streaming={streaming}
          nextUserContent={nextUserContent}
          submittedFormIds={submittedFormIds}
          onSubmitForm={handleFormSubmit}
        />
      )}

      {/*
       * 交互中的表单统一由输入区渲染；这里只在历史回放或输入区判定失效时渲染，
       * 避免同一个表单在消息流和输入区出现两次。
       */}
      {showMainContent && message.questionForm && !message.humanInterrupt && (
        <div>
          {message.questionForm.state === "generating" ? (
            renderInteractiveHitl ? (
              <QFGenerating label="正在生成问题表单" />
            ) : null
          ) : (
            <ProseBlock
              text={message.questionForm.content || ""}
              isLastAssistant={isLast}
              streaming={streaming}
              nextUserContent={nextUserContent}
              submittedFormIds={submittedFormIds}
              onSubmitForm={handleFormSubmit}
              renderInteractiveForm={renderInteractiveHitl}
            />
          )}
        </div>
      )}

      {showMainContent && otherError && (
        <AgentErrorCard
          agentType={otherError.agentType}
          message={otherError.message}
          onRetry={handleRetry}
        />
      )}

      {showMainContent && message.interrupted && !message.agentError && (
        <AgentInterruptedCard onContinue={handleRetry} />
      )}

      {showMainContent &&
        showLoadingPlaceholder &&
        !(showProcessContent && hasVisibleProcessContent) && (
          <>
            {/*
              等待第一个业务状态到达。真实状态一旦出现（正文、表单、DAG、
              时间线），这里立刻被替换，不使用通用 Loader 代替业务信息。
            */}
            {viewMode !== "main" && (
              <div className="assistant-bubble is-loading">
                <GlobalLoader scope="inline" loading label="思考中" />
              </div>
            )}
            {viewMode === "main" && runningAgents.length > 0 && (
              <div className="assistant-bubble is-loading">
                <GlobalLoader
                  scope="inline"
                  loading
                  label={`${runningAgents.map((a) => getAgentLabel(a)).join("、")}${
                    runningAgents.length > 1 ? " 并行执行中" : " 执行中"
                  }`}
                />
              </div>
            )}
          </>
        )}
    </div>
  );
});

/**
 * 展示当前助手消息内各 Agent 的 token 和费用用量，可折叠以减少聊天区干扰。
 */
/**
 * 用户提交后的 Question Form 答案展示模型。
 */
interface FormAnswersViewModel {
  formId: string;
  rows: Array<{ question: string; answer: string }>;
}

/**
 * 将用户提交的 Question Form 回复解析为可展示卡片数据。
 */
function parseFormAnswersMessage(content: string): FormAnswersViewModel | null {
  const lines = content.split(/\r?\n/);
  const header = lines[0]?.trim() ?? "";
  const headerMatch = /^\[form answers\s*(?:-|–|—)\s*([^\]]+)\]/i.exec(header);
  if (!headerMatch?.[1]) return null;

  const rows = lines.slice(1).flatMap((line) => {
    const match = /^\s*[-*]\s*(.+?)\s*[:：]\s*(.*)\s*$/.exec(line);
    if (!match?.[1]) return [];
    return [
      {
        question: match[1].trim(),
        answer: (match[2] ?? "").trim() || "(skipped)",
      },
    ];
  });

  return rows.length > 0 ? { formId: headerMatch[1].trim(), rows } : null;
}

/**
 * 以只读卡片展示用户已经提交的 Question Form 答案。
 */
function FormAnswersCard({ answers }: { answers: FormAnswersViewModel }) {
  return (
    <div className="min-w-0 w-full max-w-full rounded-lg border border-[var(--primary-soft)] bg-white px-4 py-3 shadow-[var(--shadow-card)]">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <span className="text-[13px] font-bold text-[var(--ink)]">
          Question Form 回复
        </span>
        <Tag color="blue" className="m-0! max-w-full truncate">
          {answers.formId}
        </Tag>
      </div>
      <div className="space-y-2">
        {answers.rows.map((row, index) => (
          <div
            key={`${row.question}-${index}`}
            className="rounded-md bg-[var(--surface-muted)] px-3 py-2"
          >
            <div className="font-reading-compact font-semibold text-[var(--ink-mute)]">
              {row.question}
            </div>
            <div className="font-reading-compact mt-1 whitespace-pre-wrap wrap-break-word text-[13px] leading-relaxed text-[var(--ink)]">
              {row.answer}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

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
        <span className="text-[var(--ink)]">{formatCost(totalCost)} yuan</span>
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
                key={
                  usage.id ?? `${usage.agentType}-${usage.createdAt ?? index}`
                }
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
 * 渲染 LangGraph Human-in-the-Loop interrupt 携带的自定义表单。
 */
function HumanInterruptBlock({
  interrupt,
  isLastAssistant,
  streaming,
  nextUserContent,
  submittedFormIds,
  onSubmitForm,
}: {
  interrupt: HumanInTheLoopInterrupt;
  isLastAssistant: boolean;
  streaming: boolean;
  nextUserContent?: string;
  submittedFormIds: Set<string>;
  onSubmitForm: (
    formId: string,
    text: string,
    hitlResume?: HumanInTheLoopResume,
  ) => void;
}) {
  const questionForm = getQuestionFormFromInterrupt(interrupt);
  if (!questionForm) return null;

  return (
    <ProseBlock
      text={questionForm}
      isLastAssistant={isLastAssistant}
      streaming={streaming}
      nextUserContent={nextUserContent}
      submittedFormIds={submittedFormIds}
      onSubmitForm={onSubmitForm}
      hitlThreadId={interrupt.threadId}
    />
  );
}

/**
 * 从 HITLRequest 风格 payload 中读取 Question Form 原文。
 *
 * 导出供上层在输入区渲染同一个表单，避免两处各写一份解析。
 */
export function getQuestionFormFromInterrupt(
  interrupt: HumanInTheLoopInterrupt,
): string | null {
  const action = interrupt.value.actionRequests.find(
    (item) => item.name === "question_form",
  );
  return typeof action?.args.questionForm === "string"
    ? action.args.questionForm
    : null;
}

/**
 * 展示连接中断后留下的中断态，并提供恢复入口。
 */
function AgentInterruptedCard({
  onContinue,
}: {
  onContinue?: () => void;
}) {
  return (
    <div className="mb-2 rounded-lg border border-[var(--ds-color-warning)] bg-[var(--ds-color-warning-soft)] px-4 py-3 text-[var(--ds-color-warning)]">
      <div className="mb-1 flex items-center justify-between gap-3">
        <span className="text-[13px] font-bold">
          连接中断，工作流已停止
        </span>
        {onContinue && (
          <button
            type="button"
            className="inline-flex cursor-pointer items-center gap-1 rounded-md border border-[var(--ds-color-warning)] bg-[var(--surface)] px-2 py-1 text-[var(--ds-font-size-small)] font-bold text-[var(--ds-color-warning)]"
            onClick={(event) => {
              event.stopPropagation();
              onContinue();
            }}
          >
            <ReloadOutlined />
            继续运行
          </button>
        )}
      </div>
      <span className="text-[12px] leading-relaxed">
        可点击继续运行，服务端将从上次检查点恢复。
      </span>
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
  const [detailOpen, setDetailOpen] = useState(false);

  return (
    <>
      <div className="mb-2 rounded-lg border border-[var(--ds-color-error)] bg-[var(--ds-color-error-soft)] px-4 py-3 text-[var(--ds-color-error)]">
        <div className="mb-1 flex items-center justify-between gap-3">
          <span className="text-[13px] font-bold">
            {getAgentLabel(agentType ?? "agent")} 执行失败
          </span>
          {onRetry && (
            <button
              type="button"
              className="inline-flex cursor-pointer items-center gap-1 rounded-md border border-[var(--ds-color-error)] bg-[var(--surface)] px-2 py-1 text-[var(--ds-font-size-small)] font-bold text-[var(--ds-color-error)]"
              onClick={(event) => {
                event.stopPropagation();
                onRetry();
              }}
            >
              <ReloadOutlined />
              重试
            </button>
          )}
        </div>
        <button
          type="button"
          className="block w-full cursor-pointer border-0 bg-transparent p-0 text-left text-[var(--ds-color-error)]"
          onClick={() => setDetailOpen(true)}
        >
          <span
            className="whitespace-pre-wrap text-[13px] leading-relaxed"
            style={{
              display: "-webkit-box",
              WebkitBoxOrient: "vertical",
              WebkitLineClamp: 3,
              overflow: "hidden",
            }}
          >
            {message}
          </span>
          <span className="mt-2 block text-[12px] font-bold text-[var(--ds-color-error)]">
            点击查看完整错误
          </span>
        </button>
      </div>
      <Modal
        title={`${getAgentLabel(agentType ?? "agent")} 详细报错`}
        open={detailOpen}
        footer={null}
        width={760}
        onCancel={() => setDetailOpen(false)}
      >
        <pre className="themed-scrollbar max-h-[60vh] overflow-auto whitespace-pre-wrap rounded-md bg-[#111827] p-4 text-[12px] leading-relaxed text-[#f9fafb]">
          {message}
        </pre>
      </Modal>
    </>
  );
}

/**
 * 渲染生成中状态，用于表单、用户输入整理和 Request Agent 分析。
 */
/**
 * 展示产品工作流正式结束状态，提示用户可以查看完整知识图谱。
 */
function WorkflowCompletionCard({ content }: { content: string }) {
  return (
    <div className="mb-2 rounded-lg border border-[var(--ds-color-success)] bg-[var(--ds-color-success-soft)] px-4 py-3 text-[var(--ds-color-success)]">
      <div className="mb-1 flex items-center gap-2 text-[13px] font-bold">
        <CheckCircleOutlined />
        <span>本轮流程已结束</span>
      </div>
      <div className="whitespace-pre-wrap text-[13px] leading-relaxed">
        {content || "知识图谱已完成归档，可以查看完整体知识图谱。"}
      </div>
    </div>
  );
}

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
 * 知识图谱更新事件
 *
 * 图谱更新是一次独立事件，保留在对话一级；只呈现结论与入口，不铺开原始
 * change 数据。入口复用已有路由与面板状态，不新增导航逻辑。
 */
function KnowledgeGraphUpdatedEvent({ workspaceId }: { workspaceId: string }) {
  return (
    <div className="kg-updated">
      <span className="kg-updated-icon" aria-hidden="true">
        <ApartmentOutlined />
      </span>
      <div className="kg-updated-copy">
        <strong>知识图谱已更新</strong>
        <span>本次执行写入的实体与关系已在知识图谱工作区可见</span>
      </div>
      <a className="kg-updated-link" href={buildChatPath(workspaceId)}>
        打开工作区
      </a>
    </div>
  );
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
  orchestrator: "Orchestrator Agent",
  planner: "Planner SubAgent",
  critique: "Critique Agent",
  product_director: "Critique Agent",
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

const SUBAGENT_LABELS: Record<string, string> = {
  "pre-orchestrator": "Pre-Orchestrator SubAgent",
  planner: "Planner SubAgent",
};

/**
 * 执行时间线中「计划之外」的 Agent 顺序。
 *
 * 这些 Agent 不产出 DAG 任务，但属于同一轮执行，因此按真实发生顺序排进同一条
 * 时间线，避免它们再次变成独立大卡片。
 */
const AGENT_TIMELINE_ORDER = [
  "conversation",
  "request",
  "orchestrator",
  "planner",
  "critique",
  "product_director",
];

/** 各阶段的人类可读执行描述。 */
const AGENT_STEP_TITLES: Record<string, string> = {
  conversation: "理解需求",
  request: "分析请求",
  orchestrator: "规划执行方案",
  planner: "生成执行 DAG",
  critique: "审查输出质量",
  product_director: "审查输出质量",
};

/**
 * 该 Agent 在这一轮里是否留下了可展示的活动。
 *
 * 只依据已有字段判断，避免时间线里出现空步骤。
 */
function hasAgentActivity(message: Message, agentType: string): boolean {
  if (isAgentActive(message, agentType)) return true;
  if (message.reasoningBlocks?.some((block) => block.agentType === agentType)) {
    return true;
  }
  if (getToolCallsForAgent(message, agentType).length > 0) return true;
  if (findTokenUsageForAgent(message, agentType)) return true;
  if (agentType === "request" && message.requestAnalysis) return true;
  if (agentType === "planner" && message.plannerExecution) return true;
  // 用户输入整理属于 Conversation 阶段的产出，不能因为没有 reasoning 就丢掉。
  if (agentType === "conversation" && message.userInput) return true;
  if (
    (agentType === "critique" || agentType === "product_director") &&
    message.plannerReview
  ) {
    return true;
  }
  if (agentType === "conversation" && message.thinking) return true;
  return false;
}

/** 步骤描述：优先使用产品化文案，缺失时回退到 Agent 名。 */
function getAgentStepTitle(agentType: string): string {
  return AGENT_STEP_TITLES[agentType] ?? getAgentLabel(agentType);
}

/**
 * 步骤的结构化内容。
 *
 * 复用已有卡片的内联形态，把数据放进对应步骤的运行详情，避免同一份内容在
 * 时间线之外再渲染一次（此前「用户输入整理」「Request Agent 分析」会出现两遍）。
 */
function buildStepContent(message: Message, agentType: string): ReactNode {
  if (agentType === "conversation" && message.userInput) {
    return message.userInput.state === "generating" ? (
      <QFGenerating label="正在整理用户输入" />
    ) : (
      <UserInputCard raw={message.userInput.content || ""} inline />
    );
  }
  if (agentType === "request" && message.requestAnalysis) {
    return message.requestAnalysis.state === "generating" ? (
      <QFGenerating label="Request Agent 正在分析请求" />
    ) : (
      <RequestAnalysisCard
        raw={message.requestAnalysis.content}
        analysis={message.requestAnalysis.analysis}
        inline
      />
    );
  }
  return undefined;
}

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
 * 读取指定父 Agent 下的 SubAgent 轨迹；历史数据缺父级时按 Orchestrator 兜底。
 */
function getSubagentTracesForParent(
  message: Message,
  parentAgentType: string,
): SubagentTrace[] {
  return (message.subagentTraces ?? []).filter((trace) => {
    const parent = trace.parentAgentType ?? "orchestrator";
    return parent === parentAgentType;
  });
}

/** SubAgent 返回体在折叠区中的最大渲染字符数。 */
const MAX_SUBAGENT_RESULT_CHARS = 20_000;

/**
 * 将 SubAgent 返回结果格式化为可折叠文本。
 *
 * 超长返回体只保留前缀并显式标注截断：即使运行时误传大体量结果，
 * 也不会把整块 JSON 塞进 DOM 触发页面内存压力。
 */
function formatSubagentResult(result: unknown): string {
  return boundRenderedText(formatSubagentResultBody(result));
}

/** 按渲染预算截断文本，保留截断说明。 */
function boundRenderedText(text: string, maxChars = MAX_SUBAGENT_RESULT_CHARS): string {
  if (text.length <= maxChars) return text;

  return `${text.slice(0, maxChars)}\n\n[内容过长已截断，省略 ${
    text.length - maxChars
  } 字符]`;
}

/** 将 SubAgent 返回体序列化为可读文本，不做长度约束。 */
function formatSubagentResultBody(result: unknown): string {
  if (typeof result === "string") {
    const trimmed = result.trim();
    const parsed = tryParseJson(trimmed);
    return parsed === null ? trimmed : JSON.stringify(parsed, null, 2);
  }

  try {
    return JSON.stringify(result, null, 2);
  } catch {
    return String(result);
  }
}

/**
 * 尝试解析 JSON 字符串，失败时返回 null。
 */
function tryParseJson(value: string): unknown | null {
  if (!value) return null;

  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

/**
 * 从消息的 token 用量记录中查找指定 Agent 的用量信息。
 */
function findTokenUsageForAgent(
  message: Message,
  agentType: string,
): TokenUsageInfo | undefined {
  return message.tokenUsages?.find((usage) => usage.agentType === agentType);
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

/**
 * 将 SubAgent 类型转换为展示名称。
 */
function getSubagentLabel(subagentType: string): string {
  return SUBAGENT_LABELS[subagentType] ?? `${subagentType} SubAgent`;
}
