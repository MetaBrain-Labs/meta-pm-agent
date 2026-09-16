/**
 * 任务历史推导回归检查
 *
 * 固定「任务历史只使用已有数据推导」这条约束：轮次切分、状态推导、DAG 分层与
 * 图谱更新口径都必须能从现有字段算出来，不依赖任何新增字段。
 *
 * Responsibilities:
 * - 校验任务状态与 DAG 分层的推导结果
 * - 校验图谱更新统计口径（只在一个结果出现 = 新增，多次出现 = 更新）
 * - 校验异常数据（缺依赖、成环、空计划）不会丢任务或死循环
 *
 * Notes:
 * - 只覆盖纯计算逻辑，不渲染 DOM、不访问网络。
 * - 运行方式：node apps/web/scripts/check-task-history.mjs
 */

import assert from "node:assert/strict";

/** 与 workflow-tasks.ts 的 buildTaskStatus 保持一致。 */
function buildTaskStatus(tasks, results, activeAgents = [], failedTaskIds = new Set()) {
  const completedTaskIds = new Set(results.map((item) => item.task_id));
  const runningAgents = new Set(activeAgents);
  const runningTaskIds = new Set();

  for (const agentType of runningAgents) {
    const runningTask = tasks
      .filter((task) => task.assigned_agent === agentType)
      .sort((left, right) => left.sequence - right.sequence)
      .find(
        (task) =>
          !completedTaskIds.has(task.task_id) &&
          !failedTaskIds.has(task.task_id) &&
          task.depends_on.every((taskId) => completedTaskIds.has(taskId)),
      );
    if (runningTask) runningTaskIds.add(runningTask.task_id);
  }

  return new Map(
    tasks.map((task) => {
      if (completedTaskIds.has(task.task_id)) return [task.task_id, "completed"];
      if (failedTaskIds.has(task.task_id)) return [task.task_id, "failed"];
      if (runningTaskIds.has(task.task_id)) return [task.task_id, "running"];
      return [task.task_id, "waiting"];
    }),
  );
}

/** 与 workflow-tasks.ts 的 buildTaskLayers 保持一致。 */
function buildTaskLayers(tasks) {
  const taskById = new Map(tasks.map((task) => [task.task_id, task]));
  const depthCache = new Map();

  const resolveDepth = (taskId, seen) => {
    const cached = depthCache.get(taskId);
    if (cached !== undefined) return cached;
    if (seen.has(taskId)) return 0;
    const task = taskById.get(taskId);
    if (!task) return 0;
    const nextSeen = new Set(seen).add(taskId);
    const depth = task.depends_on
      .filter((dependency) => taskById.has(dependency))
      .reduce((max, dependency) => Math.max(max, resolveDepth(dependency, nextSeen) + 1), 0);
    depthCache.set(taskId, depth);
    return depth;
  };

  const layers = new Map();
  for (const task of tasks) {
    const depth = resolveDepth(task.task_id, new Set());
    const bucket = layers.get(depth);
    if (bucket) bucket.push(task);
    else layers.set(depth, [task]);
  }
  return [...layers.entries()]
    .sort(([left], [right]) => left - right)
    .map(([, layerTasks]) => [...layerTasks].sort((left, right) => left.sequence - right.sequence));
}

/** 与 workflow-tasks.ts 的 summarizeGraphUpdate 保持一致。 */
function summarizeGraphUpdate(results) {
  const collect = (key) => {
    const seen = new Map();
    for (const result of results) {
      for (const [index, record] of (result[key] ?? []).entries()) {
        const id =
          typeof record.id === "string" && record.id
            ? record.id
            : [record.name, record.source, record.target, record.type]
                .filter(Boolean)
                .join("|") || `${key}-${index}`;
        const existing = seen.get(id);
        if (existing) existing.count += 1;
        else seen.set(id, { record, count: 1 });
      }
    }
    const isNew = [];
    const isUpdated = [];
    for (const entry of seen.values()) {
      if (entry.count > 1) isUpdated.push(entry.record);
      else isNew.push(entry.record);
    }
    return { isNew, isUpdated };
  };
  const entities = collect("entities");
  const relations = collect("relations");
  return {
    newEntities: entities.isNew,
    updatedEntities: entities.isUpdated,
    newRelations: relations.isNew,
    updatedRelations: relations.isUpdated,
  };
}

const task = (taskId, sequence, agent, dependsOn = []) => ({
  task_id: taskId,
  sequence,
  title: `${taskId} 标题`,
  description: "",
  assigned_agent: agent,
  depends_on: dependsOn,
  covered_business_model_indexes: [],
  expected_output: "",
  quality_check: { status: "pending", criteria: [] },
});

