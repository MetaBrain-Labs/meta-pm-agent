/**
 * 聊天工作区主视图
 *
 * 负责渲染单个工作区内的聊天消息、输入框、工具入口和工作流辅助弹窗。
 * 页面级数据读写由 ThreadChatPage 和 API 模块提供，本组件只管理浏览器侧交互状态。
 *
 * Responsibilities:
 * - 展示聊天消息流、输入框、停止生成和重试入口
 * - 管理知识图谱与 LangGraph 可视化弹窗
 * - 维护自动滚动、联网搜索开关和当前 Agent 定位行为
 *
 * Notes:
 * - 不直接持久化聊天历史；权威数据通过 API 恢复。
 */

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
} from "react";
import { Button, Dropdown, FloatButton, Input, Skeleton, Tooltip } from "antd";
import BorderBeam from "antd/es/border-beam";
import {
  ApartmentOutlined,
  ArrowDownOutlined,
  ArrowLeftOutlined,
  ClearOutlined,
  DownOutlined,
  PaperClipOutlined,
  PartitionOutlined,
  SearchOutlined,
  SendOutlined,
  StopOutlined,
} from "@ant-design/icons";
import type { HumanInTheLoopResume, Message } from "../types";
import {
  fetchProductKnowledgeGraph,
  type WorkspaceKnowledgeGraphData,
} from "../api/chat-api";
import { MessageBubble } from "./MessageBubble";
import { KnowledgeGraphModal } from "./modals/KnowledgeGraphModal";
import { LangGraphModal } from "./modals/LangGraphModal";

const { TextArea } = Input;

const EXAMPLE_QUERIES = [
  "帮我梳理这个产品的核心需求",
  "为当前项目拆一版 MVP 计划",
  "生成一份迭代风险清单",
  "把今天的讨论整理成待办事项",
];

const ACTIVE_MODEL = "DeepSeek V4 Pro";

interface Props {
  workspaceId: string | null;
  workspaceName: string;
  messages: Message[];
  isLoading: boolean;
  isMessagesLoading: boolean;
  error: string | null;
  disabledReason?: string | null;
  onSend: (
    text: string,
    options?: {
      webSearchEnabled?: boolean;
      hitlResume?: HumanInTheLoopResume;
    },
  ) => void;
  onStop: () => void;
  onClear: () => void;
  onBack: () => void;
}

export function ChatApp({
  workspaceId,
  workspaceName,
  messages,
  isLoading,
  isMessagesLoading,
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
  const [langGraphModalOpen, setLangGraphModalOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // 知识图谱下载状态
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

  // 工作区切换时查询知识图谱数据
  useEffect(() => {
    if (!workspaceId) {
      setKgData(null);
      return;
    }

    let cancelled = false;
    setKgLoading(true);

    fetchProductKnowledgeGraph(workspaceId)
      .then((data) => {
        if (cancelled) return;
        setKgData(data);
      })
      .catch((error) => {
        if (cancelled) return;
        console.error("[kg] Failed to load knowledge graph:", error);
        setKgData(null);
      })
      .finally(() => {
        if (!cancelled) setKgLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [workspaceId]);

  // 每个 Executor 结果流入前端时，API 已完成对应知识图谱归档，此时刷新按钮可用状态。
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

  // 打开知识图谱可视化弹窗
  const handleOpenKgModal = useCallback(() => {
    setKgModalOpen(true);
  }, []);

  // 按钮是否可用
  const kgEnabled = kgData?.hasData === true;

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
  const activeAgents = isLoading ? findActiveAgents(messages) : [];

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
        <div className="ml-auto flex min-w-0 items-center gap-2">
          <Tooltip title="查看 LangGraph">
            <Button
              type="text"
              shape="circle"
              icon={<PartitionOutlined />}
              onClick={() => setLangGraphModalOpen(true)}
            />
          </Tooltip>
          {activeAgents.length > 0 && (
            <div className="flex min-w-0 flex-wrap items-center gap-2 rounded-md border border-[var(--line-soft)] bg-white px-2.5 py-1 text-[12px] text-[var(--ink-soft)]">
              <span className="h-1.5 w-1.5 rounded-full bg-[var(--primary)]" />
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
          )}
        </div>
      </div>

      <div className="chat-canvas">
        <div
          ref={containerRef}
          onScroll={handleScroll}
          className="chat-scroll scrollbar-none items-center"
        >
          {messages.length === 0 && !isMessagesLoading && (
            <div className="flex flex-col w-full items-center justify-center gap-8">
              <span className="font-bold text-2xl">今天想推进什么？</span>
              <span className="font-bold text-[#3e3e3e]">
                围绕需求、计划、文档和风险继续推进项目。
              </span>
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

          {isMessagesLoading && messages.length === 0 && (
            <div className="flex flex-col w-full min-h-[70vh] items-center justify-center gap-8">
              <div className="flex w-full justify-end">
                <div className="w-[40%]">
                  <Skeleton active />
                </div>
              </div>

              <div className="flex w-full justify-start">
                <div className="w-[60%]">
                  <Skeleton active />
                </div>
              </div>

              <div className="flex w-full justify-end">
                <div className="w-[40%]">
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
              onFormSubmit={(text, hitlResume) =>
                onSend(text, { webSearchEnabled, hitlResume })
              }
              onRetry={() => retryAssistantMessage(message.id)}
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
          className={`scroll-to-bottom w-8! h-8! bg-[#3078b8]! ${userScrolled ? "is-visible" : ""}`}
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
                  title={webSearchEnabled ? "联网搜索已开启" : "开启联网搜索"}
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
                <Tooltip
                  title={kgEnabled ? "查看知识图谱" : "暂无知识图谱数据"}
                >
                  <Button
                    type="text"
                    shape="circle"
                    icon={<ApartmentOutlined />}
                    disabled={!kgEnabled}
                    loading={kgLoading}
                    onClick={handleOpenKgModal}
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
        onClose={() => setLangGraphModalOpen(false)}
      />
    </div>
  );
}

const AGENT_LABELS: Record<string, string> = {
  conversation: "Conversation Agent",
  conversation_confirmation: "Conversation Agent",
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
