/**
 * 知识图谱共享画布
 *
 * 集中维护产品知识图谱的 G6 数据转换、视觉配置、插件和实例生命周期，
 * 供聊天弹窗与文档策划页面复用同一套渲染行为。
 *
 * Responsibilities:
 * - 将知识图谱节点与关系转换为 G6 数据
 * - 管理 G6 初始化、数据更新、零尺寸重试和销毁
 * - 暴露全屏与图片导出能力
 *
 * Notes:
 * - 筛选、详情面板和下载交互由使用方负责
 */

import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react";
import { Graph } from "@antv/g6";
import { Spin, Typography } from "antd";
import type {
  KnowledgeGraphNodeData,
  KnowledgeGraphRelationData,
} from "../api/chat-api";

const { Text } = Typography;

/** 知识图谱画布属性。 */
export interface KnowledgeGraphViewProps {
  active?: boolean;
  nodes: KnowledgeGraphNodeData[];
  relations: KnowledgeGraphRelationData[];
  onNodeSelect: (node: KnowledgeGraphNodeData | null) => void;
  className?: string;
}

/** 知识图谱画布提供给外层操作区的能力。 */
export interface KnowledgeGraphViewHandle {
  requestFullscreen(): void;
  exitFullscreen(): void;
  toDataURL(): Promise<string>;
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
  request(): void;
  exit(): void;
}

/** 节点类型颜色。 */
export const NODE_COLORS: Record<string, string> = {
  Goal: "#1677ff",
  Requirement: "#13c2c2",
  Evidence: "#52c41a",
  Decision: "#faad14",
  Feature: "#fa541c",
  Component: "#722ed1",
  Metric: "#eb2f96",
  Risk: "#dc2626",
  OpenQuestion: "#0891b2",
  Custom: "#64748b",
};

/** 节点类型中文标签。 */
export const NODE_TYPE_LABELS: Record<string, string> = {
  Goal: "目标",
  Requirement: "需求",
  Evidence: "证据",
  Decision: "决策",
  Feature: "功能",
  Component: "组件",
  Metric: "指标",
  Risk: "风险",
  OpenQuestion: "待确认问题",
  Custom: "自定义",
};

export const NODE_TYPE_ICONS: Record<string, string> = {
  Goal: "●",
  Requirement: "◆",
  Evidence: "◉",
  Decision: "✓",
  Feature: "✦",
  Component: "■",
  Metric: "∑",
  Risk: "!",
  OpenQuestion: "?",
  Custom: "•",
};

