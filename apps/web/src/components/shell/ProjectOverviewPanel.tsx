/**
 * 项目概览面板
 *
 * 以「项目是什么 → 知识状态如何 → 下一步能做什么 → 最近产出 → 最近变化」的
 * 顺序组织只读信息，并让第一层与第二层的视觉权重明显高于后续层级。
 *
 * Responsibilities:
 * - 读取当前项目的知识图谱与最新 PRD 任务，形成同级概览数据
 * - 展示核心指标、关键维度、快捷操作、最近交付文档与最近更新
 * - 提供刷新入口与「生成 PRD」动作
 *
 * Notes:
 * - 只读取既有接口，不新增后端能力，也不改动任何业务契约。
 * - 不展示后端不支持的动作：MRD / BRD 只是占位且明确禁用。
 * - 交付物数量按真实数据口径展示：一个工作区只有一版最新 PRD 交付物。
 */

import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { Button, Tooltip, message } from "antd";
import {
  CheckCircleFilled,
  ClockCircleOutlined,
  CommentOutlined,
  DatabaseOutlined,
  FileAddOutlined,
  FileTextOutlined,
  ForkOutlined,
  LoadingOutlined,
  PlusOutlined,
  ReloadOutlined,
  RightOutlined,
  WarningFilled,
} from "@ant-design/icons";
import {
  fetchProductKnowledgeGraph,
  type WorkspaceKnowledgeGraphData,
} from "../../api/chat-api";
import {
  fetchLatestDocumentGeneration,
  startDocumentGeneration,
  type DocumentGenerationStatus,
  type DocumentGenerationStatusResponse,
} from "../../api/document-api";
import { NODE_TYPE_LABELS } from "../KnowledgeGraphView";
import type { WorkspacePanelId } from "../shell/workspace-panels";

interface Props {
  workspaceId: string;
  workspaceName: string;
  workspacePath?: string | null;
  threadCount: number;
  /** 最近一次会话活动时间，用于「最近更新」。 */
  lastConversationAt?: string | null;
  /** 切换工作区面板（例如跳到交付文档查看产物）。 */
  onPanelChange?: (panelId: WorkspacePanelId) => void;
  /** 打开新对话；未提供时按钮禁用。 */
  onNewConversation?: () => void;
}

/** 交付文档面板标识，供快捷操作跳转使用。 */
const DOCUMENTS_PANEL: WorkspacePanelId = "documents";

/** PRD 任务状态文案。 */
const RUN_STATUS_LABELS: Record<DocumentGenerationStatus, string> = {
  queued: "排队中",
  running: "生成中",
  awaiting_input: "等待补充证据",
  completed: "已完成",
  stopped: "已中断",
  failed: "失败",
};

/** 概览数据加载状态。 */
interface OverviewData {
  graph: WorkspaceKnowledgeGraphData | null;
  document: DocumentGenerationStatusResponse | null;
}

