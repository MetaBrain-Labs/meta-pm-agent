/**
 * 知识图谱可视化弹窗
 *
 * 使用 AntV G6 渲染产品知识图谱的节点、Combo 分组和关系边。
 * 图谱采用按节点类型分组的 Combo、Dagre 层级布局、关系边分型样式和
 * 平行边处理，提升复杂产品知识图谱的可读性。
 *
 * Responsibilities:
 * - 从结构化知识图谱数据构建 G6 nodes / combos / edges
 * - 使用 Dagre 层级布局与节点类型 Combo 展示产品知识结构
 * - 按 relation 类型渲染边标签、颜色、箭头和 tooltip
 * - 提供节点类型筛选、全屏、Minimap、Markdown 和 PNG 下载能力
 *
 * Notes:
 * - 画布尺寸使用容器实际尺寸，避免弹窗入场动画导致 0 尺寸初始化
 * - BubbleSets 与 EdgeBundling 仅在合理规模内开启，避免大图明显卡顿
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
import { Button, Modal, Space, Spin, Tag, Tooltip, message } from "antd";
import {
  CameraOutlined,
  CloseOutlined,
  DownloadOutlined,
  FullscreenExitOutlined,
  FullscreenOutlined,
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

interface G6Datum {
  id?: string;
  source?: string;
  target?: string;
  data?: {
    label?: string;
    nodeType?: string;
    relType?: string;
    description?: string;
    fullName?: string;
    status?: string;
    iconText?: string;
    sourceTaskId?: string;
  };
}

interface FullscreenPlugin {
  request: () => void;
  exit: () => void;
}

/** 节点类型对应的颜色。 */
const NODE_COLORS: Record<string, string> = {
  Goal: "#1677ff",
  Requirement: "#13c2c2",
  Evidence: "#52c41a",
  Decision: "#faad14",
  Feature: "#fa541c",
  Component: "#722ed1",
  Metric: "#eb2f96",
  Custom: "#64748b",
};

/** 节点类型对应的中文标签。 */
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

/** 节点类型对应的简化图标文本。 */
const NODE_TYPE_ICONS: Record<string, string> = {
  Goal: "◎",
  Requirement: "◇",
  Evidence: "◆",
  Decision: "✓",
  Feature: "✦",
  Component: "▣",
  Metric: "∑",
  Custom: "•",
};

/** 关系类型对应的中文标签。 */
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

/** 关系类型对应的边颜色。 */
const RELATION_COLORS: Record<string, string> = {
  Drives: "#2563eb",
  Satisfies: "#059669",
  Promotes: "#65a30d",
  Produces: "#0891b2",
  Constrains: "#dc2626",
  Implements: "#ea580c",
  Measures: "#7c3aed",
  Validates: "#ca8a04",
  References: "#64748b",
  Composes: "#4f46e5",
  Custom: "#475569",
};

/** 容器尺寸轮询最大重试次数。 */
const MAX_RETRIES = 30;
/** 每次轮询间隔（ms）。 */
const RETRY_INTERVAL = 100;
/** 节点 name 最大显示字符数，超出则截断。 */
const MAX_NAME_LENGTH = 18;
/** 直接展示边标签的关系数量上限。 */
const MAX_VISIBLE_EDGE_LABELS = 120;
/** BubbleSets 的节点规模上限，避免复杂轮廓拖慢大图。 */
const MAX_BUBBLE_SET_NODES = 90;
/** EdgeBundling 的关系规模上限，避免大图反复模拟。 */
const MAX_EDGE_BUNDLING_EDGES = 80;

/**
 * 截断过长的节点名称。
 */
const truncateName = (name: string, maxLen = MAX_NAME_LENGTH): string =>
  name.length > maxLen ? name.slice(0, maxLen - 1) + "..." : name;

/**
 * 将节点类型转换为稳定的 Combo ID。
 */
const toComboId = (type: string) =>
  `kg-combo-${type.replace(/[^a-zA-Z0-9_-]/g, "-") || "Custom"}`;

/**
 * 读取节点类型颜色，未知类型使用 Custom。
 */
const getNodeColor = (type?: string) =>
  NODE_COLORS[type ?? "Custom"] ?? NODE_COLORS.Custom;

/**
 * 读取关系类型颜色，未知类型使用 Custom。
 */
