/**
 * 任务历史面板
 *
 * 展示当前会话各轮「用户请求 → Planner 规划 → DAG 执行 → 图谱更新」的只读视图，
 * 让用户看懂一次请求是如何被拆解、由哪些 Executor 完成、产出了什么。
 *
 * Responsibilities:
 * - 左侧列出当前会话的任务轮次并支持切换
 * - 右侧展示所选轮次的请求摘要、规划假设、DAG、任务详情与图谱更新
 *
 * Notes:
 * - 数据范围严格限定为「当前会话」，时间取自消息自身时间，不冒充任务开始时间。
 * - 不新增工作流字段、不修改 Planner / Executor / LangGraph 行为。
 * - 任务状态由已有结果推导；失败态只在有结构化错误时出现。
 */

import { useEffect, useMemo, useState } from "react";
import { Button, Empty, Tag, Tooltip } from "antd";
import {
  ApartmentOutlined,
  CheckCircleFilled,
  ClockCircleFilled,
  CloseCircleFilled,
  FileTextOutlined,
  LoadingOutlined,
  NodeIndexOutlined,
} from "@ant-design/icons";
import type { Message, TaskExecutionNode } from "../../types";
import { TypedText } from "../ui/TypedText";
import {
  buildTaskRounds,
  findTaskResult,
  formatTaskDependencies,
  ROUND_STATUS_META,
  TASK_STATUS_META,
  type RoundStatus,
  type TaskRound,
} from "../../utils/task-history";
import {
  buildTaskLayers,
  getAgentLabel,
  readRecordString,
  summarizeGraphUpdate,
  type TaskNodeStatus,
} from "../../utils/workflow-tasks";

interface Props {
  messages: Message[];
  /** 运行中时最后一轮显示为执行中。 */
  streaming: boolean;
  /** 跳到对话中对应的消息。 */
  onLocateMessage?: (messageId: string) => void;
  /** 会话为空时的提示来源。 */
  hasThread: boolean;
}

export function TaskHistoryPanel({
  messages,
  streaming,
  onLocateMessage,
  hasThread,
}: Props) {
  const rounds = useMemo(
    () => buildTaskRounds(messages, { streaming }),
    [messages, streaming],
  );
  const [selectedId, setSelectedId] = useState<string | null>(null);

  /**
   * 默认选中最近一次**有 Planner 计划**的轮次。
   *
   * 轮次列表里可能既有已规划的轮次，也有只有请求分析的轮次；直接选最后一条会
   * 打开一个空详情，看起来像"点错了"。
   */
  const defaultRoundId = useMemo(() => {
    for (let index = rounds.length - 1; index >= 0; index -= 1) {
      if (rounds[index]!.plan) return rounds[index]!.id;
    }
    return rounds[rounds.length - 1]?.id ?? null;
  }, [rounds]);

  // 轮次变化后保持选择有效。
  useEffect(() => {
    if (rounds.length === 0) {
      setSelectedId(null);
      return;
    }
    setSelectedId((current) =>
      current && rounds.some((round) => round.id === current)
        ? current
        : defaultRoundId,
    );
  }, [defaultRoundId, rounds]);

  const selected =
    rounds.find((round) => round.id === selectedId) ??
    rounds.find((round) => round.id === defaultRoundId) ??
    null;

  if (!hasThread) {
    return (
      <div className="task-history-empty">
        <Empty
          image={Empty.PRESENTED_IMAGE_SIMPLE}
          description="先在左侧新建或选择一个对话，任务历史按会话统计。"
        />
      </div>
    );
  }

  if (rounds.length === 0) {
    return (
      <div className="task-history-empty">
        <Empty
          image={Empty.PRESENTED_IMAGE_SIMPLE}
          description="当前会话还没有产生任务，发送需求后这里会记录规划与执行过程。"
        />
      </div>
    );
  }

  return (
    <div className="task-history">
      <aside className="task-history-list" aria-label="任务历史列表">
        <header className="task-history-list-head">
          <span>任务历史列表</span>
          <em>共 {rounds.length} 次任务</em>
        </header>
        <div className="task-history-list-body scrollbar-none-thin">
          {rounds.map((round) => (
            <button
              key={round.id}
              type="button"
              className="task-history-item"
              data-active={round.id === selected?.id ? "true" : "false"}
              onClick={() => setSelectedId(round.id)}
            >
              <span className="task-history-item-top">
                <span className="task-history-item-index">任务 #{round.index}</span>
                <RoundStatusTag status={round.status} />
              </span>
              <span className="task-history-item-title">{round.title}</span>
              <span className="task-history-item-meta">
                {formatDateTime(round.updatedAt)}
              </span>
            </button>
          ))}
        </div>
      </aside>

      <section className="task-history-detail" aria-label="任务详情">
        {selected && (
          <TaskRoundDetail round={selected} onLocateMessage={onLocateMessage} />
        )}
      </section>
    </div>
  );
}

