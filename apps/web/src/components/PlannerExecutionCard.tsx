/**
 * Planner 执行计划卡片
 *
 * 展示 Planner SubAgent 生成的任务 DAG、Executor 实时运行状态，以及 Critique Agent
 * 对 Executor 结果和知识图谱一致性的收尾审查。
 *
 * Responsibilities:
 * - 渲染任务 DAG、节点状态和 Executor 结果
 * - 展示 Planner DAG 生成中的加载态
 * - 展示 Critique Agent 审查生成和完成状态
 */

import { useMemo, type ReactNode } from "react";
import { formatDisplayId } from "../utils/display-id";
import { Collapse, Empty, List, Space, Tag } from "antd";
import {
  CheckCircleOutlined,
  ClockCircleOutlined,
  LoadingOutlined,
  NodeIndexOutlined,
  PartitionOutlined,
  RightOutlined,
} from "@ant-design/icons";
import type {
  ExecutorAgentResult,
  ProductWorkflowAgentType,
  ProductWorkflowResult,
  TaskExecutionNode,
  TaskExecutionPlan,
} from "../types";

interface Props {
  plan: TaskExecutionPlan;
  executorResults?: ExecutorAgentResult[];
  activeAgent?: string;
  activeAgents?: string[];
}

type NodeStatus = "completed" | "running" | "waiting";

