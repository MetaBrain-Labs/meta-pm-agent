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
 * - v0.1 仅展示已经接入的 PRD 工作流。
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Alert,
  Button,
  Empty,
  Input,
  Layout,
  Modal,
  Select,
  Space,
  Tabs,
  Tag,
  Tooltip,
  Typography,
  message,
} from "antd";
import {
  ArrowLeftOutlined,
  CloseOutlined,
  CommentOutlined,
  DownloadOutlined,
  PlusOutlined,
  EyeOutlined,
  ExclamationCircleOutlined,
  FileSearchOutlined,
  FileTextOutlined,
  PauseCircleOutlined,
  PlayCircleOutlined,
  ReloadOutlined,
  SearchOutlined,
  WarningOutlined,
} from "@ant-design/icons";
import {
  fetchProductKnowledgeGraph,
  fetchModelProfiles,
  selectDefaultModelProfile,
  type KnowledgeGraphNodeData,
  type WorkspaceKnowledgeGraphData,
} from "../../api/chat-api";
import {
  createDocumentEvidenceResolution,
  fetchDocumentGenerationRun,
  fetchLatestDocumentGeneration,
  resumeDocumentGeneration,
  startDocumentGeneration,
  stopDocumentGeneration,
  type DocumentKind,
  type DocumentQualityScore,
  type DocumentEvidenceBlockerGroup,
  type DocumentGenerationRun,
  type DocumentReasoningLogEntry,
  type DocumentScoreAttempt,
  type DocumentGenerationStatusResponse,
  type DocumentWorkflowStage,
} from "../../api/document-api";
import { ModelProfileSelector } from "../../components/ModelProfileSelector";
import { GlobalLoader } from "../../components/ui/GlobalLoader";
import { TodoCard } from "../../components/TodoCard";
import { SYSTEM_MODEL_PROFILE_ID } from "../../constants/app";
import {
  KnowledgeGraphView,
  NODE_TYPE_LABELS,
  getKnowledgeGraphNodeColor,
} from "../../components/KnowledgeGraphView";
import { formatDisplayId } from "../../utils/display-id";
import {
  buildContentSummary,
  extractMarkdownOutline,
} from "../../utils/markdown-outline";
import { renderMarkdown } from "../../utils/markdown";
import { mapErrorToChinese } from "../../utils/errors";
import type { ModelUsageProfile, ThreadInfo } from "../../types";

const { Content } = Layout;
const { Text, Title } = Typography;

interface DocumentPlanningPageProps {
  workspaceId: string;
  workspaceName: string;
  onBack: () => void;
  onOpenEvidenceThread: (thread: ThreadInfo, autoStart: boolean) => void;
  /**
   * 嵌入工作区面板时隐藏本页标题栏并占满容器；独立路由下保持整页布局。
   */
  embedded?: boolean;
  /**
   * 是否隐藏知识图谱画布。
   *
   * 嵌入工作区「交付文档」面板时置 true：图谱有自己的「知识图谱」入口，
   * 交付文档只负责 PRD 任务。独立路由 /documents/:workspaceId 仍展示完整页面。
   */
  hideGraph?: boolean;
}

const STAGE_LABELS: Record<DocumentWorkflowStage, string> = {
  parseKg: "读取当前知识图谱",
  normalizeGraph: "规范化图谱结构",
  buildSectionDossiers: "构建章节材料",
  draftSection: "Document Agent 生成 PRD",
  crossCheck: "交叉检查",
  scoreDraft: "三方评分 Agent 打分",
  groupEvidenceBlockers: "合并三方证据阻断",
  aggregateScore: "分差合格后共识评分",
  humanReview: "自动质量审核",
  exportPrd: "导出 PRD",
};

/** 文档表格中的一行；当前只有 PRD 一个真实产物来源。 */
interface DocumentRow {
  id: string;
  title: string;
  kind: DocumentKind;
  kindLabel: string;
  updatedAt: string;
  statusLabel: string;
  /** 状态色调，与 .doc-status[data-tone] 对应。 */
  tone: "done" | "running" | "idle";
  /** 可预览/下载的正文；进行中的行为 null。 */
  markdown: string | null;
}

/**
 * 策划产出文档页面。
 */