export function ProjectOverviewPanel({
  workspaceId,
  workspaceName,
  workspacePath,
  threadCount,
  lastConversationAt,
  onPanelChange,
  onNewConversation,
}: Props) {
  const [data, setData] = useState<OverviewData>({
    graph: null,
    document: null,
  });
  const [loading, setLoading] = useState(true);
  /**
   * 各事件源的取数是否已经结束。
   *
   * 「最近更新」的会话事件来自 props（同步可知），图谱与文档事件来自接口；
   * 因此不能只按 `timeline.length` 判断是否显示骨架——列表里已经有会话事件时
   * 那个条件永远为假。按来源分别记录，才能给"还没回来的那些事件"显示占位。
   */
  const [settled, setSettled] = useState({ graph: false, document: false });
  const [loadError, setLoadError] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const [messageApi, contextHolder] = message.useMessage();

  const load = useCallback(async () => {
    setLoadError(null);
    const [graph, document] = await Promise.allSettled([
      fetchProductKnowledgeGraph(workspaceId),
      fetchLatestDocumentGeneration(workspaceId, "prd"),
    ]);
    setData({
      graph: graph.status === "fulfilled" ? graph.value : null,
      document: document.status === "fulfilled" ? document.value : null,
    });
    // 两个接口任一失败都不阻断另一块信息，只在页脚提示可刷新。
    const failed = [graph, document].filter(
      (result) => result.status === "rejected",
    ).length;
    setSettled({ graph: true, document: true });
    setLoadError(failed === 2 ? "项目概览数据加载失败" : failed === 1 ? "部分概览数据暂不可用" : null);
  }, [workspaceId]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setSettled({ graph: false, document: false });
    load()
      .catch((error) => {
        if (cancelled) return;
        console.error("[overview] Failed to load project overview:", error);
        setLoadError("项目概览数据加载失败");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [load]);

  const graph = data.graph;
  const run = data.document?.run ?? null;
  const artifact = data.document?.artifact ?? null;
  const runActive = run?.status === "queued" || run?.status === "running";

  /** 关键维度：按实体类型聚合，只展示有数据的类型。 */
  const dimensions = useMemo(() => {
    const counts = new Map<string, number>();
    for (const node of graph?.nodes ?? []) {
      counts.set(node.type, (counts.get(node.type) ?? 0) + 1);
    }
    return [...counts]
      .sort((left, right) => right[1] - left[1])
      .slice(0, 8)
      .map(([type, count]) => ({
        type,
        label: NODE_TYPE_LABELS[type as keyof typeof NODE_TYPE_LABELS] ?? type,
        count,
      }));
  }, [graph?.nodes]);

  const pendingEntities = useMemo(
    () => (graph?.nodes ?? []).filter((node) => node.status === "proposed").length,
    [graph?.nodes],
  );

  /** 最近更新：只使用真实存在的时间字段，不虚构任务开始时间。 */
  const timeline = useMemo(() => {
    const events: Array<{ key: string; label: string; detail: string; at: string }> = [];
    if (graph?.updatedAt) {
      events.push({
        key: "graph",
        label: "知识图谱更新",
        detail: `v${graph.version} · ${graph.nodes.length} 实体 / ${graph.relations.length} 关系`,
        at: graph.updatedAt,
      });
    }
    if (artifact?.updatedAt) {
      events.push({
        key: "artifact",
        label: `${artifact.title} 更新`,
        detail: `第 ${artifact.version} 版`,
        at: artifact.updatedAt,
      });
    }
    if (lastConversationAt) {
      events.push({
        key: "conversation",
        label: "最近会话活动",
        detail: "当前项目对话列表的更新时间",
        at: lastConversationAt,
      });
    }
    return events
      .filter((event) => !Number.isNaN(new Date(event.at).getTime()))
      .sort((left, right) => new Date(right.at).getTime() - new Date(left.at).getTime());
  }, [artifact, graph, lastConversationAt]);

  /**
   * 最近更新的展示行。
   *
   * 已解析出的事件直接显示；尚未返回的事件源先用骨架占住同一行几何，
   * 数据到达后就地替换，不产生布局位移。
   */
  const timelineRows = useMemo(() => {
    const byKey = new Map(timeline.map((event) => [event.key, event]));
    const rows: Array<
      | { kind: "event"; event: (typeof timeline)[number] }
      | { kind: "placeholder"; key: string }
    > = [];

    if (byKey.has("conversation")) {
      rows.push({ kind: "event", event: byKey.get("conversation")! });
    }
    if (!settled.graph) {
      rows.push({ kind: "placeholder", key: "graph" });
    } else if (byKey.has("graph")) {
      rows.push({ kind: "event", event: byKey.get("graph")! });
    }
    if (!settled.document) {
      rows.push({ kind: "placeholder", key: "artifact" });
    } else if (byKey.has("artifact")) {
      rows.push({ kind: "event", event: byKey.get("artifact")! });
    }

    // 会话事件还没排进来时（无更新时间）也补一行占位，避免区块空白。
    const known = timeline.filter(
      (event) => event.key !== "graph" && event.key !== "artifact",
    );
    if (known.length === 0 && rows.length === 0) {
      rows.push({ kind: "placeholder", key: "conversation" });
    }

    return rows;
  }, [settled, timeline]);

  /** 生成 PRD 后跳到交付文档面板，复用现有工作台展示进度。 */
  const handleGeneratePrd = useCallback(async () => {
    if (starting || runActive) return;
    setStarting(true);
    try {
      // 不指定列表：服务端使用用户记住的默认模型列表，避免这里回落到内置默认。
      await startDocumentGeneration(workspaceId, "prd");
      void messageApi.success("PRD 生成任务已进入后台。");
      onPanelChange?.(DOCUMENTS_PANEL);
    } catch (error) {
      console.error("[overview] Failed to start PRD:", error);
      void messageApi.error("PRD 启动失败，请在交付文档面板重试。");
    } finally {
      setStarting(false);
    }
  }, [messageApi, onPanelChange, runActive, starting, workspaceId]);

  const handleRefresh = useCallback(() => {
    setLoading(true);
    load()
      .catch((error) => {
        console.error("[overview] Failed to refresh project overview:", error);
      })
      .finally(() => setLoading(false));
  }, [load]);

  return (
    <div className="overview-panel">
      {contextHolder}

      {/* 第一层：项目是什么 */}
      <header className="overview-identity">
        <div className="overview-identity-main">
          <h2>{workspaceName}</h2>
          <p>
            {workspacePath
              ? workspacePath
              : "尚未关联本地路径，产品上下文与 PRD 不会保存到项目目录。"}
          </p>
        </div>
        <Tooltip title="刷新概览数据">
          <Button
            type="text"
            shape="circle"
            aria-label="刷新概览数据"
            icon={<ReloadOutlined />}
            loading={loading}
            onClick={handleRefresh}
          />
        </Tooltip>
      </header>

      {/* 第二层：核心指标 */}
      <section className="overview-metrics" aria-label="核心指标">
        <Metric
          icon={<DatabaseOutlined />}
          label="实体数量"
          value={graph ? graph.nodes.length : null}
          loading={loading}
        />
        <Metric
          icon={<ForkOutlined />}
          label="关系数量"
          value={graph ? graph.relations.length : null}
          loading={loading}
        />
        <Metric
          icon={<FileTextOutlined />}
          label="交付物数量"
          value={artifact ? 1 : 0}
          hint={artifact ? "当前工作区保留一版最新 PRD 交付物" : "尚未生成 PRD 交付物"}
          loading={loading}
        />
        <Metric
          icon={<CommentOutlined />}
          label="对话数量"
          value={threadCount}
          loading={false}
        />
      </section>

      {loadError && <p className="overview-note is-error">{loadError}</p>}

      {/* 第三层：关键维度 + 快捷操作 */}
      <section className="overview-block" aria-label="关键维度">
        <h3>关键维度</h3>
        {/*
          结构已知（一排标签 + 一行统计），因此读取期间显示骨架，
          而不是一句"正在读取…"的文案。
        */}
        {loading && dimensions.length === 0 ? (
          <OverviewSkeleton variant="chips" />
        ) : dimensions.length > 0 ? (
          <>
            <div className="overview-chips">
              {dimensions.map((dimension) => (
                <span key={dimension.type} className="overview-chip">
                  {dimension.label}
                  <em>{dimension.count}</em>
                </span>
              ))}
            </div>
            <p className="overview-note">
              {pendingEntities > 0
                ? `其中 ${pendingEntities} 个实体仍待确认。`
                : "实体状态已全部确认。"}
            </p>
          </>
        ) : (
          <p className="overview-note">
            还没有实体，先在对话中补充项目信息。
          </p>
        )}
      </section>

      <section className="overview-block" aria-label="快捷操作">
        <h3>快捷操作</h3>
        <div className="overview-actions">
          <Button
            icon={<PlusOutlined />}
            disabled={!onNewConversation}
            onClick={onNewConversation}
          >
            新建对话
          </Button>
          <Button
            icon={<FileAddOutlined />}
            loading={starting}
            disabled={runActive}
            onClick={() => void handleGeneratePrd()}
          >
            {runActive ? "PRD 生成中" : "生成 PRD 文档"}
          </Button>
          {/* 后端当前只接受 kind=prd，其余文档类型在这里保持禁用而不是假装可用。 */}
          <Tooltip title="后端暂只支持生成 PRD">
            <Button icon={<PlusOutlined />} disabled>
              生成 MRD 文档
            </Button>
          </Tooltip>
          <Tooltip title="后端暂只支持生成 PRD">
            <Button icon={<PlusOutlined />} disabled>
              生成 BRD 文档
            </Button>
          </Tooltip>
        </div>
      </section>

      {/* 第四层：最近交付文档 */}
      <section className="overview-block" aria-label="最近交付文档">
        <h3>最近交付文档</h3>
        {loading && !artifact ? (
          <OverviewSkeleton variant="row" />
        ) : artifact ? (
          <div className="overview-delivery">
            <FileTextOutlined aria-hidden="true" />
            <div className="overview-delivery-body">
              <span className="overview-delivery-title">{artifact.title}</span>
              <span className="overview-delivery-meta">
                第 {artifact.version} 版 · {formatDateTime(artifact.updatedAt)}
              </span>
            </div>
            <RunStatusTag status={run?.status ?? null} />
            <Button
              type="link"
              size="small"
              icon={<RightOutlined />}
              onClick={() => onPanelChange?.(DOCUMENTS_PANEL)}
            >
              查看
            </Button>
          </div>
        ) : (
          <p className="overview-note">
            {run
              ? `尚无交付物，最新任务状态：${RUN_STATUS_LABELS[run.status]}。`
              : "尚未生成交付文档。"}
          </p>
        )}
      </section>

      {/* 第五层：最近更新 */}
      <section className="overview-block" aria-label="最近更新">
        <h3>最近更新</h3>
        {timelineRows.length > 0 ? (
          <ol className="overview-timeline">
            {timelineRows.map((row) =>
              /*
               * 事件行与占位行共用同一套几何：数据到达时就地替换，
               * 已解析出的事件（例如会话活动）不会因为其它事件在加载而消失。
               */
              row.kind === "event" ? (
                <li key={row.event.key}>
                  <span className="overview-timeline-time">
                    {formatDateTime(row.event.at)}
                  </span>
                  <span className="overview-timeline-body">
                    <strong>{row.event.label}</strong>
                    {/* 说明单独成行、置于浅底容器内，与标题形成两级层级。 */}
                    <span className="overview-timeline-detail">
                      <em>{row.event.detail}</em>
                      <RightOutlined aria-hidden="true" />
                    </span>
                  </span>
                </li>
              ) : (
                <li key={`placeholder-${row.key}`} className="is-placeholder">
                  <span className="overview-timeline-time">
                    <span
                      className="overview-skeleton-line"
                      style={{ width: 88 }}
                    />
                  </span>
                  <span className="overview-timeline-body">
                    <span
                      className="overview-skeleton-line"
                      style={{ width: "44%" }}
                    />
                    <span className="overview-skeleton-bar" />
                  </span>
                </li>
              ),
            )}
          </ol>
        ) : (
          <p className="overview-note">暂无可用时间记录。</p>
        )}
      </section>
    </div>
  );
}

/** 核心指标单元；数值是这一层唯一需要被看见的东西。 */
function Metric({
  icon,
  label,
  value,
  hint,
  loading,
}: {
  /** 指标类型图标；仅作视觉区分，不承载语义。 */
  icon: ReactNode;
  label: string;
  value: number | null;
  hint?: string;
  loading: boolean;
}) {
  /*
   * 加载态只保留骨架，不再叠一个 spinner：
   * 同一张卡里同时出现"占位条 + 转圈图标"会显得多余，也让人分不清哪里在加载。
   * 结构已知 → 一律用骨架（见 theme/README 的加载约定）。
   */
  const content = loading ? (
    <span className="overview-metric-skeleton" aria-hidden="true" />
  ) : value === null ? (
    "-"
  ) : (
    value
  );

  return (
    <div className="overview-metric" title={hint}>
      <span className="overview-metric-head">
        <span className="overview-metric-label">{label}</span>
        <span className="overview-metric-icon" aria-hidden="true">
          {icon}
        </span>
      </span>
      <span className="overview-metric-value">{content}</span>
      {hint && <span className="overview-metric-hint">{hint}</span>}
    </div>
  );
}

/**
 * 概览区块骨架。
 *
 * 每个区块的最终结构已知（标签行 / 单行卡片），因此读取期间用骨架占住同样的
 * 几何，而不是显示一句话或通用转圈：Loading → Ready 不产生布局位移，也不会
 * 出现"卡片里同时有占位条和转圈"的混乱。
 *
 * 「最近更新」不用这个组件：它的时间线里可能已经有同步可知的事件，
 * 需要逐行判断是否占位，见 timelineRows。
 */
function OverviewSkeleton({ variant }: { variant: "chips" | "row" }) {
  if (variant === "chips") {
    return (
      <div className="overview-skeleton" aria-hidden="true">
        <div className="overview-skeleton-chips">
          {[64, 52, 60, 56, 48, 58, 44].map((width, index) => (
            <span key={index} className="overview-skeleton-chip" style={{ width }} />
          ))}
        </div>
        <span className="overview-skeleton-line" style={{ width: 168 }} />
      </div>
    );
  }

  return (
    <div className="overview-skeleton" aria-hidden="true">
      <div className="overview-skeleton-row">
        <span className="overview-skeleton-block" style={{ width: 28, height: 28 }} />
        <span className="overview-skeleton-stack">
          <span className="overview-skeleton-line" style={{ width: "58%" }} />
          <span className="overview-skeleton-line" style={{ width: "34%" }} />
        </span>
      </div>
    </div>
  );
}

/** PRD 任务状态：颜色与图标同时表达，不只依赖颜色。 */
function RunStatusTag({ status }: { status: DocumentGenerationStatus | null }) {
  if (!status) return null;
  const tone =
    status === "completed"
      ? "is-success"
      : status === "failed"
        ? "is-error"
        : status === "awaiting_input" || status === "stopped"
          ? "is-warning"
          : "is-running";
  const icon =
    status === "completed" ? (
      <CheckCircleFilled />
    ) : status === "failed" ? (
      <WarningFilled />
    ) : status === "running" || status === "queued" ? (
      <LoadingOutlined />
    ) : (
      <ClockCircleOutlined />
    );

  return (
    <span className={`overview-status ${tone}`}>
      {icon}
      {RUN_STATUS_LABELS[status]}
    </span>
  );
}

/** 本地化日期时间；无效时间回退为占位符。 */
function formatDateTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "未知时间";
  return date.toLocaleString();
}