/** 单轮任务的完整详情。 */
function TaskRoundDetail({
  round,
  onLocateMessage,
}: {
  round: TaskRound;
  onLocateMessage?: (messageId: string) => void;
}) {
  const graphUpdate = useMemo(
    () => summarizeGraphUpdate(round.results),
    [round.results],
  );
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);

  // 切轮次后重置任务选择。
  useEffect(() => {
    setSelectedTaskId(round.plan?.tasks[0]?.task_id ?? null);
  }, [round.id, round.plan]);

  const tasks = round.plan?.tasks ?? [];
  const selectedTask =
    tasks.find((task) => task.task_id === selectedTaskId) ?? tasks[0] ?? null;
  const layers = useMemo(() => buildTaskLayers(tasks), [tasks]);

  return (
    <div className="task-round">
      {/* 顶部：任务标题与状态 */}
      <header className="task-round-head">
        <div className="task-round-head-main">
          <h2>
            任务 #{round.index} · {round.title}
          </h2>
          <span className="task-round-head-meta">
            {formatDateTime(round.updatedAt)}
            {round.planStatus === "supplement" && " · 补充 DAG"}
            {round.planStatus === "initial" && " · 初始 DAG"}
          </span>
        </div>
        <div className="task-round-head-actions">
          <RoundStatusTag status={round.status} />
          {onLocateMessage && (
            <Tooltip title="在对话中定位这一轮">
              <Button
                type="text"
                size="small"
                onClick={() => onLocateMessage(round.messageId)}
              >
                定位
              </Button>
            </Tooltip>
          )}
        </div>
      </header>

      {round.agentError && (
        <p className="task-round-alert" role="alert">
          {round.agentError}
        </p>
      )}

      {/* 请求摘要 / 规划假设 */}
      <section className="task-block">
        <TaskBlockHeader title="请求摘要" />
        <p className="task-block-text">
          {round.plan?.request_summary ||
            round.review?.request_summary ||
            "本轮还没有 Planner 摘要。"}
        </p>
        {round.userRequest && (
          <details className="task-block-fold">
            <summary>查看原始请求</summary>
            <pre className="task-block-pre">{round.userRequest}</pre>
          </details>
        )}
      </section>

      <section className="task-block">
        <TaskBlockHeader title="规划假设 / Planning Context" />
        {round.plan?.assumptions.length ? (
          <ol className="task-assumptions">
            {round.plan.assumptions.map((assumption, index) => (
              /*
               * 假设文本形如 `Gap: … | Assumption: … | Impact: …`：
               * 前缀是结构标记（界面字体），后面的解释是自然语言（内容字体）。
               */
              <li key={`${round.id}-assumption-${index}`}>
                <TypedText text={assumption} />
              </li>
            ))}
          </ol>
        ) : (
          <p className="task-block-text is-muted">
            本轮 Planner 没有记录假设。
          </p>
        )}
      </section>

      {/* DAG 工作流执行链 */}
      <section className="task-block">
        <TaskBlockHeader
          title="DAG 工作流执行链"
          hint={
            layers.length <= 1
              ? tasks.length > 0
                ? "线性流程"
                : undefined
              : `${layers.length} 层依赖`
          }
        />
        {tasks.length === 0 ? (
          <p className="task-block-text is-muted">
            Planner 尚未产出任务，或本轮只做了请求分析。
          </p>
        ) : (
          <div className="task-dag scrollbar-none-thin">
            {layers.map((layer, layerIndex) => (
              <div key={`layer-${layerIndex}`} className="task-dag-layer">
                {layer.map((task) => (
                  <button
                    key={task.task_id}
                    type="button"
                    className="task-dag-node"
                    data-status={round.taskStatus.get(task.task_id) ?? "waiting"}
                    data-active={
                      task.task_id === selectedTask?.task_id ? "true" : "false"
                    }
                    onClick={() => setSelectedTaskId(task.task_id)}
                  >
                    <span className="task-dag-node-id">
                      {task.task_id}
                      <TaskStatusIcon
                        status={round.taskStatus.get(task.task_id) ?? "waiting"}
                      />
                    </span>
                    <span className="task-dag-node-agent">
                      {getAgentLabel(task.assigned_agent)}
                    </span>
                    <span className="task-dag-node-title">{task.title}</span>
                  </button>
                ))}
              </div>
            ))}
          </div>
        )}
        {layers.length > 1 && (
          <p className="task-block-text is-muted">
            同一行的任务可并行执行，箭头方向为依赖关系。
          </p>
        )}
      </section>

      {/* Task Detail */}
      <section className="task-block">
        <TaskBlockHeader
          title={selectedTask ? `${selectedTask.task_id} 任务详情` : "任务详情"}
        />
        {selectedTask ? (
          <TaskDetail
            task={selectedTask}
            status={round.taskStatus.get(selectedTask.task_id) ?? "waiting"}
            result={findTaskResult(round.results, selectedTask.task_id)}
          />
        ) : (
          <p className="task-block-text is-muted">没有可展示的任务。</p>
        )}
      </section>

      {/* Knowledge Graph Update */}
      <section className="task-block">
        <TaskBlockHeader
          title="图谱更新"
          icon={<ApartmentOutlined />}
          hint="本次任务各 Executor 提交的实体与关系"
        />
        <GraphUpdateBlock summary={graphUpdate} />
      </section>
    </div>
  );
}

