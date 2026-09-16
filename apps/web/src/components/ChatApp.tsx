/**
 * 聊天工作区主视图
 *
 * 负责渲染单个工作区内的聊天消息、输入框和工作流辅助弹窗，并把对话栏与工作区
 * 面板组合到统一外壳中。页面级数据读写由 ThreadChatPage 和 API 模块提供，
 * 本组件只管理浏览器侧交互状态。
 *
 * Responsibilities:
 * - 展示聊天消息流、欢迎态、输入框、停止生成和重试入口
 * - 管理知识图谱与 LangGraph 可视化弹窗
 * - 维护自动滚动、联网搜索开关和当前 Agent 定位行为
 * - 组合 ConversationPane 与 WorkspaceShell，并把当前面板透传给顶层
 *
 * Notes:
 * - 不直接持久化聊天历史；权威数据通过 API 恢复。
 * - 不消费 SSE，运行快照由 chat-run-store 提供。
 */

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { Button, Skeleton, message } from "antd";
import { ClearOutlined } from "@ant-design/icons";
import type {
  HumanInTheLoopResume,
  Message,
  WorkflowRetryRequest,
  ModelUsageProfile,
} from "../types";
import { type KnowledgeGraphState } from "../hooks/useKnowledgeGraph";
import { MessageBubble } from "./MessageBubble";
import { QuestionFormView } from "./QuestionForm";
import { ConversationPane } from "./shell/ConversationPane";
import { ConversationComposer } from "./shell/ConversationComposer";
import { useMessageNavigation } from "../hooks/useMessageNavigation";
import {
  formatHumanInTheLoopResume,
  type QuestionForm,
} from "../utils/question-form";
import { findPendingQuestionForm } from "../utils/pending-question-form";
import { KnowledgeGraphModal } from "./modals/KnowledgeGraphModal";
import {
  LangGraphModal,
  type LangGraphRuntimeState,
  type LangGraphRuntimeStatus,
} from "./modals/LangGraphModal";

interface Props {
  workspaceId: string | null;
  workspaceName: string;
  threadTitle: string | null;
  messages: Message[];
  isLoading: boolean;
  isMessagesLoading: boolean;
  error: string | null;
  disabledReason?: string | null;
  modelProfiles: ModelUsageProfile[];
  selectedModelProfileId: string;
  onModelProfileChange: (profileId: string) => void;
  onSend: (
    text: string,
    options?: {
      webSearchEnabled?: boolean;
      hitlResume?: HumanInTheLoopResume;
      workflowRetry?: WorkflowRetryRequest;
    },
  ) => void;
  onStop: () => void;
  onClear: () => void;
  onBack: () => void;
  /**
   * 任务历史 / 知识图谱面板内容。
   *
   * 两份数据都只存在于聊天页面（当前会话消息、工作区图谱），因此由页面注入渲染
   * 函数，最终由应用外壳的面板容器渲染，避免把消息与图谱状态提升到外壳。
   */
  tasksPanel?: () => ReactNode;
  /** 把当前任务历史渲染函数登记到外壳；外壳用它渲染任务历史面板。 */
  onTasksPanelChange?: (renderer: (() => ReactNode) | null) => void;
  graphPanel?: () => ReactNode;
  /** 把当前知识图谱渲染函数登记到外壳。 */
  onGraphPanelChange?: (renderer: (() => ReactNode) | null) => void;
  /** 工作区图谱数据与加载态；由页面持有，弹窗与面板共用。 */
  kgState?: KnowledgeGraphState;
  /** 手动刷新图谱；弹窗在无数据时调用。 */
  kgRefresh?: () => Promise<void>;
}

/**
 * 空会话的快捷任务。
 *
 * 文案与行为沿用原有推荐问题：点击即以该问题发起对话，走同一条发送路径。
 * 这里只补充一行说明，让卡片不再像表单选项。
 */