export function DocumentPlanningPage({
  workspaceId,
  workspaceName,
  onBack,
  onOpenEvidenceThread,
  embedded = false,
  hideGraph = false,
}: DocumentPlanningPageProps) {
  const [kgData, setKgData] = useState<WorkspaceKnowledgeGraphData | null>(
    null,
  );
  const [documentState, setDocumentState] =
    useState<DocumentGenerationStatusResponse>({ run: null, artifact: null });
  const [loading, setLoading] = useState(true);
  const [starting, setStarting] = useState(false);
  const [stopping, setStopping] = useState(false);
  const [resolvingEvidence, setResolvingEvidence] = useState(false);
  const [resuming, setResuming] = useState(false);
  const [blockersOpen, setBlockersOpen] = useState(false);
  const [modelProfiles, setModelProfiles] = useState<ModelUsageProfile[]>([]);
  const [selectedModelProfileId, setSelectedModelProfileId] = useState(
    SYSTEM_MODEL_PROFILE_ID,
  );
  const [error, setError] = useState<string | null>(null);
  const [selectedNode, setSelectedNode] =
    useState<KnowledgeGraphNodeData | null>(null);
  const [previewDocument, setPreviewDocument] = useState<{
    title: string;
    markdown: string;
  } | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [kindFilter, setKindFilter] = useState<DocumentKind | "all">("all");
  const [statusFilter, setStatusFilter] = useState<
    "all" | "done" | "running" | "idle"
  >("all");
  const [messageApi, contextHolder] = message.useMessage();
  /** 用户是否在本页亲手切换过模型列表；用于区分「用户选择」与「服务端默认」。 */
  const userSelectedModelProfileRef = useRef(false);

  const run = documentState.run;
  const artifact = documentState.artifact;
  const runActive = run?.status === "queued" || run?.status === "running";
  const awaitingInput = run?.status === "awaiting_input";
  const graphReady = (kgData?.nodes.length ?? 0) > 0;
  const qualityScore = artifact?.content?.qualityScore ?? null;
  const scoringAttempts =
    run?.scoringAttempts && run.scoringAttempts.length > 0
      ? run.scoringAttempts
      : (qualityScore?.attempts ?? []);
  const latestScoringAttempt = scoringAttempts.at(-1);
  const evidenceBlockerGroups = getEvidenceBlockerGroups(latestScoringAttempt);
  const sourceGraphVersion = artifact?.content?.sourceGraphStats?.version;
  const evidenceResolution = documentState.evidenceResolution;
  const canResume =
    awaitingInput &&
    evidenceResolution?.status === "completed" &&
    typeof sourceGraphVersion === "number" &&
    typeof evidenceResolution.resolvedGraphVersion === "number" &&
    evidenceResolution.resolvedGraphVersion > sourceGraphVersion &&
    typeof kgData?.version === "number" &&
    kgData.version >= evidenceResolution.resolvedGraphVersion;

  const refresh = useCallback(async () => {
    setError(null);
    const [graph, latestRun] = await Promise.all([
      fetchProductKnowledgeGraph(workspaceId),
      fetchLatestDocumentGeneration(workspaceId, "prd"),
    ]);
    setKgData(graph);
    setDocumentState(latestRun);
  }, [workspaceId]);

  const refreshModelProfiles = useCallback(async () => {
    const { profiles, defaultProfileId } = await fetchModelProfiles();
    setModelProfiles(profiles);
    /*
     * 首次加载预选用户记住的默认列表；用户在本页亲手选过时保留该选择（列表被删则回退）。
     */
    setSelectedModelProfileId((current) => {
      const preferred = userSelectedModelProfileRef.current
        ? current
        : defaultProfileId;
      return profiles.some((profile) => profile.id === preferred)
        ? preferred
        : SYSTEM_MODEL_PROFILE_ID;
    });
  }, []);

  /** 文档页的显式选择同样被记住，后续会话与文档运行都以它为默认。 */
  const changeModelProfile = useCallback(async (profileId: string) => {
    userSelectedModelProfileRef.current = true;
    setSelectedModelProfileId(profileId);
    try {
      await selectDefaultModelProfile(profileId);
    } catch {
      // 记住默认失败不影响本轮生成：startDocumentGeneration 会带上当前选择。
      console.error("[document] Failed to remember model profile:", profileId);
    }
  }, []);

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
    const reload = () => {
      void refreshModelProfiles().catch((error) => {
        console.error("[document] Failed to load model profiles:", error);
        setError(toUserMessage(error));
      });
    };
    reload();
    window.addEventListener("model-profiles-changed", reload);
    return () => window.removeEventListener("model-profiles-changed", reload);
  }, [refreshModelProfiles]);

  useEffect(() => {
    if (!selectedNode) return;
    const stillExists = kgData?.nodes.some(
      (node) => node.id === selectedNode.id,
    );
    if (!stillExists) {
      setSelectedNode(null);
    }
  }, [kgData?.nodes, selectedNode]);

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
      const next = await startDocumentGeneration(
        workspaceId,
        "prd",
        selectedModelProfileId,
      );
      setDocumentState(next);
      void messageApi.success("PRD 生成任务已进入后台。");
    } catch (error) {
      console.error("[document] Failed to start PRD:", error);
      setError(toUserMessage(error));
    } finally {
      setStarting(false);
    }
  }, [messageApi, runActive, selectedModelProfileId, starting, workspaceId]);

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

  const handleResolveEvidence = useCallback(async () => {
    if (!run?.id || !awaitingInput || resolvingEvidence) return;
    setResolvingEvidence(true);
    setError(null);
    try {
      const result = await createDocumentEvidenceResolution(
        run.id,
        selectedModelProfileId,
      );
      onOpenEvidenceThread(result.thread, result.autoStart);
    } catch (error) {
      console.error("[document] Failed to open evidence resolution:", error);
      setError(toUserMessage(error));
    } finally {
      setResolvingEvidence(false);
    }
  }, [
    awaitingInput,
    onOpenEvidenceThread,
    resolvingEvidence,
    run?.id,
    selectedModelProfileId,
  ]);

  const handleResume = useCallback(async () => {
    if (!run?.id || !canResume || resuming) return;
    setResuming(true);
    setError(null);
    try {
      setDocumentState(
        await resumeDocumentGeneration(run.id, selectedModelProfileId),
      );
      void messageApi.success("PRD 已从下一轮继续生成。");
    } catch (error) {
      console.error("[document] Failed to resume PRD:", error);
      setError(toUserMessage(error));
    } finally {
      setResuming(false);
    }
  }, [canResume, messageApi, resuming, run?.id, selectedModelProfileId]);

  const handleDownloadMarkdown = useCallback(
    (markdown: string, title: string) => {
      try {
        const blob = new Blob([markdown], {
          type: "text/markdown;charset=utf-8",
        });
        const url = URL.createObjectURL(blob);
        const anchor = document.createElement("a");
        anchor.href = url;
        anchor.download = buildMarkdownFilename(title, workspaceId);
        document.body.appendChild(anchor);
        anchor.click();
        document.body.removeChild(anchor);
        URL.revokeObjectURL(url);
        void messageApi.success("PRD Markdown 已下载。");
      } catch (error) {
        console.error("[document] Failed to download artifact:", error);
        void messageApi.error("下载失败，请重试。");
      }
    },
    [messageApi, workspaceId],
  );

  const statusTag = useMemo(() => renderRunStatus(run), [run]);

  /**
   * 文档表格行。
   *
   * 当前只有「最新一版 PRD」这一个真实产物来源，因此最多一行；生成中且尚无
   * 产物时用 run 生成一行进行中状态，保证运行态在列表里可见。列表接口提供后
   * 只需在此处追加数据源。
   */
  const rows = useMemo<DocumentRow[]>(() => {
    if (artifact) {
      return [
        {
          id: artifact.id,
          title: artifact.title,
          kind: "prd",
          kindLabel: `PRD · v${artifact.version}`,
          updatedAt: artifact.updatedAt,
          statusLabel: "已生成",
          tone: "done",
          markdown: artifact.markdown,
        },
      ];
    }
    if (run) {
      return [
        {
          id: run.id,
          title: `PRD（${
            runActive
              ? "生成中"
              : run.status === "failed"
                ? "生成失败"
                : "未完成"
          }）`,
          kind: "prd",
          kindLabel: "PRD",
          updatedAt: run.updatedAt,
          statusLabel: runActive
            ? "生成中"
            : run.status === "failed"
              ? "失败"
              : "未完成",
          tone: runActive ? "running" : "idle",
          markdown: null,
        },
      ];
    }
    return [];
  }, [artifact, run, runActive]);

  const kindCounts = useMemo(
    () => ({
      all: rows.length,
      prd: rows.filter((row) => row.kind === "prd").length,
      mrd: 0,
      brd: 0,
    }),
    [rows],
  );
  const statusCounts = useMemo(
    () => ({
      all: rows.length,
      done: rows.filter((row) => row.tone === "done").length,
      running: rows.filter((row) => row.tone === "running").length,
      idle: rows.filter((row) => row.tone === "idle").length,
    }),
    [rows],
  );
  const visibleRows = useMemo(
    () =>
      rows.filter(
        (row) =>
          (kindFilter === "all" || row.kind === kindFilter) &&
          (statusFilter === "all" || row.tone === statusFilter),
      ),
    [kindFilter, rows, statusFilter],
  );

  /** 当前产物的章节结构；来自产物 Markdown 的真实标题层级。 */
  const outline = useMemo(
    () => (artifact ? extractMarkdownOutline(artifact.markdown) : []),
    [artifact],
  );

  return (
    <Content
      className={
        embedded
          ? "h-full min-h-0 overflow-hidden bg-transparent"
          : "h-screen overflow-hidden bg-transparent"
      }
    >
      {contextHolder}
      <div className="h-full flex flex-col">
        {!embedded && (
          <header className="shrink-0 px-6 py-4 border-b border-gray-200 bg-white">
            <div className="flex items-center justify-between gap-4">
              <div className="min-w-0 flex items-center gap-3">
                <Tooltip title="返回工作区">
                  <Button
                    type="text"
                    shape="circle"
                    aria-label="返回工作区"
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
                    shape="circle"
                    aria-label="刷新图谱和文档任务"
                    icon={<ReloadOutlined />}
                    loading={loading}
                    onClick={() => void handleRefresh()}
                  />
                </Tooltip>
              </Space>
            </div>
          </header>
        )}

        <main className="min-h-0 flex-1 overflow-y-auto scrollbar-none-thin px-6 py-5">
          {loading ? (
            <PageLoadingState />
          ) : (
            <div
              className={
                hideGraph
                  ? "grid grid-cols-1 gap-5"
                  : "grid grid-cols-1 gap-5 desktop:grid-cols-[minmax(0,1.6fr)_minmax(340px,0.7fr)]"
              }
            >
              <div className="flex min-w-0 flex-col gap-5">
                {error && (
                  <Alert
                    type="error"
                    showIcon
                    message={error}
                    closable
                    onClose={() => setError(null)}
                  />
                )}

                {awaitingInput && (
                  <Alert
                    type="warning"
                    showIcon
                    message="等待补充事实或确认决策"
                    description={
                      <Space
                        direction="vertical"
                        size="small"
                        className="w-full"
                      >
                        <Text className="text-xs">
                          当前 PRD
                          草稿已保留。请先通过专用会话补充权威知识图谱，再回到本页继续剩余轮次。
                        </Text>
                        <Space wrap>
                          <Button
                            type="primary"
                            icon={<CommentOutlined />}
                            loading={resolvingEvidence}
                            onClick={() => void handleResolveEvidence()}
                          >
                            解决证据阻断
                          </Button>
                          <Button
                            icon={<WarningOutlined />}
                            onClick={() => setBlockersOpen(true)}
                          >
                            查看阻断汇总（{evidenceBlockerGroups.length}）
                          </Button>
                          <Tooltip
                            title={
                              canResume
                                ? `知识图谱已从 v${sourceGraphVersion} 更新到 v${kgData?.version}`
                                : evidenceResolution?.status !== "completed"
                                  ? "证据补充工作流尚未通过 Critique 验收"
                                  : "证据补充完成后仍需等待知识图谱版本更新"
                            }
                          >
                            <Button
                              icon={<PlayCircleOutlined />}
                              loading={resuming}
                              disabled={!canResume}
                              onClick={() => void handleResume()}
                            >
                              Resume PRD
                            </Button>
                          </Tooltip>
                        </Space>
                      </Space>
                    }
                  />
                )}

                {/* 交付文档：以文档库为主体，作用域内的工具与列表在同一表面内。 */}
                <section className="doc-surface">
                  <header className="doc-surface-head">
                    <div className="min-w-0">
                      <Text strong className="block truncate">
                        交付文档管理
                      </Text>
                    </div>
                    <Text type="secondary" className="doc-surface-count">
                      已生成：{artifact ? 1 : 0} · 生成中：{runActive ? 1 : 0}
                    </Text>
                  </header>

                  <div className="doc-surface-tools">
                    <span className="doc-tools-label">快捷生成文档</span>
                    <Space size="small" wrap>
                      <Button
                        size="small"
                        icon={<FileTextOutlined />}
                        loading={starting}
                        disabled={
                          !graphReady ||
                          runActive ||
                          awaitingInput ||
                          modelProfiles.length === 0
                        }
                        onClick={handleGeneratePrd}
                      >
                        生成 PRD 文档
                      </Button>
                      {/*
                        后端目前只实现 PRD（document-generation-service 对其它 kind
                        直接返回 400），因此这里如实禁用而不是提供假入口。
                      */}
                      <Tooltip title="后端暂只支持生成 PRD">
                        <Button size="small" icon={<PlusOutlined />} disabled>
                          生成 MRD 文档
                        </Button>
                      </Tooltip>
                      <Tooltip title="后端暂只支持生成 PRD">
                        <Button size="small" icon={<PlusOutlined />} disabled>
                          生成 BRD 文档
                        </Button>
                      </Tooltip>
                    </Space>
                  </div>

                  {/*
                    搜索与过滤。
                    项目当前没有「文档列表」接口，一次只能取到最新一版 PRD，因此这里
                    只在真实数据量下提供可生效的过滤，并如实显示当前范围，不做无效控件。
                  */}
                  <div className="doc-surface-filters">
                    <Tooltip title="当前工作区只有一版 PRD，列表接口提供后启用搜索">
                      <span className="doc-filter-search">
                        <Input
                          size="small"
                          prefix={<SearchOutlined />}
                          placeholder="搜索文档..."
                          value={searchQuery}
                          onChange={(event) => setSearchQuery(event.target.value)}
                          disabled
                          aria-label="搜索文档"
                        />
                      </span>
                    </Tooltip>
                    <Select
                      size="small"
                      value={kindFilter}
                      onChange={setKindFilter}
                      aria-label="文档类型"
                      options={[
                        { value: "all", label: `文档类型：全部（${kindCounts.all}）` },
                        ...(["prd", "mrd", "brd"] as const).map((kind) => ({
                          value: kind,
                          label: `${kind.toUpperCase()}（${kindCounts[kind]}）`,
                          disabled: kindCounts[kind] === 0,
                        })),
                      ]}
                    />
                    <Select
                      size="small"
                      value={statusFilter}
                      onChange={setStatusFilter}
                      aria-label="生成状态"
                      options={[
                        {
                          value: "all",
                          label: `生成状态：全部（${statusCounts.all}）`,
                        },
                        {
                          value: "done",
                          label: `已生成（${statusCounts.done}）`,
                          disabled: statusCounts.done === 0,
                        },
                        {
                          value: "running",
                          label: `生成中（${statusCounts.running}）`,
                          disabled: statusCounts.running === 0,
                        },
                        {
                          value: "idle",
                          label: `未完成（${statusCounts.idle}）`,
                          disabled: statusCounts.idle === 0,
                        },
                      ]}
                    />
                  </div>

                  {/* 文档列表：只有 PRD 一种真实产物，暂不提供无效的搜索与筛选。 */}
                  <div className="doc-table" role="table" aria-label="交付文档列表">
                    <div className="doc-table-head" role="row">
                      <span role="columnheader">文档名称</span>
                      <span role="columnheader">文档类型</span>
                      <span role="columnheader">更新时间</span>
                      <span role="columnheader">状态</span>
                      <span role="columnheader">操作</span>
                    </div>
                    {visibleRows.length > 0 ? (
                      visibleRows.map((row) => (
                        <div className="doc-table-row" role="row" key={row.id}>
                          <span className="doc-cell-name" role="cell">
                            <FileTextOutlined aria-hidden="true" />
                            {row.markdown ? (
                              <button
                                type="button"
                                title={row.title}
                                onClick={() =>
                                  setPreviewDocument({
                                    title: row.title,
                                    markdown: row.markdown ?? "",
                                  })
                                }
                              >
                                {row.title}
                              </button>
                            ) : (
                              <span className="doc-cell-muted" title={row.title}>
                                {row.title}
                              </span>
                            )}
                          </span>
                          <span role="cell" className="doc-cell-muted">
                            {row.kindLabel}
                          </span>
                          <span role="cell" className="doc-cell-muted">
                            {formatDate(row.updatedAt)}
                          </span>
                          <span role="cell">
                            <span className="doc-status" data-tone={row.tone}>
                              <i aria-hidden="true" />
                              {row.statusLabel}
                            </span>
                          </span>
                          <span role="cell" className="doc-cell-actions">
                            {row.markdown && (
                              <>
                                <Tooltip title="查看完整 Markdown">
                                  <Button
                                    type="text"
                                    size="small"
                                    shape="circle"
                                    aria-label="查看完整 Markdown"
                                    icon={<EyeOutlined />}
                                    onClick={() =>
                                      setPreviewDocument({
                                        title: row.title,
                                        markdown: row.markdown ?? "",
                                      })
                                    }
                                  />
                                </Tooltip>
                                <Tooltip title="下载 Markdown">
                                  <Button
                                    type="text"
                                    size="small"
                                    shape="circle"
                                    aria-label="下载 Markdown"
                                    icon={<DownloadOutlined />}
                                    onClick={() =>
                                      handleDownloadMarkdown(
                                        row.markdown ?? "",
                                        row.title,
                                      )
                                    }
                                  />
                                </Tooltip>
                              </>
                            )}
                          </span>
                        </div>
                      ))
                    ) : (
                      <div className="doc-table-empty">
                        <Empty
                          image={Empty.PRESENTED_IMAGE_SIMPLE}
                          description={
                            rows.length > 0
                              ? "当前筛选条件下没有文档，请调整筛选。"
                              : graphReady
                                ? "还没有 PRD 交付物，点击「生成 PRD 文档」开始。"
                                : "当前工作区还没有可用于生成文档的知识图谱。"
                          }
                        />
                      </div>
                    )}
                  </div>
                </section>

                <ScoringResultPanel
                  attempts={scoringAttempts}
                  qualityScore={qualityScore}
                  currentStage={run?.currentStage ?? null}
                  onViewAttempt={(attempt) =>
                    setPreviewDocument({
                      title: `${artifact?.title ?? "PRD"} · 第 ${attempt.attempt} 轮`,
                      markdown: attempt.markdown,
                    })
                  }
                  onDownloadAttempt={(attempt) =>
                    handleDownloadMarkdown(
                      attempt.markdown,
                      `${artifact?.title ?? "PRD"}-round-${attempt.attempt}`,
                    )
                  }
                />

                {/*
                  工作流明细：任务列表与执行日志原来铺在页面右侧，视觉权重高于
                  文档本身；改为折叠区保留在同一列，默认收起、需要时展开。
                */}
                <details className="doc-surface doc-workflow">
                  <summary>
                    <span className="doc-workflow-title">工作流明细</span>
                    <span className="doc-workflow-meta">
                      {run?.todos && run.todos.length > 0
                        ? `任务列表 ${run.todos.filter((todo) => todo.status === "completed").length}/${run.todos.length}`
                        : "暂无任务记录"}
                      {run?.reasoningLog && run.reasoningLog.length > 0
                        ? ` · 执行日志 ${run.reasoningLog.length}`
                        : ""}
                    </span>
                  </summary>

                  <div className="doc-workflow-body">
                    <div className="doc-workflow-agent">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <Text strong>Document Agent</Text>
                          <Text type="secondary" className="block text-xs mt-1">
                            PRD 工作流独立运行，页面切换不会中断后台任务。
                          </Text>
                        </div>
                        {/*
                          运行中的任务状态由「当前阶段」表达，这里只补一个局部
                          加载指示：它不是通用 Loading，而是"工作流正在跑"。
                        */}
                        {runActive && (
                          <GlobalLoader scope="inline" loading label="运行中" />
                        )}
                      </div>
                      <div className="mt-3 flex flex-col gap-2 text-sm">
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
                          value={
                            run?.finishedAt ? formatDate(run.finishedAt) : "-"
                          }
                        />
                        {run?.errorMessage && (
                          <Alert
                            type="warning"
                            showIcon
                            message={run.errorMessage}
                          />
                        )}
                      </div>
                    </div>

                    {run?.todos && run.todos.length > 0 && (
                      <TodoCard todos={run.todos} />
                    )}

                    <ReasoningLogPanel entries={run?.reasoningLog ?? []} />
                  </div>
                </details>
              </div>

              <aside className="flex min-w-0 flex-col gap-4">
                {/* 图谱画布；在交付文档面板内隐藏，避免与「知识图谱」入口重复。 */}
                {!hideGraph && (
                  <section className="min-h-[480px] rounded border border-gray-200 bg-white overflow-hidden">
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
                      <KnowledgeGraphView
                        className="h-[480px]"
                        nodes={kgData?.nodes ?? []}
                        relations={kgData?.relations ?? []}
                        onNodeSelect={setSelectedNode}
                      />
                    ) : (
                      <div className="h-[480px] flex items-center justify-center">
                        <Empty description="当前工作区还没有可用于生成文档的知识图谱" />
                      </div>
                    )}
                  </section>
                )}

                {/* 节点详情依赖图谱选择；隐藏图谱时一并隐藏，避免出现空面板。 */}
                {!hideGraph && (
                  <NodeDetailPanel
                    node={selectedNode}
                    totalNodes={kgData?.nodes.length ?? 0}
                    onClose={() => setSelectedNode(null)}
                  />
                )}

                {/* 文档预览：默认展示当前产出，与左侧文档列表联动。 */}
                <section className="rounded border border-gray-200 bg-white p-4">
                  <div className="flex items-center justify-between gap-3">
                    <Text strong>文档预览</Text>
                    {statusTag}
                  </div>

                  {artifact || run ? (
                    <>
                      <div className="doc-preview-meta">
                        更新时间：{formatDate(artifact?.updatedAt ?? run?.updatedAt ?? "")}
                      </div>

                      <div className="doc-preview-title">
                        <span className="doc-preview-label">文档名称</span>
                        <Text strong className="block truncate">
                          {artifact?.title ?? "PRD（生成中）"}
                        </Text>
                      </div>

                      {/* 章节结构：来自产物 Markdown 的真实标题层级。 */}
                      <div className="doc-preview-section">
                        <span className="doc-preview-label">章节结构</span>
                        {outline.length > 0 ? (
                          <ol className="doc-outline scrollbar-none-thin">
                            {outline.map((item) => (
                              <li
                                key={item.id}
                                data-level={item.level}
                                title={item.text}
                              >
                                <button
                                  type="button"
                                  onClick={() =>
                                    artifact &&
                                    setPreviewDocument({
                                      title: artifact.title,
                                      markdown: artifact.markdown,
                                    })
                                  }
                                >
                                  {item.text}
                                </button>
                              </li>
                            ))}
                          </ol>
                        ) : (
                          <Text type="secondary" className="text-xs">
                            {artifact
                              ? "该文档没有可解析的标题层级。"
                              : "生成完成后显示章节结构。"}
                          </Text>
                        )}
                      </div>

                      <div className="doc-preview-body">
                        <span className="doc-preview-label">内容预览</span>
                        <Text type="secondary" className="text-xs">
                          {artifact
                            ? `${buildContentSummary(outline, artifact.markdown)}正文、图表和原型图在完整 Markdown 弹窗中展示。`
                            : "生成完成后可在此查看与下载。"}
                        </Text>
                      </div>

                      <Space size="small" wrap className="mt-3">
                        <Button
                          type="primary"
                          icon={<EyeOutlined />}
                          disabled={!artifact}
                          onClick={() =>
                            artifact &&
                            setPreviewDocument({
                              title: artifact.title,
                              markdown: artifact.markdown,
                            })
                          }
                        >
                          查看完整 MD
                        </Button>
                        <Button
                          icon={<DownloadOutlined />}
                          disabled={!artifact}
                          onClick={() =>
                            artifact &&
                            handleDownloadMarkdown(
                              artifact.markdown,
                              artifact.title,
                            )
                          }
                        >
                          下载 Markdown
                        </Button>
                      </Space>
                    </>
                  ) : (
                    <Empty
                      className="mt-4"
                      image={Empty.PRESENTED_IMAGE_SIMPLE}
                      description="暂无交付文档"
                    />
                  )}
                </section>
                {/*
                  本地同步诊断不属于文档工作区：项目本地状态统一由 Workspace
                  Header 的同步状态承载，这里不再重复展示路径与副本说明。
                  同步能力本身未改动，仍由该状态入口驱动。
                */}
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
              <Space size={4}>
                <Text type="secondary" className="text-xs">
                  下次生成模型
                </Text>
                <ModelProfileSelector
                  profiles={modelProfiles}
                  selectedProfileId={selectedModelProfileId}
                  disabled={runActive || starting}
                  onChange={(profileId) => void changeModelProfile(profileId)}
                />
              </Space>
              {(runActive || awaitingInput) && (
                <Button
                  danger
                  icon={<PauseCircleOutlined />}
                  loading={stopping}
                  onClick={handleStop}
                >
                  {awaitingInput ? "结束本次任务" : "中断"}
                </Button>
              )}
              <Button
                type="primary"
                icon={<FileTextOutlined />}
                loading={starting}
                disabled={
                  !graphReady ||
                  runActive ||
                  awaitingInput ||
                  modelProfiles.length === 0
                }
                onClick={handleGeneratePrd}
              >
                生成 PRD
              </Button>
            </Space>
          </div>
        </footer>

        <Modal
          centered
          width={720}
          open={blockersOpen}
          title="PRD 证据阻断汇总"
          footer={
            <Button
              icon={<CloseOutlined />}
              onClick={() => setBlockersOpen(false)}
            >
              关闭
            </Button>
          }
          onCancel={() => setBlockersOpen(false)}
        >
          {evidenceBlockerGroups.length > 0 ? (
            <div className="flex max-h-[60vh] flex-col gap-3 overflow-y-auto">
              {latestScoringAttempt?.evidenceBlockerGroupingStatus ===
                "fallback" && (
                <Alert
                  type="warning"
                  showIcon
                  message="语义合并失败，当前按 Reviewer 原始意见逐条展示。"
                />
              )}
              {evidenceBlockerGroups.map((group) => (
                <div
                  key={group.id}
                  className="rounded border border-red-100 bg-red-50 px-3 py-2"
                >
                  <Text strong>{group.title}</Text>
                  <Text className="font-reading-compact mt-1 block">{group.description}</Text>
                  {group.relatedNodeIds.length > 0 ? (
                    <Text type="secondary" className="mt-1 block text-xs wrap-anywhere" title={group.relatedNodeIds.join("、")}>
                      关联节点：{group.relatedNodeIds.map(formatDisplayId).join("、")}
                    </Text>
                  ) : null}
                  <div className="mt-2 flex flex-col gap-1.5 border-t border-red-100 pt-2">
                    {group.sources.map((source, sourceIndex) => (
                      <div key={`${source.reviewerId}-${sourceIndex}`}>
                        <Text type="secondary" className="block text-xs">
                          {source.reviewerName}
                        </Text>
                        <Text className="text-xs">{source.text}</Text>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <Empty description="暂无证据阻断" />
          )}
        </Modal>

        <Modal
          centered
          width="min(960px, 92vw)"
          open={previewDocument !== null}
          title={previewDocument?.title ?? "PRD Markdown"}
          footer={
            previewDocument ? (
              <Space>
                <Button
                  icon={<DownloadOutlined />}
                  onClick={() =>
                    handleDownloadMarkdown(
                      previewDocument.markdown,
                      previewDocument.title,
                    )
                  }
                >
                  下载 MD
                </Button>
                <Button
                  type="primary"
                  icon={<CloseOutlined />}
                  onClick={() => setPreviewDocument(null)}
                >
                  关闭
                </Button>
              </Space>
            ) : null
          }
          onCancel={() => setPreviewDocument(null)}
          styles={{
            body: {
              maxHeight: "72vh",
              overflowY: "auto",
              paddingRight: 16,
            },
          }}
        >
          {previewDocument ? (
            <div className="text-sm leading-7">
              {renderMarkdown(previewDocument.markdown, {
                  enableVisualizations: true,
                    // 文档预览启用图表与原型渲染
})}
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
 * 优先展示持久化语义阻断组；兼容旧评分记录时逐条保留 Reviewer 原文。
 */
function getEvidenceBlockerGroups(
  attempt: DocumentScoreAttempt | undefined,
): DocumentEvidenceBlockerGroup[] {
  if (attempt?.evidenceBlockerGroups?.length) {
    return attempt.evidenceBlockerGroups;
  }
  return (
    attempt?.reviewerScores.flatMap((reviewer) =>
      (reviewer.evidenceBlockers ?? []).map((text, index) => ({
        reviewerId: reviewer.reviewerId,
        reviewerName: reviewer.reviewerName,
        text,
        relatedNodeIds:
          reviewer.evidenceBlockerDetails?.[index]?.relatedNodeIds ?? [],
      })),
    ) ?? []
  ).map((source, index) => ({
    id: `legacy-evidence-blocker-${index + 1}`,
    title: `证据阻断 ${index + 1}`,
    description: source.text,
    sourceIndexes: [index],
    sources: [source],
    relatedNodeIds: source.relatedNodeIds,
  }));
}

/**
 * 嵌入式 G6 知识图谱画布。
 */
/**
 * 文档工作区首次初始化。
 *
 * 此时知识图谱、Document Agent 任务与产物状态都还没准备好，整个交付文档
 * 模块不可用，属于工作区级加载。
 */
function PageLoadingState() {
  return (
    <div className="doc-init-state">
      <GlobalLoader scope="workspace" loading label="正在初始化文档工作区..." />
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
          <Text type="secondary" className="block text-xs mt-1 wrap-anywhere" title={node.id}>
            {formatDisplayId(node.id)}
          </Text>
        </div>
        <Button
          type="text"
          size="small"
          shape="circle"
          aria-label="关闭详情"
          icon={<CloseOutlined />}
          onClick={onClose}
        />
      </div>

      <div className="flex flex-col gap-3 text-sm">
        <div>
          <Text type="secondary" className="block text-xs mb-1">
            名称
          </Text>
          <Text className="font-reading-compact break-words">{node.name}</Text>
        </div>
        <div>
          <Text type="secondary" className="block text-xs mb-1">
            类型
          </Text>
          <Tag color={getKnowledgeGraphNodeColor(node.type)} className="m-0">
            {NODE_TYPE_LABELS[node.type] ?? node.type}
          </Tag>
        </div>
        {node.description && (
          <div>
            <Text type="secondary" className="block text-xs mb-1">
              描述
            </Text>
            <Text className="font-reading-compact break-words leading-6">{node.description}</Text>
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
                <Tag className="m-0">
                  {getReasoningAgentLabel(entry.agentType)}
                </Tag>
                <Text type="secondary" className="text-[11px]">
                  {formatDate(entry.createdAt)}
                </Text>
              </div>
              <Text className="font-reading-compact whitespace-pre-wrap break-words">
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
  onViewAttempt,
  onDownloadAttempt,
}: {
  attempts: DocumentScoreAttempt[];
  qualityScore: DocumentQualityScore | null;
  currentStage: DocumentWorkflowStage | null;
  onViewAttempt: (attempt: DocumentScoreAttempt) => void;
  onDownloadAttempt: (attempt: DocumentScoreAttempt) => void;
}) {
  const [reviewDetail, setReviewDetail] = useState<
    DocumentScoreAttempt["reviewerScores"][number] | null
  >(null);
  const scoringActive =
    currentStage === "scoreDraft" ||
    currentStage === "groupEvidenceBlockers" ||
    currentStage === "aggregateScore";
  const selectedAttempt = qualityScore
    ? attempts.find(
        (attempt) => attempt.attempt === qualityScore.selectedAttempt,
      )
    : undefined;

  return (
    <section className="rounded border border-gray-200 bg-white p-4">
      <div className="flex items-center justify-between gap-3 mb-3">
        <div>
          <Text strong>评分结果</Text>
          <Text type="secondary" className="block text-xs mt-1">
            三位评分 Agent
            独立评审；可重写问题最多修订三轮，缺少新证据时直接保留草案。
          </Text>
        </div>
        {/*
          「n / 3 轮」是真实业务进度：评分进行中也要继续显示，
          不能用通用 Loading 把它藏起来。这里只补一个运行指示。
        */}
        <div className="flex items-center gap-2">
          {scoringActive && <GlobalLoader scope="inline" loading label="" />}
          <Tag>{attempts.length}/3 轮</Tag>
        </div>
      </div>

      {qualityScore && (
        <div className="rounded border border-blue-200 bg-blue-50 px-3 py-3 mb-3 text-sm">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap items-center gap-2">
              {selectedAttempt && !selectedAttempt.varianceAccepted ? (
                <Tag color="warning">最终：评分分歧，未形成共识</Tag>
              ) : (
                <Tag color={qualityScore.passed ? "success" : "warning"}>
                  最终 {qualityScore.finalScore} / {qualityScore.threshold}
                </Tag>
              )}
              <Tag color="processing">
                推荐第 {qualityScore.selectedAttempt} 轮
              </Tag>
              <Tag>{getSelectionReasonLabel(qualityScore.selectionReason)}</Tag>
            </div>
            {selectedAttempt && (
              <Button
                type="primary"
                size="small"
                icon={<EyeOutlined />}
                onClick={() => onViewAttempt(selectedAttempt)}
              >
                查看最佳 PRD
              </Button>
            )}
          </div>
        </div>
      )}

      {attempts.length === 0 ? (
        <Text type="secondary" className="text-xs">
          暂无评分结果，PRD 草稿生成后开始评分。
        </Text>
      ) : (
        <div className="flex flex-col gap-3">
          {qualityScore && (
            <Text type="secondary" className="text-xs">
              本次运行共生成 {attempts.length} 份 PRD，以下版本均可查看和下载。
            </Text>
          )}
          {attempts.map((attempt) => {
            const selected =
              attempt.selected ||
              qualityScore?.selectedAttempt === attempt.attempt;
            return (
              <div
                key={attempt.attempt}
                className={`rounded border p-3 ${
                  selected ? "border-blue-300 bg-blue-50/40" : "border-gray-100"
                }`}
              >
                <div className="flex flex-wrap items-center gap-2 mb-2">
                  <Text strong>第 {attempt.attempt} 轮</Text>
                  <Tag color={attempt.varianceAccepted ? "success" : "error"}>
                    分差 {attempt.scoreSpread}
                  </Tag>
                  {attempt.varianceAccepted ? (
                    <Tag
                      color={attempt.aggregate.passed ? "success" : "warning"}
                    >
                      共识 {attempt.aggregate.score}
                    </Tag>
                  ) : (
                    <Tag color="warning">评分分歧，未形成共识</Tag>
                  )}
                  <Tooltip
                    title={
                      attempt.varianceAccepted
                        ? `70% × 三方平均分 ${attempt.aggregate.weights.averageScore} + 30% × 最低分 ${attempt.aggregate.weights.minimumScore} = ${attempt.aggregate.score}`
                        : `三方原始分：${attempt.reviewerScores
                            .map(
                              (review) =>
                                `${getReviewerTabLabel(review.reviewerId)} ${review.score}`,
                            )
                            .join("、")}。分差 ${attempt.scoreSpread} 超过允许范围，未生成共识分。`
                    }
                  >
                    <ExclamationCircleOutlined
                      tabIndex={0}
                      aria-label={
                        attempt.varianceAccepted
                          ? "查看共识分计算详情"
                          : "查看三方原始评分"
                      }
                      className="cursor-help text-blue-500"
                    />
                  </Tooltip>
                  {attempt.evidenceBlocked && (
                    <Tag color="error">等待补充证据</Tag>
                  )}
                  {selected && <Tag color="processing">最佳版本</Tag>}
                  <span className="ml-auto flex gap-2">
                    <Button
                      size="small"
                      icon={<EyeOutlined />}
                      onClick={() => onViewAttempt(attempt)}
                    >
                      查看 PRD
                    </Button>
                    <Button
                      size="small"
                      icon={<DownloadOutlined />}
                      onClick={() => onDownloadAttempt(attempt)}
                    >
                      下载
                    </Button>
                  </span>
                </div>
                <Tabs
                  size="small"
                  items={attempt.reviewerScores.map((review) => ({
                    key: review.reviewerId,
                    label: getReviewerTabLabel(review.reviewerId),
                    children: (
                      <div className="rounded bg-gray-50 p-3">
                        <div className="mb-2 flex flex-wrap items-center gap-2">
                          <Text strong>{review.reviewerName}</Text>
                          <Tag
                            color={review.evidenceBlocked ? "error" : "blue"}
                          >
                            总分 {review.score}
                          </Tag>
                          <Tooltip
                            title={
                              <div className="min-w-60">
                                {Object.entries(review.dimensions).map(
                                  ([key, value]) => (
                                    <div
                                      key={key}
                                      className="flex justify-between gap-6"
                                    >
                                      <span>{getDimensionLabel(key)}</span>
                                      <span>{value}</span>
                                    </div>
                                  ),
                                )}
                                <div className="mt-2 border-t border-white/30 pt-2">
                                  维度评分由 Reviewer 同时提供，仅供参考，与
                                  Reviewer 总分无计算关系。
                                </div>
                              </div>
                            }
                          >
                            <ExclamationCircleOutlined
                              tabIndex={0}
                              aria-label="查看五项维度评分说明"
                              className="cursor-help text-amber-500"
                            />
                          </Tooltip>
                          {review.evidenceBlocked && (
                            <Tag color="error">存在阻断</Tag>
                          )}
                        </div>
                        <ReviewerPreviewRow
                          label="优势"
                          items={review.strengths}
                        />
                        <ReviewerPreviewRow
                          label="不足"
                          items={review.weaknesses}
                        />
                        <ReviewerPreviewRow
                          label="阻断"
                          items={review.evidenceBlockers ?? []}
                        />
                        <Button
                          size="small"
                          className="mt-2"
                          icon={<FileSearchOutlined />}
                          onClick={() => setReviewDetail(review)}
                        >
                          查看完整评审
                        </Button>
                      </div>
                    ),
                  }))}
                />
                <Text type="secondary" className="font-reading-compact whitespace-pre-wrap">
                  {attempt.aggregate.rationale}
                </Text>
                {/* {(attempt.evidenceBlockers?.length ?? 0) > 0 && (
                  <Text type="danger" className="block text-xs mt-2">
                    证据阻塞：{attempt.evidenceBlockers?.join("；")}
                  </Text>
                )} */}
              </div>
            );
          })}
        </div>
      )}
      <Modal
        centered
        width={760}
        open={reviewDetail !== null}
        title={
          reviewDetail
            ? `${reviewDetail.reviewerName} · 总分 ${reviewDetail.score}`
            : "完整评审"
        }
        footer={
          <Button
            icon={<CloseOutlined />}
            onClick={() => setReviewDetail(null)}
          >
            关闭
          </Button>
        }
        onCancel={() => setReviewDetail(null)}
      >
        {reviewDetail && (
          <div className="max-h-[65vh] space-y-4 overflow-y-auto pr-2">
            <div>
              <Text strong>
                五项维度（仅供参考，与 Reviewer 总分无计算关系）
              </Text>
              <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-5">
                {Object.entries(reviewDetail.dimensions).map(([key, value]) => (
                  <div key={key} className="rounded bg-gray-50 p-2 text-center">
                    <Text type="secondary" className="block text-xs">
                      {getDimensionLabel(key)}
                    </Text>
                    <Text strong>{value}</Text>
                  </div>
                ))}
              </div>
            </div>
            <ReviewerDetailList
              title="Strengths"
              items={reviewDetail.strengths}
            />
            <ReviewerDetailList
              title="Weaknesses"
              items={reviewDetail.weaknesses}
            />
            <ReviewerDetailList
              title="Revision Advice"
              items={reviewDetail.revisionAdvice}
            />
            <ReviewerDetailList
              title="Evidence Blockers"
              items={reviewDetail.evidenceBlockers ?? []}
              danger
            />
          </div>
        )}
      </Modal>
    </section>
  );
}

/**
 * 渲染后台 run 状态标签。
 */
/**
 * 在 Reviewer Tab 中仅展示首条重点及剩余数量。
 */
function ReviewerPreviewRow({
  label,
  items,
}: {
  label: string;
  items: string[];
}) {
  if (items.length === 0) return null;
  return (
    <div className="mt-1 flex min-w-0 items-center gap-2 text-xs">
      <Text type="secondary" className="shrink-0">
        {label}
      </Text>
      <Text ellipsis title={items[0]}>
        {items[0]}
      </Text>
      {items.length > 1 && <Tag className="m-0">+{items.length - 1}</Tag>}
    </div>
  );
}

/**
 * 在完整评审弹窗中展示不裁剪的评审条目。
 */
function ReviewerDetailList({
  title,
  items,
  danger = false,
}: {
  title: string;
  items: string[];
  danger?: boolean;
}) {
  return (
    <div>
      <Text strong type={danger ? "danger" : undefined}>
        {title}
      </Text>
      {items.length > 0 ? (
        <ul className="mt-2 list-disc space-y-1 pl-5">
          {items.map((item, index) => (
            <li key={`${title}-${index}`}>{item}</li>
          ))}
        </ul>
      ) : (
        <Text type="secondary" className="mt-1 block text-xs">
          无
        </Text>
      )}
    </div>
  );
}

/**
 * 将三个稳定 reviewer ID 映射为固定中文 Tab 名称。
 */
function getReviewerTabLabel(reviewerId: string): string {
  if (reviewerId === "product-rationale-evidence-reviewer") return "产品依据";
  if (reviewerId === "requirements-acceptance-reviewer") return "需求与验收";
  if (reviewerId === "scope-delivery-readiness-reviewer") return "范围与交付";
  return reviewerId;
}

/**
 * 将评分维度键映射为中文展示名。
 */
function getDimensionLabel(key: string): string {
  const labels: Record<string, string> = {
    relevance: "相关性",
    completeness: "完整性",
    structure: "结构",
    feasibility: "可行性",
    language: "表达",
  };
  return labels[key] ?? key;
}

function renderRunStatus(run: DocumentGenerationRun | null) {
  if (run?.status === "awaiting_input") {
    return <Tag color="warning">等待补充事实或确认决策</Tag>;
  }
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
  if (reason === "highest_score_then_lowest_spread")
    return "最高评分，同分看分差";
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
  if (
    error instanceof Error &&
    error.message &&
    !error.message.startsWith("Server error")
  ) {
    return error.message;
  }

  return mapErrorToChinese(error);
}
