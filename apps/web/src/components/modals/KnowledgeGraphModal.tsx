/**
 * 知识图谱可视化弹窗
 *
 * 使用 AntV G6 渲染产品知识图谱的节点和关系图。
 * 节点按 entity 类型着色，关系以有向边展示并标注关系类型。
 * 支持按节点类型筛选，以降低大规模图谱的视觉复杂度。
 *
 * Responsibilities:
 * - 从结构化知识图谱数据构建 G6 图数据，按节点类型过滤
 * - 使用 dagre 布局自动排布节点，渲染后自动 fitView
 * - 提供节点类型筛选开关，隐藏无关类型
 * - 提供图谱 Markdown 和 PNG 下载按钮
 *
 * Notes:
 * - 画布尺寸使用容器实际尺寸（dagre 布局不约束于画布边界）
 * - 渲染完成后调用 fitView 缩放至全部节点可见
 * - 统一通过 [open, filteredNodes, filteredRelations] 监听初始化和数据变更
 * - 筛选变更通过 setData + render 增量更新，保留当前视口状态
 * - G6 实例在弹窗关闭或组件卸载时销毁
 */
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FC,
} from "react";
import { Button, Modal, Spin, Tag, Tooltip, message, Space } from "antd";
import {
  CameraOutlined,
  CloseOutlined,
  DownloadOutlined,
} from "@ant-design/icons";
import { Graph } from "@antv/g6";
import type {
  KnowledgeGraphNodeData,
  KnowledgeGraphRelationData,
} from "../../api/chat-api";

interface Props {
  open: boolean;
  nodes: KnowledgeGraphNodeData[];
  relations: KnowledgeGraphRelationData[];
  markdown: string;
  workspaceId: string;
  onClose: () => void;
}

/** 节点类型对应的颜色 */
const NODE_COLORS: Record<string, string> = {
  Goal: "#1677ff",
  Requirement: "#36cfc9",
  Evidence: "#95de64",
  Decision: "#ffc53d",
  Feature: "#ff7a45",
  Component: "#b37feb",
  Metric: "#f759ab",
  Custom: "#8c8c8c",
};

/** 节点类型对应的中文标签 */
const NODE_TYPE_LABELS: Record<string, string> = {
  Goal: "目标",
  Requirement: "需求",
  Evidence: "证据",
  Decision: "决策",
  Feature: "功能",
  Component: "组件",
  Metric: "指标",
  Custom: "自定义",
};

/** 关系类型对应的中文标签 */
const RELATION_TYPE_LABELS: Record<string, string> = {
  Drives: "驱动",
  Satisfies: "满足",
  Promotes: "促进",
  Produces: "产出",
  Constrains: "约束",
  Implements: "实现",
  Measures: "衡量",
  Validates: "验证",
  References: "引用",
  Composes: "组成",
  Custom: "自定义",
};

/** 容器尺寸轮询最大重试次数 */
const MAX_RETRIES = 30;
/** 每次轮询间隔（ms） */
const RETRY_INTERVAL = 100;
/** 节点 name 最大显示字符数，超出则截断 */
const MAX_NAME_LENGTH = 18;

/**
 * 截断过长的节点名称。
 */
const truncateName = (name: string, maxLen = MAX_NAME_LENGTH): string =>
  name.length > maxLen ? name.slice(0, maxLen - 1) + "…" : name;

/**
 * 将 KG 节点转换为 G6 节点数据格式。
 */
const toG6Node = (node: KnowledgeGraphNodeData) => ({
  id: node.id,
  data: {
    label: `${node.id}\n${truncateName(node.name)}`,
    nodeType: node.type,
    description: node.description ?? "",
    status: node.status ?? "proposed",
    sourceTaskId: node.source_task_id ?? "",
    fullName: node.name,
  },
});

/**
 * 将 KG 关系转换为 G6 边数据格式。
 */