// 1. 线性计划的层级与状态。
const linear = [task("T-01", 1, "executor-gtm"), task("T-02", 2, "executor-toolkit", ["T-01"]), task("T-03", 3, "executor-data-analytics", ["T-02"])];
const linearLayers = buildTaskLayers(linear);
assert.equal(linearLayers.length, 3, "线性计划应得到 3 层");
assert.deepEqual(linearLayers.map((layer) => layer.map((item) => item.task_id)), [["T-01"], ["T-02"], ["T-03"]]);
console.log("✓ 线性计划 → T-01 → T-02 → T-03 三层");

// 2. 分支计划：T-03 与 T-04 依赖同一个 T-01，应落在同一层并可并行。
const branched = [
  task("T-01", 1, "executor-gtm"),
  task("T-02", 2, "executor-toolkit", ["T-01"]),
  task("T-03", 3, "executor-data-analytics", ["T-01"]),
  task("T-04", 4, "executor-ai-shipping", ["T-02"]),
];
const branchedLayers = buildTaskLayers(branched);
assert.deepEqual(
  branchedLayers.map((layer) => layer.map((item) => item.task_id)),
  [["T-01"], ["T-02", "T-03"], ["T-04"]],
  "分支计划应正确分层",
);
console.log("✓ 分支计划 → T-01 →(T-02‖T-03)→ T-04");

// 3. 状态推导：已完成 / 运行中 / 等待。
const statuses = buildTaskStatus(branched, [{ task_id: "T-01" }], ["executor-data-analytics"]);
assert.equal(statuses.get("T-01"), "completed");
assert.equal(statuses.get("T-03"), "running", "依赖已满足的任务应标记为运行中");
assert.equal(statuses.get("T-02"), "waiting");
assert.equal(statuses.get("T-04"), "waiting");
console.log("✓ 状态推导 → 已完成 / 运行中 / 等待");

// 4. 依赖未满足的 Agent 不应被标记为运行中。
const blocked = buildTaskStatus(branched, [], ["executor-ai-shipping"]);
assert.equal(blocked.get("T-04"), "waiting", "依赖未满足时不应显示运行中");
console.log("✓ 依赖未满足 → 不误报运行中");

// 5. 失败态只在显式给出时出现。
const withFailure = buildTaskStatus(linear, [{ task_id: "T-01" }], [], new Set(["T-02"]));
assert.equal(withFailure.get("T-02"), "failed");
assert.equal(withFailure.get("T-03"), "waiting");
console.log("✓ 失败态来自结构化错误，不猜测");

// 6. 异常数据不得丢任务或死循环。
const cyclic = buildTaskLayers([task("A", 1, "x", ["B"]), task("B", 2, "x", ["A"])]);
const cyclicIds = cyclic.flat().map((item) => item.task_id).sort();
assert.deepEqual(cyclicIds, ["A", "B"], "成环时仍要展示全部任务");
const missingDep = buildTaskLayers([task("A", 1, "x", ["不存在"])]);
assert.equal(missingDep.flat().length, 1, "依赖缺失时任务不能丢");
assert.deepEqual(buildTaskLayers([]), [], "空计划应得到空分层");
console.log("✓ 成环 / 依赖缺失 / 空计划都不会丢任务或死循环");

// 7. 图谱更新口径：只出现一次 = 新增，出现多次 = 更新。
const summary = summarizeGraphUpdate([
  { entities: [{ id: "e1", name: "目标" }, { id: "e2", name: "需求" }], relations: [{ id: "r1", source: "e1", target: "e2" }] },
  { entities: [{ id: "e2", name: "需求" }, { id: "e3", name: "证据" }], relations: [{ id: "r1", source: "e1", target: "e2" }] },
]);
assert.deepEqual(summary.newEntities.map((item) => item.id), ["e1", "e3"]);
assert.deepEqual(summary.updatedEntities.map((item) => item.id), ["e2"]);
assert.deepEqual(summary.newRelations.map((item) => item.id), []);
assert.deepEqual(summary.updatedRelations.map((item) => item.id), ["r1"]);
console.log("✓ 图谱更新口径 → 单次出现计新增，多次出现计更新");

// 8. 缺少 id 的记录用 name/source/target 兜底，仍然稳定去重。
const fallback = summarizeGraphUpdate([
  { entities: [{ name: "同名" }], relations: [] },
  { entities: [{ name: "同名" }], relations: [{ source: "a", target: "b" }] },
]);
assert.equal(fallback.updatedEntities.length, 1, "缺少 id 时同一条目应被识别为更新");
assert.equal(fallback.newRelations.length, 1);
assert.deepEqual(summarizeGraphUpdate([]), {
  newEntities: [],
  updatedEntities: [],
  newRelations: [],
  updatedRelations: [],
});
console.log("✓ 缺少 id 的记录仍能稳定去重；空结果返回空统计");