export const RELATION_TYPE_LABELS: Record<string, string> = {
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

const MAX_RETRIES = 30;
const RETRY_INTERVAL = 100;
const MAX_NAME_LENGTH = 18;
const MAX_VISIBLE_EDGE_LABELS = 120;
const MAX_BUBBLE_SET_NODES = 90;
const MAX_EDGE_BUNDLING_EDGES = 80;

/** 获取节点类型颜色。 */
export function getKnowledgeGraphNodeColor(type?: string): string {
  return NODE_COLORS[type ?? "Custom"] ?? NODE_COLORS.Custom;
}

/** 获取关系类型颜色。 */
export function getKnowledgeGraphRelationColor(type?: string): string {
  return RELATION_COLORS[type ?? "Custom"] ?? RELATION_COLORS.Custom;
}

/** 截断画布标签，完整名称仍保留在 tooltip 数据中。 */
function truncateName(name: string): string {
  return name.length > MAX_NAME_LENGTH
    ? `${name.slice(0, MAX_NAME_LENGTH - 1)}...`
    : name;
}

/** 将业务节点类型转换为稳定的 G6 Combo ID。 */
function toComboId(type: string): string {
  return `kg-combo-${type.replace(/[^a-zA-Z0-9_-]/g, "-") || "Custom"}`;
}

/** 从 G6 事件中读取目标元素 ID。 */
function getEventTargetId(event: unknown): string {
  const target = (event as { target?: { id?: unknown } })?.target;
  return typeof target?.id === "string" ? target.id : "";
}

/** 转义 tooltip HTML，避免业务文本被解释为标签。 */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** 将业务知识图谱转换为 G6 图数据。 */
function buildGraphData(
  nodes: KnowledgeGraphNodeData[],
  relations: KnowledgeGraphRelationData[],
) {
  const visibleTypes = [...new Set(nodes.map((node) => node.type))];
  const showEdgeLabels = relations.length <= MAX_VISIBLE_EDGE_LABELS;

  return {
    nodes: nodes.map((node) => ({
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
    })),
    combos: visibleTypes.map((type) => ({
      id: toComboId(type),
      type: "rect",
      data: {
        label: NODE_TYPE_LABELS[type] ?? type,
        nodeType: type,
      },
    })),
    edges: relations.map((relation) => ({
      id: relation.id,
      source: relation.source,
      target: relation.target,
      data: {
        label: showEdgeLabels
          ? RELATION_TYPE_LABELS[relation.type] ?? relation.type
          : "",
        tooltipLabel: RELATION_TYPE_LABELS[relation.type] ?? relation.type,
        relType: relation.type,
        description: relation.description ?? "",
        sourceTaskId: relation.source_task_id ?? "",
      },
    })),
  };
}

/** 为小规模同类节点构建 BubbleSets 分组。 */
function buildBubbleSetsPlugins(nodes: KnowledgeGraphNodeData[]) {
  if (nodes.length === 0 || nodes.length > MAX_BUBBLE_SET_NODES) return [];

  const grouped = nodes.reduce<Record<string, string[]>>((result, node) => {
    result[node.type] = [...(result[node.type] ?? []), node.id];
    return result;
  }, {});

  return Object.entries(grouped)
    .filter(([, members]) => members.length >= 2)
    .map(([type, members]) => ({
      type: "bubble-sets",
      key: `kg-bubble-${type}`,
      members,
      fill: getKnowledgeGraphNodeColor(type),
      fillOpacity: 0.08,
      stroke: getKnowledgeGraphNodeColor(type),
      strokeOpacity: 0.12,
      lineWidth: 1,
    }));
}

/** 构建两个页面共用的 G6 插件列表。 */
function buildGraphPlugins(
  nodes: KnowledgeGraphNodeData[],
  relations: KnowledgeGraphRelationData[],
) {
  return [
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
            ? `<div class="font-reading-compact" style="margin-top:4px;color:#475569">${escapeHtml(datum.data.description)}</div>`
            : "";
          return `<div style="max-width:260px"><strong>${escapeHtml(label)}</strong>${description}</div>`;
        }

        const name = datum.data.fullName ?? datum.data.label ?? "节点";
        const typeLabel =
          NODE_TYPE_LABELS[datum.data.nodeType ?? "Custom"] ??
          datum.data.nodeType ??
          "节点";
        const description = datum.data.description
          ? `<div class="font-reading-compact" style="margin-top:4px;color:#475569">${escapeHtml(datum.data.description)}</div>`
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
    },
    ...(relations.length > 6 &&
    relations.length <= MAX_EDGE_BUNDLING_EDGES
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
    ...buildBubbleSetsPlugins(nodes),
  ];
}

/** 共享知识图谱画布。 */
export const KnowledgeGraphView = forwardRef<
  KnowledgeGraphViewHandle,
  KnowledgeGraphViewProps
