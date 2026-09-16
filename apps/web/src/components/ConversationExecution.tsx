/**
 * 对话执行时间线
 *
 * 把一次请求中的 Agent 执行过程从「每个 Agent 一张大卡片」重构为紧凑的执行时间线：
 * 一级只呈现状态、执行描述与 Agent 名称，Token / Cost / 工具参数等下级信息逐层展开。
 *
 * Responsibilities:
 * - 渲染一次请求的执行分组（步骤计数、整体状态、完成后折叠）
 * - 渲染单步执行行（状态圆点、执行描述、Agent 名称、耗时）
 * - 在展开的「运行详情」中呈现 Token、Cost、工具调用与执行过程
 *
 * Notes:
 * - 纯展示组件：只读取已有 Message 字段，不请求、不改写任何状态。
 * - 步骤状态复用 workflow-tasks 的推导，与「任务历史」面板共用一份逻辑。
 * - 必须保留 data-agent-thinking 锚点，ChatApp 的并行 Agent 定位依赖它。
 */

import { useState, type ReactNode } from "react";
import { Spin } from "antd";
import {
  CaretRightOutlined,
  CheckCircleFilled,
  CloseCircleFilled,
  LoadingOutlined,
} from "@ant-design/icons";
import type {
  ExecutorAgentResult,
  Message,
  SubagentTrace,
  TaskExecutionNode,
  TaskExecutionPlan,
  TokenUsageInfo,
} from "../types";
import { getAgentLabel, type TaskNodeStatus } from "../utils/workflow-tasks";
import { formatCost, formatDuration, formatTokens } from "../utils/token-usage";

type ToolCall = NonNullable<Message["toolCalls"]>[number];

/** 时间线中的一步。 */
export interface ExecutionStep {
  /** 稳定 key：同一 Executor 可能对应多个任务，用任务 ID 区分。 */
  id: string;
  /** 人类可读的执行描述。 */
  title: string;
  /** 负责的 Agent 展示名。 */
  agentLabel: string;
  /** Agent 类型，用于查工具调用与 token 用量。 */
  agentType: string;
  status: TaskNodeStatus;
  /** 该 Agent 的执行耗时（毫秒）；缺少 token 记录时为 undefined。 */
  durationMs?: number;
  /** 展开区要展示的数据。 */
  task?: TaskExecutionNode;
  result?: ExecutorAgentResult;
  toolCalls: ToolCall[];
  tokenUsage?: TokenUsageInfo;
  /** 执行过程正文（reasoning）。 */
  thinking?: string;
  /** Orchestrator 调用过的 SubAgent 轨迹。 */
  subagents?: SubagentTrace[];
  /**
   * 该步骤的结构化内容。
   *
   * 复用已有卡片（用户输入整理、Request Agent 分析等）的内联形态，避免同一份
   * 数据在时间线之外再渲染一次。
   */
  content?: ReactNode;
}

interface RunGroupProps {
  /** 分组标题，例如「智能体任务执行」。 */
  title?: string;
  steps: ExecutionStep[];
  /** 组内是否仍有步骤在运行。 */
  active: boolean;
  /** 运行中的当前步骤描述，用于折叠态摘要。 */
  activeLabel?: string;
  /** 是否展开步骤列表；不传时由组件内部维护。 */
  defaultOpen?: boolean;
  /** 分组标题右侧的补充说明。 */
  hint?: string | null;
}

const STATUS_LABEL: Record<TaskNodeStatus, string> = {
  completed: "已完成",
  running: "执行中",
  failed: "失败",
  waiting: "等待",
};

/**
 * 执行分组：一级信息容器。
 *
 * 只有一步时，标题直接使用该步骤的执行描述与 Agent 名（描述在左、Agent 在右），
 * 不再重复「智能体任务执行」这层没有信息量的包裹；多步时保留分组标题与步数。
 *
 * 完成后自动折叠为一行摘要，运行中展开当前步骤；用户随时可以重新展开。
 */