const AGENT_LABELS: Record<string, string> = {
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
 * 展示 Planner SubAgent 生成的执行 DAG，以及每个节点的实时运行状态。
 */
export function PlannerExecutionCard({
  plan,
  executorResults = [],
  activeAgent,
  activeAgents,
}: Props) {
  const statusByTaskId = useMemo(
    () =>
      buildTaskStatus(plan.tasks, executorResults, activeAgent, activeAgents),
    [activeAgent, activeAgents, executorResults, plan.tasks],
  );
  const completedCount = plan.tasks.filter(
    (task) => statusByTaskId.get(task.task_id) === "completed",
  ).length;

  return (
    <Collapse
      className="planner-execution-card mb-2 min-w-0 max-w-full [&_.ant-collapse-body]:min-w-0"
      defaultActiveKey={["1"]}
      expandIcon={({ isActive }) => <RightOutlined rotate={isActive ? 90 : 0} />}
      items={[
        {
          key: "1",
          label: (
            <div className="flex min-w-0 flex-wrap items-center gap-2">
              <PartitionOutlined style={{ color: "var(--primary)" }} />
              <span className="text-[14px] font-bold text-[var(--ink)]">
                Planner SubAgent DAG
              </span>
              <Tag color={plan.status === "supplement" ? "purple" : "blue"}>
                {plan.status === "supplement" ? "补充 DAG" : "初始 DAG"}
              </Tag>
              <Tag color="green">
                {completedCount}/{plan.tasks.length} 已完成
              </Tag>
            </div>
          ),
          children: (
            <div className="space-y-4">
              <PlanOverview plan={plan} />

              <div>
                <div className="mb-2 flex items-center gap-2 text-[13px] font-bold text-[var(--ink)]">
                  <PartitionOutlined />
                  任务流
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  {plan.tasks.map((task, index) => (
                    <div
                      key={task.task_id}
                      className="flex min-w-0 items-center gap-2"
                    >
                      <NodePill
                        task={task}
                        status={statusByTaskId.get(task.task_id) ?? "waiting"}
                      />
                      {index < plan.tasks.length - 1 && (
                        <RightOutlined className="text-[11px] text-[var(--ink-faint)]" />
                      )}
                    </div>
                  ))}
                </div>
              </div>

              <List
                size="small"
                dataSource={plan.tasks}
                renderItem={(task) => (
                  <TaskRow
                    task={task}
                    status={statusByTaskId.get(task.task_id) ?? "waiting"}
                    result={executorResults.find(
                      (item) => item.task_id === task.task_id,
                    )}
                  />
                )}
              />

              <DagEdges plan={plan} />
            </div>
          ),
        },
      ]}
    />
  );
}

/**
 * 展示 Planner SubAgent DAG 结构生成期间的占位卡片。
 */
export function PlannerExecutionLoadingCard() {
  return (
    <div
      className="mb-2 flex items-center gap-3 rounded-lg border border-[var(--line-soft)] bg-white p-5"
      data-agent-thinking="planner"
    >
      <div
        className="h-5 w-5 rounded-full border-2"
        style={{
          borderColor: "var(--primary)",
          animation: "qf-pulse 1.4s ease-out infinite",
        }}
      />
      <div className="min-w-0">
        <div className="flex items-center gap-2 text-[13px] font-bold text-[var(--ink)]">
          <PartitionOutlined style={{ color: "var(--primary)" }} />
          <span>Planner SubAgent DAG</span>
        </div>
        <div className="mt-1 text-[12px] font-bold text-[var(--ink-faint)]">
          正在生成执行 DAG
        </div>
      </div>
      <div className="ml-auto flex gap-1">
        {[0, 1, 2].map((index) => (
          <span
            key={index}
            className="h-1.5 w-1.5 rounded-full bg-[var(--primary)]"
            style={{
              animation: "qf-bounce 1.2s ease-in-out infinite",
              animationDelay: `${index * 0.2}s`,
            }}
          />
        ))}
      </div>
    </div>
  );
}

/**
 * 展示所有 Executor 完成后 Critique Agent 审查工作流结果的状态。
 */
export function CritiqueAgentReviewCard({
  state,
  result,
}: {
  state: "generating" | "complete";
  result?: ProductWorkflowResult;
}) {
  const complete = state === "complete";
  const requiresCorrection =
    result?.status === "requires_executor_retry" ||
    (result?.review.retry_task_ids?.length ?? 0) > 0;
  const statusColor = requiresCorrection
    ? "#d97706"
    : complete
      ? "var(--success)"
      : "var(--primary)";

  return (
    <div
      className="mb-2 rounded-lg border border-[var(--line-soft)] bg-white p-5"
      data-agent-thinking="critique"
    >
      <div className="flex items-start gap-3">
        <div
          className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2"
          style={{
            borderColor: statusColor,
            animation: complete ? undefined : "qf-pulse 1.4s ease-out infinite",
          }}
        >
          {complete && (
            <CheckCircleOutlined
              className="text-[11px]"
              style={{ color: statusColor }}
            />
          )}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2 text-[13px] font-bold text-[var(--ink)]">
            <PartitionOutlined
              style={{ color: statusColor }}
            />
            <span>Critique Agent</span>
            {result && (
              <WorkflowStatusTag
                status={
                  (result.review.retry_task_ids?.length ?? 0) > 0
                    ? "requires_executor_retry"
                    : result.status
                }
              />
            )}
          </div>
          <div className="mt-1 text-[12px] font-bold text-[var(--ink-faint)]">
            {complete
              ? requiresCorrection
                ? "审查已完成，工作流正在等待修正决定"
                : "已完成 Executor 结果与知识图谱审查"
              : "正在审查 Executor 结果与知识图谱一致性"}
          </div>
        </div>
        {!complete && (
          <div className="ml-auto flex gap-1">
            {[0, 1, 2].map((index) => (
              <span
                key={index}
                className="h-1.5 w-1.5 rounded-full bg-[var(--primary)]"
                style={{
                  animation: "qf-bounce 1.2s ease-in-out infinite",
                  animationDelay: `${index * 0.2}s`,
                }}
              />
            ))}
          </div>
        )}
      </div>

      {result && <CritiqueReviewResult result={result} />}
    </div>
  );
}

/**
 * 渲染 DAG 总览信息，帮助用户先理解本轮任务范围。
 */
function PlanOverview({ plan }: { plan: TaskExecutionPlan }) {
  return (
    <section className="min-w-0 max-w-full rounded-lg bg-[var(--surface-muted)] px-4 py-3">
      <div className="mb-1 text-[12px] font-bold uppercase tracking-normal text-[var(--ink-faint)]">
        请求摘要
      </div>
      <div className="font-reading-compact whitespace-pre-wrap text-[13px] leading-relaxed text-[var(--ink-soft)]">
        {plan.request_summary}
      </div>
      {plan.assumptions.length > 0 && (
        <div className="mt-3">
          <div className="mb-1 text-[12px] font-bold text-[var(--ink-faint)]">
            规划假设
          </div>
          <div className="min-w-0 space-y-2">
            {plan.assumptions.map((assumption, index) => (
              <div key={`${assumption}-${index}`} className="font-reading-compact max-w-full whitespace-pre-wrap rounded bg-white/70 px-2 py-1 text-[var(--ink-soft)]">
                {assumption}
              </div>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}

/**
 * 渲染 DAG 顶部流程中的单个节点。
 */
function NodePill({
  task,
  status,
}: {
  task: TaskExecutionNode;
  status: NodeStatus;
}) {
  const config = getStatusConfig(status);
  return (
    <span
      className="inline-flex max-w-[260px] items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-[12px] font-bold"
      style={{
        borderColor: config.border,
        background: config.background,
        color: config.color,
      }}
      title={`${task.task_id} · ${task.title}`}
    >
      {config.icon}
      <span className="truncate">
        {task.task_id} · {getAgentLabel(task.assigned_agent)}
      </span>
    </span>
  );
}

/**
 * 渲染 DAG 明细中的单个任务节点。
 */
function TaskRow({
  task,
  status,
  result,
}: {
  task: TaskExecutionNode;
  status: NodeStatus;
  result?: ExecutorAgentResult;
}) {
  const config = getStatusConfig(status);

  return (
    <List.Item className="min-w-0 max-w-full px-0!">
      <article className="min-w-0 max-w-full w-full rounded-lg border border-[var(--line-soft)] bg-white px-4 py-3">
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <Tag className="m-0!">{task.task_id}</Tag>
          <Tag color={config.tagColor} className="m-0!">
            {config.label}
          </Tag>
          <Tag className="m-0!">{getAgentLabel(task.assigned_agent)}</Tag>
          {task.depends_on.length > 0 && (
            <Tag className="m-0!">依赖：{task.depends_on.join(", ")}</Tag>
          )}
        </div>

        <div className="mb-3">
          <div className="text-[14px] font-bold text-[var(--ink)]">
            {task.title}
          </div>
        </div>

        <div className="grid gap-3 md:grid-cols-[minmax(0,1.2fr)_minmax(220px,0.8fr)]">
          <TaskTextPanel label="任务说明" text={task.description} />
          <TaskTextPanel label="预期产出" text={task.expected_output} />
        </div>

        {result ? (
          <ExecutorResultPanel result={result} />
        ) : (
          <div className="mt-3 rounded-md bg-[var(--surface-muted)] px-3 py-2 text-[12px] font-semibold text-[var(--ink-faint)]">
            {status === "running"
              ? "该任务正在执行，完成后会在这里展示图谱更新结果。"
              : "等待依赖任务完成后执行。"}
          </div>
        )}
      </article>
    </List.Item>
  );
}

/**
 * 以轻量信息块展示任务说明、预期产出等不同语义段落。
 */
function TaskTextPanel({ label, text }: { label: string; text: string }) {
  return (
    <section className="rounded-md bg-[var(--surface-muted)] px-3 py-2">
      <div className="mb-1 text-[12px] font-bold text-[var(--ink-faint)]">
        {label}
      </div>
      <div className="font-reading-compact whitespace-pre-wrap text-[13px] leading-relaxed text-[var(--ink-soft)]">
        {text}
      </div>
    </section>
  );
}

/**
 * 展示单个 Executor 任务完成后的完整结构化结果摘要。
 */
function ExecutorResultPanel({ result }: { result: ExecutorAgentResult }) {
  return (
    <section className="mt-3 rounded-md border border-[#bbf7d0] bg-[#f0fdf4] px-3 py-3">
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <CheckCircleOutlined className="text-[var(--success)]" />
        <span className="text-[13px] font-bold text-[#166534]">
          已更新至知识图谱
        </span>
        <Tag color={result.quality_result.passed ? "green" : "red"} className="m-0!">
          {result.quality_result.passed ? "质量通过" : "质量未通过"}
        </Tag>
        {result.focus_layer && (
          <Tag color="cyan" className="m-0!">
            {result.focus_layer}
          </Tag>
        )}
      </div>

      <div className="font-reading-compact whitespace-pre-wrap text-[13px] leading-relaxed text-[#166534]">
        {result.summary}
      </div>

      <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
        <MetricPill label="实体" value={result.entities.length} />
        <MetricPill label="关系" value={result.relations.length} />
        <MetricPill label="决策" value={result.decisions.length} />
        <MetricPill label="风险" value={result.risks.length} />
        <MetricPill label="开放问题" value={result.open_questions.length} />
      </div>

      {result.quality_result.notes && (
        <ResultTextBlock label="质量说明" text={result.quality_result.notes} />
      )}
      <RecordList title="实体节点" items={result.entities} />
      <RecordList title="关系边" items={result.relations} />
      <TextList title="决策" items={result.decisions} />
      <TextList title="风险" items={result.risks} tone="risk" />
      <TextList title="开放问题" items={result.open_questions} tone="question" />
    </section>
  );
}

/**
 * 展示 Executor 结果中的数量指标。
 */
function MetricPill({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-md bg-white/70 px-2.5 py-2">
      <div className="text-[11px] font-bold text-[var(--ink-faint)]">
        {label}
      </div>
      <div className="mt-0.5 text-[16px] font-bold text-[var(--ink)]">
        {value}
      </div>
    </div>
  );
}

/**
 * 展示带标题的长文本结果段落。
 */
function ResultTextBlock({ label, text }: { label: string; text: string }) {
  return (
    <div className="mt-3 rounded-md bg-white/70 px-3 py-2">
      <div className="mb-1 text-[12px] font-bold text-[var(--ink-faint)]">
        {label}
      </div>
      <div className="font-reading-compact whitespace-pre-wrap text-[13px] leading-relaxed text-[var(--ink-soft)]">
        {text}
      </div>
    </div>
  );
}

/**
 * 展示结构化实体或关系记录，尽量提取名称、类型和描述。
 */
function RecordList({
  title,
  items,
}: {
  title: string;
  items: Array<Record<string, unknown>>;
}) {
  if (items.length === 0) return null;

  return (
    <div className="mt-3">
      <div className="mb-1 text-[12px] font-bold text-[var(--ink-faint)]">
        {title}
      </div>
      <div className="space-y-1.5">
        {items.map((item, index) => (
          <div
            key={`${title}-${readRecordString(item, "id") || index}`}
            className="font-reading-compact min-w-0 max-w-full rounded-md bg-white/70 px-3 py-2 text-[12px] leading-relaxed text-[var(--ink-soft)]"
          >
            <div className="font-reading-compact font-bold text-[var(--ink)]" title={formatRecordTitle(item, index, false)}>
              {formatRecordTitle(item, index)}
            </div>
            {formatRecordDescription(item) && (
              <div className="font-reading-compact mt-0.5 whitespace-pre-wrap">
                {formatRecordDescription(item)}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * 展示决策、风险和开放问题等文本列表。
 */
/**
 * 可渲染的文本项：纯字符串或带结构的 {id, text} 对象。
 */
type TextItem = string | { id: string; text: string };

/**
 * 从 TextItem 中提取显示文本。
 */
function extractText(item: TextItem): string {
  return typeof item === "string" ? item : item.text;
}

function TextList({
  title,
  items,
  tone = "default",
}: {
  title: string;
  items: TextItem[];
  tone?: "default" | "risk" | "question";
}) {
  if (items.length === 0) return null;
  const toneClass =
    tone === "risk"
      ? "border-[#fed7aa] bg-[#fff7ed] text-[#9a3412]"
      : tone === "question"
        ? "border-[#bfdbfe] bg-[#eff6ff] text-[#1d4ed8]"
        : "border-[var(--line-soft)] bg-white/70 text-[var(--ink-soft)]";

  return (
    <div className="mt-3">
      <div className="mb-1 text-[12px] font-bold text-[var(--ink-faint)]">
        {title}
      </div>
      <div className="space-y-1.5">
        {items.map((item, index) => (
          <div
            key={`${title}-${index}`}
            className={`font-reading-compact rounded-md border px-3 py-2 text-[12px] leading-relaxed ${toneClass}`}
          >
            {extractText(item)}
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * 渲染 DAG 边信息，并将 task_id 映射到任务标题，便于阅读依赖关系。
 */
function DagEdges({ plan }: { plan: TaskExecutionPlan }) {
  const taskById = new Map(plan.tasks.map((task) => [task.task_id, task]));

  return (
    <div>
      <div className="mb-2 flex items-center gap-2 text-[13px] font-bold text-[var(--ink)]">
        <NodeIndexOutlined />
        依赖边
      </div>
      {plan.dag.edges.length === 0 ? (
        <Empty
          image={Empty.PRESENTED_IMAGE_SIMPLE}
          description="暂无依赖边"
        />
      ) : (
        <Space size={6} wrap>
          {plan.dag.edges.map((edge) => (
            <Tag key={`${edge.source}-${edge.target}`} className="m-0!">
              {formatTaskEdgeLabel(taskById.get(edge.source), edge.source)} →{" "}
              {formatTaskEdgeLabel(taskById.get(edge.target), edge.target)}
            </Tag>
          ))}
        </Space>
      )}
    </div>
  );
}

/**
 * 展示 Critique Agent 产出的完整审查结果。
 */
function CritiqueReviewResult({ result }: { result: ProductWorkflowResult }) {
  const reviewIssues = result.review.issues ?? [];
  const graphReview = result.knowledge_graph_review;
  const graphIssues = graphReview?.issues ?? [];
  const graphNotes = graphReview?.notes ?? [];
  const proposalQuestions = result.proposal_questions ?? [];
  const graphRef = graphReview?.graph_ref;
  const isLightweightSnapshot =
    result.knowledge_graph_update.entities.length === 0 &&
    (graphRef?.entity_count ?? 0) > 0;

  return (
    <div className="mt-4 space-y-3">
      <section className="rounded-md bg-[var(--surface-muted)] px-3 py-2">
        <div className="mb-1 text-[12px] font-bold text-[var(--ink-faint)]">
          请求摘要
        </div>
        <div className="font-reading-compact whitespace-pre-wrap text-[13px] leading-relaxed text-[var(--ink-soft)]">
          {result.request_summary}
        </div>
      </section>

      <section className="rounded-md bg-[var(--surface-muted)] px-3 py-2">
        <div className="mb-2 flex flex-wrap items-center gap-2">
          <span className="text-[13px] font-bold text-[var(--ink)]">
            任务审查
          </span>
          <Tag color="green" className="m-0!">
            接受 {result.review.accepted_task_ids.length}
          </Tag>
          <Tag color="red" className="m-0!">
            驳回 {result.review.rejected_task_ids.length}
          </Tag>
          <Tag color="orange" className="m-0!">
            待修正 {result.review.retry_task_ids?.length ?? 0}
          </Tag>
        </div>
        <ChipList label="已接受任务" items={result.review.accepted_task_ids} />
        <ChipList label="驳回任务" items={result.review.rejected_task_ids} />
        <ChipList label="待修正任务" items={result.review.retry_task_ids ?? []} />
        <ReviewIssueList title="审查问题" issues={reviewIssues} />
        {result.review.notes && (
          <div className="font-reading-compact mt-2 whitespace-pre-wrap text-[13px] leading-relaxed text-[var(--ink-soft)]">
            {result.review.notes}
          </div>
        )}
      </section>

      <section className="rounded-md bg-[var(--surface-muted)] px-3 py-2">
        <div className="mb-2 flex flex-wrap items-center gap-2">
          <span className="text-[13px] font-bold text-[var(--ink)]">
            知识图谱更新
          </span>
          <Tag color="blue" className="m-0!">
            实体{" "}
            {graphRef?.entity_count ??
              result.knowledge_graph_update.entities.length}
          </Tag>
          <Tag color="cyan" className="m-0!">
            关系{" "}
            {graphRef?.relation_count ??
              result.knowledge_graph_update.relations.length}
          </Tag>
          {!isLightweightSnapshot && (
            <>
              <Tag className="m-0!">
                决策 {result.knowledge_graph_update.decisions?.length ?? 0}
              </Tag>
              <Tag className="m-0!">
                风险 {result.knowledge_graph_update.risks?.length ?? 0}
              </Tag>
              <Tag className="m-0!">
                开放问题{" "}
                {result.knowledge_graph_update.open_questions?.length ?? 0}
              </Tag>
            </>
          )}
        </div>
        <TextList title="图谱备注" items={result.knowledge_graph_update.notes} />
        {graphReview && (
          <>
            <div className="mt-3 flex flex-wrap items-center gap-2 text-[12px] text-[var(--ink-faint)]">
              {typeof graphReview.graph_ref?.version === "number" && (
                <Tag className="m-0!">版本 {graphReview.graph_ref.version}</Tag>
              )}
              {typeof graphReview.graph_ref?.entity_count === "number" && (
                <Tag className="m-0!">
                  图谱实体 {graphReview.graph_ref.entity_count}
                </Tag>
              )}
              {typeof graphReview.graph_ref?.relation_count === "number" && (
                <Tag className="m-0!">
                  图谱关系 {graphReview.graph_ref.relation_count}
                </Tag>
              )}
              {graphReview.graph_ref?.checksum && (
                <Tag className="m-0!">校验 {graphReview.graph_ref.checksum}</Tag>
              )}
            </div>
            <ReviewIssueList title="图谱审查问题" issues={graphIssues} />
            <TextList title="图谱审查备注" items={graphNotes} />
          </>
        )}
      </section>

      {result.product_context_update && (
        <section className="rounded-md bg-[var(--surface-muted)] px-3 py-2">
          <div className="mb-1 text-[12px] font-bold text-[var(--ink-faint)]">
            产品上下文更新
          </div>
          <div className="font-reading-compact whitespace-pre-wrap text-[13px] leading-relaxed text-[var(--ink-soft)]">
            {result.product_context_update}
          </div>
        </section>
      )}

      {proposalQuestions.length > 0 && (
        <section className="rounded-md bg-[#eff6ff] px-3 py-2">
          <div className="mb-2 text-[13px] font-bold text-[#1d4ed8]">
            待用户确认的问题
          </div>
          <div className="space-y-1.5">
            {proposalQuestions.map((question) => (
              <div
                key={question.id}
                className="font-reading-compact rounded-md bg-white/75 px-3 py-2 text-[12px] leading-relaxed text-[#1d4ed8]"
              >
                <div className="font-bold">{question.label}</div>
                {question.help && <div className="mt-0.5">{question.help}</div>}
              </div>
            ))}
          </div>
        </section>
      )}

      {result.confirmation_message && (
        <section className="rounded-md bg-[#f0fdf4] px-3 py-2">
          <div className="mb-1 text-[12px] font-bold text-[#166534]">
            确认提示
          </div>
          <div className="font-reading-compact whitespace-pre-wrap text-[13px] leading-relaxed text-[#166534]">
            {result.confirmation_message}
          </div>
        </section>
      )}
    </div>
  );
}

/**
 * 渲染一组任务 ID 标签。
 */
function ChipList({ label, items }: { label: string; items: string[] }) {
  if (items.length === 0) return null;

  return (
    <div className="mt-2">
      <span className="mr-2 text-[12px] font-bold text-[var(--ink-faint)]">
        {label}
      </span>
      <Space size={4} wrap>
        {items.map((item) => (
          <Tag key={item} className="m-0!">
            {item}
          </Tag>
        ))}
      </Space>
    </div>
  );
}

/**
 * 渲染 Critique Agent 审查中的问题列表。
 */
function ReviewIssueList({
  title,
  issues,
}: {
  title: string;
  issues: NonNullable<ProductWorkflowResult["review"]["issues"]>;
}) {
  if (issues.length === 0) return null;

  return (
    <div className="mt-3">
      <div className="mb-1 text-[12px] font-bold text-[var(--ink-faint)]">
        {title}
      </div>
      <div className="space-y-1.5">
        {issues.map((issue, index) => (
          <div
            key={`${issue.code}-${issue.task_id ?? "global"}-${index}`}
            className="rounded-md border border-[#fed7aa] bg-[#fff7ed] px-3 py-2 text-[12px] leading-relaxed text-[#9a3412]"
          >
            <div className="mb-0.5 flex flex-wrap items-center gap-1.5 font-bold">
              <Tag color={issue.severity === "error" ? "red" : "orange"} className="m-0!">
                {issue.severity === "error" ? "错误" : "警告"}
              </Tag>
              <span>{issue.code}</span>
              {issue.task_id && <span>· {issue.task_id}</span>}
            </div>
            <div className="font-reading-compact whitespace-pre-wrap">{issue.message}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * 展示产品工作流状态标签。
 */
function WorkflowStatusTag({
  status,
}: {
  status: ProductWorkflowResult["status"] | "requires_executor_retry";
}) {
  if (status === "completed") return <Tag color="green">已完成</Tag>;
  if (status === "discarded") return <Tag color="red">已放弃</Tag>;
  if (status === "requires_executor_retry") {
    return <Tag color="orange">待修正</Tag>;
  }
  return <Tag color="orange">等待确认</Tag>;
}

/**
 * 根据已完成结果和当前 Agent 推断 DAG 节点状态。
 */
function buildTaskStatus(
  tasks: TaskExecutionNode[],
  results: ExecutorAgentResult[],
  activeAgent?: string,
  activeAgents?: string[],
): Map<string, NodeStatus> {
  const completedTaskIds = new Set(results.map((item) => item.task_id));
  const runningAgents = new Set(activeAgents ?? []);
  if (activeAgent) {
    runningAgents.add(activeAgent);
  }
  const runningTaskIds = new Set<string>();

  // 相同 Executor Agent 在 DAG 中可能出现多次，只标记当前依赖已满足的最早任务。
  for (const agentType of runningAgents) {
    const runningTask = tasks
      .filter((task) => task.assigned_agent === agentType)
      .sort((left, right) => left.sequence - right.sequence)
      .find((task) => {
        if (completedTaskIds.has(task.task_id)) return false;
        return task.depends_on.every((taskId) => completedTaskIds.has(taskId));
      });
    if (runningTask) {
      runningTaskIds.add(runningTask.task_id);
    }
  }

  return new Map(
    tasks.map((task) => {
      if (completedTaskIds.has(task.task_id)) {
        return [task.task_id, "completed" as const];
      }
      if (runningTaskIds.has(task.task_id)) {
        return [task.task_id, "running" as const];
      }
      return [task.task_id, "waiting" as const];
    }),
  );
}

/**
 * 获取节点状态的展示配置。
 */
function getStatusConfig(status: NodeStatus): {
  label: string;
  tagColor: string;
  color: string;
  background: string;
  border: string;
  icon: ReactNode;
} {
  if (status === "completed") {
    return {
      label: "运行完毕",
      tagColor: "green",
      color: "var(--success)",
      background: "var(--success-soft)",
      border: "rgba(22, 163, 74, 0.28)",
      icon: <CheckCircleOutlined />,
    };
  }
  if (status === "running") {
    return {
      label: "运行中",
      tagColor: "blue",
      color: "var(--primary)",
      background: "var(--primary-soft)",
      border: "rgba(37, 99, 235, 0.28)",
      icon: <LoadingOutlined />,
    };
  }
  return {
    label: "等待运行",
    tagColor: "default",
    color: "var(--ink-faint)",
    background: "var(--surface-muted)",
    border: "var(--line-soft)",
    icon: <ClockCircleOutlined />,
  };
}

/**
 * 将 Agent 类型转换为展示名。
 */
function getAgentLabel(agentType: ProductWorkflowAgentType): string {
  return AGENT_LABELS[agentType] ?? agentType;
}

/**
 * 为 DAG 边展示任务 ID 和标题。
 */
function formatTaskEdgeLabel(
  task: TaskExecutionNode | undefined,
  fallbackTaskId: string,
): string {
  if (!task) return fallbackTaskId;
  return `${task.task_id} ${task.title}`;
}

/**
 * 从结构化记录中读取字符串字段。
 */
function readRecordString(
  record: Record<string, unknown>,
  key: string,
): string {
  const value = record[key];
  return typeof value === "string" ? value : "";
}

/**
 * 为实体或关系记录生成标题。
 */
function formatRecordTitle(record: Record<string, unknown>, index: number, compact = true): string {
  const id = readRecordString(record, "id");
  const type = readRecordString(record, "type");
  const name = readRecordString(record, "name");
  const source = readRecordString(record, "source");
  const target = readRecordString(record, "target");
  const display = compact ? formatDisplayId : (value: string) => value;
  const label = name || (source && target ? `${display(source)} → ${display(target)}` : "");
  return [display(id) || `#${index + 1}`, type, label].filter(Boolean).join(" · ");
}

/**
 * 为实体或关系记录生成描述。
 */
function formatRecordDescription(record: Record<string, unknown>): string {
  return (
    readRecordString(record, "description") ||
    readRecordString(record, "summary") ||
    readRecordString(record, "text")
  );
}
