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
import {
  Button,
  Dropdown,
  FloatButton,
  Input,
  Skeleton,
  Splitter,
  Tooltip,
  message,
} from "antd";
import BorderBeam from "antd/es/border-beam";
import {
  ApartmentOutlined,
  ArrowDownOutlined,
  ArrowLeftOutlined,
  CaretRightOutlined,
  ClearOutlined,
  DownOutlined,
  PaperClipOutlined,
  PartitionOutlined,
  SearchOutlined,
  SendOutlined,
  StopOutlined,
} from "@ant-design/icons";
import type { HumanInTheLoopResume, Message, TokenUsageInfo } from "../types";
import {
  fetchProductKnowledgeGraph,
  type WorkspaceKnowledgeGraphData,
} from "../api/chat-api";
import { MessageBubble } from "./MessageBubble";
import { KnowledgeGraphModal } from "./modals/KnowledgeGraphModal";
import {
  LangGraphModal,
  type LangGraphRuntimeState,
  type LangGraphRuntimeStatus,
} from "./modals/LangGraphModal";
import { SPLIT_COLLAPSED_KEY, SPLIT_SIZES_KEY } from "../constants/app";
import {
  aggregateTokenUsages,
  formatCost,
  formatTokens,
  formatDuration,
} from "../utils/token-usage";

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
  const [processUserScrolled, setProcessUserScrolled] = useState(false);
  const [isNarrowLayout, setIsNarrowLayout] = useState(false);
  const [splitSizes, setSplitSizes] = useState<string[]>(() => {
    try {
      const raw = localStorage.getItem(SPLIT_SIZES_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as string[];
        if (
          Array.isArray(parsed) &&
          parsed.length === 2 &&
          parsed.every((v) => typeof v === "string" && v.endsWith("%"))
        ) {
          return parsed;
        }
      }
    } catch {
      // 缓存数据异常时使用默认比例。
    }
    return ["50%", "50%"];
  });
  const [langGraphModalOpen, setLangGraphModalOpen] = useState(false);
  const [tokenDetailOpen, setTokenDetailOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const processContainerRef = useRef<HTMLDivElement>(null);

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

  // 从历史消息中归档过的 token 用量，供右侧过程栏顶部汇总。
  const tokenUsages = useMemo(
    () => aggregateTokenUsages(messages),
    [messages],
  );

  // 右侧过程栏顶部 Token 用量汇总行。
  const tokenTotalTokens = tokenUsages.reduce(
    (sum, u) => sum + u.totalTokens,
    0,
  );
  const tokenTotalCost = tokenUsages.reduce(
    (sum, u) => sum + u.costTotal,
    0,
  );

  // 持久化分栏比例，保证切换对话后左右栏宽度与上次一致。
  const handleSplitResize = useCallback((sizes: number[]) => {
    const percentSizes = sizes.map((v) => `${v}%`);
    setSplitSizes(percentSizes);
    try {
      localStorage.setItem(SPLIT_SIZES_KEY, JSON.stringify(percentSizes));
    } catch {
      // 忽略存储异常。
    }
  }, []);

  // 持久化右侧过程栏展开/折叠状态（当前 antd Panel 不支持 controlled collapsed，
  // 仅保存供将来恢复或状态追踪使用）。
  const handleSplitCollapse = useCallback(
    (collapsed: boolean[]) => {
      const processCollapsed = collapsed.length > 1 ? collapsed[1] : false;
      try {
        localStorage.setItem(SPLIT_COLLAPSED_KEY, String(processCollapsed));
      } catch {
        // 忽略存储异常。
      }
    },
    [],
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
  const handleOpenKgModal = useCallback(async () => {
    if (!workspaceId || kgLoading) return;

    const data = kgData ?? (await loadKnowledgeGraph());
    if (data?.hasData) {
      setKgModalOpen(true);
      return;
    }

    void message.info("当前工作区暂无可查看的知识图谱数据");
  }, [kgData, kgLoading, loadKnowledgeGraph, workspaceId]);

  // 按钮是否可用
  const kgEnabled = Boolean(workspaceId);
  const useSplitLayout = messages.length > 0;
  const splitterOrientation = isNarrowLayout ? "vertical" : "horizontal";
  const hasProcessContent =
    messages.some(hasAgentProcessContent) || tokenUsages.length > 0;

  useEffect(() => {
    const media = window.matchMedia("(max-width: 900px)");
    const syncLayout = () => setIsNarrowLayout(media.matches);

    // 根据视口宽度切换分栏方向，避免窄屏左右栏互相挤压。
    syncLayout();
    media.addEventListener("change", syncLayout);
    return () => media.removeEventListener("change", syncLayout);
  }, []);

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

  const isProcessAtBottom = useCallback(() => {
    const el = processContainerRef.current;
    if (!el) return true;
    return el.scrollHeight - el.scrollTop - el.clientHeight < 40;
  }, []);

  const scrollProcessToBottom = useCallback(() => {
    if (processContainerRef.current) {
      processContainerRef.current.scrollTop =
        processContainerRef.current.scrollHeight;
    }
  }, []);

  useEffect(() => {
    if (!userScrolled) {
      scrollToBottom();
    }
  }, [messages, userScrolled, scrollToBottom]);

  useEffect(() => {
    if (useSplitLayout && !processUserScrolled) {
      scrollProcessToBottom();
    }
  }, [messages, processUserScrolled, scrollProcessToBottom, useSplitLayout]);

  useEffect(() => {
    if (!useSplitLayout) return;

    // 分栏刚出现时把两侧都贴到底部，保证过渡后看到最新上下文。
    setUserScrolled(false);
    setProcessUserScrolled(false);
    requestAnimationFrame(() => {
      scrollToBottom();
      scrollProcessToBottom();
    });
  }, [scrollProcessToBottom, scrollToBottom, useSplitLayout]);

  const handleScroll = useCallback(() => {
    setUserScrolled(!isAtBottom());
  }, [isAtBottom]);

  const handleProcessScroll = useCallback(() => {
    setProcessUserScrolled(!isProcessAtBottom());
  }, [isProcessAtBottom]);

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

      for (let cursor = index - 1; cursor >= 0; cursor--) {
        const previous = messages[cursor];
        if (previous?.role === "user" && previous.content.trim()) {
          onSend(previous.content.trim(), { webSearchEnabled });
          setUserScrolled(false);
          setProcessUserScrolled(false);
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
    setProcessUserScrolled(false);
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
    setProcessUserScrolled(false);
  };

  const scrollToActiveThinking = useCallback(
    (agentType: string) => {
      const container =
        (useSplitLayout ? processContainerRef.current : containerRef.current) ??
        containerRef.current;
      if (!container) return;

      // 先退出自动贴底模式，再在下一帧计算目标位置，避免底部自动滚动抢回视口。
      if (useSplitLayout) {
        setProcessUserScrolled(true);
      } else {
        setUserScrolled(true);
      }

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
    },
    [useSplitLayout],
  );

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
              <span>
                {activeAgents.length > 1 ? "并行思考：" : "正在思考："}
              </span>
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

      <div
        className={`chat-canvas ${useSplitLayout ? "is-split" : "is-single"}`}
      >
        {useSplitLayout && (
          <Splitter
            key={splitterOrientation}
            className="chat-splitter"
            orientation={splitterOrientation}
            onResize={handleSplitResize}
            onCollapse={handleSplitCollapse}
          >
            <Splitter.Panel
              defaultSize={splitSizes[0]}
              min={isNarrowLayout ? 260 : 320}
              className="chat-split-main-panel"
            >
              <div className="chat-main-column is-split">
                <div
                  ref={containerRef}
                  onScroll={handleScroll}
                  className="chat-scroll scrollbar-none items-center"
                >
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
                      viewMode="main"
                      nextUserContent={nextUserContentByAssistantId.get(
                        message.id,
                      )}
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
                          title={
                            webSearchEnabled ? "联网搜索已开启" : "开启联网搜索"
                          }
                        >
                          <Button
                            type={webSearchEnabled ? "primary" : "text"}
                            shape="circle"
                            icon={<SearchOutlined />}
                            aria-label="联网搜索"
                            aria-pressed={webSearchEnabled}
                            disabled={isLoading || Boolean(disabledReason)}
                            onClick={() =>
                              setWebSearchEnabled((enabled) => !enabled)
                            }
                          />
                        </Tooltip>
                        <Tooltip
                          title={
                            kgLoading
                              ? "正在加载知识图谱"
                              : kgData?.hasData === false
                                ? "暂无知识图谱数据"
                                : "查看知识图谱"
                          }
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
                                disabled={
                                  !input.trim() || Boolean(disabledReason)
                                }
                              />
                            </Tooltip>
                          )}
                        </div>
                      </div>
                    </form>
                  </div>
                </BorderBeam>
              </div>
            </Splitter.Panel>

            <Splitter.Panel
              collapsible
              defaultSize={splitSizes[1]}
              min={isNarrowLayout ? 240 : 300}
              className="chat-split-process-panel"
            >
              <div className="chat-process-column">
                <div
                  ref={processContainerRef}
                  onScroll={handleProcessScroll}
                  className="chat-process-scroll themed-scrollbar"
                >
                  {tokenUsages.length > 0 && (
                    <div className="mb-3 rounded-lg border border-[var(--line-soft)] bg-white">
                      <button
                        type="button"
                        className="flex w-full cursor-pointer items-center gap-2 border-0 bg-transparent px-3 py-2.5 text-left"
                        onClick={() => setTokenDetailOpen(!tokenDetailOpen)}
                      >
                        <CaretRightOutlined
                          style={{
                            fontSize: 10,
                            transition: "transform 0.2s",
                            transform: tokenDetailOpen
                              ? "rotate(90deg)"
                              : "rotate(0deg)",
                            color: "var(--primary)",
                          }}
                        />
                        <span className="text-[13px] font-extrabold text-[var(--ink)]">
                          Token 用量
                        </span>
                        <span className="ml-auto text-[12px] text-[var(--ink-mute)]">
                          {formatCost(tokenTotalCost)} yuan
                        </span>
                        <span className="text-[12px] text-[var(--ink-faint)]">
                          {formatTokens(tokenTotalTokens)}
                        </span>
                      </button>
                      {tokenDetailOpen && tokenUsages.length > 1 && (
                        <div className="border-t border-[var(--line-soft)] px-3 pb-2.5 pt-2">
                          <div className="grid grid-cols-[minmax(100px,1fr)_auto_auto_auto] gap-x-2 gap-y-0.5 text-[10px] leading-5 text-[var(--ink-faint)]">
                            <span className="font-semibold">Agent</span>
                            <span className="text-right font-semibold">
                              输入
                            </span>
                            <span className="text-right font-semibold">
                              输出
                            </span>
                            <span className="text-right font-semibold">
                              费用
                            </span>
                            {tokenUsages.map((usage, idx) => (
                              <TokenUsageMiniRow
                                key={
                                  usage.id ??
                                  `${usage.agentType}-${idx}`
                                }
                                usage={usage}
                              />
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  )}

                  {!hasProcessContent && (
                    <div className="chat-process-empty">等待 Agent 过程</div>
                  )}

                  {messages.map((message, index) => (
                    <MessageBubble
                      key={`${message.id}-process`}
                      message={message}
                      isLast={index === lastAgentIdx}
                      streaming={
                        isLoading &&
                        index === messages.length - 1 &&
                        message.role === "agent"
                      }
                      viewMode="process"
                    />
                  ))}
                </div>
              </div>
            </Splitter.Panel>
          </Splitter>
        )}

        {!useSplitLayout && (
          <>
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
                      title={
                        webSearchEnabled ? "联网搜索已开启" : "开启联网搜索"
                      }
                    >
                      <Button
                        type={webSearchEnabled ? "primary" : "text"}
                        shape="circle"
                        icon={<SearchOutlined />}
                        aria-label="联网搜索"
                        aria-pressed={webSearchEnabled}
                        disabled={isLoading || Boolean(disabledReason)}
                        onClick={() =>
                          setWebSearchEnabled((enabled) => !enabled)
                        }
                      />
                    </Tooltip>
                    <Tooltip
                      title={
                        kgLoading
                          ? "正在加载知识图谱"
                          : kgData?.hasData === false
                            ? "暂无知识图谱数据"
                            : "查看知识图谱"
                      }
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
          </>
        )}
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
        runtimeState={langGraphRuntimeState}
        onClose={() => setLangGraphModalOpen(false)}
      />
    </div>
  );
}

/**
 * 右侧过程栏顶部 Token 用量明细行（紧凑版）。
 */
function TokenUsageMiniRow({ usage }: { usage: TokenUsageInfo }) {
  const parallelOthers = (usage.parallelAgents ?? []).filter(
    (a) => a !== usage.agentType,
  );

  return (
    <>
      <span className="flex min-w-0 items-center gap-1 truncate text-[var(--ink-mute)]">
        {parallelOthers.length > 0 && (
          <Tooltip
            title={`与 ${parallelOthers
              .map(getAgentLabel)
              .join("、")} 并行执行`}
          >
            <PartitionOutlined className="shrink-0 cursor-help text-[var(--primary)]" />
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

/**
 * 判断消息是否包含需要放入过程栏展示的 Agent 推理或工具调用。
 */
function hasAgentProcessContent(message: Message): boolean {
  return (
    message.role === "agent" &&
    Boolean(
      message.thinking ||
      message.reasoningBlocks?.length ||
      message.toolCalls?.length,
    )
  );
}

const LANGGRAPH_NODE_IDS = [
  "START",
  "parse_user_input",
  "request_agent",
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
  planner: "planner_agent",
  product_director: "planner_agent",
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
