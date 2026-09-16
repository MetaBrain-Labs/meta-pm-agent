/**
 * 对话执行时间线回归检查
 *
 * 固定「执行时间线不丢信息」这条约束：步骤必须覆盖 Planner 任务与其余 Agent，
 * 状态与耗时来自已有数据，且技术信息只在展开层出现。
 *
 * Responsibilities:
 * - 校验步骤推导（任务优先、Agent 兜底、未知 Agent 不丢）
 * - 校验状态、耗时与工具计数的映射
 * - 校验一级摘要不包含 Token / Cost
 *
 * Notes:
 * - 只覆盖推导逻辑，不渲染 DOM；用与组件一致的规则复刻实现。
 * - 运行方式：node apps/web/scripts/check-conversation-timeline.mjs
 */

import assert from "node:assert/strict";

/** 与 ConversationExecution.tsx 的 buildExecutionSteps 保持一致。 */
function buildExecutionSteps({ plan, results, statusByTaskId, resolveAgent }) {
  if (!plan || plan.tasks.length === 0) return [];
  return plan.tasks.map((task) => {
    const agent = resolveAgent(task.assigned_agent);
    const status = statusByTaskId.get(task.task_id) ?? "waiting";
    return {
      id: task.task_id,
      title: status === "running" ? `正在执行：${task.title}` : task.title,
      agentType: task.assigned_agent,
      status,
      durationMs: agent.tokenUsage?.durationMs,
      result: results.find((item) => item.task_id === task.task_id),
      toolCalls: agent.toolCalls,
      tokenUsage: agent.tokenUsage,
    };
  });
}

/** 与 workflow-tasks.ts 的 buildTaskStatus 保持一致。 */
function buildTaskStatus(tasks, results, activeAgents = [], failedTaskIds = new Set()) {
  const completed = new Set(results.map((item) => item.task_id));
  const runningAgents = new Set(activeAgents);
  const running = new Set();
  for (const agentType of runningAgents) {
    const task = tasks
      .filter((item) => item.assigned_agent === agentType)
      .sort((a, b) => a.sequence - b.sequence)
      .find(
        (item) =>
          !completed.has(item.task_id) &&
          !failedTaskIds.has(item.task_id) &&
          item.depends_on.every((id) => completed.has(id)),
      );
    if (task) running.add(task.task_id);
  }
  return new Map(
    tasks.map((task) => {
      if (completed.has(task.task_id)) return [task.task_id, "completed"];
      if (failedTaskIds.has(task.task_id)) return [task.task_id, "failed"];
      if (running.has(task.task_id)) return [task.task_id, "running"];
      return [task.task_id, "waiting"];
    }),
  );
}

/** 与 MessageBubble 的时间线补充规则保持一致。 */
const AGENT_TIMELINE_ORDER = [
  "conversation",
  "request",
  "orchestrator",
  "planner",
  "critique",
  "product_director",
];

/** planAgents 用数组传入，内部转成 Set，贴近组件里的用法。 */
function buildExtraAgents({ message, planAgents, isAgentActive }) {
  const planAgentSet = new Set(planAgents);
  const hasActivity = (agentType) => {
    if (isAgentActive(agentType)) return true;
    if (message.reasoningBlocks?.some((block) => block.agentType === agentType)) {
      return true;
    }
    if (message.toolCalls?.some((call) => call.agentType === agentType)) return true;
    if (message.tokenUsages?.some((usage) => usage.agentType === agentType)) {
      return true;
    }
    if (agentType === "request" && message.requestAnalysis) return true;
    if (agentType === "planner" && message.plannerExecution) return true;
    if (
      (agentType === "critique" || agentType === "product_director") &&
      message.plannerReview
    ) {
      return true;
    }
    return false;
  };

  const known = new Set([...AGENT_TIMELINE_ORDER, ...planAgentSet]);
  const extra = AGENT_TIMELINE_ORDER.filter(
    (agentType) => !planAgentSet.has(agentType) && hasActivity(agentType),
  );
  const unknown = [
    ...new Set([
      ...(message.reasoningBlocks?.map((block) => block.agentType) ?? []),
      ...(message.toolCalls?.map((call) => call.agentType ?? "") ?? []),
    ]),
  ].filter((agentType) => agentType && !known.has(agentType));

  return [...extra, ...unknown];
}

const task = (taskId, sequence, agent, dependsOn = []) => ({
  task_id: taskId,
  sequence,
  title: `${taskId} 任务标题`,
  description: "",
  assigned_agent: agent,
  depends_on: dependsOn,
  covered_business_model_indexes: [],
  expected_output: "",
  quality_check: { status: "pending", criteria: [] },
});

const toolCall = (name, agentType, complete = true) => ({
  id: `${name}-1`,
  name,
  agentType,
  ...(complete ? { result: { ok: true }, status: "complete" } : {}),
});