>(function KnowledgeGraphView(
  {
    active = true,
    nodes,
    relations,
    onNodeSelect,
    className = "h-[620px]",
  },
  ref,
) {
  const containerRef = useRef<HTMLDivElement>(null);
  const graphRef = useRef<Graph | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const nodesRef = useRef(nodes);
  const relationsRef = useRef(relations);
  const onNodeSelectRef = useRef(onNodeSelect);
  const [graphReady, setGraphReady] = useState(false);

  nodesRef.current = nodes;
  relationsRef.current = relations;
  onNodeSelectRef.current = onNodeSelect;

  const cleanup = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    if (graphRef.current) {
      try {
        graphRef.current.destroy();
      } catch {
        // G6 销毁失败不应阻断页面关闭或切换。
      }
      graphRef.current = null;
    }
  }, []);

  useImperativeHandle(
    ref,
    () => ({
      requestFullscreen() {
        const plugin = graphRef.current?.getPluginInstance(
          "kg-fullscreen",
        ) as unknown as FullscreenPlugin | undefined;
        plugin?.request();
      },
      exitFullscreen() {
        const plugin = graphRef.current?.getPluginInstance(
          "kg-fullscreen",
        ) as unknown as FullscreenPlugin | undefined;
        plugin?.exit();
      },
      async toDataURL() {
        if (!graphRef.current) throw new Error("graph-not-ready");
        return graphRef.current.toDataURL({
          type: "image/png",
          mode: "overall",
        });
      },
    }),
    [],
  );

  const createGraph = useCallback((container: HTMLDivElement) => {
    const latestNodes = nodesRef.current;
    const latestRelations = relationsRef.current;
    // Canvas 不解析 CSS 变量，读取界面字体栈后显式传给各类标签。
    const fontFamily =
      getComputedStyle(container).getPropertyValue("--sans").trim() || "sans-serif";
    const fontRequest = `600 12px ${fontFamily}`;
    const labelFontFamily =
      document.fonts && !document.fonts.check(fontRequest)
        ? fontFamily.split(",").slice(1).join(",").trim() || "sans-serif"
        : fontFamily;
    const graph = new Graph({
      container,
      width: container.clientWidth,
      height: container.clientHeight,
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
          fill: (datum: G6Datum) =>
            getKnowledgeGraphNodeColor(datum.data?.nodeType),
          fillOpacity: 0.14,
          stroke: (datum: G6Datum) =>
            getKnowledgeGraphNodeColor(datum.data?.nodeType),
          strokeWidth: 2,
          icon: true,
          iconText: (datum: G6Datum) =>
            datum.data?.iconText ?? NODE_TYPE_ICONS.Custom,
          iconFill: (datum: G6Datum) =>
            getKnowledgeGraphNodeColor(datum.data?.nodeType),
          iconFontSize: 21,
          iconFontWeight: 700,
          labelText: (datum: G6Datum) => datum.data?.label ?? "",
          labelFill: "#1f2937",
          labelFontSize: 11,
          labelFontFamily,
          labelFontWeight: 600,
          labelLineHeight: 14,
          labelPlacement: "bottom",
          labelOffsetY: 8,
          labelWordWrap: true,
          labelMaxWidth: 112,
          halo: true,
          haloStroke: (datum: G6Datum) =>
            getKnowledgeGraphNodeColor(datum.data?.nodeType),
          haloStrokeOpacity: 0.12,
          haloLineWidth: 10,
        },
        state: {
          active: { haloStrokeOpacity: 0.32, strokeWidth: 3 },
          selected: { haloStrokeOpacity: 0.4, strokeWidth: 3 },
        },
      },
      combo: {
        type: "rect",
        style: {
          padding: [34, 42, 38, 42],
          radius: 8,
          fill: (datum: G6Datum) =>
            getKnowledgeGraphNodeColor(datum.data?.nodeType),
          fillOpacity: 0.035,
          stroke: (datum: G6Datum) =>
            getKnowledgeGraphNodeColor(datum.data?.nodeType),
          strokeOpacity: 0.28,
          lineDash: [8, 6],
          lineWidth: 1.2,
          labelText: (datum: G6Datum) => datum.data?.label ?? "",
          labelPlacement: "top-left",
          labelOffsetX: 8,
          labelOffsetY: -8,
          labelFill: (datum: G6Datum) =>
            getKnowledgeGraphNodeColor(datum.data?.nodeType),
          labelFontSize: 12,
          labelFontFamily,
          labelFontWeight: 700,
          collapsedMarker: true,
        },
      },
      edge: {
        type: latestNodes.length > 18 ? "cubic-horizontal" : "cubic-vertical",
        style: {
          stroke: (datum: G6Datum) =>
            getKnowledgeGraphRelationColor(datum.data?.relType),
          strokeOpacity: 0.78,
          strokeWidth: (datum: G6Datum) =>
            datum.data?.relType === "Constrains" ? 2.2 : 1.6,
          endArrow: true,
          endArrowSize: 8,
          labelText: (datum: G6Datum) => datum.data?.label ?? "",
          labelFill: (datum: G6Datum) =>
            getKnowledgeGraphRelationColor(datum.data?.relType),
          labelFontSize: 10,
          labelFontFamily,
          labelFontWeight: 600,
          labelBackground: true,
          labelBackgroundFill: "#ffffff",
          labelBackgroundOpacity: 0.92,
          labelBackgroundRadius: 4,
          labelBackgroundPadding: [2, 4],
          labelOffsetY: -8,
        },
        state: {
          active: { strokeOpacity: 1, strokeWidth: 2.6 },
        },
      },
      behaviors: [
        "drag-canvas",
        "zoom-canvas",
        {
          type: "drag-element",
          enable: (event: unknown) => {
            const targetId = getEventTargetId(event);
            return Boolean(targetId && !targetId.startsWith("kg-combo-"));
          },
        },
        {
          type: "focus-element",
          animation: { duration: 360, easing: "ease-in-out" },
        },
        { type: "hover-activate", degree: 1, direction: "both" },
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
      plugins: buildGraphPlugins(latestNodes, latestRelations),
      autoFit: "view",
      animation: false,
    });

    graph.on("node:click", (event) => {
      const nodeId = getEventTargetId(event);
      const node = nodesRef.current.find((item) => item.id === nodeId);
      if (node) onNodeSelectRef.current(node);
    });
    graph.on("canvas:click", () => onNodeSelectRef.current(null));
    graphRef.current = graph;

    const rendered = graph
      .render()
      .then(() => {
        if (graphRef.current === graph) return graph.fitView({ when: "always" });
      })
      .catch((error: unknown) => {
        if (graphRef.current === graph) {
          console.error("[kg-graph] Failed to render G6 graph:", error);
        }
      })
      .finally(() => {
        // 仅允许当前实例结束加载，避免旧实例销毁后的 Promise 覆盖新实例状态。
        if (graphRef.current === graph) setGraphReady(true);
      });

    if (document.fonts) {
      // 首次展示允许系统回退；字体就绪后仅重绘当前实例，保留用户的缩放和选中状态。
      void Promise.all([
        rendered,
        document.fonts.load(fontRequest),
      ])
        .then(([, fonts]) => {
          if (
            fonts.length > 0 &&
            graphRef.current === graph &&
            labelFontFamily !== fontFamily
          ) {
            // 更新标签样式使 G6 重新计算文字尺寸，单独 draw 不会刷新未变化的元素。
            const { node, combo, edge } = graph.getOptions();
            graph.setOptions({
              node: {
                ...node,
                style: { ...node?.style, labelFontFamily: fontFamily },
              },
              combo: {
                ...combo,
                style: { ...combo?.style, labelFontFamily: fontFamily },
              },
              edge: {
                ...edge,
                style: { ...edge?.style, labelFontFamily: fontFamily },
              },
            });
            return graph.draw();
          }
        })
        .catch(() => {
          // 字体加载失败时保留回退字体，不中断图谱展示。
        });
    }
  }, []);

  useEffect(() => {
    if (!active) {
      cleanup();
      setGraphReady(false);
      return;
    }
    if (nodes.length === 0) {
      cleanup();
      setGraphReady(true);
      return;
    }

    // 插件成员依赖当前节点集合，数据变化时重建实例以避免保留旧 BubbleSets。
    cleanup();
    setGraphReady(false);
    const tryInit = (attempt: number) => {
      const container = containerRef.current;
      if (!container) return;
      if (!container.clientWidth || !container.clientHeight) {
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
      createGraph(container);
    };
    const animationFrame = requestAnimationFrame(() => tryInit(0));
    return () => cancelAnimationFrame(animationFrame);
  }, [active, cleanup, createGraph, nodes, relations]);

  /**
   * 容器尺寸变化（分栏拖动、Inspector 开合、窗口缩放）后同步画布尺寸。
   * 只调用 G6 的 resize，不重建实例，保留用户当前的缩放、平移与选中状态。
   */
  useEffect(() => {
    if (!active || nodes.length === 0) return;
    const container = containerRef.current;
    if (!container) return;

    let frame: number | null = null;
    const syncSize = () => {
      frame = null;
      const graph = graphRef.current;
      if (!graph || container.clientWidth === 0 || container.clientHeight === 0) {
        return;
      }
      const [width, height] = graph.getSize();
      if (width === container.clientWidth && height === container.clientHeight) {
        return;
      }
      try {
        graph.resize();
      } catch (error) {
        console.error("[kg-graph] Failed to resize G6 graph:", error);
      }
    };

    // 尺寸变化合并到同一帧，避免拖动分栏时每个像素都触发重排。
    const observer = new ResizeObserver(() => {
      if (frame !== null) return;
      frame = requestAnimationFrame(syncSize);
    });
    observer.observe(container);
    return () => {
      observer.disconnect();
      if (frame !== null) cancelAnimationFrame(frame);
    };
  }, [active, nodes.length]);

  useEffect(() => cleanup, [cleanup]);

  return (
    <div className={`relative w-full bg-white ${className}`}>
      <div ref={containerRef} className="absolute inset-0" />
      {!graphReady && (
        <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-4 bg-white">
          <Spin size="large" />
          <Text type="secondary">
            正在渲染知识图谱，节点较多请耐心等待...
          </Text>
        </div>
      )}
    </div>
  );
});