const EXAMPLE_QUERIES: Array<{ label: string; hint: string }> = [
  { label: "帮我梳理这个产品的核心需求", hint: "明确目标、用户与范围" },
  { label: "为当前项目拆一版 MVP 计划", hint: "形成阶段性执行方案" },
  { label: "生成一份迭代风险清单", hint: "识别关键风险与依赖" },
  { label: "把今天的讨论整理成待办事项", hint: "提炼讨论后的行动事项" },
];

export function ChatApp({
  workspaceId,
  workspaceName,
  threadTitle,
  messages,
  isLoading,
  isMessagesLoading,
  error,
  disabledReason,
  modelProfiles,
  selectedModelProfileId,
  onModelProfileChange,
  onSend,
  onStop,
  onClear,
  onBack,
  tasksPanel,
  onTasksPanelChange,
  graphPanel,
  onGraphPanelChange,
  kgState,
  kgRefresh,
}: Props) {
  const [input, setInput] = useState("");
  const [webSearchEnabled, setWebSearchEnabled] = useState(false);
  const [userScrolled, setUserScrolled] = useState(false);
  const [langGraphModalOpen, setLangGraphModalOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  /**
   * 把两个面板渲染函数登记到外壳；卸载时清空，避免外壳引用失效闭包。
   *
   * 注意：调用方必须把传入的函数原样保存，不能用 setState 直接接收——
   * setState 会把函数当 updater 执行，存下来就不是函数了。
   */
  useEffect(() => {
    onTasksPanelChange?.(tasksPanel ?? null);
    return () => onTasksPanelChange?.(null);
  }, [onTasksPanelChange, tasksPanel]);

  useEffect(() => {
    onGraphPanelChange?.(graphPanel ?? null);
    return () => onGraphPanelChange?.(null);
  }, [graphPanel, onGraphPanelChange]);

  // MessageBubble 使用 React.memo：传给它的回调必须在多次渲染间保持同一引用，
  // 最新状态统一经 ref 读取，避免 memo 命中时使用过期的闭包值。
  const onSendRef = useRef(onSend);
  const webSearchEnabledRef = useRef(webSearchEnabled);

  useEffect(() => {
    onSendRef.current = onSend;
  }, [onSend]);
  useEffect(() => {
    webSearchEnabledRef.current = webSearchEnabled;
  }, [webSearchEnabled]);

  // 图谱数据由页面持有：对话弹窗与「知识图谱」Tab 共用同一份，避免各自请求。
  const kgData = kgState?.data ?? null;
  const kgLoading = kgState?.loading ?? false;
  const kgDataRef = useRef(kgData);
  kgDataRef.current = kgData;
  const kgRefreshRef = useRef(kgRefresh);
  kgRefreshRef.current = kgRefresh;
  const [kgModalOpen, setKgModalOpen] = useState(false);

  // 工作区切换时关闭弹窗，避免保留上一个项目的图谱视图。
  useEffect(() => {
    setKgModalOpen(false);
  }, [workspaceId]);

  /** 打开知识图谱可视化弹窗，无数据时给出明确提示。 */
  const handleOpenKgModal = useCallback(async () => {
    if (!workspaceId || kgLoading) return;

    if (!kgDataRef.current) await kgRefreshRef.current?.();
    if (kgDataRef.current?.hasData) {
      setKgModalOpen(true);
      return;
    }

    void message.info("当前工作区暂无可查看的知识图谱数据");
  }, [kgLoading, workspaceId]);

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

  /** 暂停自动贴底，让消息导航可以定位历史内容。 */
  const pauseAutoScroll = useCallback(() => setUserScrolled(true), []);
  const messageNavigation = useMessageNavigation(
    containerRef,
    workspaceId ?? "empty",
    pauseAutoScroll,
  );

  /*
   * 流式期间只在用户位于底部附近时跟随滚动。
   *
   * userScrolled 由滚动事件维护：离开底部即暂停跟随，滚回底部自动恢复，
   * 因此用户主动上滚查看历史时不会被强行拉回。
   */
  useEffect(() => {
    if (!userScrolled) scrollToBottom();
  }, [messages, userScrolled, scrollToBottom]);

  // 新一轮发送时重新跟随：否则"上滚看历史 → 再发送"会永久停止自动滚动。
  useEffect(() => {
    if (isLoading) setUserScrolled(false);
  }, [isLoading]);

  const handleScroll = useCallback(() => {
    setUserScrolled(!isAtBottom());
  }, [isAtBottom]);

  /**
   * 已本地提交的表单 ID。
   *
   * 提交后立即登记，避免等待历史恢复期间重复提交；同时让输入区判定"没有待回答
   * 的问题"，从而把输入框还给用户。
   */
  const [submittedFormIds, setSubmittedFormIds] = useState<Set<string>>(
    () => new Set(),
  );
  const markFormSubmitted = useCallback((formId: string) => {
    setSubmittedFormIds((prev) => {
      if (prev.has(formId)) return prev;
      const next = new Set(prev);
      next.add(formId);
      return next;
    });
  }, []);
  const handleFormSubmitted = useCallback(
    (
      formId: string,
      text: string,
      hitlResume?: HumanInTheLoopResume,
    ) => {
      markFormSubmitted(formId);
      onSendRef.current(text, {
        webSearchEnabled: webSearchEnabledRef.current,
        hitlResume,
      });
      setUserScrolled(false);
    },
    [markFormSubmitted],
  );

  /**
   * 待回答的 HITL 表单。
   *
   * 运行时暂停等待补充信息时，表单替换输入框占据底部；用户答完提交后输入框
   * 自动恢复，这样不会出现"既要回答又要打字"的双重入口。
   */
  const pendingForm = useMemo(
    () =>
      findPendingQuestionForm(messages, submittedFormIds, {
        streaming: isLoading,
      }),
    [isLoading, messages, submittedFormIds],
  );
  /**
   * 消息流是否渲染交互态表单。
   *
   * 表单的宿主只有一个：存在待回答表单时由输入区承担，消息流不再重复渲染；
   * 只有在"正文里有表单但输入区判定它已失效"这种极端情况下才回落到消息流，
   * 保证任何情况下用户都能看到并回答问题。
   */
  const renderInteractiveHitl = !pendingForm;

  const lastAgentIdx = (() => {
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i]!.role === "agent") return i;
    }
    return -1;
  })();
  const activeAgents = isLoading ? findActiveAgents(messages) : [];
  const langGraphRuntimeState = useMemo(
    () => buildLangGraphRuntimeState(messages, activeAgents),
    [activeAgents, messages],
  );

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

  const retryAssistantMessage = useCallback(
    (messageId: string) => {
      if (isLoading || disabledReason) return;
      const index = messages.findIndex((message) => message.id === messageId);
      if (index === -1) return;
      const retryAction = messages[index]?.agentError?.retryAction;
      if (retryAction) {
        onSend("", {
          webSearchEnabled,
          workflowRetry: {
            type: retryAction.type,
            taskId: retryAction.taskId,
          },
        });
        setUserScrolled(false);
        return;
      }

      for (let cursor = index - 1; cursor >= 0; cursor--) {
        const previous = messages[cursor];
        if (previous?.role === "user" && previous.content.trim()) {
          onSend(previous.content.trim(), { webSearchEnabled });
          setUserScrolled(false);
          return;
        }
      }
    },
    [disabledReason, isLoading, messages, onSend, webSearchEnabled],
  );

  // retryAssistantMessage 的重试回调同样需要稳定引用（见文件顶部的 ref 说明）。
  const retryAssistantMessageRef = useRef(retryAssistantMessage);

  useEffect(() => {
    retryAssistantMessageRef.current = retryAssistantMessage;
  }, [retryAssistantMessage]);

  const handleRetryMessage = useCallback((messageId: string) => {
    retryAssistantMessageRef.current(messageId);
  }, []);

  const doSubmit = useCallback(() => {
    if (!input.trim() || isLoading || disabledReason) return;
    onSend(input.trim(), { webSearchEnabled });
    setInput("");
    setUserScrolled(false);
  }, [disabledReason, input, isLoading, onSend, webSearchEnabled]);

  /** 推荐任务直接以该问题发起对话，保持原有发送路径。 */
  const handleExampleClick = (query: string) => {
    if (disabledReason || isLoading) return;
    onSend(query, { webSearchEnabled });
    setUserScrolled(false);
  };

  const showWelcome = messages.length === 0 && !isMessagesLoading;
  const showMessagesLoading = isMessagesLoading && messages.length === 0;
  /**
   * 空会话（New Conversation）与 Active Conversation 的布局在这里分流。
   *
   * 只有真正没有消息且不在恢复中时才算空会话；一旦发出第一条消息，
   * showWelcome 立即为 false，布局自动切回「消息区 + 贴底输入框」。
   */
  const isEmptyConversation = showWelcome && !pendingForm;

  const scrollToActiveThinking = useCallback((agentType: string) => {
    const container = containerRef.current;
    if (!container) return;

    // 先退出自动贴底模式，再在下一帧计算目标位置，避免底部自动滚动抢回视口。
    setUserScrolled(true);

    const targetAgent = getThinkingTargetAgentType(agentType);
    const target = container.querySelector<HTMLElement>(
      `[data-agent-thinking="${escapeDataAttributeValue(targetAgent)}"]`,
    );
    if (!target) return;

    requestAnimationFrame(() => {
      const containerRect = container.getBoundingClientRect();
      const targetRect = target.getBoundingClientRect();
      const nextTop =
        container.scrollTop +
        targetRect.top -
        containerRect.top -
        container.clientHeight / 2 +
        targetRect.height / 2;

      container.scrollTo({ top: Math.max(0, nextTop), behavior: "smooth" });
    });
  }, []);

  /** 运行中的 Agent 指示行，点击后定位到对应过程卡片。 */
  const activityBar =
    activeAgents.length > 0 ? (
      <div className="conversation-activity">
        <span className="conversation-activity-dot" aria-hidden="true" />
        <span>{activeAgents.length > 1 ? "并行思考：" : "正在思考："}</span>
        {activeAgents.map((agentType) => (
          <Button
            key={agentType}
            size="small"
            type="link"
            className="h-auto! px-0!"
            onClick={() => scrollToActiveThinking(agentType)}
          >
            {getAgentLabel(agentType)}
          </Button>
        ))}
      </div>
    ) : null;

  const messageList = (
    <>
      {activityBar}

      {showMessagesLoading && (
        <div className="chat-welcome chat-welcome-skeleton">
          <div className="flex w-full justify-end">
            <div className="w-[46%]">
              <Skeleton active />
            </div>
          </div>
          <div className="flex w-full justify-start">
            <div className="w-[78%]">
              <Skeleton active />
            </div>
          </div>
          <div className="flex w-full justify-end">
            <div className="w-[46%]">
              <Skeleton active />
            </div>
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
          submittedFormIds={submittedFormIds}
          onFormSubmitted={handleFormSubmitted}
          renderInteractiveHitl={renderInteractiveHitl}
          onRetry={handleRetryMessage}
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
    </>
  );

  /**
   * 待回答的 HITL 表单。
   *
   * 运行时暂停等待补充信息时，表单替换输入框占据底部；用户答完提交后输入框
   * 自动恢复，这样不会出现"既要回答又要打字"的双重入口。
   */
  const composer = pendingForm ? (
    <QuestionFormView
      form={pendingForm.form}
      interactive
      onSubmit={(text, answers) => {
        handleFormSubmitted(
          pendingForm.form.id,
          text,
          pendingForm.threadId
            ? formatHumanInTheLoopResume(
                pendingForm.threadId,
                pendingForm.form,
                answers,
                text,
              )
            : undefined,
        );
      }}
    />
  ) : (
    <ConversationComposer
      value={input}
      onChange={setInput}
      onSubmit={doSubmit}
      isLoading={isLoading}
      disabledReason={disabledReason}
      placeholder={
        isEmptyConversation ? "输入需求，让问渠帮你推进项目..." : undefined
      }
      webSearchEnabled={webSearchEnabled}
      onToggleWebSearch={() => setWebSearchEnabled((enabled) => !enabled)}
      knowledgeGraphEnabled={Boolean(workspaceId)}
      knowledgeGraphLoading={kgLoading}
      knowledgeGraphHint={
        kgLoading
          ? "正在加载知识图谱"
          : kgData?.hasData === false
            ? "暂无知识图谱数据"
            : "查看知识图谱"
      }
      onOpenKnowledgeGraph={handleOpenKgModal}
      onOpenLangGraph={() => setLangGraphModalOpen(true)}
      modelProfiles={modelProfiles}
      selectedModelProfileId={selectedModelProfileId}
      onModelProfileChange={onModelProfileChange}
      onStop={onStop}
    />
  );

  /** 空会话的欢迎区：只保留标题与一行说明。 */
  const welcome = (
    <header className="conversation-welcome">
      <h1>今天想推进什么？</h1>
      <p>从需求、规划、文档或风险开始。</p>
    </header>
  );

  /** 空会话的快捷任务：2 × 2 网格，点击沿用原有发送路径。 */
  const quickActions = (
    <section className="quick-actions" aria-label="常用任务">
      <h2>常用任务</h2>
      <div className="quick-actions-grid">
        {EXAMPLE_QUERIES.map((action) => (
          <button
            key={action.label}
            type="button"
            className="quick-action"
            disabled={isLoading || Boolean(disabledReason)}
            onClick={() => handleExampleClick(action.label)}
          >
            <span className="quick-action-label">{action.label}</span>
            <span className="quick-action-hint">{action.hint}</span>
          </button>
        ))}
      </div>
    </section>
  );

  const conversation = (
    <ConversationPane
      workspaceName={workspaceName}
      threadTitle={threadTitle}
      scrollRef={containerRef}
      onScroll={handleScroll}
      messageNavigation={messageNavigation}
      onBack={onBack}
      showScrollToBottom={userScrolled}
      onScrollToBottom={() => {
        scrollToBottom();
        setUserScrolled(false);
      }}
      empty={isEmptyConversation}
      welcome={welcome}
      quickActions={quickActions}
      composer={composer}
    >
      {messageList}
    </ConversationPane>
  );

  return (
    <>
      {conversation}

      <KnowledgeGraphModal
        open={kgModalOpen}
        nodes={kgData?.nodes ?? []}
        relations={kgData?.relations ?? []}
        markdown={kgData?.markdown ?? ""}
        workspaceId={workspaceId ?? ""}
        onClose={() => setKgModalOpen(false)}
      />
      <LangGraphModal
        open={langGraphModalOpen}
        runtimeState={langGraphRuntimeState}
        onClose={() => setLangGraphModalOpen(false)}
      />
    </>
  );
}

const AGENT_LABELS: Record<string, string> = {
  conversation: "Conversation Agent",
  conversation_confirmation: "Conversation Agent",
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

/**
 * 将当前运行中的 Agent 类型转换为可读名称。
 */
function getAgentLabel(agentType: string): string {
  return AGENT_LABELS[agentType] ?? `${agentType} Agent`;
}

/**
 * 转义 data attribute 查询值，保证 Agent 类型变化后仍能稳定定位卡片。
 */
function escapeDataAttributeValue(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

/**
 * 将内部确认阶段映射回实际渲染的思考卡片锚点。
 */
function getThinkingTargetAgentType(agentType: string): string {
  if (agentType === "conversation_confirmation") return "conversation";
  return agentType;
}

/**
 * 从最新助手消息中查找当前正在思考的 Agent。
 */
function findActiveAgents(messages: Message[]): string[] {
  for (let index = messages.length - 1; index >= 0; index--) {
    const message = messages[index];
    if (message?.role === "agent") {
      const activeAgents = message.activeAgents?.length
        ? message.activeAgents
        : message.activeAgent
          ? [message.activeAgent]
          : [];
      if (activeAgents.length > 0) {
        return [...new Set(activeAgents)];
      }
    }
  }
  return [];
}

const LANGGRAPH_NODE_IDS = [
  "START",
  "parse_user_input",
  "request_agent",
  "orchestrator_agent",
  "planner_agent",
  "executor_router",
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
  "executor_aggregator",
  "END",
];

const LANGGRAPH_EXECUTOR_NODE_IDS = LANGGRAPH_NODE_IDS.filter((nodeId) =>
  nodeId.startsWith("executor-"),
);

const AGENT_TO_LANGGRAPH_NODE: Record<string, string> = {
  request: "request_agent",
  orchestrator: "orchestrator_agent",
  planner: "planner_agent",
  critique: "orchestrator_agent",
  product_director: "orchestrator_agent",
  "executor-product-strategy": "executor-product-strategy",
  "executor-market-research": "executor-market-research",
  "executor-gtm": "executor-gtm",
  "executor-product-discovery": "executor-product-discovery",
  "executor-product-execution": "executor-product-execution",
  "executor-marketing-growth": "executor-marketing-growth",
  "executor-data-analytics": "executor-data-analytics",
  "executor-ai-shipping": "executor-ai-shipping",
  "executor-toolkit": "executor-toolkit",
  "executor-interface-craft": "executor-interface-craft",
};

/**
 * 根据当前聊天消息恢复 LangGraph 固定骨架的可视运行状态。
 */
function buildLangGraphRuntimeState(
  messages: Message[],
  activeAgents: string[],
): LangGraphRuntimeState {
  const nodeStatuses = Object.fromEntries(
    LANGGRAPH_NODE_IDS.map((nodeId) => [nodeId, "pending"]),
  ) as Record<string, LangGraphRuntimeStatus>;
  const workflowMessage = findLatestWorkflowMessage(messages);

  if (!workflowMessage) {
    return { nodeStatuses, activeAgents };
  }

  nodeStatuses.START = "completed";

  if (workflowMessage.userInput?.state === "complete") {
    nodeStatuses.parse_user_input = "completed";
  }

  if (workflowMessage.requestAnalysis?.state === "complete") {
    nodeStatuses.request_agent = "completed";
  }

  if (
    workflowMessage.reasoningBlocks?.some(
      (block) => block.agentType === "orchestrator",
    ) ||
    workflowMessage.plannerExecution ||
    workflowMessage.executorResults?.length ||
    workflowMessage.plannerReview ||
    workflowMessage.workflowCompletion
  ) {
    nodeStatuses.orchestrator_agent = "completed";
  }

  const plannedExecutors = new Set(
    workflowMessage.plannerExecution?.plan.tasks.map(
      (task) => task.assigned_agent,
    ) ?? [],
  );

  if (workflowMessage.plannerExecution) {
    nodeStatuses.planner_agent = "completed";
    nodeStatuses.executor_router = "completed";
    for (const executorNodeId of LANGGRAPH_EXECUTOR_NODE_IDS) {
      if (!plannedExecutors.has(executorNodeId)) {
        nodeStatuses[executorNodeId] = "skipped";
      }
    }
  }

  for (const result of workflowMessage.executorResults ?? []) {
    nodeStatuses[result.agent_type] = "completed";
  }

  if ((workflowMessage.executorResults?.length ?? 0) > 0) {
    nodeStatuses.executor_aggregator = "completed";
  }

  if (workflowMessage.plannerReview?.state === "complete") {
    nodeStatuses.planner_agent = "completed";
  }

  if (workflowMessage.workflowCompletion) {
    nodeStatuses.END = "completed";
  }

  for (const agentType of activeAgents) {
    const nodeId = AGENT_TO_LANGGRAPH_NODE[agentType];
    if (nodeId) {
      nodeStatuses[nodeId] = "running";
    }
  }

  return { nodeStatuses, activeAgents };
}

/**
 * 找到最近一条携带产品工作流结构状态的 assistant 消息。
 */
function findLatestWorkflowMessage(messages: Message[]): Message | null {
  for (let index = messages.length - 1; index >= 0; index--) {
    const message = messages[index];
    if (
      message?.role === "agent" &&
      (message.userInput ||
        message.requestAnalysis ||
        message.plannerExecution ||
        message.executorResults?.length ||
        message.plannerReview ||
        message.workflowCompletion ||
        message.activeAgent ||
        message.activeAgents?.length)
    ) {
      return message;
    }
  }

  return null;
}