/** 任务详情：ID、Executor、依赖、说明、预期产出、结果与状态。 */
function TaskDetail({
  task,
  status,
  result,
}: {
  task: TaskExecutionNode;
  status: TaskNodeStatus;
  result: ReturnType<typeof findTaskResult>;
}) {
  return (
    <dl className="task-detail">
      <TaskDetailRow label="Task ID" value={task.task_id} />
      <TaskDetailRow label="Executor / Agent" value={getAgentLabel(task.assigned_agent)} />
      <TaskDetailRow label="Dependencies" value={formatTaskDependencies(task)} />
      <TaskDetailRow label="Status" value={<TaskStatusTag status={status} />} />
      <TaskDetailRow
        label="Description"
        value={task.description || "未提供说明"}
        block
      />
      <TaskDetailRow
        label="预期产出"
        value={task.expected_output || "未定义"}
        block
      />
      <TaskDetailRow
        label="质量检查"
        value={
          task.quality_check.criteria.length > 0
            ? task.quality_check.criteria.join("；")
            : "无"
        }
        block
      />
      <TaskDetailRow
        label="Result"
        value={
          result
            ? [result.summary, result.quality_result?.notes]
                .filter((text): text is string => Boolean(text))
                .join(" · ") || "已完成，无附加说明"
            : "尚未产出结果"
        }
        block
      />
    </dl>
  );
}

