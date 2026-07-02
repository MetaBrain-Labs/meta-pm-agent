/**
 * 策划产出文档页面
 *
 * 展示当前工作区已完成的产品知识图谱，并提供 PRD 文档后台生成入口。用户可以
 * 离开当前页面，生成任务继续由 API 后台运行；只有手动中断或服务不可用会停止任务。
 *
 * Responsibilities:
 * - 加载并展示工作区知识图谱 G6 视图
 * - 启动、轮询和中断 PRD 文档生成任务
 * - 展示 Document Agent 的 Task planning 和最新生成文档
 *
 * Notes:
 * - MRD/BRD 按钮先禁用，后续接入对应 Document Agent 工作流。
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Alert,
  Button,
  Empty,
  Layout,
  Modal,
  Space,
  Spin,
  Tag,
  Tooltip,
  Typography,
  message,
} from "antd";
import {
  ArrowLeftOutlined,
  CloseOutlined,
  DownloadOutlined,
  EyeOutlined,
  FileDoneOutlined,
  FileTextOutlined,
  PauseCircleOutlined,
  ReloadOutlined,
} from "@ant-design/icons";
import { Graph } from "@antv/g6";
import {
  fetchProductKnowledgeGraph,
  type KnowledgeGraphNodeData,
  type KnowledgeGraphRelationData,
  type WorkspaceKnowledgeGraphData,
} from "../../api/chat-api";
import {
  fetchDocumentGenerationRun,
  fetchLatestDocumentGeneration,
  startDocumentGeneration,
  stopDocumentGeneration,
  type DocumentQualityScore,
  type DocumentGenerationRun,
  type DocumentReasoningLogEntry,
  type DocumentScoreAttempt,
  type DocumentGenerationStatusResponse,
  type DocumentWorkflowStage,
} from "../../api/document-api";
import { TodoCard } from "../../components/TodoCard";
import { renderMarkdown } from "../../utils/markdown";
import { mapErrorToChinese } from "../../utils/errors";

const { Content } = Layout;
const { Text, Title } = Typography;

interface DocumentPlanningPageProps {
  workspaceId: string;
  workspaceName: string;
  onBack: () => void;
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

/** 节点类型对应的颜色，保持与知识图谱 Modal 一致。 */
const NODE_COLORS: Record<string, string> = {
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

/** 节点类型对应的中文标签，保持与知识图谱 Modal 一致。 */
const NODE_TYPE_LABELS: Record<string, string> = {
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

/** 节点类型对应的简化图标文本，保持与知识图谱 Modal 一致。 */
const NODE_TYPE_ICONS: Record<string, string> = {
  Goal: "◎",
  Requirement: "◇",
  Evidence: "◆",
  Decision: "✓",
  Feature: "✦",
  Component: "▣",
  Metric: "∑",
  Risk: "!",
  OpenQuestion: "?",
  Custom: "•",
};

/** 关系类型对应的中文标签，保持与知识图谱 Modal 一致。 */
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

/** 关系类型对应的边颜色，保持与知识图谱 Modal 一致。 */
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

const STAGE_LABELS: Record<DocumentWorkflowStage, string> = {
  parseKg: "读取当前知识图谱",
  normalizeGraph: "规范化图谱结构",
  buildSectionDossiers: "构建章节材料",
  draftSection: "Document Agent 生成 PRD",
  crossCheck: "交叉检查",
  scoreDraft: "三方评分 Agent 打分",
  aggregateScore: "分差合格后共识评分",
  humanReview: "人工审核节点",
  exportPrd: "导出 PRD",
};

/**
 * 策划产出文档页面。
 */
export function DocumentPlanningPage({
  workspaceId,
  workspaceName,
  onBack,
}: DocumentPlanningPageProps) {
  const [kgData, setKgData] = useState<WorkspaceKnowledgeGraphData | null>(
    null,
  );
  const [documentState, setDocumentState] =
    useState<DocumentGenerationStatusResponse>({ run: null, artifact: null });
  const [loading, setLoading] = useState(true);
  const [starting, setStarting] = useState(false);
  const [stopping, setStopping] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedNode, setSelectedNode] =
    useState<KnowledgeGraphNodeData | null>(null);
  const [artifactModalOpen, setArtifactModalOpen] = useState(false);
  const [messageApi, contextHolder] = message.useMessage();

  const run = documentState.run;
  const artifact = documentState.artifact;
  const runActive = run?.status === "queued" || run?.status === "running";
  const graphReady = (kgData?.nodes.length ?? 0) > 0;
  const qualityScore = artifact?.content?.qualityScore ?? null;
  const scoringAttempts =
    run?.scoringAttempts && run.scoringAttempts.length > 0
      ? run.scoringAttempts
      : qualityScore?.attempts ?? [];

  const refresh = useCallback(async () => {
    setError(null);
    const [graph, latestRun] = await Promise.all([
      fetchProductKnowledgeGraph(workspaceId),
      fetchLatestDocumentGeneration(workspaceId, "prd"),
    ]);
    setKgData(graph);
    setDocumentState(latestRun);
  }, [workspaceId]);

  const handleRefresh = useCallback(async () => {
    setLoading(true);
    setSelectedNode(null);
    try {
      await refresh();
    } catch (error) {
      console.error("[document] Failed to refresh page:", error);
      setError(toUserMessage(error));
    } finally {
      setLoading(false);
    }
  }, [refresh]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setSelectedNode(null);
    refresh()
      .catch((error) => {
        if (cancelled) return;
        console.error("[document] Failed to load page:", error);
        setError(toUserMessage(error));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [refresh]);

  useEffect(() => {
    if (!selectedNode) return;
    const stillExists = kgData?.nodes.some((node) => node.id === selectedNode.id);
    if (!stillExists) {
      setSelectedNode(null);
    }
  }, [kgData?.nodes, selectedNode]);

  useEffect(() => {
    if (!artifact) {
      setArtifactModalOpen(false);
    }
  }, [artifact]);

  useEffect(() => {
    if (!runActive || !run?.id) return;

    const timer = window.setInterval(() => {
      fetchDocumentGenerationRun(run.id)
        .then(setDocumentState)
        .catch((error) => {
          console.error("[document] Failed to poll run:", error);
          setError(toUserMessage(error));
        });
    }, 2500);

    return () => window.clearInterval(timer);
  }, [run?.id, runActive]);

  const handleGeneratePrd = useCallback(async () => {
    if (starting || runActive) return;
    setStarting(true);
    setError(null);

    try {
      const next = await startDocumentGeneration(workspaceId, "prd");
      setDocumentState(next);
      void messageApi.success("PRD 生成任务已进入后台。");
    } catch (error) {
      console.error("[document] Failed to start PRD:", error);
      setError(toUserMessage(error));
    } finally {
      setStarting(false);
    }
  }, [messageApi, runActive, starting, workspaceId]);

  const handleStop = useCallback(async () => {
    if (!run?.id || stopping) return;
    setStopping(true);

    try {
      await stopDocumentGeneration(run.id);
      setDocumentState(await fetchDocumentGenerationRun(run.id));
      void messageApi.success("文档生成任务已中断。");
    } catch (error) {
      console.error("[document] Failed to stop run:", error);
      setError(toUserMessage(error));
    } finally {
      setStopping(false);
    }
  }, [messageApi, run?.id, stopping]);

  const handleDownloadArtifact = useCallback(() => {
    if (!artifact) return;

    try {
      const blob = new Blob([artifact.markdown], {
        type: "text/markdown;charset=utf-8",
      });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = buildMarkdownFilename(artifact.title, workspaceId);
      document.body.appendChild(anchor);
      anchor.click();
      document.body.removeChild(anchor);
      URL.revokeObjectURL(url);
      void messageApi.success("PRD Markdown 已下载。");
    } catch (error) {
      console.error("[document] Failed to download artifact:", error);
      void messageApi.error("下载失败，请重试。");
    }
  }, [artifact, messageApi, workspaceId]);

  const statusTag = useMemo(() => renderRunStatus(run), [run]);

  return (
    <Content className="h-screen overflow-hidden bg-transparent">
      {contextHolder}
      <div className="h-full flex flex-col">
        <header className="shrink-0 px-6 py-4 border-b border-gray-200 bg-white">
          <div className="flex items-center justify-between gap-4">
            <div className="min-w-0 flex items-center gap-3">
              <Tooltip title="返回工作区">
                <Button
                  type="text"
                  icon={<ArrowLeftOutlined />}
                  onClick={onBack}
                />
              </Tooltip>
              <div className="min-w-0">
                <Title level={4} className="!m-0 truncate">
                  策划产出文档
                </Title>
                <Text type="secondary" className="block truncate">
                  {workspaceName}
                </Text>
              </div>
            </div>
            <Space size="small">
              {statusTag}
              <Tooltip title="刷新图谱和文档任务">
                <Button
                  icon={<ReloadOutlined />}
                  loading={loading}
                  onClick={() => void handleRefresh()}
                />
              </Tooltip>
            </Space>
          </div>
        </header>

        <main className="min-h-0 flex-1 overflow-y-auto scrollbar-none-thin px-6 py-5">
          {loading ? (
            <PageLoadingState />
          ) : (
            <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1.45fr)_minmax(360px,0.55fr)] gap-4">
              <section className="min-h-[620px] rounded border border-gray-200 bg-white overflow-hidden xl:sticky xl:top-0 xl:self-start">
                <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between">
                  <div>
                    <Text strong>当前知识图谱</Text>
                    <Text type="secondary" className="ml-2 text-xs">
                      {kgData
                        ? `${kgData.nodes.length} 节点 / ${kgData.relations.length} 关系`
                        : "未加载"}
                    </Text>
                  </div>
                  {kgData?.updatedAt && (
                    <Text type="secondary" className="text-xs">
                      v{kgData.version}
                    </Text>
                  )}
                </div>
                {graphReady ? (
                  <KnowledgeGraphCanvas
                    nodes={kgData?.nodes ?? []}
                    relations={kgData?.relations ?? []}
                    onSelectNode={setSelectedNode}
                  />
                ) : (
                  <div className="h-[620px] flex items-center justify-center">
                    <Empty description="当前工作区还没有可用于生成文档的知识图谱" />
                  </div>
                )}
              </section>

              <aside className="flex flex-col gap-4">
                {error && (
                  <Alert
                    type="error"
                    showIcon
                    message={error}
                    closable
                    onClose={() => setError(null)}
                  />
                )}

                <NodeDetailPanel
                  node={selectedNode}
                  totalNodes={kgData?.nodes.length ?? 0}
                  onClose={() => setSelectedNode(null)}
                />

                <section className="rounded border border-gray-200 bg-white p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <Text strong>Document Agent</Text>
                      <Text type="secondary" className="block text-xs mt-1">
                        PRD 工作流独立运行，页面切换不会中断后台任务。
                      </Text>
                    </div>
                    {runActive && <Spin size="small" />}
                  </div>

                  <div className="mt-4 flex flex-col gap-2 text-sm">
                    <InfoRow label="任务 ID" value={run?.id ?? "-"} />
                    <InfoRow
                      label="当前阶段"
                      value={
                        run?.currentStage
                          ? STAGE_LABELS[run.currentStage]
                          : runActive
                            ? "等待调度"
                            : "-"
                      }
                    />
                    <InfoRow
                      label="完成时间"
                      value={run?.finishedAt ? formatDate(run.finishedAt) : "-"}
                    />
                    {run?.errorMessage && (
                      <Alert
                        type="warning"
                        showIcon
                        message={run.errorMessage}
                      />
                    )}
                  </div>
                </section>

                {run?.todos && run.todos.length > 0 && (
                  <TodoCard todos={run.todos} />
                )}

                <ReasoningLogPanel entries={run?.reasoningLog ?? []} />

                <ScoringResultPanel
                  attempts={scoringAttempts}
                  qualityScore={qualityScore}
                  currentStage={run?.currentStage ?? null}
                />

                {artifact && (
                  <section className="rounded border border-gray-200 bg-white p-4">
                    <div className="flex items-center justify-between gap-3 mb-3">
                      <div className="min-w-0">
                        <Text strong className="block truncate">
                          {artifact.title}
                        </Text>
                        <Text type="secondary" className="text-xs">
                          PRD v{artifact.version}
                        </Text>
                      </div>
                      <Space size="small" wrap>
                        <Tag color="success" icon={<FileDoneOutlined />}>
                          已生成
                        </Tag>
                        <Button
                          size="small"
                          icon={<EyeOutlined />}
                          onClick={() => setArtifactModalOpen(true)}
                        >
                          查看完整 MD
                        </Button>
                        <Button
                          size="small"
                          icon={<DownloadOutlined />}
                          onClick={handleDownloadArtifact}
                        >
                          下载 MD
                        </Button>
                      </Space>
                    </div>
                    <Text type="secondary" className="text-xs">
                      正文内容仅在完整 Markdown 弹窗中展示。
                    </Text>
                  </section>
                )}
              </aside>
            </div>
          )}
        </main>

        <footer className="shrink-0 border-t border-gray-200 bg-white px-6 py-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <Text type="secondary" className="text-xs">
              PRD 生成开始后会进入后台；只有手动中断或服务不可用会停止。
            </Text>
            <Space wrap>
              {runActive && (
                <Button
                  danger
                  icon={<PauseCircleOutlined />}
                  loading={stopping}
                  onClick={handleStop}
                >
                  中断
                </Button>
              )}
              <Button
                type="primary"
                icon={<FileTextOutlined />}
                loading={starting}
                disabled={!graphReady || runActive}
                onClick={handleGeneratePrd}
              >
                生成 PRD
              </Button>
              <Tooltip title="MRD 工作流尚未接入">
                <Button disabled>生成 MRD</Button>
              </Tooltip>
              <Tooltip title="BRD 工作流尚未接入">
                <Button disabled>生成 BRD</Button>
              </Tooltip>
            </Space>
          </div>
        </footer>

        <Modal
          centered
          width="min(960px, 92vw)"
          open={artifactModalOpen}
          title={artifact?.title ?? "PRD Markdown"}
          footer={
            artifact ? (
              <Space>
                <Button
                  icon={<DownloadOutlined />}
                  onClick={handleDownloadArtifact}
                >
                  下载 MD
                </Button>
                <Button
                  type="primary"
                  onClick={() => setArtifactModalOpen(false)}
                >
                  关闭
                </Button>
              </Space>
            ) : null
          }
          onCancel={() => setArtifactModalOpen(false)}
          styles={{
            body: {
              maxHeight: "72vh",
              overflowY: "auto",
              paddingRight: 16,
            },
          }}
        >
          {artifact ? (
            <div className="text-sm leading-7">
              {renderMarkdown(artifact.markdown)}
            </div>
          ) : (
            <Empty description="暂无可查看的 PRD 内容" />
          )}
        </Modal>
      </div>
    </Content>
  );
}

/**
 * 嵌入式 G6 知识图谱画布。
 */
function KnowledgeGraphCanvas({
  nodes,
  relations,
  onSelectNode,
}: {
  nodes: KnowledgeGraphNodeData[];
  relations: KnowledgeGraphRelationData[];
  onSelectNode: (node: KnowledgeGraphNodeData | null) => void;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [graphReady, setGraphReady] = useState(false);

  useEffect(() => {
    const container = containerRef.current;
    if (!container || nodes.length === 0) {
      setGraphReady(true);
      return;
    }

    let disposed = false;
    let graph: Graph | null = null;
    let timer: number | null = null;
    const validNodeIds = new Set(nodes.map((node) => node.id));
    const validRelations = relations.filter(
      (relation) =>
        validNodeIds.has(relation.source) && validNodeIds.has(relation.target),
    );

    setGraphReady(false);

    /**
     * 初始化图谱实例，保持视觉参数与知识图谱 Modal 一致。
     */
    const buildAndRenderGraph = () => {
      if (disposed) return;

      graph = new Graph({
        container,
        width: container.clientWidth,
        height: container.clientHeight,
        background: "#ffffff",
        data: buildGraphData(nodes, validRelations),
        layout: {
          type: "dagre",
          rankdir: nodes.length > 18 ? "LR" : "TB",
          nodesep: nodes.length > 40 ? 72 : 96,
          ranksep: nodes.length > 40 ? 118 : 152,
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
          type: nodes.length > 18 ? "cubic-horizontal" : "cubic-vertical",
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
              return Boolean(targetId && !targetId.startsWith("kg-combo-"));
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
        plugins: buildGraphPlugins(nodes, validRelations),
        autoFit: "view",
        animation: false,
      });

      graph
        .render()
        .then(async () => {
          try {
            await graph?.fitView({ when: "always" });
          } catch {
            // fitView 失败不影响用户继续查看图谱。
          }
        })
        .catch((error: unknown) => {
          console.error("[document-kg] Failed to render graph:", error);
        })
        .finally(() => {
          if (!disposed) {
            setGraphReady(true);
          }
        });

      // 点击节点时把完整节点数据交给右侧详情框。
      graph.on("node:click", (event) => {
        const nodeId = getEventTargetId(event);
        if (!nodeId) return;
        const found = nodes.find((node) => node.id === nodeId);
        if (found) {
          onSelectNode(found);
        }
      });

      // 点击画布空白处取消选中，避免右侧详情误导用户。
      graph.on("canvas:click", () => {
        onSelectNode(null);
      });
    };

    /**
     * 等待容器尺寸就绪后再初始化，避免 G6 在 0 尺寸容器中渲染空白。
     */
    const tryInit = (attempt: number) => {
      if (disposed) return;

      if (!container.clientWidth || !container.clientHeight) {
        if (attempt < MAX_RETRIES) {
          timer = window.setTimeout(
            () => tryInit(attempt + 1),
            RETRY_INTERVAL,
          );
        } else {
          setGraphReady(true);
        }
        return;
      }

      buildAndRenderGraph();
    };

    const rafId = window.requestAnimationFrame(() => {
      tryInit(0);
    });

    return () => {
      disposed = true;
      window.cancelAnimationFrame(rafId);
      if (timer) {
        window.clearTimeout(timer);
      }
      try {
        graph?.destroy();
      } catch {
        // 忽略销毁错误，保持页面切换稳定。
      }
    };
  }, [nodes, onSelectNode, relations]);

  return (
    <div className="relative h-[620px] w-full bg-white">
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
}

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
  relation: KnowledgeGraphRelationData,
  showLabel: boolean,
) => ({
  id: relation.id,
  source: relation.source,
  target: relation.target,
  data: {
    label: showLabel
      ? RELATION_TYPE_LABELS[relation.type] ?? relation.type
      : "",
    tooltipLabel: RELATION_TYPE_LABELS[relation.type] ?? relation.type,
    relType: relation.type,
    description: relation.description ?? "",
    sourceTaskId: relation.source_task_id ?? "",
  },
});

/**
 * 构建 G6 图数据，结构保持与知识图谱 Modal 一致。
 */
function buildGraphData(
  nodes: KnowledgeGraphNodeData[],
  relations: KnowledgeGraphRelationData[],
) {
  const visibleTypes = Array.from(new Set(nodes.map((node) => node.type)));
  const showEdgeLabels = relations.length <= MAX_VISIBLE_EDGE_LABELS;

  return {
    nodes: nodes.map(toG6Node),
    combos: visibleTypes.map(toG6Combo),
    edges: relations.map((relation) => toG6Edge(relation, showEdgeLabels)),
  };
}

/**
 * 为节点类型构建 BubbleSets 插件配置。
 */
const buildBubbleSetsPlugins = (nodes: KnowledgeGraphNodeData[]) => {
  if (nodes.length === 0 || nodes.length > MAX_BUBBLE_SET_NODES) {
    return [];
  }

  const grouped = nodes.reduce<Record<string, string[]>>((acc, node) => {
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
 * 构建嵌入式 G6 插件配置，保留 Modal 的 tooltip、minimap、边聚合和分组轮廓。
 */
const buildGraphPlugins = (
  nodes: KnowledgeGraphNodeData[],
  relations: KnowledgeGraphRelationData[],
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
  ...(relations.length > 6 && relations.length <= MAX_EDGE_BUNDLING_EDGES
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

/**
 * 页面首屏加载态，确保进入策划产出文档页面后再加载并有明确动画反馈。
 */
function PageLoadingState() {
  return (
    <div className="min-h-[620px] rounded border border-gray-200 bg-white flex flex-col items-center justify-center gap-4">
      <Spin size="large" />
      <div className="text-center">
        <Text strong>正在加载策划产出文档数据</Text>
        <Text type="secondary" className="block mt-1 text-xs">
          正在读取当前知识图谱和 Document Agent 任务状态...
        </Text>
      </div>
    </div>
  );
}

/**
 * 右侧节点详情框，展示用户在图谱中点击的节点信息。
 */
function NodeDetailPanel({
  node,
  totalNodes,
  onClose,
}: {
  node: KnowledgeGraphNodeData | null;
  totalNodes: number;
  onClose: () => void;
}) {
  if (!node) {
    return (
      <section className="rounded border border-gray-200 bg-white p-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <Text strong>节点详情</Text>
            <Text type="secondary" className="block text-xs mt-1">
              点击左侧图谱节点后，这里会显示对应节点信息。
            </Text>
          </div>
          <Tag>{totalNodes} 节点</Tag>
        </div>
      </section>
    );
  }

  return (
    <section className="rounded border border-gray-200 bg-white p-4">
      <div className="flex items-start justify-between gap-3 mb-3">
        <div className="min-w-0">
          <Text strong className="block truncate">
            节点详情
          </Text>
          <Text type="secondary" className="block text-xs mt-1 truncate">
            {node.id}
          </Text>
        </div>
        <Button
          type="text"
          size="small"
          icon={<CloseOutlined />}
          onClick={onClose}
        />
      </div>

      <div className="flex flex-col gap-3 text-sm">
        <div>
          <Text type="secondary" className="block text-xs mb-1">
            名称
          </Text>
          <Text className="break-words">{node.name}</Text>
        </div>
        <div>
          <Text type="secondary" className="block text-xs mb-1">
            类型
          </Text>
          <Tag color={getNodeColor(node.type)} className="m-0">
            {NODE_TYPE_LABELS[node.type] ?? node.type}
          </Tag>
        </div>
        {node.description && (
          <div>
            <Text type="secondary" className="block text-xs mb-1">
              描述
            </Text>
            <Text className="break-words leading-6">{node.description}</Text>
          </div>
        )}
        {node.status && (
          <div>
            <Text type="secondary" className="block text-xs mb-1">
              状态
            </Text>
            <Text>{getNodeStatusLabel(node.status)}</Text>
          </div>
        )}
        {node.source_task_id && (
          <div>
            <Text type="secondary" className="block text-xs mb-1">
              来源任务
            </Text>
            <Text className="break-all">{node.source_task_id}</Text>
          </div>
        )}
      </div>
    </section>
  );
}

/**
 * 展示 Document Agent 和评分 Agent 的持久化思考过程。
 */
function ReasoningLogPanel({
  entries,
}: {
  entries: DocumentReasoningLogEntry[];
}) {
  return (
    <section className="rounded border border-gray-200 bg-white p-4">
      <div className="flex items-center justify-between gap-3 mb-3">
        <Text strong>思考过程</Text>
        <Tag>{entries.length} 条</Tag>
      </div>
      {entries.length === 0 ? (
        <Text type="secondary" className="text-xs">
          暂无思考记录，任务开始后会在这里持续更新。
        </Text>
      ) : (
        <div className="max-h-[280px] overflow-y-auto pr-1 flex flex-col gap-3">
          {entries.slice(-12).map((entry) => (
            <div
              key={`${entry.index}-${entry.createdAt}`}
              className="rounded bg-gray-50 px-3 py-2"
            >
              <div className="flex items-center justify-between gap-2 mb-1">
                <Tag className="m-0">{getReasoningAgentLabel(entry.agentType)}</Tag>
                <Text type="secondary" className="text-[11px]">
                  {formatDate(entry.createdAt)}
                </Text>
              </div>
              <Text className="text-xs whitespace-pre-wrap break-words">
                {entry.content}
              </Text>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

/**
 * 展示 PRD 评分状态和每轮评分结果。
 */
function ScoringResultPanel({
  attempts,
  qualityScore,
  currentStage,
}: {
  attempts: DocumentScoreAttempt[];
  qualityScore: DocumentQualityScore | null;
  currentStage: DocumentWorkflowStage | null;
}) {
  const scoringActive =
    currentStage === "scoreDraft" || currentStage === "aggregateScore";

  return (
    <section className="rounded border border-gray-200 bg-white p-4">
      <div className="flex items-center justify-between gap-3 mb-3">
        <div>
          <Text strong>评分结果</Text>
          <Text type="secondary" className="block text-xs mt-1">
            三位评分 Agent 分差超过 8 分时跳过共识评分并重试，分差合格后才进入共识评分。
          </Text>
        </div>
        {scoringActive ? <Spin size="small" /> : <Tag>{attempts.length}/3 轮</Tag>}
      </div>

      {qualityScore && (
        <div className="rounded bg-gray-50 px-3 py-2 mb-3 text-sm">
          <div className="flex flex-wrap items-center gap-2">
            <Tag color={qualityScore.passed ? "success" : "warning"}>
              最终 {qualityScore.finalScore} / {qualityScore.threshold}
            </Tag>
            <Tag>选择第 {qualityScore.selectedAttempt} 轮</Tag>
            <Tag>{getSelectionReasonLabel(qualityScore.selectionReason)}</Tag>
          </div>
        </div>
      )}

      {attempts.length === 0 ? (
        <Text type="secondary" className="text-xs">
          暂无评分结果，PRD 草稿生成后开始评分。
        </Text>
      ) : (
        <div className="flex flex-col gap-3">
          {attempts.map((attempt) => (
            <div key={attempt.attempt} className="rounded border border-gray-100 p-3">
              <div className="flex flex-wrap items-center gap-2 mb-2">
                <Text strong>第 {attempt.attempt} 轮</Text>
                <Tag color={attempt.varianceAccepted ? "success" : "error"}>
                  分差 {attempt.scoreSpread}
                </Tag>
                <Tag color={attempt.aggregate.passed ? "success" : "warning"}>
                  {attempt.varianceAccepted ? "共识" : "跳过共识"} {attempt.aggregate.score}
                </Tag>
                {attempt.selected && <Tag color="processing">已选中</Tag>}
              </div>
              <div className="grid grid-cols-3 gap-2 mb-2">
                {attempt.reviewerScores.map((review) => (
                  <div key={review.reviewerId} className="rounded bg-gray-50 p-2">
                    <Text type="secondary" className="block text-[11px] truncate">
                      {review.reviewerName}
                    </Text>
                    <Text strong>{review.score}</Text>
                  </div>
                ))}
              </div>
              <Text type="secondary" className="text-xs whitespace-pre-wrap">
                {attempt.aggregate.rationale}
              </Text>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

/**
 * 渲染后台 run 状态标签。
 */
function renderRunStatus(run: DocumentGenerationRun | null) {
  if (!run) return <Tag>未生成</Tag>;
  if (run.status === "completed") return <Tag color="success">已完成</Tag>;
  if (run.status === "failed") return <Tag color="error">失败</Tag>;
  if (run.status === "stopped") return <Tag color="warning">已中断</Tag>;
  if (run.status === "queued") return <Tag color="processing">排队中</Tag>;
  return <Tag color="processing">生成中</Tag>;
}

/**
 * 信息行。
 */
function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid grid-cols-[72px_minmax(0,1fr)] gap-2">
      <Text type="secondary">{label}</Text>
      <Text className="truncate" title={value}>
        {value}
      </Text>
    </div>
  );
}

/**
 * 获取节点颜色。
 */
function getNodeColor(type?: string): string {
  return NODE_COLORS[type ?? "Custom"] ?? NODE_COLORS.Custom;
}

/**
 * 获取关系颜色。
 */
function getRelationColor(type?: string): string {
  return RELATION_COLORS[type ?? "Custom"] ?? RELATION_COLORS.Custom;
}

/**
 * 从 G6 通用事件中安全读取目标元素 ID。
 */
function getEventTargetId(event: unknown): string {
  const target = (event as { target?: { id?: unknown } })?.target;
  return typeof target?.id === "string" ? target.id : "";
}

/**
 * 转义 tooltip HTML，避免图谱内容被当作 DOM 注入。
 */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * 截断过长的节点名称。
 */
function truncateName(name: string, maxLen = MAX_NAME_LENGTH): string {
  return name.length > maxLen ? `${name.slice(0, maxLen - 1)}...` : name;
}

/**
 * 将节点类型转换为稳定的 Combo ID。
 */
function toComboId(type: string): string {
  return `kg-combo-${type.replace(/[^a-zA-Z0-9_-]/g, "-") || "Custom"}`;
}

/**
 * 将节点状态转换为用户可读文本。
 */
function getNodeStatusLabel(status: string): string {
  if (status === "proposed") return "待确认";
  if (status === "confirmed") return "已确认";
  if (status === "deprecated") return "已废弃";
  return status;
}

/**
 * 将思考日志 Agent 类型转换为展示名称。
 */
function getReasoningAgentLabel(agentType: string): string {
  if (agentType === "document") return "Document Agent";
  if (agentType === "document-score") return "评分 Agent";
  if (agentType === "document-workflow") return "文档工作流";
  return agentType;
}

/**
 * 将最终选择原因转换为展示名称。
 */
function getSelectionReasonLabel(reason: string): string {
  if (reason === "passed_threshold") return "通过阈值";
  if (reason === "lowest_spread") return "最小分差";
  if (reason === "highest_score") return "最高评分";
  if (reason === "highest_score_then_lowest_spread") return "最高评分，同分看分差";
  return reason;
}

/**
 * 格式化时间。
 */
function formatDate(value: string): string {
  return new Date(value).toLocaleString();
}

/**
 * 构建安全的 Markdown 下载文件名。
 */
function buildMarkdownFilename(title: string, workspaceId: string): string {
  const safeTitle = title
    .trim()
    .replace(/[\\/:*?"<>|]/g, "-")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .slice(0, 80);
  const fallbackTitle = safeTitle || "prd-document";
  return `${fallbackTitle}-${workspaceId}.md`;
}

/**
 * 转换错误提示，优先保留 API 返回的业务文案。
 */
function toUserMessage(error: unknown): string {
  if (error instanceof Error && error.message && !error.message.startsWith("Server error")) {
    return error.message;
  }

  return mapErrorToChinese(error);
}