export function ExecutionRunGroup({
  title = "智能体任务执行",
  steps,
  active,
  activeLabel,
  defaultOpen,
  hint,
}: RunGroupProps) {
  const [userToggled, setUserToggled] = useState(false);
  const [userOpen, setUserOpen] = useState(false);

  const completedCount = steps.filter((step) => step.status === "completed").length;
  const failedCount = steps.filter((step) => step.status === "failed").length;
  const totalDuration = steps.reduce(
    (sum, step) => sum + (step.durationMs ?? 0),
    0,
  );

  if (steps.length === 0) return null;

  // 运行中默认展开当前步骤；结束后默认折叠，除非用户手动展开过。
  const open = userToggled ? userOpen : (defaultOpen ?? active);

  /** 只有一步时直接用该步的身份，避免多一层无信息量的标题。 */
  const sole = steps.length === 1 ? steps[0]! : null;

  /**
   * 单步分组：头部就是这一步，没有更大的分组身份。
   *
   * 展开时直接展示运行详情，不再重复一遍标题与 Agent 名。
   */
  if (sole) {
    const hasDetail = stepHasDetail(sole);
    const expanded = open && hasDetail;
    const soleDuration = sole.durationMs ?? 0;

    return (
      <section
        className="exec-run is-single"
        data-active={active ? "true" : "false"}
        // ChatApp 的「并行思考」指示器依赖这个锚点定位当前 Agent。
        data-agent-thinking={sole.agentType}
      >
        <button
          type="button"
          className="exec-run-head"
          aria-expanded={expanded}
          disabled={!hasDetail}
          onClick={() => {
            if (!hasDetail) return;
            setUserOpen(!open);
            setUserToggled(true);
          }}
        >
          <CaretRightOutlined
            className="exec-caret"
            data-open={expanded ? "true" : "false"}
            data-hidden={hasDetail ? "false" : "true"}
            aria-hidden="true"
          />
          <StatusDot status={sole.status} />
          <span className="exec-run-title" title={sole.title}>
            {sole.title}
          </span>

          {/* 右侧尾部：运行指示与耗时，始终靠最右。 */}
          <span className="exec-run-tail">
            {active && <Spin indicator={<LoadingOutlined />} size="small" />}
            {soleDuration > 0 && (
              <span className="exec-run-meta">
                {formatDuration(soleDuration)}
              </span>
            )}
          </span>

          <span className="exec-run-agent" title={sole.agentLabel}>
            {sole.agentLabel}
          </span>
        </button>

        {/* 展开即运行详情；没有可展开内容时连提示都不显示。 */}
        {expanded && (
          <div className="exec-run-detail">
            <ExecutionDetail step={sole} />
          </div>
        )}
      </section>
    );
  }

  const summary = active
    ? activeLabel ?? steps.find((step) => step.status === "running")?.title ?? "正在执行"
    : failedCount > 0
      ? `已完成 ${completedCount} / ${steps.length}，${failedCount} 步失败`
      : `已完成 ${completedCount} / ${steps.length}`;

  return (
    <section className="exec-run" data-active={active ? "true" : "false"}>
      <button
        type="button"
        className="exec-run-head"
        aria-expanded={open}
        onClick={() => {
          setUserOpen(!open);
          setUserToggled(true);
        }}
      >
        <CaretRightOutlined
          className="exec-caret"
          data-open={open ? "true" : "false"}
          aria-hidden="true"
        />
        <span className="exec-run-title" title={title}>
          {title}
        </span>

        <span className="exec-run-tail">
          <span className="exec-run-count">
            {completedCount} / {steps.length}
          </span>
          {active && <Spin indicator={<LoadingOutlined />} size="small" />}
          {!active && totalDuration > 0 && (
            <span className="exec-run-meta">{formatDuration(totalDuration)}</span>
          )}
          {hint && <span className="exec-run-meta">{hint}</span>}
        </span>
      </button>

      {!open && (
        <p className="exec-run-summary" data-tone={active ? "running" : "done"}>
          {summary}
        </p>
      )}

      {open && (
        <ol className="exec-steps">
          {steps.map((step) => (
            <ExecutionStepRow key={step.id} step={step} />
          ))}
        </ol>
      )}
    </section>
  );
}

/**
 * 该步骤是否有可展开的运行详情。
 *
 * 没有内容时不渲染展开入口，避免出现点了没反应的 caret。
 */