/** 任务详情的一行；block 行允许换行显示长文本。 */
function TaskDetailRow({
  label,
  value,
  block = false,
}: {
  label: string;
  value: React.ReactNode;
  block?: boolean;
}) {
  return (
    <div className="task-detail-row" data-block={block ? "true" : "false"}>
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}

/** 图谱更新：新增 / 更新节点与关系。 */
function GraphUpdateBlock({
  summary,
}: {
  summary: ReturnType<typeof summarizeGraphUpdate>;
}) {
  const rows = [
    ...summary.newEntities.map((record) => ({
      kind: "新增实体",
      tone: "new" as const,
      title: formatRecordTitle(record),
      detail: readRecordString(record, "description") || readRecordString(record, "summary"),
    })),
    ...summary.updatedEntities.map((record) => ({
      kind: "更新实体",
      tone: "update" as const,
      title: formatRecordTitle(record),
      detail: readRecordString(record, "description") || readRecordString(record, "summary"),
    })),
    ...summary.newRelations.map((record) => ({
      kind: "新增关系",
      tone: "new" as const,
      title: formatRelationTitle(record),
      detail: readRecordString(record, "description"),
    })),
    ...summary.updatedRelations.map((record) => ({
      kind: "更新关系",
      tone: "update" as const,
      title: formatRelationTitle(record),
      detail: readRecordString(record, "description"),
    })),
  ];

  if (rows.length === 0) {
    return (
      <p className="task-block-text is-muted">
        本轮 Executor 结果里没有实体或关系变更。
      </p>
    );
  }

  return (
    <>
      <div className="task-graph-summary">
        <GraphMetric label="新增节点" value={summary.newEntities.length} />
        <GraphMetric label="更新节点" value={summary.updatedEntities.length} />
        <GraphMetric label="新增关系" value={summary.newRelations.length} />
        <GraphMetric label="更新关系" value={summary.updatedRelations.length} />
      </div>
      <div className="scrollbar-none-thin task-graph-table">
        <div className="task-graph-head">
          <span>变更</span>
          <span>实体 / 关系</span>
          <span>说明</span>
        </div>
        {rows.map((row, index) => (
          <div key={`${row.kind}-${index}`} className="task-graph-row">
            <span className="task-graph-kind" data-tone={row.tone}>
              {row.kind}
            </span>
            <span className="task-graph-title">{row.title}</span>
            <span className="task-graph-detail">{row.detail || "—"}</span>
          </div>
        ))}
      </div>
    </>
  );
}

/** 图谱更新的一项计数。 */
function GraphMetric({ label, value }: { label: string; value: number }) {
  return (
    <span className="task-graph-metric">
      {label}
      <em>{value}</em>
    </span>
  );
}

/** 区块标题。 */
function TaskBlockHeader({
  title,
  hint,
  icon,
}: {
  title: string;
  hint?: string;
  icon?: React.ReactNode;
}) {
  return (
    <header className="task-block-head">
      <h3>
        {icon}
        {title}
      </h3>
      {hint && <span>{hint}</span>}
    </header>
  );
}

/** 轮次状态：图标与文字同时表达，不只依赖颜色。 */
function RoundStatusTag({ status }: { status: RoundStatus }) {
  const meta = ROUND_STATUS_META[status];
  return (
    <span className="task-status-tag" data-tone={meta.tone}>
      <TaskStatusIcon status={status} />
      {meta.label}
    </span>
  );
}

/** 任务状态标签。 */
function TaskStatusTag({ status }: { status: TaskNodeStatus }) {
  const meta = TASK_STATUS_META[status];
  return (
    <span className="task-status-tag" data-tone={meta.tone}>
      <TaskStatusIcon status={status} />
      {meta.label}
    </span>
  );
}

/** 状态图标：形状区分，颜色克制。 */
function TaskStatusIcon({ status }: { status: RoundStatus | TaskNodeStatus }) {
  if (status === "completed") return <CheckCircleFilled />;
  if (status === "failed") return <CloseCircleFilled />;
  if (status === "running") return <LoadingOutlined />;
  if (status === "waiting") return <ClockCircleFilled />;
  return <ClockCircleFilled />;
}

/** 实体标题：ID · 类型 · 名称。 */
function formatRecordTitle(record: Record<string, unknown>): string {
  const parts = [
    readRecordString(record, "id"),
    readRecordString(record, "type"),
    readRecordString(record, "name") || readRecordString(record, "text"),
  ].filter(Boolean);
  return parts.length > 0 ? parts.join(" · ") : "未命名实体";
}

/** 关系标题：source → target。 */
function formatRelationTitle(record: Record<string, unknown>): string {
  const source = readRecordString(record, "source");
  const target = readRecordString(record, "target");
  const type = readRecordString(record, "type");
  if (source && target) {
    return `${source} → ${target}${type ? ` · ${type}` : ""}`;
  }
  return formatRecordTitle(record);
}

/** 本地化时间；无效时间回退占位符。 */
function formatDateTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "未知时间";
  return date.toLocaleString();
}