const toG6Edge = (rel: KnowledgeGraphRelationData) => ({
  id: rel.id,
  source: rel.source,
  target: rel.target,
  data: {
    label: RELATION_TYPE_LABELS[rel.type] ?? rel.type,
    relType: rel.type,
    description: rel.description ?? "",
  },
});

/**
 * 知识图谱可视化弹窗组件。
 */
export const KnowledgeGraphModal: FC<Props> = ({
  open,
  nodes,
  relations,
  markdown,
  workspaceId,
  onClose,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const graphRef = useRef<Graph | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const retryCountRef = useRef(0);
  const initAttemptedRef = useRef(false);
  const [selectedNode, setSelectedNode] =
    useState<KnowledgeGraphNodeData | null>(null);

  // 隐藏的节点类型集合（空 = 全部显示）
  const [hiddenTypes, setHiddenTypes] = useState<Set<string>>(new Set());

  // 图谱是否已完成渲染（用于控制加载动画）
  const [graphReady, setGraphReady] = useState(false);

  // 弹窗打开/关闭时重置状态
  useEffect(() => {
    if (open) {
      setHiddenTypes(new Set());
      setSelectedNode(null);
      setGraphReady(false);
    } else {
      initAttemptedRef.current = false;
      setGraphReady(false);
    }
  }, [open]);

  // 当前数据中实际存在的节点类型
  const availableTypes = useMemo(() => {
    const types = new Set<string>();
    nodes.forEach((n) => types.add(n.type));
    return Array.from(types).sort();
  }, [nodes]);

  // 根据隐藏类型筛选后的节点
  const filteredNodes = useMemo(
    () => nodes.filter((n) => !hiddenTypes.has(n.type)),
    [nodes, hiddenTypes],
  );

  // 可见节点 ID 集合
  const visibleNodeIds = useMemo(
    () => new Set(filteredNodes.map((n) => n.id)),
    [filteredNodes],
  );

  // 只保留两端节点均可见的边
  const filteredRelations = useMemo(
    () =>
      relations.filter(
        (r) => visibleNodeIds.has(r.source) && visibleNodeIds.has(r.target),
      ),
    [relations, visibleNodeIds],
  );

  // 使用 ref 保存最新筛选结果，供异步回调读取
  const filteredNodesRef = useRef(filteredNodes);
  filteredNodesRef.current = filteredNodes;
  const filteredRelationsRef = useRef(filteredRelations);
  filteredRelationsRef.current = filteredRelations;

  // 清理 timer 与 graph 实例
  const cleanup = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    retryCountRef.current = 0;
    if (graphRef.current) {
      try {
        graphRef.current.destroy();
      } catch {
        // 忽略销毁错误
      }
      graphRef.current = null;
    }
  }, []);

  /**
   * 使用当前筛选数据初始化 G6 实例并渲染。
   * 画布尺寸使用容器实际尺寸；dagre 布局不约束于画布边界。
   */
  const buildAndRenderGraph = useCallback(
    (container: HTMLDivElement) => {
      const containerWidth = container.clientWidth;
      const containerHeight = container.clientHeight;
      const latestNodes = filteredNodesRef.current;
      const latestRelations = filteredRelationsRef.current;

      if (latestNodes.length === 0) return;

      const g6Nodes = latestNodes.map(toG6Node);
      const g6Edges = latestRelations.map(toG6Edge);

      const graph = new Graph({
        container,
        width: containerWidth,
        height: containerHeight,
        background: "#ffffff",
        data: { nodes: g6Nodes, edges: g6Edges },
        layout: {
          type: "dagre" as const,
          rankdir: "TB",
          nodesep: 60,
          ranksep: 100,
        },
        node: {
          type: "rect",
          style: {
            size: (d: { data?: { label?: string } }) => {
              const label = d.data?.label ?? "";
              const lines = label.split("\n");
              const maxLen = Math.max(...lines.map((l: string) => l.length));
              return [
                Math.min(Math.max(maxLen * 14 + 48, 120), 260),
                60,
              ];
            },
            radius: 8,
            fill: (d: { data?: { nodeType?: string } }) => {
              const nodeType = d.data?.nodeType ?? "Custom";
              return NODE_COLORS[nodeType] ?? NODE_COLORS.Custom;
            },
            fillOpacity: 0.15,
            stroke: (d: { data?: { nodeType?: string } }) => {
              const nodeType = d.data?.nodeType ?? "Custom";
              return NODE_COLORS[nodeType] ?? NODE_COLORS.Custom;
            },
            strokeWidth: 2,
            labelText: (d: { data?: { label?: string } }) =>
              d.data?.label ?? "",
            labelFill: "#1f1f1f",
            labelFontSize: 12,
            labelLineHeight: 18,
            labelPlacement: "center",
            labelWordWrap: true,
            labelMaxWidth: 240,
          },
        },
        edge: {
          type: "cubic",
          style: {
            stroke: "#b8b8b8",
            strokeWidth: 1.5,
            endArrow: true,
            endArrowSize: 8,
            labelText: (d: { data?: { label?: string } }) =>
              d.data?.label ?? "",
            labelFill: "#595959",
            labelFontSize: 10,
            labelBackground: true,
            labelBackgroundFill: "#ffffff",
            labelBackgroundOpacity: 0.9,
            labelBackgroundRadius: 4,
            labelBackgroundPadding: [2, 4],
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

      // 渲染完成后自动缩放以展示全部节点
      graph
        .render()
        .then(async () => {
          try {
            await graph.fitView({ when: "always" });
          } catch {
            // fitView 失败不影响使用
          }
        })
        .catch((err: unknown) => {
          console.error("[kg-graph] Failed to render G6 graph:", err);
        })
        .finally(() => {
          setGraphReady(true);
        });

      // 点击节点显示详情
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      graph.on("node:click", ((event: any) => {
        const nodeId = event?.target?.id;
        if (!nodeId) return;
        const found = latestNodes.find((n) => n.id === nodeId);
        if (found) {
          setSelectedNode(found);
        }
      }) as any);

      // 点击画布空白处取消选中
      graph.on("canvas:click", () => {
        setSelectedNode(null);
      });
    },
    [],
  );

  /**
   * 仅更新图数据（用于筛选变更，保留当前视口状态）。
   */
  const updateGraphData = useCallback(async () => {
    const graph = graphRef.current;
    if (!graph) return;

    const latestNodes = filteredNodesRef.current;
    const latestRelations = filteredRelationsRef.current;

    if (latestNodes.length === 0) {
      // 全部类型被隐藏时销毁图
      cleanup();
      return;
    }

    const g6Nodes = latestNodes.map(toG6Node);
    const g6Edges = latestRelations.map(toG6Edge);

    graph.setData({ nodes: g6Nodes, edges: g6Edges });
    try {
      await graph.render();
      await graph.fitView({ when: "always" });
    } catch (err: unknown) {
      console.error("[kg-graph] Failed to update G6 graph data:", err);
    } finally {
      setGraphReady(true);
    }
  }, [cleanup]);

  /**
   * 统一管理图的生命周期：初始化、数据到达、筛选变更。
   *
   * - 弹窗关闭时销毁图实例
   * - 弹窗打开且首次有数据时通过轮询初始化图
   * - 数据或筛选变更时增量更新图数据
   */
  useEffect(() => {
    if (!open) {
      initAttemptedRef.current = false;
      cleanup();
      return;
    }

    if (filteredNodes.length === 0) {
      // 全量类型被隐藏或数据为空：销毁已有实例，触发加载状态
      if (graphRef.current) {
        cleanup();
        setGraphReady(false);
      }
      return;
    }

    const graph = graphRef.current;

    // 图实例已存在 → 增量更新数据（筛选变更等场景）
    if (graph) {
      updateGraphData();
      return;
    }

    // 检查是否已经尝试过初始化（避免同一次渲染中重复尝试）
    if (initAttemptedRef.current) return;

    const container = containerRef.current;
    if (!container) return;

    // 先确保没有任何残留实例
    cleanup();
    initAttemptedRef.current = true;

    /**
     * 轮询等待容器尺寸就绪后初始化图。
     * 处理 Ant Design Modal 的入场动画导致容器尺寸暂时为 0 的情况。
     */
    const tryInit = (attempt: number) => {
      const c = containerRef.current;
      if (!c) return;

      const width = c.clientWidth;
      const height = c.clientHeight;

      if (width === 0 || height === 0) {
        if (attempt < MAX_RETRIES) {
          timerRef.current = setTimeout(
            () => tryInit(attempt + 1),
            RETRY_INTERVAL,
          );
        }
        return;
      }

      buildAndRenderGraph(c);
    };

    const rafId = requestAnimationFrame(() => {
      tryInit(0);
    });

    return () => {
      cancelAnimationFrame(rafId);
    };
    // filteredNodes / filteredRelations 作为 deps 确保数据到达或筛选变更时都会处理
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, filteredNodes, filteredRelations]);

  // 切换节点类型显示/隐藏
  const toggleType = useCallback((type: string) => {
    setHiddenTypes((prev) => {
      const next = new Set(prev);
      if (next.has(type)) {
        next.delete(type);
      } else {
        next.add(type);
      }
      return next;
    });
  }, []);

  // 获取某类型的节点数量
  const getTypeCount = useCallback(
    (type: string) => nodes.filter((n) => n.type === type).length,
    [nodes],
  );

  // 下载知识图谱 Markdown
  const handleDownloadMarkdown = () => {
    try {
      const blob = new Blob([markdown], {
        type: "text/markdown;charset=utf-8",
      });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `product-knowledge-graph-${workspaceId}.md`;
      document.body.appendChild(anchor);
      anchor.click();
      document.body.removeChild(anchor);
      URL.revokeObjectURL(url);
      void message.success("知识图谱 Markdown 已下载");
    } catch {
      void message.error("下载失败，请重试");
    }
  };

  // 下载知识图谱为 PNG 图片
  const handleDownloadGraph = useCallback(async () => {
    if (!graphRef.current) {
      void message.warning("图谱尚未渲染完成");
      return;
    }
    try {
      const dataURL = await graphRef.current.toDataURL({
        type: "image/png",
        mode: "overall",
      });
      const anchor = document.createElement("a");
      anchor.href = dataURL;
      anchor.download = `product-knowledge-graph-${workspaceId}.png`;
      document.body.appendChild(anchor);
      anchor.click();
      document.body.removeChild(anchor);
      void message.success("知识图谱图片已下载");
    } catch {
      void message.error("下载图片失败，请重试");
    }
  }, [workspaceId]);

  // 图谱是否正在加载（数据获取或渲染过程中）
  const showLoadingOverlay = open && !graphReady;

  return (
    <Modal
      centered
      mask={{ enabled: true, blur: true, closable: true }}
      width="90vw"
      style={{ maxWidth: 1400 }}
      open={open}
      onCancel={onClose}
      footer={null}
      closable={false}
      styles={{
        mask: { backdropFilter: "blur(8px)", background: "rgba(0,0,0,0.3)" },
        body: {
          padding: 0,
          height: "calc(85vh - 56px)",
          overflow: "hidden",
        },
        header: { padding: "12px 20px" },
      }}
      title={
        <div className="flex items-center justify-between w-full pr-8">
          <Space>
            <span className="text-base font-semibold text-[var(--ink-base)]">
              知识图谱
            </span>
            <span className="text-xs text-[var(--ink-soft)]">
              全量 {nodes.length} 节点 · {relations.length} 关系
              {hiddenTypes.size > 0 && (
                <span className="ml-1 text-[var(--ink-accent,#1677ff)]">
                  （显示 {filteredNodes.length} / {filteredRelations.length}）
                </span>
              )}
            </span>
          </Space>
          <Space>
            {hiddenTypes.size > 0 && (
              <Button
                type="link"
                size="small"
                onClick={() => setHiddenTypes(new Set())}
              >
                全部显示
              </Button>
            )}
            <Tooltip title="下载图谱图片">
              <Button
                type="text"
                icon={<CameraOutlined />}
                onClick={handleDownloadGraph}
              />
            </Tooltip>
            <Tooltip title="下载 Markdown">
              <Button
                type="text"
                icon={<DownloadOutlined />}
                onClick={handleDownloadMarkdown}
              />
            </Tooltip>
          </Space>
        </div>
      }
    >
      <div style={{ position: "relative", height: "100%", background: "#ffffff" }}>
        {/* 加载动画 —— 数据获取或 G6 渲染过程中显示 */}
        {showLoadingOverlay && (
          <div
            style={{
              position: "absolute",
              inset: 0,
              zIndex: 15,
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              gap: 16,
              background: "#ffffff",
            }}
          >
            <Spin size="large" />
            <span style={{ fontSize: 14, color: "var(--ink-soft, #8c8c8c)" }}>
              {nodes.length === 0
                ? "加载知识图谱数据中…"
                : "正在渲染知识图谱，节点较多请耐心等待…"}
            </span>
          </div>
        )}

        {/* 图容器 */}
        <div
          ref={containerRef}
          style={{
            position: "absolute",
            inset: 0,
          }}
        />

        {/* 侧边栏 —— 图例 + 筛选控制 */}
        {nodes.length > 0 && (
          <div
            style={{
              position: "absolute",
              left: 0,
              top: 0,
              bottom: 0,
              width: selectedNode ? 312 : 180,
              zIndex: 10,
              background: "#ffffff",
              boxShadow: selectedNode
                ? "2px 0 16px rgba(0,0,0,0.1)"
                : "1px 0 0 var(--line-soft, #e8e8e8)",
              padding: 12,
              overflowY: "auto",
              overflowX: "hidden",
              transition: "width 0.3s ease",
            }}
          >
            <div style={{ minWidth: 156 }}>
              <div
                style={{
                  fontSize: 12,
                  fontWeight: 500,
                  color: "var(--ink-soft, #8c8c8c)",
                  marginBottom: 8,
                }}
              >
                节点类型（点击筛选）
              </div>
              {availableTypes.map((type) => {
                const isHidden = hiddenTypes.has(type);
                const count = getTypeCount(type);
                return (
                  <div
                    key={type}
                    onClick={() => toggleType(type)}
                    title={
                      isHidden
                        ? `点击显示 ${NODE_TYPE_LABELS[type] ?? type}`
                        : `点击隐藏 ${NODE_TYPE_LABELS[type] ?? type}`
                    }
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 8,
                      marginBottom: 4,
                      padding: "4px 6px",
                      borderRadius: 4,
                      fontSize: 12,
                      cursor: "pointer",
                      opacity: isHidden ? 0.4 : 1,
                      transition: "opacity 0.2s, background 0.2s",
                      textDecoration: isHidden ? "line-through" : "none",
                    }}
                    onMouseEnter={(e) => {
                      (
                        e.currentTarget as HTMLDivElement
                      ).style.background = "var(--fill-soft, #f5f5f5)";
                    }}
                    onMouseLeave={(e) => {
                      (
                        e.currentTarget as HTMLDivElement
                      ).style.background = "transparent";
                    }}
                  >
                    <span
                      style={{
                        display: "inline-block",
                        width: 12,
                        height: 12,
                        borderRadius: 2,
                        flexShrink: 0,
                        background:
                          NODE_COLORS[type] ?? NODE_COLORS.Custom,
                      }}
                    />
                    <span>{NODE_TYPE_LABELS[type] ?? type}</span>
                    <span
                      style={{
                        color: "var(--ink-soft, #8c8c8c)",
                        marginLeft: "auto",
                      }}
                    >
                      {count}
                    </span>
                  </div>
                );
              })}

              <div
                style={{
                  fontSize: 12,
                  fontWeight: 500,
                  color: "var(--ink-soft, #8c8c8c)",
                  marginTop: 16,
                  marginBottom: 8,
                }}
              >
                交互
              </div>
              <div
                style={{
                  fontSize: 12,
                  color: "var(--ink-soft, #8c8c8c)",
                  lineHeight: 1.6,
                }}
              >
                拖拽平移 · 滚轮缩放
                <br />
                点击节点查看详情
              </div>
            </div>

            {/* 选中节点详情 */}
            <div
              style={{
                maxHeight: selectedNode ? 600 : 0,
                opacity: selectedNode ? 1 : 0,
                overflow: "hidden",
                transition:
                  "max-height 0.35s ease, opacity 0.3s ease, margin 0.3s ease",
                marginTop: selectedNode ? 16 : 0,
              }}
            >
              <div
                style={{
                  padding: 12,
                  borderRadius: 8,
                  background: "var(--fill-soft, #f5f5f5)",
                }}
              >
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    marginBottom: 8,
                  }}
                >
                  <span
                    style={{
                      fontSize: 12,
                      fontWeight: 600,
                      color: "var(--ink-base, #1f1f1f)",
                    }}
                  >
                    节点详情
                  </span>
                  <Button
                    type="text"
                    size="small"
                    icon={<CloseOutlined style={{ fontSize: 10 }} />}
                    onClick={() => setSelectedNode(null)}
                  />
                </div>
                <div style={{ fontSize: 12, lineHeight: 1.8 }}>
                  <div style={{ color: "var(--ink-soft, #8c8c8c)" }}>ID</div>
                  <div
                    style={{
                      fontWeight: 500,
                      color: "var(--ink-base, #1f1f1f)",
                      marginBottom: 6,
                      wordBreak: "break-all",
                    }}
                  >
                    {selectedNode?.id ?? ""}
                  </div>
                  <div style={{ color: "var(--ink-soft, #8c8c8c)" }}>
                    名称
                  </div>
                  <div
                    style={{
                      fontWeight: 500,
                      color: "var(--ink-base, #1f1f1f)",
                      marginBottom: 6,
                      wordBreak: "break-all",
                    }}
                  >
                    {selectedNode?.name ?? ""}
                  </div>
                  <div style={{ color: "var(--ink-soft, #8c8c8c)" }}>
                    类型
                  </div>
                  <div style={{ marginBottom: 6 }}>
                    {selectedNode && (
                      <Tag
                        color={
                          NODE_COLORS[selectedNode.type] ?? NODE_COLORS.Custom
                        }
                        style={{ margin: 0, fontSize: 11 }}
                      >
                        {NODE_TYPE_LABELS[selectedNode.type] ??
                          selectedNode.type}
                      </Tag>
                    )}
                  </div>
                  {selectedNode?.description && (
                    <>
                      <div style={{ color: "var(--ink-soft, #8c8c8c)" }}>
                        描述
                      </div>
                      <div
                        style={{
                          color: "var(--ink-base, #1f1f1f)",
                          marginBottom: 6,
                          wordBreak: "break-all",
                          lineHeight: 1.6,
                        }}
                      >
                        {selectedNode.description}
                      </div>
                    </>
                  )}
                  {selectedNode?.status && (
                    <>
                      <div style={{ color: "var(--ink-soft, #8c8c8c)" }}>
                        状态
                      </div>
                      <div style={{ color: "var(--ink-base, #1f1f1f)" }}>
                        {selectedNode.status === "proposed"
                          ? "待确认"
                          : selectedNode.status === "confirmed"
                            ? "已确认"
                            : selectedNode.status === "deprecated"
                              ? "已废弃"
                              : selectedNode.status}
                      </div>
                    </>
                  )}
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
};