const getRelationColor = (type?: string) =>
  RELATION_COLORS[type ?? "Custom"] ?? RELATION_COLORS.Custom;

/**
 * 从 G6 通用事件中安全读取目标元素 ID。
 */
const getEventTargetId = (event: unknown) => {
  const target = (event as { target?: { id?: unknown } })?.target;
  return typeof target?.id === "string" ? target.id : "";
};

/**
 * 转义 tooltip HTML，避免图谱内容被当作 DOM 注入。
 */
const escapeHtml = (value: string) =>
  value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

/**
 * 将 KG 节点转换为 G6 节点数据格式。
 */
const toG6Node = (node: KnowledgeGraphNodeData) => ({
  id: node.id,
  type: "circle",
  combo: toComboId(node.type),
  data: {
    label: truncateName(node.name),
    nodeType: node.type,
    description: node.description ?? "",
    status: node.status ?? "proposed",
    sourceTaskId: node.source_task_id ?? "",
    fullName: node.name,
    iconText: NODE_TYPE_ICONS[node.type] ?? NODE_TYPE_ICONS.Custom,
  },
});

/**
 * 将节点类型转换为 G6 Combo 数据。
 */
const toG6Combo = (type: string) => ({
  id: toComboId(type),
  type: "rect",
  data: {
    label: NODE_TYPE_LABELS[type] ?? type,
    nodeType: type,
  },
});

/**
 * 将 KG 关系转换为 G6 边数据格式。
 */
const toG6Edge = (
  rel: KnowledgeGraphRelationData,
  showLabel: boolean,
) => ({
  id: rel.id,
  source: rel.source,
  target: rel.target,
  data: {
    label: showLabel ? RELATION_TYPE_LABELS[rel.type] ?? rel.type : "",
    tooltipLabel: RELATION_TYPE_LABELS[rel.type] ?? rel.type,
    relType: rel.type,
    description: rel.description ?? "",
    sourceTaskId: rel.source_task_id ?? "",
  },
});

/**
 * 基于当前筛选结果构建完整 G6 图数据。
 */
const buildGraphData = (
  latestNodes: KnowledgeGraphNodeData[],
  latestRelations: KnowledgeGraphRelationData[],
) => {
  const visibleTypes = Array.from(new Set(latestNodes.map((node) => node.type)));
  const showEdgeLabels = latestRelations.length <= MAX_VISIBLE_EDGE_LABELS;

  return {
    nodes: latestNodes.map(toG6Node),
    combos: visibleTypes.map(toG6Combo),
    edges: latestRelations.map((relation) =>
      toG6Edge(relation, showEdgeLabels),
    ),
  };
};

/**
 * 为节点类型构建 BubbleSets 插件配置。
 */
const buildBubbleSetsPlugins = (latestNodes: KnowledgeGraphNodeData[]) => {
  if (
    latestNodes.length === 0 ||
    latestNodes.length > MAX_BUBBLE_SET_NODES
  ) {
    return [];
  }

  const grouped = latestNodes.reduce<Record<string, string[]>>((acc, node) => {
    acc[node.type] = [...(acc[node.type] ?? []), node.id];
    return acc;
  }, {});

  return Object.entries(grouped)
    .filter(([, members]) => members.length >= 2)
    .map(([type, members]) => ({
      type: "bubble-sets",
      key: `kg-bubble-${type}`,
      members,
      fill: getNodeColor(type),
      fillOpacity: 0.08,
      stroke: getNodeColor(type),
      strokeOpacity: 0.12,
      lineWidth: 1,
    }));
};

/**
 * 构建 G6 插件配置。
 */
