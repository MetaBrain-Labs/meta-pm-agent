/**
 * LangGraph 主图可视化弹窗
 *
 * 使用 AntV G6 渲染当前 agent-runtime 的固定 LangGraph 骨架，帮助用户在页面内查看
 * Conversation / Request / Planner / Executor Router / Executor Pool / Aggregator 的连接关系。
 * 图中只展示架构级节点和条件边，不承载单次 Planner 生成的任务 DAG。
 *
 * Responsibilities:
 * - 定义前端只读 LangGraph 架构图数据
 * - 初始化、渲染和销毁 G6 图实例
 * - 提供节点详情、图例和 PNG 下载入口
 *
 * Notes:
 * - 运行时动态行为由 Router 条件边和 Executor 节点内部任务选择完成，前端仅展示当前固定骨架。
 */

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FC,
} from "react";
import { Button, Modal, Space, Tag, Tooltip, Typography, message } from "antd";
import {
  CameraOutlined,
  CloseOutlined,
  ReloadOutlined,
} from "@ant-design/icons";
import { Graph } from "@antv/g6";

interface Props {
  open: boolean;
  onClose: () => void;
  runtimeState?: LangGraphRuntimeState;
}

/**
 * LangGraph 固定骨架节点在当前会话轮次中的可视运行状态。
 */
export type LangGraphRuntimeStatus =
  | "completed"
  | "running"
  | "pending"
  | "skipped";

/**
 * LangGraph 弹窗接收的运行态快照。
 */
export interface LangGraphRuntimeState {
  nodeStatuses: Record<string, LangGraphRuntimeStatus>;
  activeAgents: string[];
}

type LangGraphNodeType =
  | "entry"
  | "agent"
  | "router"
  | "executor"
  | "aggregator"
  | "end";

interface LangGraphNode {
  id: string;
  label: string;
  type: LangGraphNodeType;
  description: string;
}

interface LangGraphEdge {
  id: string;
  source: string;
  target: string;
  label: string;
  kind: "static" | "conditional" | "loop";
}

const NODE_COLORS: Record<LangGraphNodeType, string> = {
  entry: "#64748b",
  agent: "#115eab",
  router: "#d97706",
  executor: "#7c3aed",
  aggregator: "#059669",
  end: "#334155",
};

const NODE_TYPE_LABELS: Record<LangGraphNodeType, string> = {
  entry: "入口",
  agent: "固定 Agent",
  router: "Router",
  executor: "Executor Pool",
  aggregator: "Aggregator",
  end: "结束",
};

const RUNTIME_STATUS_COLORS: Record<LangGraphRuntimeStatus, string> = {
  completed: "#16a34a",
  running: "#2563eb",
  pending: "#94a3b8",
  skipped: "#cbd5e1",
};

const RUNTIME_STATUS_LABELS: Record<LangGraphRuntimeStatus, string> = {
  completed: "已运行",
  running: "运行中",
  pending: "未运行",
  skipped: "忽略运行",
};

const MAX_RENDER_RETRIES = 30;
const RENDER_RETRY_INTERVAL = 100;