// 9. 端到端：从"历史恢复后的消息"构建轮次。
// 复刻 persisted-message.ts 的关键映射，验证面板能从真实形态的消息里找到轮次。
{
  const plan = {
    status: "supplement",
    request_summary: "打造一个面向企业内部团队与开发者技术团队的文档协同工具",
    dag: { nodes: ["supplement-task-01"], edges: [] },
    tasks: [
      task("supplement-task-01", 1, "executor-gtm"),
      task("supplement-task-02", 2, "executor-toolkit", ["supplement-task-01"]),
    ],
    assumptions: ["假设团队规模在 10-100 人"],
  };
  const productWorkflow = {
    status: "completed",
    confirmation_id: "c1",
    request_summary: plan.request_summary,
    planner: plan,
    executor_results: [
      {
        task_id: "supplement-task-01",
        agent_type: "executor-gtm",
        focus_layer: "gtm",
        summary: "已完成",
        entities: [{ id: "e1", name: "目标" }],
        relations: [],
        decisions: [],
        risks: [],
        open_questions: [],
        quality_result: { passed: true, notes: "" },
      },
    ],
    review: { accepted_task_ids: [], rejected_task_ids: [], notes: "" },
    product_context_update: "",
    knowledge_graph_update: { entities: [], relations: [], notes: [] },
  };

  // 这是 mapPersistedMessageToMessage 对上述持久化记录的产物。
  const restoredAgentMessage = {
    id: "msg-1",
    role: "agent",
    workflowRoundId: "round-1",
    content: "",
    timestamp: Date.parse("2026-09-17T01:04:16Z"),
    requestAnalysis: { state: "complete", content: "{}", analysis: { business_model: [], questions: [], chitchat: [] } },
    plannerExecution: { state: "complete", content: "{}", plan },
    executorResults: productWorkflow.executor_results,
    plannerReview: { state: "complete", result: productWorkflow },
    workflowCompletion: { state: "complete", content: "本轮产品工作流已正式结束" },
  };
  const restoredUserMessage = {
    id: "msg-0",
    role: "user",
    content: "我想要做一个文档协同工具",
    timestamp: Date.parse("2026-09-17T01:00:00Z"),
  };

  // 与 task-history.ts 的 carriesWorkflow 保持一致。
  const carriesWorkflow = (message) =>
    Boolean(
      message.plannerExecution ||
        message.requestAnalysis ||
        message.executorResults?.length ||
        message.plannerReview ||
        message.workflowCompletion ||
        message.userInput,
    );

  const workflowMessages = [restoredUserMessage, restoredAgentMessage].filter(
    (message) => message.role === "agent" && carriesWorkflow(message),
  );
  assert.equal(workflowMessages.length, 1, "恢复后的助手消息必须被识别为工作流轮次");
  // 面板列表与详情都用得到的关键字段。
  assert.equal(workflowMessages[0].workflowRoundId, "round-1", "轮次 ID 应取 workflowRoundId");
  assert.equal(workflowMessages[0].plannerExecution.plan.tasks.length, 2);
  assert.equal(workflowMessages[0].executorResults.length, 1);
  assert.ok(workflowMessages[0].plannerReview.result, "Critique 结果应可用于轮次详情");
  assert.ok(workflowMessages[0].workflowCompletion, "完成卡片应让轮次状态成为已完成");
}
console.log("✓ 历史恢复后的消息能被识别为任务轮次（含轮次 ID、计划、结果与完成态）");

