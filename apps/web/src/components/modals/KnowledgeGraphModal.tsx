/**
 * 知识图谱可视化弹窗
 *
 * 使用 AntV G6 渲染产品知识图谱的节点和关系图。
 * 节点按 entity 类型着色，关系以有向边展示并标注关系类型。
 *
 * Responsibilities:
 * - 从结构化知识图谱数据构建 G6 图数据
 * - 使用 dagre 布局自动排布节点
 * - 提供节点悬停提示和缩放/平移交互
 * - 提供图谱 Markdown 下载按钮
 *
 * Notes:
 * - 通过 requestAnimationFrame + 轮询等待容器尺寸就绪后再初始化 G6
 * - 使用 ref 保存最新 nodes/relations，避免闭包捕获过期数据
 * - G6 实例在弹窗关闭或组件卸载时销毁
 */
import { useEffect, useRef, type FC } from "react";
import { Button, Modal, Tooltip, message, Space } from "antd";
import { DownloadOutlined } from "@ant-design/icons";
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

/**
 * 知识图谱可视化弹窗组件。
 * 使用 AntV G6 渲染结构化节点与关系图，支持缩放平移及 Markdown 下载。
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

  // 使用 ref 保存最新数据，避免闭包捕获过期值
  const nodesRef = useRef(nodes);
  nodesRef.current = nodes;
  const relationsRef = useRef(relations);
  relationsRef.current = relations;

  // 清理所有 timer 和 graph 实例
  const cleanup = () => {
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
  };

  // 弹窗打开时初始化 G6，关闭时清理
  useEffect(() => {
    if (!open) {
      cleanup();
      return;
    }

    const currentNodes = nodesRef.current;
    if (currentNodes.length === 0) return;

    // 先清理上一轮实例
    cleanup();

    /**
     * 初始化 G6 图实例。
     * 通过轮询确保容器尺寸已就绪，再创建 Graph。
     */
    const tryInit = (attempt: number) => {
      const container = containerRef.current;
      if (!container) return;

      const width = container.clientWidth;
      const height = container.clientHeight;

      if (width === 0 || height === 0) {
        if (attempt < MAX_RETRIES) {
          timerRef.current = setTimeout(
            () => tryInit(attempt + 1),
            RETRY_INTERVAL,
          );
        }
        return;
      }

      const latestNodes = nodesRef.current;
      const latestRelations = relationsRef.current;

      // 转换 KG 节点为 G6 节点数据
      const g6Nodes = latestNodes.map((node) => ({
        id: node.id,
        data: {
          label: node.name,
          nodeType: node.type,
          description: node.description ?? "",
          status: node.status ?? "proposed",
          sourceTaskId: node.source_task_id ?? "",
        },
      }));

      // 转换 KG 关系为 G6 边数据
      const g6Edges = latestRelations.map((rel) => ({
        id: rel.id,
        source: rel.source,
        target: rel.target,
        data: {
          label: RELATION_TYPE_LABELS[rel.type] ?? rel.type,
          relType: rel.type,
          description: rel.description ?? "",
        },
      }));

      const graph = new Graph({
        container,
        width,
        height,
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
              return [
                Math.min(Math.max(label.length * 14 + 40, 100), 260),
                48,
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
            labelFontSize: 13,
            labelPlacement: "center",
            labelWordWrap: true,
            labelMaxWidth: 240,
          },
        },
        edge: {
          type: "cubic-horizontal",
          style: {
            stroke: "#c2c2c2",
            strokeWidth: 1.5,
            endArrow: true,
            labelText: (d: { data?: { label?: string } }) =>
              d.data?.label ?? "",
            labelFill: "#595959",
            labelFontSize: 11,
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
          { type: "hover-activate", degree: 1, direction: "both" },
        ],
        autoFit: "view",
        animation: false,
      });

      graphRef.current = graph;
      graph.render().catch((err: unknown) => {
        console.error("[kg-graph] Failed to render G6 graph:", err);
      });
    };

    // 使用 rAF 后再开始轮询，确保布局已完成一次渲染
    const rafId = requestAnimationFrame(() => {
      tryInit(0);
    });

    return () => {
      cancelAnimationFrame(rafId);
      cleanup();
    };
    // 仅以 open 为触发条件；nodes/relations 通过 ref 获取最新值
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // 下载知识图谱 Markdown
  const handleDownload = () => {
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

  return (
    <Modal
      centered
      mask={{ enabled: true, blur: true, closable: true }}
      width="90vw"
      style={{ maxWidth: 1280 }}
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
              {nodes.length} 节点 · {relations.length} 关系
            </span>
          </Space>
          <Tooltip title="下载 Markdown">
            <Button
              type="text"
              icon={<DownloadOutlined />}
              onClick={handleDownload}
            />
          </Tooltip>
        </div>
      }
    >
      <div style={{ display: "flex", height: "100%", gap: 0 }}>
        {/* 图例 */}
        <div
          style={{
            width: 160,
            flexShrink: 0,
            borderRight: "1px solid var(--line-soft, #e8e8e8)",
            padding: 12,
            overflowY: "auto",
          }}
        >
          <div
            style={{
              fontSize: 12,
              fontWeight: 500,
              color: "var(--ink-soft, #8c8c8c)",
              marginBottom: 8,
            }}
          >
            节点类型
          </div>
          {Object.entries(NODE_TYPE_LABELS).map(([type, label]) => (
            <div
              key={type}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                marginBottom: 6,
                fontSize: 12,
              }}
            >
              <span
                style={{
                  display: "inline-block",
                  width: 12,
                  height: 12,
                  borderRadius: 2,
                  flexShrink: 0,
                  background: NODE_COLORS[type] ?? NODE_COLORS.Custom,
                }}
              />
              <span>{label}</span>
            </div>
          ))}
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
            悬停高亮关联节点
          </div>
        </div>
        {/* 图容器，使用绝对定位确保尺寸计算可靠 */}
        <div style={{ flex: 1, minWidth: 0, position: "relative" }}>
          <div
            ref={containerRef}
            style={{
              position: "absolute",
              inset: 0,
            }}
          />
        </div>
      </div>
    </Modal>
  );
};