const LANGGRAPH_NODES: LangGraphNode[] = [
  {
    id: "START",
    label: "Entry",
    type: "entry",
    description: "LangGraph START，进入产品工作流主图。",
  },
  {
    id: "parse_user_input",
    label: "Parse User Input",
    type: "agent",
    description: "解析 Conversation Agent 输出的 user-input block。",
  },
  {
    id: "request_agent",
    label: "Request Agent",
    type: "agent",
    description: "把用户输入整理成业务建模项，并决定是否进入产品工作流。",
  },
  {
    id: "orchestrator_agent",
    label: "Orchestrator Agent",
    type: "router",
    description: "负责产品意图路由、上下文加载、Planner 子代理委派，并在 Executor 完成后触发 Critique。",
  },
  {
    id: "planner_agent",
    label: "Planner SubAgent Output",
    type: "agent",
    description: "首次进入时生成任务 DAG；Executor 全部完成后交给 Critique Agent 审查。",
  },
  {
    id: "executor_router",
    label: "Executor Router",
    type: "router",
    description: "根据 Planner DAG、已完成任务和最终结果选择下一批 Executor、回到 Planner 或结束。",
  },
  {
    id: "executor-product-strategy",
    label: "Product Strategy",
    type: "executor",
    description: "产品战略 Executor，处理目标、定位和策略层任务。",
  },
  {
    id: "executor-market-research",
    label: "Market Research",
    type: "executor",
    description: "市场研究 Executor，处理竞品、用户和市场证据任务。",
  },
  {
    id: "executor-gtm",
    label: "Go-to-Market",
    type: "executor",
    description: "GTM Executor，处理上市、渠道和商业化任务。",
  },
  {
    id: "executor-product-discovery",
    label: "Product Discovery",
    type: "executor",
    description: "产品发现 Executor，处理问题空间、机会和用户洞察任务。",
  },
  {
    id: "executor-product-execution",
    label: "Product Execution",
    type: "executor",
    description: "产品执行 Executor，处理交付、优先级和落地计划任务。",
  },
  {
    id: "executor-marketing-growth",
    label: "Marketing Growth",
    type: "executor",
    description: "营销增长 Executor，处理增长、转化和传播任务。",
  },
  {
    id: "executor-data-analytics",
    label: "Data Analytics",
    type: "executor",
    description: "数据分析 Executor，处理指标、实验和分析任务。",
  },
  {
    id: "executor-ai-shipping",
    label: "AI Shipping",
    type: "executor",
    description: "AI 交付 Executor，处理 AI 能力、模型和上线任务。",
  },
  {
    id: "executor-toolkit",
    label: "Toolkit",
    type: "executor",
    description: "工具链 Executor，处理工具、流程和自动化任务。",
  },
  {
    id: "executor-interface-craft",
    label: "Interface Craft",
    type: "executor",
    description: "界面体验 Executor，处理交互、界面和体验任务。",
  },
  {
    id: "executor_aggregator",
    label: "Aggregator",
    type: "aggregator",
    description: "汇合同一批 Executor 的状态更新，并发出知识图谱刷新事件。",
  },
  {
    id: "END",
    label: "End",
    type: "end",
    description: "LangGraph END，结束当前工作流。",
  },
];

const EXECUTOR_NODE_IDS = LANGGRAPH_NODES.filter(
  (node) => node.type === "executor",
).map((node) => node.id);

const LANGGRAPH_EDGES: LangGraphEdge[] = [
  {
    id: "start-parse",
    source: "START",
    target: "parse_user_input",
    label: "start",
    kind: "static",
  },
  {
    id: "parse-request",
    source: "parse_user_input",
    target: "request_agent",
    label: "parsed",
    kind: "static",
  },
  {
    id: "request-orchestrator",
    source: "request_agent",
    target: "orchestrator_agent",
    label: "analysis complete",
    kind: "static",
  },
  {
    id: "orchestrator-planner",
    source: "orchestrator_agent",
    target: "planner_agent",
    label: "product workflow",
    kind: "conditional",
  },
  {
    id: "orchestrator-end",
    source: "orchestrator_agent",
    target: "END",
    label: "conversation route",
    kind: "conditional",
  },
  {
    id: "planner-router",
    source: "planner_agent",
    target: "executor_router",
    label: "plan ready",
    kind: "static",
  },
  ...EXECUTOR_NODE_IDS.map((executorId) => ({
    id: `router-${executorId}`,
    source: "executor_router",
    target: executorId,
    label: "ready task",
    kind: "conditional" as const,
  })),
  ...EXECUTOR_NODE_IDS.map((executorId) => ({
    id: `${executorId}-aggregator`,
    source: executorId,
    target: "executor_aggregator",
    label: "result",
    kind: "static" as const,
  })),
  {
    id: "aggregator-router",
    source: "executor_aggregator",
    target: "executor_router",
    label: "next batch",
    kind: "loop",
  },
  {
    id: "router-orchestrator",
    source: "executor_router",
    target: "orchestrator_agent",
    label: "all tasks done",
    kind: "conditional",
  },
  {
    id: "router-end",
    source: "executor_router",
    target: "END",
    label: "workflow result",
    kind: "conditional",
  },
];

/**
 * 将 LangGraph 节点转换为 G6 节点数据。
 */
