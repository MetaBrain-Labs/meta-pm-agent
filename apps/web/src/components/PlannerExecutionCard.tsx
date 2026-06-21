import { useMemo, type ReactNode } from "react";
import { Collapse, Empty, List, Space, Tag, Typography } from "antd";
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
  TaskExecutionNode,
  TaskExecutionPlan,
} from "../types";

interface Props {
  plan: TaskExecutionPlan;
  executorResults?: ExecutorAgentResult[];
  activeAgent?: string;
}

type NodeStatus = "completed" | "running" | "waiting";

const AGENT_LABELS: Record<string, string> = {
  product_strategy: "Product Strategy Agent",
  user_insight: "User Insight Agent",
  solution_decision: "Solution Decision Agent",
  feature_arch: "Feature Architecture Agent",
  tech_design: "Technical Design Agent",
  data_ops: "Data Operations Agent",
};

/**
 * 展示 Planner Agent 生成的执行 DAG，以及每个节点的实时运行状态。
 */
export function PlannerExecutionCard({
  plan,
  executorResults = [],
  activeAgent,
}: Props) {
  const statusByTaskId = useMemo(
    () => buildTaskStatus(plan.tasks, executorResults, activeAgent),
    [activeAgent, executorResults, plan.tasks],
  );
  const completedCount = plan.tasks.filter(
    (task) => statusByTaskId.get(task.task_id) === "completed",
  ).length;

  return (
    <Collapse
      defaultActiveKey={["1"]}
      expandIcon={({ isActive }) => <RightOutlined rotate={isActive ? 90 : 0} />}
      items={[
        {
          key: "1",
          label: (
            <div className="flex min-w-0 flex-wrap items-center gap-2">
              <PartitionOutlined style={{ color: "var(--primary)" }} />
              <span className="text-[14px] font-extrabold text-[var(--ink)]">
                Planner Agent DAG
              </span>
              <Tag color="blue">
                {completedCount}/{plan.tasks.length} 已完成
              </Tag>
            </div>
          ),
          children: (
            <div className="space-y-4">
              <Typography.Paragraph className="m-0! text-[13px] text-[var(--ink-soft)]">
                {plan.request_summary}
              </Typography.Paragraph>

              <div className="flex flex-wrap items-center gap-2">
                {plan.tasks.map((task, index) => (
                  <div
                    key={task.task_id}
                    className="flex items-center gap-2"
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

              <div>
                <div className="mb-2 flex items-center gap-2 text-[13px] font-bold text-[var(--ink)]">
                  <NodeIndexOutlined />
                  边
                </div>
                {plan.dag.edges.length === 0 ? (
                  <Empty
                    image={Empty.PRESENTED_IMAGE_SIMPLE}
                    description="暂无边"
                  />
                ) : (
                  <Space size={6} wrap>
                    {plan.dag.edges.map((edge) => (
                      <Tag key={`${edge.source}-${edge.target}`}>
                        {getAgentLabel(edge.source)} → {getAgentLabel(edge.target)}
                      </Tag>
                    ))}
                  </Space>
                )}
              </div>
            </div>
          ),
        },
      ]}
    />
  );
}

/**
 * 展示 Planner Agent DAG 结构生成期间的占位卡片。
 */
export function PlannerExecutionLoadingCard() {
  return (
    <div className="mb-2 flex items-center gap-3 rounded-lg border border-[var(--line-soft)] bg-white p-5">
      <div
        className="h-5 w-5 rounded-full border-2"
        style={{
          borderColor: "var(--primary)",
          animation: "qf-pulse 1.4s ease-out infinite",
        }}
      />
      <div className="min-w-0">
        <div className="flex items-center gap-2 text-[13px] font-extrabold text-[var(--ink)]">
          <PartitionOutlined style={{ color: "var(--primary)" }} />
          <span>Planner Agent DAG</span>
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
      className="inline-flex max-w-[220px] items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-[12px] font-bold"
      style={{
        borderColor: config.border,
        background: config.background,
        color: config.color,
      }}
      title={task.title}
    >
      {config.icon}
      <span className="truncate">{task.sequence}. {getAgentLabel(task.assigned_agent)}</span>
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
    <List.Item className="px-0!">
      <div className="min-w-0 flex-1">
        <div className="mb-2 flex flex-wrap items-center gap-2">
          <Tag>{task.task_id}</Tag>
          <Tag color={config.tagColor}>{config.label}</Tag>
          <Tag>{getAgentLabel(task.assigned_agent)}</Tag>
          {task.depends_on.length > 0 && (
            <Tag>依赖：{task.depends_on.join(", ")}</Tag>
          )}
        </div>
        <Typography.Text className="block text-[14px] font-bold text-[var(--ink)]">
          {task.title}
        </Typography.Text>
        <Typography.Paragraph className="mb-2! text-[13px] text-[var(--ink-soft)]">
          {task.description}
        </Typography.Paragraph>
        <Typography.Text className="block text-[12px] text-[var(--ink-faint)]">
          预期产出：{task.expected_output}
        </Typography.Text>
        {result && (
          <Typography.Text className="mt-1 block text-[12px] text-[var(--success)]">
            运行结果：{result.summary}
          </Typography.Text>
        )}
      </div>
    </List.Item>
  );
}

/**
 * 根据已完成结果和当前 Agent 推断 DAG 节点状态。
 */
function buildTaskStatus(
  tasks: TaskExecutionNode[],
  results: ExecutorAgentResult[],
  activeAgent?: string,
): Map<string, NodeStatus> {
  const completedTaskIds = new Set(results.map((item) => item.task_id));
  return new Map(
    tasks.map((task) => {
      if (completedTaskIds.has(task.task_id)) {
        return [task.task_id, "completed" as const];
      }
      if (activeAgent === task.assigned_agent) {
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
 * 将 Agent 类型转换为中文展示名。
 */
function getAgentLabel(agentType: ProductWorkflowAgentType): string {
  return AGENT_LABELS[agentType] ?? agentType;
}