const buildGraphPlugins = (
  latestNodes: KnowledgeGraphNodeData[],
  latestRelations: KnowledgeGraphRelationData[],
  setIsFullscreen: (value: boolean) => void,
) => [
  {
    type: "tooltip",
    key: "kg-tooltip",
    trigger: "hover",
    enable: (event: unknown) => Boolean(getEventTargetId(event)),
    getContent: (_event: unknown, items: G6Datum[]) => {
      const datum = items[0];
      if (!datum?.data) return "";

      if (datum.source && datum.target) {
        const label =
          RELATION_TYPE_LABELS[datum.data.relType ?? "Custom"] ??
          datum.data.relType ??
          "关系";
        const description = datum.data.description
          ? `<div style="margin-top:4px;color:#475569;line-height:1.5">${escapeHtml(datum.data.description)}</div>`
          : "";
        return `<div style="max-width:260px"><strong>${escapeHtml(label)}</strong>${description}</div>`;
      }

      const name = datum.data.fullName ?? datum.data.label ?? "节点";
      const typeLabel =
        NODE_TYPE_LABELS[datum.data.nodeType ?? "Custom"] ??
        datum.data.nodeType ??
        "节点";
      const description = datum.data.description
        ? `<div style="margin-top:4px;color:#475569;line-height:1.5">${escapeHtml(datum.data.description)}</div>`
        : "";
      return `<div style="max-width:280px"><strong>${escapeHtml(name)}</strong><div style="color:#64748b;margin-top:2px">${escapeHtml(typeLabel)}</div>${description}</div>`;
    },
    onOpenChange: () => undefined,
  },
  {
    type: "minimap",
    key: "kg-minimap",
    size: [180, 120],
    position: "right-bottom",
    padding: 12,
    shape: "key",
    delay: 180,
    containerStyle: {
      right: "16px",
      bottom: "16px",
      border: "1px solid #d9e2ef",
      borderRadius: "8px",
      background: "rgba(255,255,255,0.92)",
      boxShadow: "0 8px 24px rgba(15,23,42,0.12)",
      overflow: "hidden",
    },
    maskStyle: {
      border: "1px solid #1677ff",
      background: "rgba(22,119,255,0.12)",
    },
  },
  {
    type: "fullscreen",
    key: "kg-fullscreen",
    autoFit: true,
    onEnter: () => setIsFullscreen(true),
    onExit: () => setIsFullscreen(false),
  },
  ...(latestRelations.length > 6 &&
  latestRelations.length <= MAX_EDGE_BUNDLING_EDGES
    ? [
        {
          type: "edge-bundling",
          key: "kg-edge-bundling",
          bundleThreshold: 0.72,
          cycles: 3,
          iterations: 45,
          divisions: 1,
        },
      ]
    : []),
  ...buildBubbleSetsPlugins(latestNodes),
];

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
  const [selectedNode, setSelectedNode] =
    useState<KnowledgeGraphNodeData | null>(null);
  const [hiddenTypes, setHiddenTypes] = useState<Set<string>>(new Set());
  const [graphReady, setGraphReady] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);

  // 弹窗打开/关闭时重置状态。
  useEffect(() => {
    if (open) {
      setHiddenTypes(new Set());
      setSelectedNode(null);
      setGraphReady(false);
      setIsFullscreen(false);
    } else {
      setGraphReady(false);
      setIsFullscreen(false);
    }
  }, [open]);

  // 当前数据中实际存在的节点类型。
  const availableTypes = useMemo(() => {
    const types = new Set<string>();
    nodes.forEach((node) => types.add(node.type));
    return Array.from(types).sort();
  }, [nodes]);

  // 根据隐藏类型筛选后的节点。
  const filteredNodes = useMemo(
    () => nodes.filter((node) => !hiddenTypes.has(node.type)),
    [nodes, hiddenTypes],
  );

  // 可见节点 ID 集合。
  const visibleNodeIds = useMemo(
    () => new Set(filteredNodes.map((node) => node.id)),
    [filteredNodes],
  );

  // 只保留两端节点均可见的边。
  const filteredRelations = useMemo(
    () =>
      relations.filter(
        (relation) =>
          visibleNodeIds.has(relation.source) &&
          visibleNodeIds.has(relation.target),
      ),
    [relations, visibleNodeIds],
  );

  // 当前可见关系类型，用于侧边栏展示边分型图例。
  const availableRelationTypes = useMemo(() => {
    const types = new Set<string>();
    filteredRelations.forEach((relation) => types.add(relation.type));
    return Array.from(types).sort();
  }, [filteredRelations]);

  // 使用 ref 保存最新筛选结果，供异步回调读取。
  const filteredNodesRef = useRef(filteredNodes);
  filteredNodesRef.current = filteredNodes;
  const filteredRelationsRef = useRef(filteredRelations);
  filteredRelationsRef.current = filteredRelations;

  // 清理 timer 与 graph 实例。
  const cleanup = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    if (graphRef.current) {
      try {
        graphRef.current.destroy();
      } catch {
        // 忽略销毁错误，避免弹窗关闭被 G6 内部状态阻断。
      }
      graphRef.current = null;
    }
  }, []);

  /**
   * 使用当前筛选数据初始化 G6 实例并渲染。
   */
  const buildAndRenderGraph = useCallback(
    (container: HTMLDivElement) => {
      const containerWidth = container.clientWidth;
      const containerHeight = container.clientHeight;
      const latestNodes = filteredNodesRef.current;
      const latestRelations = filteredRelationsRef.current;

      if (latestNodes.length === 0) return;

      const graph = new Graph({
        container,
        width: containerWidth,
        height: containerHeight,
        background: "#ffffff",
        data: buildGraphData(latestNodes, latestRelations),
        layout: {
          type: "dagre",
          rankdir: latestNodes.length > 18 ? "LR" : "TB",
          nodesep: latestNodes.length > 40 ? 72 : 96,
          ranksep: latestNodes.length > 40 ? 118 : 152,
          comboPadding: 28,
        },
        node: {
          type: "circle",
          style: {
            size: 48,
            fill: (datum: G6Datum) => getNodeColor(datum.data?.nodeType),
            fillOpacity: 0.14,
            stroke: (datum: G6Datum) => getNodeColor(datum.data?.nodeType),
            strokeWidth: 2,
            icon: true,
            iconText: (datum: G6Datum) =>
              datum.data?.iconText ?? NODE_TYPE_ICONS.Custom,
            iconFill: (datum: G6Datum) => getNodeColor(datum.data?.nodeType),
            iconFontSize: 21,
            iconFontWeight: 700,
            labelText: (datum: G6Datum) => datum.data?.label ?? "",
            labelFill: "#1f2937",
            labelFontSize: 11,
            labelFontWeight: 600,
            labelLineHeight: 14,
            labelPlacement: "bottom",
            labelOffsetY: 8,
            labelWordWrap: true,
            labelMaxWidth: 112,
            halo: true,
            haloStroke: (datum: G6Datum) => getNodeColor(datum.data?.nodeType),
            haloStrokeOpacity: 0.12,
            haloLineWidth: 10,
          },
          state: {
            active: {
              haloStrokeOpacity: 0.32,
              strokeWidth: 3,
            },
            selected: {
              haloStrokeOpacity: 0.4,
              strokeWidth: 3,
            },
          },
        },
        combo: {
          type: "rect",
          style: {
            padding: [34, 42, 38, 42],
            radius: 8,
            fill: (datum: G6Datum) => getNodeColor(datum.data?.nodeType),
            fillOpacity: 0.035,
            stroke: (datum: G6Datum) => getNodeColor(datum.data?.nodeType),
            strokeOpacity: 0.28,
            lineDash: [8, 6],
            lineWidth: 1.2,
            labelText: (datum: G6Datum) => datum.data?.label ?? "",
            labelPlacement: "top-left",
            labelOffsetX: 8,
            labelOffsetY: -8,
            labelFill: (datum: G6Datum) => getNodeColor(datum.data?.nodeType),
            labelFontSize: 12,
            labelFontWeight: 700,
            collapsedMarker: true,
          },
        },
        edge: {
          type: latestNodes.length > 18 ? "cubic-horizontal" : "cubic-vertical",
          style: {
            stroke: (datum: G6Datum) => getRelationColor(datum.data?.relType),
            strokeOpacity: 0.78,
            strokeWidth: (datum: G6Datum) =>
              datum.data?.relType === "Constrains" ? 2.2 : 1.6,
            endArrow: true,
            endArrowSize: 8,
            labelText: (datum: G6Datum) => datum.data?.label ?? "",
            labelFill: (datum: G6Datum) => getRelationColor(datum.data?.relType),
            labelFontSize: 10,
            labelFontWeight: 600,
            labelBackground: true,
            labelBackgroundFill: "#ffffff",
            labelBackgroundOpacity: 0.92,
            labelBackgroundRadius: 4,
            labelBackgroundPadding: [2, 4],
            labelOffsetY: -8,
          },
          state: {
            active: {
              strokeOpacity: 1,
              strokeWidth: 2.6,
            },
          },
        },
        behaviors: [
          "drag-canvas",
          "zoom-canvas",
          {
            type: "drag-element",
            enable: (event: unknown) => {
              const targetId = getEventTargetId(event);
              return Boolean(
                targetId && !targetId.startsWith("kg-combo-"),
              );
            },
          },
          {
            type: "focus-element",
            animation: { duration: 360, easing: "ease-in-out" },
          },
          {
            type: "hover-activate",
            degree: 1,
            direction: "both",
          },
          "collapse-expand",
        ],
        transforms: [
          {
            type: "process-parallel-edges",
            mode: "bundle",
            distance: 24,
            loopMode: "spread",
          },
        ],
        plugins: buildGraphPlugins(
          latestNodes,
          latestRelations,
          setIsFullscreen,
        ),
        autoFit: "view",
        animation: false,
      });

      graphRef.current = graph;

      // 渲染完成后自动缩放以展示全部节点。
      graph
        .render()
        .then(async () => {
          try {
            await graph.fitView({ when: "always" });
          } catch {
            // fitView 失败不影响图谱继续使用。
          }
        })
        .catch((err: unknown) => {
          console.error("[kg-graph] Failed to render G6 graph:", err);
        })
        .finally(() => {
          setGraphReady(true);
      });

      // 点击节点显示详情。
      graph.on("node:click", (event) => {
        const nodeId = getEventTargetId(event);
        if (!nodeId) return;
        const found = latestNodes.find((node) => node.id === nodeId);
        if (found) {
          setSelectedNode(found);
        }
      });

      // 点击画布空白处取消选中。
      graph.on("canvas:click", () => {
        setSelectedNode(null);
      });
    },
    [],
  );

  /**
   * 更新图数据；筛选变更后重渲染并刷新 Combo / 边分型。
   */
  const updateGraphData = useCallback(async () => {
    const graph = graphRef.current;
    if (!graph) return;

    const latestNodes = filteredNodesRef.current;
    const latestRelations = filteredRelationsRef.current;

    if (latestNodes.length === 0) {
      // 全部类型被隐藏时销毁图，但不要保留永久加载遮罩。
      cleanup();
      setGraphReady(true);
      return;
    }

    graph.setData(buildGraphData(latestNodes, latestRelations));
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
   */
  useEffect(() => {
    if (!open) {
      cleanup();
      return;
    }

    if (filteredNodes.length === 0) {
      // 全量类型被隐藏或数据为空：销毁已有实例，但不显示永久加载状态。
      if (graphRef.current) {
        cleanup();
      }
      setGraphReady(true);
      return;
    }

    const graph = graphRef.current;

    // 图实例已存在时仅更新数据，保持弹窗和按钮状态。
    if (graph) {
      updateGraphData();
      return;
    }

    const container = containerRef.current;
    if (!container) return;

    cleanup();
    setGraphReady(false);

    /**
     * 轮询等待容器尺寸就绪后初始化图。
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
        } else {
          setGraphReady(true);
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
    // filteredNodes / filteredRelations 作为 deps 确保数据到达或筛选变更时都会处理。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, filteredNodes, filteredRelations]);

  // 切换节点类型显示/隐藏。
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

  // 获取某类型的节点数量。
  const getTypeCount = useCallback(
    (type: string) => nodes.filter((node) => node.type === type).length,
    [nodes],
  );

  // 获取某关系类型的可见关系数量。
  const getRelationTypeCount = useCallback(
    (type: string) =>
      filteredRelations.filter((relation) => relation.type === type).length,
    [filteredRelations],
  );

  // 切换 G6 fullscreen 插件状态。
  const handleToggleFullscreen = useCallback(() => {
    const graph = graphRef.current;
    if (!graph) {
      void message.warning("图谱尚未渲染完成");
      return;
    }

    const fullscreen = graph.getPluginInstance(
      "kg-fullscreen",
    ) as unknown as FullscreenPlugin;
    if (isFullscreen) {
      fullscreen.exit();
    } else {
      fullscreen.request();
    }
  }, [isFullscreen]);

  // 下载知识图谱 Markdown。
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

  // 下载知识图谱为 PNG 图片。
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

  // 图谱是否正在加载（数据获取或渲染过程中）。
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
            <Tooltip title={isFullscreen ? "退出全屏" : "全屏查看"}>
              <Button
                type="text"
                icon={
                  isFullscreen ? (
                    <FullscreenExitOutlined />
                  ) : (
                    <FullscreenOutlined />
                  )
                }
                onClick={handleToggleFullscreen}
              />
            </Tooltip>
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
      <div
        style={{ position: "relative", height: "100%", background: "#ffffff" }}
      >
        {/* 加载动画：数据获取或 G6 渲染过程中显示。 */}
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
                ? "加载知识图谱数据中..."
                : "正在渲染知识图谱，节点较多请耐心等待..."}
            </span>
          </div>
        )}

        {/* 图容器。 */}
        <div
          ref={containerRef}
          style={{
            position: "absolute",
            inset: 0,
          }}
        />

        {/* 侧边栏：节点图例、关系图例和筛选控制。 */}
        {nodes.length > 0 && (
          <div
            style={{
              position: "absolute",
              left: 0,
              top: 0,
              bottom: 0,
              width: selectedNode ? 320 : 216,
              zIndex: 10,
              background: "rgba(255,255,255,0.96)",
              boxShadow: selectedNode
                ? "2px 0 16px rgba(0,0,0,0.1)"
                : "1px 0 0 var(--line-soft, #e8e8e8)",
              padding: 12,
              overflowY: "auto",
              overflowX: "hidden",
              transition: "width 0.3s ease",
            }}
          >
            <div style={{ minWidth: 184 }}>
              <div
                style={{
                  fontSize: 12,
                  fontWeight: 600,
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
                      padding: "5px 6px",
                      borderRadius: 4,
                      fontSize: 12,
                      cursor: "pointer",
                      opacity: isHidden ? 0.4 : 1,
                      transition: "opacity 0.2s, background 0.2s",
                      textDecoration: isHidden ? "line-through" : "none",
                    }}
                    onMouseEnter={(event) => {
                      event.currentTarget.style.background =
                        "var(--fill-soft, #f5f5f5)";
                    }}
                    onMouseLeave={(event) => {
                      event.currentTarget.style.background = "transparent";
                    }}
                  >
                    <span
                      style={{
                        width: 18,
                        height: 18,
                        borderRadius: "50%",
                        flexShrink: 0,
                        display: "inline-flex",
                        alignItems: "center",
                        justifyContent: "center",
                        color: getNodeColor(type),
                        border: `1px solid ${getNodeColor(type)}`,
                        background: `${getNodeColor(type)}18`,
                        fontSize: 11,
                        fontWeight: 700,
                      }}
                    >
                      {NODE_TYPE_ICONS[type] ?? NODE_TYPE_ICONS.Custom}
                    </span>
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

              {availableRelationTypes.length > 0 && (
                <>
                  <div
                    style={{
                      fontSize: 12,
                      fontWeight: 600,
                      color: "var(--ink-soft, #8c8c8c)",
                      marginTop: 16,
                      marginBottom: 8,
                    }}
                  >
                    关系类型
                  </div>
                  {availableRelationTypes.map((type) => (
                    <div
                      key={type}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 8,
                        marginBottom: 5,
                        fontSize: 12,
                      }}
                    >
                      <span
                        style={{
                          width: 22,
                          height: 0,
                          borderTop: `2px solid ${getRelationColor(type)}`,
                          flexShrink: 0,
                        }}
                      />
                      <span>{RELATION_TYPE_LABELS[type] ?? type}</span>
                      <span
                        style={{
                          color: "var(--ink-soft, #8c8c8c)",
                          marginLeft: "auto",
                        }}
                      >
                        {getRelationTypeCount(type)}
                      </span>
                    </div>
                  ))}
                </>
              )}

              <div
                style={{
                  fontSize: 12,
                  fontWeight: 600,
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
                  lineHeight: 1.7,
                }}
              >
                拖拽平移 · 滚轮缩放
                <br />
                点击节点聚焦并查看详情
                <br />
                Hover 节点或边查看说明
              </div>
            </div>

            {/* 选中节点详情。 */}
            <div
              style={{
                maxHeight: selectedNode ? 640 : 0,
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
                        color={getNodeColor(selectedNode.type)}
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