function toG6Node(
  node: LangGraphNode,
  runtimeState: LangGraphRuntimeState | undefined,
) {
  const runtimeStatus = getRuntimeNodeStatus(node.id, runtimeState);
  return {
    id: node.id,
    data: {
      label: node.label,
      nodeType: node.type,
      description: node.description,
      runtimeStatus,
    },
  };
}

/**
 * 读取节点当前运行状态，默认保持未运行。
 */
function getRuntimeNodeStatus(
  nodeId: string,
  runtimeState: LangGraphRuntimeState | undefined,
): LangGraphRuntimeStatus {
  return runtimeState?.nodeStatuses[nodeId] ?? "pending";
}

/**
 * 将 LangGraph 边转换为 G6 边数据。
 */
function toG6Edge(edge: LangGraphEdge) {
  return {
    id: edge.id,
    source: edge.source,
    target: edge.target,
    data: {
      label: edge.label,
      kind: edge.kind,
    },
  };
}

/**
 * LangGraph 架构图弹窗。
 */
export const LangGraphModal: FC<Props> = ({ open, onClose, runtimeState }) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const graphRef = useRef<Graph | null>(null);
  const resizeObserverRef = useRef<ResizeObserver | null>(null);
  const renderTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [graphReady, setGraphReady] = useState(false);
  const [selectedNode, setSelectedNode] = useState<LangGraphNode | null>(null);

  const nodeById = useMemo(
    () => new Map(LANGGRAPH_NODES.map((node) => [node.id, node])),
    [],
  );

  /**
   * 销毁 G6 实例和尺寸监听，避免弹窗重复打开后残留画布。
   */
  const cleanup = useCallback(() => {
    if (renderTimerRef.current) {
      clearTimeout(renderTimerRef.current);
      renderTimerRef.current = null;
    }
    resizeObserverRef.current?.disconnect();
    resizeObserverRef.current = null;
    if (graphRef.current) {
      try {
        graphRef.current.destroy();
      } catch {
        // 销毁失败不影响弹窗关闭。
      }
      graphRef.current = null;
    }
    if (containerRef.current) {
      containerRef.current.innerHTML = "";
    }
  }, []);

  /**
   * 按当前容器尺寸重新适配视图。
   */
  const fitGraphView = useCallback(async () => {
    const graph = graphRef.current;
    if (!graph) return;

    try {
      await graph.fitView({ when: "always" });
    } catch {
      // 视图适配失败不影响图本身展示。
    }
  }, []);

  /**
   * 初始化固定 LangGraph 架构图。
   */
  const renderGraph = useCallback(
    async (container: HTMLDivElement) => {
      cleanup();

      const graph = new Graph({
        container,
        width: container.clientWidth,
        height: container.clientHeight,
        background: "#ffffff",
        data: {
          nodes: LANGGRAPH_NODES.map((node) => toG6Node(node, runtimeState)),
          edges: LANGGRAPH_EDGES.map(toG6Edge),
        },
        layout: {
          type: "dagre" as const,
          rankdir: "TB",
          nodesep: 28,
          ranksep: 82,
        },
        node: {
          type: "rect",
          style: {
            size: (datum: { data?: { label?: string; nodeType?: string } }) => {
              const label = datum.data?.label ?? "";
              const width = Math.min(Math.max(label.length * 8 + 56, 132), 210);
              const height = datum.data?.nodeType === "executor" ? 48 : 56;
              return [width, height];
            },
            radius: 8,
            fill: (datum: { data?: { runtimeStatus?: LangGraphRuntimeStatus } }) => {
              const status = datum.data?.runtimeStatus ?? "pending";
              return RUNTIME_STATUS_COLORS[status];
            },
            fillOpacity: (datum: { data?: { runtimeStatus?: LangGraphRuntimeStatus } }) =>
              datum.data?.runtimeStatus === "skipped" ? 0.08 : 0.16,
            stroke: (datum: { data?: { runtimeStatus?: LangGraphRuntimeStatus } }) => {
              const status = datum.data?.runtimeStatus ?? "pending";
              return RUNTIME_STATUS_COLORS[status];
            },
            strokeWidth: (datum: { data?: { runtimeStatus?: LangGraphRuntimeStatus } }) =>
              datum.data?.runtimeStatus === "running" ? 3 : 2,
            labelText: (datum: { data?: { label?: string } }) =>
              datum.data?.label ?? "",
            labelFill: "#11161d",
            labelFontSize: 12,
            labelFontWeight: 700,
            labelPlacement: "center",
            labelWordWrap: true,
            labelMaxWidth: 180,
          },
        },
        edge: {
          type: "cubic",
          style: {
            stroke: (datum: { data?: { kind?: LangGraphEdge["kind"] } }) => {
              if (datum.data?.kind === "conditional") return "#d97706";
              if (datum.data?.kind === "loop") return "#059669";
              return "#9ca3af";
            },
            lineDash: (datum: { data?: { kind?: LangGraphEdge["kind"] } }) =>
              datum.data?.kind === "conditional" ? [6, 4] : [],
            strokeWidth: 1.6,
            endArrow: true,
            endArrowSize: 8,
            labelText: (datum: { data?: { label?: string } }) =>
              datum.data?.label ?? "",
            labelFill: "#4b5563",
            labelFontSize: 10,
            labelBackground: true,
            labelBackgroundFill: "#ffffff",
            labelBackgroundOpacity: 0.92,
            labelBackgroundRadius: 4,
            labelBackgroundPadding: [2, 5],
            labelOffsetY: -8,
          },
        },
        behaviors: [
          "drag-canvas",
          "zoom-canvas",
          {
            type: "hover-activate",
            degree: 1,
            direction: "both",
          },
        ],
        autoFit: "view",
        animation: false,
      });

      graphRef.current = graph;

      graph.on("node:click", ((event: { target?: { id?: string } }) => {
        const nodeId = event.target?.id;
        if (!nodeId) return;
        setSelectedNode(nodeById.get(nodeId) ?? null);
      }) as never);

      graph.on("canvas:click", () => {
        setSelectedNode(null);
      });

      try {
        await graph.render();
        await fitGraphView();
      } finally {
        setGraphReady(true);
      }

      resizeObserverRef.current = new ResizeObserver(() => {
        void fitGraphView();
      });
      resizeObserverRef.current.observe(container);
    },
    [cleanup, fitGraphView, nodeById, runtimeState],
  );

  useEffect(() => {
    if (!open) {
      setGraphReady(false);
      setSelectedNode(null);
      cleanup();
      return;
    }

    setGraphReady(false);

    const tryRender = (attempt: number) => {
      const container = containerRef.current;
      if (!container) return;

      if (container.clientWidth === 0 || container.clientHeight === 0) {
        if (attempt < MAX_RENDER_RETRIES) {
          renderTimerRef.current = setTimeout(
            () => tryRender(attempt + 1),
            RENDER_RETRY_INTERVAL,
          );
          return;
        }
        setGraphReady(true);
        return;
      }

      void renderGraph(container);
    };

    const rafId = requestAnimationFrame(() => {
      tryRender(0);
    });

    return () => {
      cancelAnimationFrame(rafId);
      if (renderTimerRef.current) {
        clearTimeout(renderTimerRef.current);
        renderTimerRef.current = null;
      }
    };
  }, [cleanup, open, renderGraph]);

  /**
   * 下载当前 LangGraph 图为 PNG。
   */
  const handleDownloadGraph = useCallback(async () => {
    if (!graphRef.current) {
      void message.warning("LangGraph 图还没有渲染完成");
      return;
    }

    try {
      const dataUrl = await graphRef.current.toDataURL({
        type: "image/png",
        mode: "overall",
      });
      const anchor = document.createElement("a");
      anchor.href = dataUrl;
      anchor.download = "langgraph-runtime-graph.png";
      document.body.appendChild(anchor);
      anchor.click();
      document.body.removeChild(anchor);
      void message.success("LangGraph 图片已下载");
    } catch {
      void message.error("下载图片失败，请重试");
    }
  }, []);

  return (
    <Modal
      centered
      mask={{ enabled: true, blur: true, closable: true }}
      width="92vw"
      style={{ maxWidth: 1440 }}
      open={open}
      onCancel={onClose}
      footer={null}
      closable={false}
      styles={{
        mask: { backdropFilter: "blur(8px)", background: "rgba(0,0,0,0.3)" },
        body: {
          padding: 0,
          height: "calc(86vh - 56px)",
          overflow: "hidden",
        },
        header: { padding: "12px 20px" },
      }}
      title={
        <div className="flex w-full items-center justify-between pr-8">
          <Space size={10}>
            <span className="text-base font-semibold text-[var(--ink)]">
              LangGraph
            </span>
            <span className="text-xs text-[var(--ink-mute)]">
              {LANGGRAPH_NODES.length} 节点 · {LANGGRAPH_EDGES.length} 边
            </span>
          </Space>
          <Space size={4}>
            <Tooltip title="重置视图">
              <Button
                type="text"
                shape="circle"
                aria-label="重置视图"
                icon={<ReloadOutlined />}
                onClick={() => void fitGraphView()}
              />
            </Tooltip>
            <Tooltip title="下载图片">
              <Button
                type="text"
                shape="circle"
                aria-label="下载图片"
                icon={<CameraOutlined />}
                onClick={handleDownloadGraph}
              />
            </Tooltip>
            <Tooltip title="关闭">
              <Button
                type="text"
                shape="circle"
                aria-label="关闭"
                icon={<CloseOutlined />}
                onClick={onClose}
              />
            </Tooltip>
          </Space>
        </div>
      }
    >
      <div className="relative h-full bg-white">
        {!graphReady && (
          <div className="absolute inset-0 z-20 flex items-center justify-center bg-white text-sm font-semibold text-[var(--ink-mute)]">
            正在渲染 LangGraph
          </div>
        )}

        <div ref={containerRef} className="absolute inset-0" />

        <div className="absolute bottom-4 left-4 z-10 w-[220px] rounded-md border border-[var(--line-soft)] bg-white p-3 shadow-[var(--shadow-card)]">
          <div className="mb-2 text-xs font-bold text-[var(--ink)]">图例</div>
          <div className="space-y-1.5">
            {Object.entries(RUNTIME_STATUS_LABELS).map(([status, label]) => (
              <div key={status} className="flex items-center gap-2 text-xs">
                <span
                  className="h-3 w-3 rounded-sm"
                  style={{
                    background:
                      RUNTIME_STATUS_COLORS[status as LangGraphRuntimeStatus],
                  }}
                />
                <span className="text-[var(--ink-soft)]">{label}</span>
              </div>
            ))}
          </div>
          <div className="mt-3 border-t border-[var(--line-faint)] pt-2 text-xs text-[var(--ink-mute)]">
            <div className="flex items-center gap-2">
              <span className="h-px w-8 bg-[#9ca3af]" />
              <span>固定边</span>
            </div>
            <div className="mt-1 flex items-center gap-2">
              <span className="h-px w-8 border-t border-dashed border-[#d97706]" />
              <span>条件边</span>
            </div>
          </div>
        </div>

        {selectedNode && (
          <div className="absolute right-4 top-4 z-10 w-[320px] rounded-md border border-[var(--line-soft)] bg-white p-4 shadow-[var(--shadow-card)]">
            <div className="mb-3 flex items-start justify-between gap-3">
              <div className="min-w-0">
                <Typography.Text className="block text-sm font-bold">
                  {selectedNode.label}
                </Typography.Text>
                <Tag
                  className="mt-2"
                  color={NODE_COLORS[selectedNode.type]}
                >
                  {NODE_TYPE_LABELS[selectedNode.type]}
                </Tag>
                <Tag
                  className="mt-2"
                  color={
                    RUNTIME_STATUS_COLORS[
                      getRuntimeNodeStatus(selectedNode.id, runtimeState)
                    ]
                  }
                >
                  {
                    RUNTIME_STATUS_LABELS[
                      getRuntimeNodeStatus(selectedNode.id, runtimeState)
                    ]
                  }
                </Tag>
              </div>
              <Button
                type="text"
                size="small"
                shape="circle"
                aria-label="关闭节点详情"
                icon={<CloseOutlined />}
                onClick={() => setSelectedNode(null)}
              />
            </div>
            <Typography.Text className="block text-xs text-[var(--ink-mute)]">
              {selectedNode.id}
            </Typography.Text>
            <Typography.Paragraph className="mt-2 mb-0! text-sm text-[var(--ink-soft)]">
              {selectedNode.description}
            </Typography.Paragraph>
          </div>
        )}
      </div>
    </Modal>
  );
};