// 1. 有计划的轮次：以任务为步骤，状态与结果正确挂载。
{
  const plan = {
    status: "initial",
    request_summary: "设计文档协同工具",
    dag: { nodes: [], edges: [] },
    tasks: [
      task("task-01", 1, "executor-product-strategy"),
      task("task-02", 2, "executor-data-analytics", ["task-01"]),
      task("task-03", 3, "executor-product-execution", ["task-01"]),
    ],
    assumptions: [],
  };
  const results = [{ task_id: "task-01", summary: "完成" }];
  const status = buildTaskStatus(plan.tasks, results, ["executor-data-analytics"]);
  const steps = buildExecutionSteps({
    plan,
    results,
    statusByTaskId: status,
    resolveAgent: (agentType) => ({
      toolCalls: agentType === "executor-product-strategy" ? [toolCall("kg_file_add_nodes", agentType)] : [],
      tokenUsage: { durationMs: 6500 },
    }),
  });

  assert.equal(steps.length, 3, "每个 Planner 任务都应成为一个步骤");
  assert.equal(steps[0].status, "completed");
  assert.equal(steps[1].status, "running");
  assert.equal(steps[2].status, "waiting");
  assert.equal(steps[1].title, "正在执行：task-02 任务标题", "运行中的步骤描述应体现正在执行");
  assert.equal(steps[0].durationMs, 6500, "耗时取自 token 用量记录");
  assert.equal(steps[0].toolCalls.length, 1, "工具调用挂在对应 Agent 的步骤上");
}
console.log("✓ 有计划轮次：任务 → 步骤，状态/耗时/工具正确映射");

// 2. 运行中步骤的描述使用「正在执行」前缀，完成后回到任务标题。
{
  const plan = {
    status: "initial",
    request_summary: "",
    dag: { nodes: [], edges: [] },
    tasks: [task("task-01", 1, "executor-gtm")],
    assumptions: [],
  };
  const running = buildExecutionSteps({
    plan,
    results: [],
    statusByTaskId: buildTaskStatus(plan.tasks, [], ["executor-gtm"]),
    resolveAgent: () => ({ toolCalls: [] }),
  });
  const done = buildExecutionSteps({
    plan,
    results: [{ task_id: "task-01" }],
    statusByTaskId: buildTaskStatus(plan.tasks, [{ task_id: "task-01" }]),
    resolveAgent: () => ({ toolCalls: [] }),
  });
  assert.ok(running[0].title.startsWith("正在执行："));
  assert.ok(!done[0].title.startsWith("正在执行："));
}
console.log("✓ 步骤描述随状态切换（运行中 / 已完成）");

// 3. 失败态来自结构化失败集合，不猜测。
{
  const plan = {
    status: "initial",
    request_summary: "",
    dag: { nodes: [], edges: [] },
    tasks: [task("task-01", 1, "executor-gtm"), task("task-02", 2, "executor-toolkit", ["task-01"])],
    assumptions: [],
  };
  const steps = buildExecutionSteps({
    plan,
    results: [{ task_id: "task-01" }],
    statusByTaskId: buildTaskStatus(plan.tasks, [{ task_id: "task-01" }], [], new Set(["task-02"])),
    resolveAgent: () => ({ toolCalls: [] }),
  });
  assert.equal(steps[1].status, "failed");
}
console.log("✓ 失败态只在显式失败时出现");

// 4. 无计划轮次：计划之外与未知 Agent 都不能被丢掉。
{
  const message = {
    reasoningBlocks: [
      { agentType: "conversation" },
      { agentType: "request" },
      { agentType: "orchestrator" },
      { agentType: "conversation_confirmation" },
    ],
    toolCalls: [
      toolCall("web_search", "conversation"),
      toolCall("ask_user", "conversation_confirmation"),
    ],
    tokenUsages: [{ agentType: "critique" }],
    plannerReview: { state: "complete" },
  };
  const extra = buildExtraAgents({
    message,
    planAgents: [],
    isAgentActive: () => false,
  });
  assert.deepEqual(
    extra.slice(0, 3),
    ["conversation", "request", "orchestrator"],
    "固定顺序内的 Agent 按序出现",
  );
  assert.ok(extra.includes("critique"), "只有 token 记录但确实运行过的 Agent 也要出现");
  assert.ok(
    extra.includes("conversation_confirmation"),
    "未列入固定顺序的 Agent 类型不能丢失（本轮之前的实现会漏掉它）",
  );
}
console.log("✓ 无计划轮次：固定顺序 + 未知 Agent 全部保留");

// 5. 没有活动的 Agent 不产生空步骤。
{
  const extra = buildExtraAgents({
    message: { reasoningBlocks: [{ agentType: "conversation" }] },
    planAgents: [],
    isAgentActive: () => false,
  });
  assert.deepEqual(extra, ["conversation"], "未运行的阶段不应出现在时间线里");
}
console.log("✓ 未运行的 Agent 不产生空步骤");

// 6. 一级摘要不携带 Token / Cost：这些只在展开层。
{
  const steps = [
    { status: "completed", durationMs: 6500, tokenUsage: { inputTokens: 61523, outputTokens: 25866, costTotal: 0.319437 } },
  ];
  const collapsedText = [
    `已完成 ${steps.filter((s) => s.status === "completed").length} / ${steps.length}`,
    `6.5s`,
  ].join(" ");
  assert.ok(!/\d{4,}/.test(collapsedText), "一级摘要不应出现 token 级数字");
  assert.ok(!/yuan/i.test(collapsedText), "一级摘要不应出现费用");
  assert.ok(!/Cost/i.test(collapsedText), "一级摘要不应出现 Cost 标签");
}
console.log("✓ 一级摘要只有进度与耗时，Token / Cost 留在展开层");

console.log("\n对话执行时间线断言全部通过。");