function stepHasDetail(step: ExecutionStep): boolean {
  return Boolean(
    step.result ||
      step.thinking ||
      step.toolCalls.length > 0 ||
      step.tokenUsage ||
      step.subagents?.length ||
      step.content ||
      step.task?.expected_output,
  );
}

/**
 * 单步执行行。
 *
 * 折叠时只有状态、描述与 Agent 名；展开后是「运行详情」。
 */
export function ExecutionStepRow({ step }: { step: ExecutionStep }) {
  const [open, setOpen] = useState(false);
  const hasDetail = stepHasDetail(step);

  return (
    <li
      className="exec-step"
      data-status={step.status}
      // ChatApp 的「并行思考」指示器依赖这个锚点定位当前 Agent。
      data-agent-thinking={step.agentType}
    >
      <div className="exec-step-row">
        <StatusDot status={step.status} />
        <span className="exec-step-title" title={step.title}>
          {step.title}
        </span>
        {hasDetail && (
          <button
            type="button"
            className="exec-step-toggle"
            aria-expanded={open}
            onClick={() => setOpen((value) => !value)}
          >
            {open ? "收起详情" : "运行详情"}
            <CaretRightOutlined
              className="exec-caret"
              data-open={open ? "true" : "false"}
              aria-hidden="true"
            />
          </button>
        )}
      </div>

      <div className="exec-step-meta">
        <span className="exec-step-agent">{step.agentLabel}</span>
        {step.durationMs !== undefined && step.durationMs > 0 && (
          <>
            <span className="exec-dot" aria-hidden="true">
              ·
            </span>
            <span>{formatDuration(step.durationMs)}</span>
          </>
        )}
        {step.status === "running" && (
          <>
            <span className="exec-dot" aria-hidden="true">
              ·
            </span>
            <span className="exec-step-hint">
              {step.title.startsWith("正在") ? "正在处理…" : "处理中…"}
            </span>
          </>
        )}
        {step.status === "failed" && (
          <>
            <span className="exec-dot" aria-hidden="true">
              ·
            </span>
            <span className="exec-step-failed">未通过校验</span>
          </>
        )}
      </div>

      {open && <ExecutionDetail step={step} />}
    </li>
  );
}

/** 运行详情：技术信息集中在这里，默认不展示。 */
function ExecutionDetail({ step }: { step: ExecutionStep }) {
  const usage = step.tokenUsage;
  const toolDone = step.toolCalls.filter(isToolComplete).length;

  return (
    <div className="exec-detail">
      {/* 元数据：耗时 / Token / 费用 / 工具数。 */}
      <dl className="exec-metrics">
        {usage && usage.durationMs > 0 && (
          <Metric label="耗时" value={formatDuration(usage.durationMs)} />
        )}
        {usage && <Metric label="Input" value={formatTokens(usage.inputTokens)} />}
        {usage && <Metric label="Output" value={formatTokens(usage.outputTokens)} />}
        {usage && <Metric label="Cost" value={`${formatCost(usage.costTotal)} yuan`} />}
        {step.toolCalls.length > 0 && (
          <Metric label="工具" value={`${toolDone} / ${step.toolCalls.length}`} />
        )}
        {step.task && <Metric label="任务 ID" value={step.task.task_id} />}
        {step.task && step.task.depends_on.length > 0 && (
          <Metric label="依赖" value={step.task.depends_on.join("、")} />
        )}
      </dl>

      {step.task?.expected_output && (
        <DetailBlock label="预期产出" text={step.task.expected_output} />
      )}

      {/* 结构化内容：复用已有卡片的内联形态。 */}
      {step.content}

      {step.result && (
        <DetailBlock
          label="执行结果"
          text={[step.result.summary, step.result.quality_result?.notes]
            .filter((text): text is string => Boolean(text))
            .join("\n")}
        />
      )}

      {step.toolCalls.length > 0 && (
        <ToolCallList toolCalls={step.toolCalls} />
      )}

      {step.subagents && step.subagents.length > 0 && (
        <SubagentList subagents={step.subagents} />
      )}

      {step.thinking && (
        <Disclosure label="执行过程" text={step.thinking} />
      )}
    </div>
  );
}

/**
 * Orchestrator 内部调用的 SubAgent 轨迹。
 *
 * 与执行过程同级：默认收起，展开后才渲染正文与返回结果。
 */