// 10. 分组：一次请求的多阶段消息必须归为一轮。
// 复刻 task-history.ts 的分组与合并规则。
{
  const carriesWorkflow = (message) =>
    Boolean(
      message.plannerExecution ||
        message.requestAnalysis ||
        message.executorResults?.length ||
        message.plannerReview ||
        message.workflowCompletion ||
        message.userInput,
    );

  function groupWorkflowMessages(messages) {
    const groups = new Map();
    let lastUserId = null;
    let lastUserRequest = "";
    for (const message of messages) {
      if (message.role === "user") {
        lastUserId = message.id;
        lastUserRequest = message.content.trim();
        continue;
      }
      if (!carriesWorkflow(message)) continue;
      const key = message.workflowRoundId ?? lastUserId ?? message.id;
      const existing = groups.get(key);
      if (existing) {
        existing.messages.push(message);
        continue;
      }
      groups.set(key, { key, messages: [message], userRequest: lastUserRequest });
    }
    return [...groups.values()];
  }

  function mergeRoundMessages(messages) {
    const base = messages[0];
    return messages.reduce((acc, message) => {
      const results =
        (message.executorResults?.length ?? 0) >= (acc.executorResults?.length ?? 0)
          ? message.executorResults ?? acc.executorResults
          : acc.executorResults;
      return {
        ...acc,
        timestamp: Math.min(acc.timestamp, message.timestamp),
        requestAnalysis: message.requestAnalysis ?? acc.requestAnalysis,
        plannerExecution: message.plannerExecution ?? acc.plannerExecution,
        plannerReview: message.plannerReview ?? acc.plannerReview,
        workflowCompletion: message.workflowCompletion ?? acc.workflowCompletion,
        executorResults: results,
      };
    }, base);
  }

  const plan = {
    status: "initial",
    request_summary: "为多地20人团队设计Web文档协同工具",
    dag: { nodes: [], edges: [] },
    tasks: [task("task-01", 1, "executor-product-strategy")],
    assumptions: [],
  };

  // 后端形态：一次请求落成多条助手消息，共享 workflowRoundId。
  const sameRound = "round-A";
  const messages = [
    { id: "u1", role: "user", content: "为多地20人团队设计Web文档协同工具", timestamp: 1000 },
    { id: "a1", role: "agent", workflowRoundId: sameRound, content: "", timestamp: 1001, requestAnalysis: { state: "complete", analysis: { business_model: [], questions: [], chitchat: [] } } },
    { id: "a2", role: "agent", workflowRoundId: sameRound, content: "", timestamp: 1002, plannerExecution: { state: "complete", plan } },
    { id: "a3", role: "agent", workflowRoundId: sameRound, content: "", timestamp: 1003, executorResults: [{ task_id: "task-01" }] },
    { id: "a4", role: "agent", workflowRoundId: sameRound, content: "", timestamp: 1004, plannerReview: { state: "complete", result: { status: "completed" } } },
    { id: "a5", role: "agent", workflowRoundId: sameRound, content: "", timestamp: 1005, workflowCompletion: { state: "complete", content: "本轮产品工作流已正式结束" } },
  ];

  const groups = groupWorkflowMessages(messages);
  assert.equal(groups.length, 1, "同一次请求的 5 条阶段消息必须归为 1 轮，而不是 5 轮");
  assert.equal(groups[0].userRequest, "为多地20人团队设计Web文档协同工具");

  const merged = mergeRoundMessages(groups[0].messages);
  assert.ok(merged.plannerExecution?.plan, "合并后必须保留 Planner 计划");
  assert.equal(merged.executorResults.length, 1, "合并后必须保留 Executor 结果");
  assert.ok(merged.plannerReview, "合并后必须保留 Critique");
  assert.ok(merged.workflowCompletion, "合并后必须保留完成态");
  assert.equal(merged.timestamp, 1001, "轮次时间取这一轮最早的消息");

  // 没有 workflowRoundId 时，按最近的用户消息归组。
  const withoutRoundId = messages.map(({ workflowRoundId, ...rest }) => rest);
  assert.equal(
    groupWorkflowMessages(withoutRoundId).length,
    1,
    "缺少 workflowRoundId 时也必须按用户消息归为 1 轮",
  );

  // 两轮请求不应互相合并。
  const twoRounds = [
    { id: "u1", role: "user", content: "第一轮", timestamp: 1000 },
    messages[2],
    { id: "u2", role: "user", content: "第二轮", timestamp: 2000 },
    { id: "b1", role: "agent", workflowRoundId: "round-B", content: "", timestamp: 2001, plannerExecution: { state: "complete", plan: { ...plan, status: "supplement" } } },
  ];
  const two = groupWorkflowMessages(twoRounds);
  assert.equal(two.length, 2, "两次请求必须是两轮");
  assert.equal(two[0].userRequest, "第一轮");
  assert.equal(two[1].userRequest, "第二轮");

  // 纯对话回复不属于任务轮次。
  const chatOnly = [
    { id: "u1", role: "user", content: "你好", timestamp: 1000 },
    { id: "a1", role: "agent", content: "你好，我可以帮你规划产品", timestamp: 1001 },
  ];
  assert.equal(groupWorkflowMessages(chatOnly).length, 0, "普通对话不应产生空任务轮次");
}
console.log("✓ 分组：一次请求的多阶段消息归为一轮，多轮与纯对话正确区分");

console.log("\n任务历史推导断言全部通过。");
