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
import {
  fetchProductKnowledgeGraph,
  type WorkspaceKnowledgeGraphData,
} from "../api/chat-api";
import { MessageBubble } from "./MessageBubble";
import { ConversationPane } from "./shell/ConversationPane";
import { ConversationComposer } from "./shell/ConversationComposer";
import { useMessageNavigation } from "../hooks/useMessageNavigation";
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
}

const EXAMPLE_QUERIES = [
  "帮我梳理这个产品的核心需求",
  "为当前项目拆一版 MVP 计划",
  "生成一份迭代风险清单",
  "把今天的讨论整理成待办事项",
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
}: Props) {
  const [input, setInput] = useState("");
  const [webSearchEnabled, setWebSearchEnabled] = useState(false);
  const [userScrolled, setUserScrolled] = useState(false);
  const [langGraphModalOpen, setLangGraphModalOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // 知识图谱弹窗数据；进入工作区不主动加载，仅在需要时读取。
  const [kgData, setKgData] = useState<WorkspaceKnowledgeGraphData | null>(
    null,
  );
  const [kgLoading, setKgLoading] = useState(false);
  const [kgModalOpen, setKgModalOpen] = useState(false);
  const executorResultRefreshKey = useMemo(
    () =>
      messages
        .flatMap((message) => message.executorResults ?? [])
        .map((result) => result.task_id)
        .sort()
        .join("|"),
    [messages],
  );

  // 工作区切换时仅清理本地缓存，避免进入工作区就触发知识图谱加载。
  useEffect(() => {
    setKgData(null);
    setKgModalOpen(false);
  }, [workspaceId]);

  const loadKnowledgeGraph = useCallback(async () => {
    if (!workspaceId) return null;

    setKgLoading(true);
    try {
      const data = await fetchProductKnowledgeGraph(workspaceId);
      setKgData(data);
      return data;
    } catch (error) {
      console.error("[kg] Failed to load knowledge graph:", error);
      setKgData(null);
      return null;
    } finally {
      setKgLoading(false);
    }
  }, [workspaceId]);

  // 每个 Executor 结果流入前端时，API 已完成对应知识图谱归档，此时刷新缓存。
  useEffect(() => {
    if (!workspaceId || !executorResultRefreshKey) return;

    let cancelled = false;
    setKgLoading(true);

    fetchProductKnowledgeGraph(workspaceId)
      .then((data) => {
        if (cancelled) return;
        setKgData(data);
      })
      .catch((error) => {
        if (cancelled) return;
        console.error("[kg] Failed to refresh knowledge graph:", error);
      })
      .finally(() => {
        if (!cancelled) setKgLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [executorResultRefreshKey, workspaceId]);

  /** 打开知识图谱可视化弹窗，无数据时给出明确提示。 */
  const handleOpenKgModal = useCallback(async () => {
    if (!workspaceId || kgLoading) return;

    const data = kgData ?? (await loadKnowledgeGraph());
    if (data?.hasData) {
      setKgModalOpen(true);
      return;
    }

    void message.info("当前工作区暂无可查看的知识图谱数据");
  }, [kgData, kgLoading, loadKnowledgeGraph, workspaceId]);

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

  // MessageBubble 使用 React.memo：传给它的回调必须在多次渲染间保持同一引用，
  // 最新状态统一经 ref 读取，避免 memo 命中时使用过期的闭包值。
  const onSendRef = useRef(onSend);
  const webSearchEnabledRef = useRef(webSearchEnabled);
  const retryAssistantMessageRef = useRef(retryAssistantMessage);

  useEffect(() => {
    onSendRef.current = onSend;
  }, [onSend]);
  useEffect(() => {
    webSearchEnabledRef.current = webSearchEnabled;
  }, [webSearchEnabled]);
  useEffect(() => {
    retryAssistantMessageRef.current = retryAssistantMessage;
  }, [retryAssistantMessage]);

  const handleSendFormAnswer = useCallback(
    (text: string, hitlResume?: HumanInTheLoopResume) => {
      onSendRef.current(text, {
        webSearchEnabled: webSearchEnabledRef.current,
        hitlResume,
      });
    },
    [],
  );

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

      {/* 空会话把标题、推荐任务与输入提示收在同一个容器里，避免首屏被拆散。 */}
      {showWelcome && (
        <div className="chat-welcome">
          <header className="chat-welcome-head">
            <h1>今天想推进什么？</h1>
            <p>围绕需求、计划、文档和风险继续推进项目。</p>
          </header>
          <div className="chat-suggestions">
            {EXAMPLE_QUERIES.map((query) => (
              <button
                key={query}
                type="button"
                disabled={isLoading || Boolean(disabledReason)}
                onClick={() => handleExampleClick(query)}
              >
                <span className="chat-suggestion-label">{query}</span>
              </button>
            ))}
          </div>
        </div>
      )}

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
          onFormSubmit={handleSendFormAnswer}
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

  const composer = (
    <ConversationComposer
      value={input}
      onChange={setInput}
      onSubmit={doSubmit}
      isLoading={isLoading}
      disabledReason={disabledReason}
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