function SubagentList({ subagents }: { subagents: SubagentTrace[] }) {
  return (
    <div className="exec-block">
      <h4>子智能体 · {subagents.length}</h4>
      <ul className="exec-tools">
        {subagents.map((subagent, index) => (
          <li
            key={subagent.id ?? `${subagent.subagentType}-${index}`}
            className="exec-tool"
            data-status={subagent.status === "running" ? "running" : "completed"}
          >
            <div className="exec-tool-row">
              <ToolStatusIcon
                status={subagent.status === "running" ? "running" : "completed"}
              />
              <span className="exec-tool-name">{subagent.subagentType}</span>
              <span className="exec-tool-state">
                {subagent.status === "running" ? "执行中" : "已完成"}
              </span>
            </div>
            {subagent.description && (
              <p className="exec-subagent-desc">{subagent.description}</p>
            )}
            {subagent.thinking && (
              <Disclosure label="子智能体执行过程" text={subagent.thinking} />
            )}
            {Object.prototype.hasOwnProperty.call(subagent, "result") && (
              <Disclosure
                label="返回给 Orchestrator 的结果"
                text={safeStringify(subagent.result)}
              />
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

/** 详情中的一项指标。 */
function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="exec-metric">
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}

/** 详情中的文本块。 */
function DetailBlock({ label, text }: { label: string; text: string }) {
  if (!text.trim()) return null;
  return (
    <div className="exec-block">
      <h4>{label}</h4>
      <p>{text}</p>
    </div>
  );
}

/**
 * 可展开的长文本块；默认收起，展开后自身滚动。
 */
function Disclosure({
  label,
  text,
  defaultOpen = false,
}: {
  label: string;
  text: string;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="exec-block">
      <button
        type="button"
        className="exec-disclosure"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        <CaretRightOutlined
          className="exec-caret"
          data-open={open ? "true" : "false"}
          aria-hidden="true"
        />
        {label}
      </button>
      {open && <pre className="exec-pre scrollbar-none-thin">{text}</pre>}
    </div>
  );
}

/**
 * 工具调用列表。
 *
 * 一级只显示名称与状态；参数与原始结果需要再展开一次。
 */
function ToolCallList({ toolCalls }: { toolCalls: ToolCall[] }) {
  return (
    <div className="exec-block">
      <h4>工具调用 · {toolCalls.length}</h4>
      <ul className="exec-tools">
        {toolCalls.map((toolCall) => (
          <ToolCallRow key={toolCall.id ?? toolCall.name} toolCall={toolCall} />
        ))}
      </ul>
    </div>
  );
}

/** 单条工具调用：状态图标 + 名称，展开后才是参数与结果。 */
function ToolCallRow({ toolCall }: { toolCall: ToolCall }) {
  const [open, setOpen] = useState(false);
  const complete = isToolComplete(toolCall);
  const failed = Boolean(readToolError(toolCall.result));
  const payload = formatToolPayload(toolCall);
  const status: TaskNodeStatus = failed
    ? "failed"
    : complete
      ? "completed"
      : "running";

  return (
    <li className="exec-tool" data-status={status}>
      <div className="exec-tool-row">
        <ToolStatusIcon status={status} />
        <span className="exec-tool-name" title={toolCall.name}>
          {toolCall.name}
        </span>
        <span className="exec-tool-state">{STATUS_LABEL[status]}</span>
        {payload && (
          <button
            type="button"
            className="exec-step-toggle"
            aria-expanded={open}
            onClick={() => setOpen((value) => !value)}
          >
            {open ? "收起" : "详情"}
          </button>
        )}
      </div>
      {open && payload && <pre className="exec-pre scrollbar-none-thin">{payload}</pre>}
    </li>
  );
}

/** 状态圆点：整条容器保持中性，状态只在圆点与图标上表达。 */
function StatusDot({ status }: { status: TaskNodeStatus }) {
  if (status === "completed") {
    return (
      <CheckCircleFilled
        className="exec-status-icon"
        data-status="completed"
        aria-label={STATUS_LABEL.completed}
      />
    );
  }
  if (status === "failed") {
    return (
      <CloseCircleFilled
        className="exec-status-icon"
        data-status="failed"
        aria-label={STATUS_LABEL.failed}
      />
    );
  }
  if (status === "running") {
    return (
      <Spin
        indicator={<LoadingOutlined />}
        size="small"
        className="exec-status-spin"
        aria-label={STATUS_LABEL.running}
      />
    );
  }
  return (
    <span
      className="exec-status-ring"
      data-status="waiting"
      aria-label={STATUS_LABEL.waiting}
    />
  );
}

/** 工具状态图标，与步骤状态保持同一套视觉。 */
function ToolStatusIcon({ status }: { status: TaskNodeStatus }) {
  if (status === "completed") {
    return <CheckCircleFilled className="exec-tool-icon" data-status="completed" />;
  }
  if (status === "failed") {
    return <CloseCircleFilled className="exec-tool-icon" data-status="failed" />;
  }
  return (
    <Spin
      indicator={<LoadingOutlined />}
      size="small"
      className="exec-status-spin"
      aria-label={STATUS_LABEL.running}
    />
  );
}

/** 工具是否已返回结果。 */
function isToolComplete(toolCall: ToolCall): boolean {
  if (toolCall.status === "complete") return true;
  return Object.prototype.hasOwnProperty.call(toolCall, "result");
}

/** 从工具结果里读取错误信息。 */
function readToolError(result: unknown): string | null {
  if (!result || typeof result !== "object") return null;
  const value = (result as { error?: unknown }).error;
  return typeof value === "string" && value ? value : null;
}

/** 工具详情文本：优先展示原始结果，其次参数。 */
function formatToolPayload(toolCall: ToolCall): string {
  const parts: string[] = [];
  if (toolCall.args && Object.keys(toolCall.args).length > 0) {
    parts.push(`参数\n${safeStringify(toolCall.args)}`);
  }
  if (toolCall.result !== undefined) {
    parts.push(`结果\n${safeStringify(toolCall.result)}`);
  }
  return parts.join("\n\n");
}

/** JSON 序列化并限制长度，避免超长 payload 撑破面板。 */
function safeStringify(value: unknown): string {
  try {
    const text =
      typeof value === "string" ? value : JSON.stringify(value, null, 2);
    return text.length > 4000 ? `${text.slice(0, 4000)}\n…（已截断）` : text;
  } catch {
    return String(value);
  }
}

/**
 * 从 Planner 计划与执行结果推导时间线步骤。
 *
 * 有计划时以任务为步骤，状态复用调用方用 workflow-tasks 推导的结果（与「任务
 * 历史」面板同一口径）；没有计划时返回空数组，由调用方决定是否渲染分组。
 */
export function buildExecutionSteps({
  plan,
  results,
  statusByTaskId,
  resolveAgent,
}: {
  plan: TaskExecutionPlan | null;
  results: ExecutorAgentResult[];
  statusByTaskId: Map<string, TaskNodeStatus>;
  /** 读取某 Agent 的工具调用、token 用量、执行过程与 SubAgent 轨迹。 */
  resolveAgent: (agentType: string) => {
    toolCalls: ToolCall[];
    tokenUsage?: TokenUsageInfo;
    thinking?: string;
    subagents?: SubagentTrace[];
  };
}): ExecutionStep[] {
  if (!plan || plan.tasks.length === 0) return [];

  return plan.tasks.map((task) => {
    const agent = resolveAgent(task.assigned_agent);
    const status = statusByTaskId.get(task.task_id) ?? "waiting";
    return {
      id: task.task_id,
      title:
        status === "running" ? `正在执行：${task.title}` : task.title,
      agentLabel: getAgentLabel(task.assigned_agent),
      agentType: task.assigned_agent,
      status,
      durationMs: agent.tokenUsage?.durationMs,
      task,
      result: results.find((item) => item.task_id === task.task_id),
      toolCalls: agent.toolCalls,
      tokenUsage: agent.tokenUsage,
      thinking: agent.thinking,
      subagents: agent.subagents,
    };
  });
}

/** 分组标题右侧的提示文案；无需提示时返回 null。 */
export function buildRunHint(steps: ExecutionStep[]): string | null {
  const failed = steps.filter((step) => step.status === "failed").length;
  return failed === 0 ? null : `${failed} 步需要关注`;
}
