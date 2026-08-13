/**
 * 产品知识图谱并行合并测试
 *
 * 验证多个 Executor 基于同一图谱快照并行写入时，重复 ID 不会被后到分支覆盖。
 * 相似内容应去重保留一个，非相似内容应生成递增 ID 并同步重写关系端点。
 *
 * Responsibilities:
 * - 覆盖 LangGraph knowledgeGraph reducer 的重复 ID 合并策略
 * - 覆盖 Critique 确定性校验对重编号提交结果的识别
 * - 防止 DUPLICATE_ENTITY_ID / DUPLICATE_RELATION_ID / SOURCE_CONFLICT 回归
 */

import assert from "node:assert/strict";
import test from "node:test";
import type {
  CritiqueAgentOutput,
  ExecutorAgentResult,
  ProductKnowledgeGraph,
  RequestAnalysis,
  TaskExecutionNode,
  TaskExecutionPlan,
} from "@repo/shared";
import {
  CritiqueAgentModelOutputSchema,
  compactTaskSemanticUpdates,
  composeProductWorkflowResult,
  createCritiqueValidationReport,
} from "../src/agents/product-workflow/critique-agent/agent";
import {
  getExecutorOutputValidationError,
  hasStructuredGraphItems,
} from "../src/agents/product-workflow/executor-agent/agent";
import { mergeKnowledgeGraphSnapshots } from "../src/graph/state";

test("retries only when an executor wrote no structured graph items", () => {
  const emptyGraph = createGraph({});
  emptyGraph.summary.push("Summary alone is not a graph patch.");

  assert.equal(hasStructuredGraphItems(emptyGraph), false);
  emptyGraph.entities.push(createGoal("G-001"));
  assert.equal(hasStructuredGraphItems(emptyGraph), true);
});

test("rejects a final executor attempt with no structured writes", () => {
  assert.equal(
    getExecutorOutputValidationError({
      hasStructuredItems: false,
      blockingQuestionCount: 0,
      requiredBlockingCount: 0,
    }),
    "no structured graph items were committed",
  );
  assert.equal(
    getExecutorOutputValidationError({
      hasStructuredItems: true,
      blockingQuestionCount: 0,
      requiredBlockingCount: 0,
    }),
    null,
  );
});

test("keeps compact semantic updates reviewable without copying the full graph", () => {
  const goal = createGoal("G-001");
  const entity = createRequirement(
    "R-001",
    "task-01",
    "Concurrent editing",
    "The product supports concurrent editing.",
  );
  const result = createExecutorResult({
    taskId: "task-01",
    agentType: "executor-product-strategy",
    entity,
    relation: createRelation(
      "REL-001",
      "G-001",
      entity.id,
      "task-01",
      "The goal references the requirement.",
    ),
  });

  const updates = compactTaskSemanticUpdates(
    [result],
    createGraph({ entities: [goal, entity], relations: result.relations }),
  );

  assert.equal(updates[0]?.entities[0]?.description, entity.description);
  assert.equal(updates[0]?.relations[0]?.target, entity.id);
  assert.equal(
    updates[0]?.relations[0]?.source_context?.description,
    goal.description,
  );
  assert.equal(
    updates[0]?.relations[0]?.target_context?.description,
    entity.description,
  );
  assert.equal(updates[0]?.web_search_enabled, false);
});

test("critique validation rejects executor boundary violations", () => {
  const feature: ProductKnowledgeGraph["entities"][number] = {
    id: "F-001",
    type: "Feature",
    name: "Shared editing",
    description: "Allow users to edit one document together.",
    provenance: createUserInputProvenance(),
    source_task_id: "task-00",
    status: "proposed",
  };
  const component: ProductKnowledgeGraph["entities"][number] = {
    id: "C-001",
    type: "Component",
    name: "Collaboration gateway",
    description: "Coordinates shared editing sessions.",
    provenance: createUserInputProvenance(),
    source_task_id: "task-01",
    status: "proposed",
  };
  const requirement = createRequirement(
    "R-001",
    "task-01",
    "Concurrent editing requirement",
    "The product supports multiple active editors.",
  );
  const relations: ProductKnowledgeGraph["relations"] = [
    {
      id: "REL-001",
      type: "Implements",
      source: component.id,
      target: feature.id,
      source_task_id: "task-01",
    },
    createRelation(
      "REL-002",
      requirement.id,
      feature.id,
      "task-01",
      "The requirement references the collaboration feature.",
    ),
  ];
  const task = createTask("task-01", 1, "executor-toolkit");
  const result: ExecutorAgentResult = {
    task_id: task.task_id,
    agent_type: "executor-toolkit",
    focus_layer: "Component",
    summary: "Created collaboration constraints.",
    entities: [component, requirement],
    relations,
    decisions: [],
    risks: [],
    open_questions: [],
    quality_result: { passed: true, notes: "ok" },
  };
  const report = createCritiqueValidationReport({
    workspaceId: "workspace-test",
    productContext: "",
    requestAnalysis: createRequestAnalysis(),
    plan: {
      status: "initial",
      request_summary: "Review executor boundaries.",
      dag: { nodes: [task.task_id], edges: [] },
      tasks: [task],
      assumptions: [],
    },
    executorResults: [result],
    knowledgeGraph: createGraph({
      entities: [feature, component, requirement],
      relations,
    }),
  });

  assert.deepEqual(report.rejected_task_ids, ["task-01"]);
  assert.deepEqual(
    report.issues.map((issue) => issue.code),
    ["UNAUTHORIZED_ENTITY_TYPE", "UNAUTHORIZED_RELATION_TYPE"],
  );
});

test("document evidence review permits only deprecated Risk audit nodes", () => {
  const task = createTask("task-risk", 1, "executor-product-strategy");
  const risk: ProductKnowledgeGraph["entities"][number] = {
    id: "RISK-1",
    type: "Risk",
    name: "Certification is not confirmed",
    description: "The user has now confirmed the certification.",
    source_task_id: "task-old",
    status: "deprecated",
    deprecated_by_task_id: task.task_id,
    deprecation_reason: "The submitted evidence form resolved this risk.",
  };
  const result: ExecutorAgentResult = {
    task_id: task.task_id,
    agent_type: task.assigned_agent,
    focus_layer: "Decision",
    summary: "Closed the answered certification risk.",
    entities: [risk],
    relations: [],
    decisions: [],
    risks: [],
    open_questions: [],
    quality_result: { passed: true, notes: "ok" },
  };
  const report = createCritiqueValidationReport({
    requestAnalysis: createRequestAnalysis(),
    plan: {
      status: "supplement",
      request_summary: "Close answered evidence risks.",
      dag: { nodes: [task.task_id], edges: [] },
      tasks: [task],
      assumptions: [],
    },
    executorResults: [result],
    knowledgeGraph: createGraph({ entities: [risk] }),
    documentEvidenceResolution: true,
  });

  assert.equal(
    report.issues.some((issue) => issue.code === "UNAUTHORIZED_ENTITY_TYPE"),
    false,
  );
});

test("critique validation rejects a task that omits its required blocking question", () => {
  const task = {
    ...createTask("task-01", 1, "executor-product-discovery"),
    required_open_question_count: 1,
  };
  const requirement = createRequirement(
    "R-001",
    "seed-task",
    "Concurrent editing",
    "The product supports concurrent editing.",
  );
  const feature: ProductKnowledgeGraph["entities"][number] = {
    id: "F-001",
    type: "Feature",
    name: "Shared editing",
    description: "Allow users to edit one document together.",
    provenance: createUserInputProvenance(),
    source_task_id: task.task_id,
    status: "proposed",
  };
  const relation: ProductKnowledgeGraph["relations"][number] = {
    id: "REL-001",
    type: "Satisfies",
    source: feature.id,
    target: requirement.id,
    source_task_id: task.task_id,
  };
  const result: ExecutorAgentResult = {
    task_id: task.task_id,
    agent_type: task.assigned_agent,
    focus_layer: "Feature",
    summary: "Created the collaboration feature.",
    entities: [feature],
    relations: [relation],
    decisions: [],
    risks: [],
    open_questions: [],
    quality_result: { passed: true, notes: "ok" },
  };
  const graph = createGraph({
    entities: [requirement, feature],
    relations: [relation],
  });

  const missing = createCritiqueValidationReport({
    requestAnalysis: createRequestAnalysis(),
    plan: {
      status: "initial",
      request_summary: "Review blocking question persistence.",
      dag: { nodes: [task.task_id], edges: [] },
      tasks: [task],
      assumptions: [],
    },
    executorResults: [result],
    knowledgeGraph: graph,
  });
  const present = createCritiqueValidationReport({
    requestAnalysis: createRequestAnalysis(),
    plan: {
      status: "initial",
      request_summary: "Review blocking question persistence.",
      dag: { nodes: [task.task_id], edges: [] },
      tasks: [task],
      assumptions: [],
    },
    executorResults: [
      {
        ...result,
        open_questions: [
          { id: "OQ-runtime-allocated", text: "Expected concurrency?", blocking: true },
        ],
      },
    ],
    knowledgeGraph: {
      ...graph,
      open_questions: [
        { id: "OQ-runtime-allocated", text: "Expected concurrency?", blocking: true },
      ],
    },
  });

  assert.deepEqual(missing.rejected_task_ids, [task.task_id]);
  assert.equal(
    missing.issues.some(
      (issue) => issue.code === "MISSING_REQUIRED_BLOCKING_QUESTIONS",
    ),
    true,
  );
  assert.deepEqual(present.rejected_task_ids, []);
});

test("critique composition keeps runtime validation and graph counts authoritative", () => {
  const task = createTask("task-01", 1, "executor-product-strategy");
  const goal = createGoal("G-001");
  const requirement = createRequirement(
    "R-001",
    task.task_id,
    "Confirmed requirement",
    "The user confirmed this product requirement.",
  );
  const relation = createRelation(
    "REL-001",
    requirement.id,
    goal.id,
    task.task_id,
    "The requirement references the product goal.",
  );
  const executorResult: ExecutorAgentResult = {
    task_id: task.task_id,
    agent_type: task.assigned_agent,
    focus_layer: "Requirement",
    summary: "Created a confirmed requirement.",
    entities: [requirement],
    relations: [relation],
    decisions: [],
    risks: [],
    open_questions: [],
    quality_result: { passed: true, notes: "ok" },
  };
  const graph = createGraph({
    entities: [goal, requirement],
    relations: [relation],
  });
  const plan = {
    status: "supplement" as const,
    request_summary: "Confirm the requirement.",
    dag: { nodes: [task.task_id], edges: [] },
    tasks: [task],
    assumptions: [],
  };
  const modelReview: CritiqueAgentOutput = {
    status: "completed",
    confirmation_id: "review-1",
    request_summary: "Confirm the requirement.",
    review: {
      accepted_task_ids: ["invented-task"],
      rejected_task_ids: [],
      retry_task_ids: [],
      issues: [],
      notes: "ok",
    },
    product_context_update: "Requirement confirmed.",
    knowledge_graph_review: {
      graph_ref: { entity_count: 999, relation_count: 999 },
      accepted_task_ids: ["invented-task"],
      rejected_task_ids: [],
      retry_task_ids: [],
      issues: [],
      notes: ["ok"],
    },
    proposal_questions: [],
    confirmation_message: "Complete.",
  };

  const result = composeProductWorkflowResult(
    {
      requestAnalysis: createRequestAnalysis(),
      plan,
      executorResults: [executorResult],
      knowledgeGraph: graph,
    },
    modelReview,
  );
  const parsedModelReview = CritiqueAgentModelOutputSchema.parse(modelReview);

  assert.equal(
    "graph_ref" in parsedModelReview.knowledge_graph_review,
    false,
  );
  assert.deepEqual(result.review.accepted_task_ids, [task.task_id]);
  assert.deepEqual(result.knowledge_graph_review?.graph_ref, {
    entity_count: 2,
    relation_count: 1,
  });
  assert.equal(result.confirmation_message, "本轮任务已完成：Requirement confirmed.");
});

test("carries prior critique issues until explicitly resolved or downgraded to a real risk", () => {
  const task = createTask("task-03", 3, "executor-product-strategy");
  const goal = createGoal("G-003");
  const requirement = createRequirement(
    "R-003",
    task.task_id,
    "Supplement requirement",
    "The supplement adds a traceable product requirement.",
  );
  const relation = createRelation(
    "REL-003",
    requirement.id,
    goal.id,
    task.task_id,
    "The supplement requirement references the product goal.",
  );
  const executorResult = createExecutorResult({
    taskId: task.task_id,
    agentType: task.assigned_agent,
    entity: requirement,
    relation,
  });
  const graph = createGraph({
    entities: [goal, requirement],
    relations: [relation],
  });
  const priorIssue = {
    code: "WEAK_EVIDENCE",
    severity: "warning" as const,
    task_id: "task-02",
    message: "Industry claims still lack trustworthy source evidence.",
  };
  const input = {
    requestAnalysis: createRequestAnalysis(),
    plan: {
      status: "supplement" as const,
      request_summary: "Add the supplement requirement.",
      dag: { nodes: [task.task_id], edges: [] },
      tasks: [task],
      assumptions: [],
    },
    executorResults: [executorResult],
    knowledgeGraph: graph,
    priorIssues: [priorIssue],
  };
  const review: CritiqueAgentOutput = {
    status: "completed",
    confirmation_id: "review-prior-issue",
    request_summary: "Review the supplement.",
    review: {
      accepted_task_ids: [task.task_id],
      rejected_task_ids: [],
      retry_task_ids: [],
      issues: [],
      notes: "The supplement task passed.",
    },
    product_context_update: "Supplement reviewed.",
    knowledge_graph_review: {
      accepted_task_ids: [task.task_id],
      rejected_task_ids: [],
      retry_task_ids: [],
      issues: [],
      notes: [],
    },
    proposal_questions: [],
    confirmation_message: "Complete.",
  };

  const carried = composeProductWorkflowResult(input, review);
  assert.equal(
    carried.review.issues?.some((issue) => issue.code === "WEAK_EVIDENCE"),
    true,
  );

  const invalidDowngrade = composeProductWorkflowResult(input, {
    ...review,
    prior_issue_resolutions: [
      {
        code: priorIssue.code,
        task_id: priorIssue.task_id,
        disposition: "downgraded_to_non_blocking_risk",
        rationale: "Track the evidence limitation as an accepted research risk.",
        risk_id: "RISK-EVIDENCE",
      },
    ],
  });
  assert.equal(
    invalidDowngrade.review.issues?.some(
      (issue) => issue.code === "WEAK_EVIDENCE",
    ),
    true,
  );

  const resolved = composeProductWorkflowResult(input, {
    ...review,
    prior_issue_resolutions: [
      {
        code: priorIssue.code,
        task_id: priorIssue.task_id,
        disposition: "resolved",
        rationale: "The supplement added a trustworthy source and traceable evidence.",
      },
    ],
  });
  assert.equal(
    resolved.review.issues?.some((issue) => issue.code === "WEAK_EVIDENCE"),
    false,
  );

  graph.risks.push({
    id: "RISK-EVIDENCE",
    text: "External evidence quality remains a non-blocking research risk.",
    source_task_id: task.task_id,
  });
  const downgraded = composeProductWorkflowResult(input, {
    ...review,
    prior_issue_resolutions: [
      {
        code: priorIssue.code,
        task_id: priorIssue.task_id,
        disposition: "downgraded_to_non_blocking_risk",
        rationale: "Track the evidence limitation as an accepted research risk.",
        risk_id: "RISK-EVIDENCE",
      },
    ],
  });
  assert.equal(
    downgraded.review.issues?.some((issue) => issue.code === "WEAK_EVIDENCE"),
    false,
  );
});

test("blocks completion while graph blocking questions remain", () => {
  const task = createTask("task-01", 1, "executor-product-strategy");
  const graph = createGraph({});
  graph.open_questions = [
    {
      id: "OQ-001",
      text: "Which deployment target should be used?",
      source_task_id: task.task_id,
      blocking: true,
    },
  ];
  const review: CritiqueAgentOutput = {
    status: "completed",
    confirmation_id: "review-blocking-question",
    request_summary: "Review deployment planning.",
    review: {
      accepted_task_ids: [task.task_id],
      rejected_task_ids: [],
      retry_task_ids: [],
      issues: [],
      notes: "Model considered the task complete.",
    },
    product_context_update: "Deployment planning reviewed.",
    knowledge_graph_review: {
      accepted_task_ids: [task.task_id],
      rejected_task_ids: [],
      retry_task_ids: [],
      issues: [],
      notes: [],
    },
    proposal_questions: [],
    confirmation_message: "Complete.",
  };

  const result = composeProductWorkflowResult(
    {
      requestAnalysis: createRequestAnalysis(),
      plan: {
        status: "supplement",
        request_summary: "Review deployment planning.",
        dag: { nodes: [task.task_id], edges: [] },
        tasks: [task],
        assumptions: [],
      },
      executorResults: [
        {
          task_id: task.task_id,
          agent_type: task.assigned_agent,
          focus_layer: "Decision",
          summary: "Reviewed deployment planning.",
          entities: [],
          relations: [],
          decisions: [],
          risks: [],
          open_questions: [graph.open_questions[0]!],
          quality_result: { passed: true, notes: "ok" },
        },
      ],
      knowledgeGraph: graph,
    },
    review,
  );

  assert.equal(result.status, "pending_user_confirmation");
  assert.equal(result.proposal_questions.length, 1);
  assert.equal(
    result.proposal_questions[0]?.sources[0]?.open_question_id,
    "OQ-001",
  );
  assert.equal(result.proposal_questions[0]?.required, true);
});

test("leaves success-target coverage semantics to Critique Agent", () => {
  const task = createTask("task-01", 1, "executor-product-discovery");
  const requestAnalysis = createRequestAnalysis();
  requestAnalysis.business_model[0]!.goal_constraints = [
    "成功标准：团队内 80% 的文档协作迁移到该工具",
    "成功标准：用户满意度达到 4.5 分以上",
  ];
  const result: ExecutorAgentResult = {
    task_id: task.task_id,
    agent_type: task.assigned_agent,
    focus_layer: "Metric",
    summary: "No success metrics were created.",
    entities: [
      {
        id: "F-001",
        type: "Feature",
        name: "Collaborative editing",
        provenance: createUserInputProvenance(),
        source_task_id: task.task_id,
        status: "proposed",
      },
    ],
    relations: [],
    decisions: [],
    risks: [],
    open_questions: [],
    quality_result: { passed: true, notes: "ok" },
  };
  const input = {
    requestAnalysis,
    plan: {
      status: "initial" as const,
      request_summary: "Design a collaborative document tool.",
      dag: { nodes: [task.task_id], edges: [] },
      tasks: [task],
      assumptions: [],
    },
    executorResults: [result],
  };

  const missing = createCritiqueValidationReport({
    ...input,
    knowledgeGraph: createGraph({ entities: result.entities }),
  });
  assert.deepEqual(missing.retry_task_ids, []);
  assert.equal(
    missing.issues.filter(
      (issue) => issue.code === "MISSING_SUCCESS_TARGET_COVERAGE",
    ).length,
    0,
  );

  const metric: ProductKnowledgeGraph["entities"][number] = {
    id: "M-001",
    type: "Metric",
    name: "文档迁移率与用户满意度",
    description: "至少 80% 的文档协作完成迁移，用户满意度达到 4.5。",
    provenance: createUserInputProvenance(),
    source_task_id: task.task_id,
    status: "proposed",
  };
  const covered = createCritiqueValidationReport({
    ...input,
    executorResults: [{ ...result, entities: [metric] }],
    knowledgeGraph: createGraph({ entities: [metric] }),
  });
  assert.equal(
    covered.issues.some(
      (issue) => issue.code === "MISSING_SUCCESS_TARGET_COVERAGE",
    ),
    false,
  );
});

test("critique validation warns when a task patch exceeds the soft ceiling", () => {
  const task = createTask("task-01", 1, "executor-product-strategy");
  const entities = Array.from({ length: 9 }, (_, index) =>
    createRequirement(
      `R-${index + 1}`,
      task.task_id,
      `Requirement ${index + 1}`,
      `Requirement ${index + 1} description.`,
    ),
  );
  const report = createCritiqueValidationReport({
    requestAnalysis: createRequestAnalysis(),
    plan: {
      status: "initial",
      request_summary: "Create requirements.",
      dag: { nodes: [task.task_id], edges: [] },
      tasks: [task],
      assumptions: [],
    },
    executorResults: [
      {
        task_id: task.task_id,
        agent_type: task.assigned_agent,
        focus_layer: "Requirement",
        summary: "Created requirements.",
        entities,
        relations: [],
        decisions: [],
        risks: [],
        open_questions: [],
        quality_result: { passed: true, notes: "ok" },
      },
    ],
    knowledgeGraph: createGraph({ entities }),
  });

  assert.equal(
    report.issues.some((issue) => issue.code === "TASK_PATCH_SIZE_EXCEEDED"),
    true,
  );
  assert.deepEqual(report.retry_task_ids, []);
});

test("does not infer duplicate metrics from similar wording", () => {
  const task = createTask("task-01", 1, "executor-data-analytics");
  const goal = createGoal("G-001");
  const metrics: ProductKnowledgeGraph["entities"] = [
    {
      id: "M-001",
      type: "Metric",
      name: "Offline sync success rate",
      description: "Measure the successful completion rate of offline synchronization.",
      provenance: createUserInputProvenance(),
      source_task_id: task.task_id,
      status: "proposed",
    },
    {
      id: "M-002",
      type: "Metric",
      name: "Offline synchronization success rate",
      description: "Measure successful completion of offline document synchronization.",
      provenance: createUserInputProvenance(),
      source_task_id: task.task_id,
      status: "proposed",
    },
  ];
  const relations: ProductKnowledgeGraph["relations"] = metrics.map(
    (metric, index) => ({
      id: `REL-${index + 1}`,
      type: "Measures",
      source: metric.id,
      target: goal.id,
      source_task_id: task.task_id,
    }),
  );
  const report = createCritiqueValidationReport({
    requestAnalysis: createRequestAnalysis(),
    plan: {
      status: "initial",
      request_summary: "Define metrics.",
      dag: { nodes: [task.task_id], edges: [] },
      tasks: [task],
      assumptions: [],
    },
    executorResults: [
      {
        task_id: task.task_id,
        agent_type: task.assigned_agent,
        focus_layer: "Metric",
        summary: "Defined metrics.",
        entities: metrics,
        relations,
        decisions: [],
        risks: [],
        open_questions: [],
        quality_result: { passed: true, notes: "ok" },
      },
    ],
    knowledgeGraph: createGraph({
      entities: [goal, ...metrics],
      relations,
    }),
  });

  assert.equal(
    report.issues.some((issue) => issue.code === "DUPLICATE_METRIC"),
    false,
  );
  assert.deepEqual(report.retry_task_ids, []);
});

test("does not infer metric completion from missing Measures relations", () => {
  const task = createTask("task-05", 1, "executor-data-analytics");
  const goal = createGoal("G-001");
  const metric: ProductKnowledgeGraph["entities"][number] = {
    id: "M-001",
    type: "Metric",
    name: "Collaboration efficiency improvement",
    description: "Measures the target 30% collaboration efficiency improvement.",
    provenance: createUserInputProvenance(),
    source_task_id: task.task_id,
    status: "proposed",
  };
  const executorResult: ExecutorAgentResult = {
    task_id: task.task_id,
    agent_type: task.assigned_agent,
    focus_layer: "Metric",
    summary: "Created the requested metric.",
    entities: [metric],
    relations: [],
    decisions: [],
    risks: [],
    open_questions: [],
    quality_result: { passed: true, notes: "ok" },
  };
  const plan: TaskExecutionPlan = {
    status: "initial",
    request_summary: "Define collaboration success metrics.",
    dag: { nodes: [task.task_id], edges: [] },
    tasks: [task],
    assumptions: [],
  };
  const input = {
    requestAnalysis: createRequestAnalysis(),
    plan,
    executorResults: [executorResult],
  };

  const missingRelation = createCritiqueValidationReport({
    ...input,
    knowledgeGraph: createGraph({ entities: [goal, metric] }),
  });
  assert.deepEqual(missingRelation.retry_task_ids, []);
  assert.equal(
    missingRelation.issues.some(
      (issue) =>
        issue.code === "UNMEASURED_METRIC" &&
        issue.severity === "error" &&
        issue.task_id === task.task_id,
    ),
    false,
  );

  const measureRelation: ProductKnowledgeGraph["relations"][number] = {
    id: "REL-001",
    type: "Measures",
    source: metric.id,
    target: goal.id,
    source_task_id: task.task_id,
  };
  const completed = createCritiqueValidationReport({
    ...input,
    executorResults: [{ ...executorResult, relations: [measureRelation] }],
    knowledgeGraph: createGraph({
      entities: [goal, metric],
      relations: [measureRelation],
    }),
  });
  assert.deepEqual(completed.retry_task_ids, []);
});

test("leaves free-text expected output equivalence to Critique Agent", () => {
  const task = {
    ...createTask("task-evidence", 1, "executor-market-research"),
    expected_output:
      "Source-verifiable Evidence and benchmark gaps linked to Requirements or decision candidates.",
  };
  const requirement = createRequirement(
    "R-evidence",
    "task-upstream",
    "Realtime collaboration",
    "Support realtime collaborative editing.",
  );
  const researchGap: ProductKnowledgeGraph["entities"][number] = {
    id: "CUS-evidence-gap",
    type: "Custom",
    name: "Research Gap: collaboration benchmark",
    description: "No verified collaboration benchmark was available.",
    provenance: [{ kind: "existing_graph", node_id: requirement.id }],
    source_task_id: task.task_id,
    status: "proposed",
  };
  const gapRelation: ProductKnowledgeGraph["relations"][number] = {
    id: "REL-evidence-gap",
    type: "References",
    source: researchGap.id,
    target: requirement.id,
    source_task_id: task.task_id,
  };
  const plan: TaskExecutionPlan = {
    status: "initial",
    request_summary: "Research collaboration evidence.",
    dag: { nodes: [task.task_id], edges: [] },
    tasks: [task],
    assumptions: [],
  };
  const executorResult: ExecutorAgentResult = {
    task_id: task.task_id,
    agent_type: task.assigned_agent,
    focus_layer: "Evidence",
    summary: "Recorded a research gap.",
    entities: [researchGap],
    relations: [],
    decisions: [],
    risks: [],
    open_questions: [],
    quality_result: { passed: true, notes: "ok" },
  };
  const input = {
    requestAnalysis: createRequestAnalysis(),
    plan,
    executorResults: [executorResult],
  };

  const missingEvidence = createCritiqueValidationReport({
    ...input,
    knowledgeGraph: createGraph({
      entities: [requirement, researchGap],
      relations: [],
    }),
  });
  assert.equal(
    missingEvidence.issues.some(
      (issue) =>
        issue.code === "EXPECTED_OUTPUT_ENTITY_MISSING" &&
        issue.task_id === task.task_id,
    ),
    false,
  );
  assert.deepEqual(missingEvidence.retry_task_ids, []);

  const evidence: ProductKnowledgeGraph["entities"][number] = {
    id: "E-evidence",
    type: "Evidence",
    name: "Verified collaboration benchmark",
    description: "A verified source describes collaboration behavior.",
    provenance: [
      {
        kind: "web_search",
        source_id: "source-1",
        title: "Verified source",
        url: "https://example.com/source",
      },
    ],
    source_task_id: task.task_id,
    status: "proposed",
  };
  const evidenceRelation: ProductKnowledgeGraph["relations"][number] = {
    id: "REL-evidence",
    type: "Validates",
    source: evidence.id,
    target: requirement.id,
    source_task_id: task.task_id,
  };
  const unconsumed = createCritiqueValidationReport({
    ...input,
    executorResults: [{ ...executorResult, entities: [evidence] }],
    knowledgeGraph: createGraph({ entities: [requirement, evidence] }),
    documentEvidenceResolution: true,
  });
  assert.equal(
    unconsumed.issues.some((issue) => issue.code === "UNCONSUMED_EVIDENCE"),
    false,
  );
  assert.deepEqual(unconsumed.retry_task_ids, []);
  const completed = createCritiqueValidationReport({
    ...input,
    executorResults: [
      {
        ...executorResult,
        summary: "Added verified evidence.",
        entities: [evidence],
        relations: [evidenceRelation],
      },
    ],
    knowledgeGraph: createGraph({
      entities: [requirement, evidence],
      relations: [evidenceRelation],
    }),
  });
  assert.equal(
    completed.issues.some((issue) =>
      issue.code.startsWith("EXPECTED_OUTPUT_"),
    ),
    false,
  );
});

test("supplement critique leaves natural-language scope conflicts to the model", () => {
  const task = createTask("task-10", 1, "executor-product-execution");
  const oldFeature: ProductKnowledgeGraph["entities"][number] = {
    id: "F-001",
    type: "Feature",
    name: "Rich text editor",
    description: "Provide a WYSIWYG rich text editor.",
    provenance: createUserInputProvenance(),
    source_task_id: "task-old",
    status: "proposed",
  };
  const oldComponent: ProductKnowledgeGraph["entities"][number] = {
    id: "C-001",
    type: "Component",
    name: "WYSIWYG editor component",
    description: "Implements the rich text editing surface.",
    provenance: createUserInputProvenance(),
    source_task_id: "task-old",
    status: "proposed",
  };
  const oldMetric: ProductKnowledgeGraph["entities"][number] = {
    id: "M-001",
    type: "Metric",
    name: "Rich text formatting success",
    description: "Measures successful rich text formatting.",
    provenance: createUserInputProvenance(),
    source_task_id: "task-old",
    status: "proposed",
  };
  const historicalRelations: ProductKnowledgeGraph["relations"] = [
    {
      id: "REL-001",
      type: "Implements",
      source: oldComponent.id,
      target: oldFeature.id,
      source_task_id: "task-old",
    },
    {
      id: "REL-002",
      type: "Measures",
      source: oldMetric.id,
      target: oldFeature.id,
      source_task_id: "task-old",
    },
  ];
  const markdownDecision: ProductKnowledgeGraph["entities"][number] = {
    id: "D-001",
    type: "Decision",
    name: "Markdown-only editing",
    description: "Markdown syntax is the only editing mode.",
    provenance: createUserInputProvenance(),
    source_task_id: task.task_id,
    status: "confirmed",
  };
  const plan: TaskExecutionPlan = {
    status: "supplement",
    request_summary: "Apply the confirmed Markdown-only scope.",
    dag: { nodes: [task.task_id], edges: [] },
    tasks: [task],
    assumptions: [],
  };
  const executorResult: ExecutorAgentResult = {
    task_id: task.task_id,
    agent_type: task.assigned_agent,
    focus_layer: "Decision",
    summary: "Applied the Markdown-only scope.",
    entities: [markdownDecision],
    relations: [],
    decisions: [],
    risks: [],
    open_questions: [],
    quality_result: { passed: true, notes: "ok" },
  };
  const baseInput = {
    requestAnalysis: createRequestAnalysis(),
    plan,
    executorResults: [executorResult],
    userInput: [
      {
        index: 1,
        content: "Use Markdown only and do not support rich text editor.",
        type: "requirement",
      },
    ],
  };

  const conflicting = createCritiqueValidationReport({
    ...baseInput,
    knowledgeGraph: createGraph({
      entities: [oldFeature, oldComponent, oldMetric, markdownDecision],
      relations: historicalRelations,
    }),
  });
  assert.equal(
    conflicting.issues.some(
      (issue) => issue.code === "ACTIVE_SCOPE_CONFLICT",
    ),
    false,
  );

  const deprecatedFeature = {
    ...oldFeature,
    status: "deprecated" as const,
    deprecated_by_task_id: task.task_id,
    deprecation_reason: "The user confirmed Markdown-only editing.",
    replacement_node_id: markdownDecision.id,
  };
  const partiallyCorrected = createCritiqueValidationReport({
    ...baseInput,
    executorResults: [
      {
        ...executorResult,
        entities: [deprecatedFeature, markdownDecision],
      },
    ],
    knowledgeGraph: createGraph({
      entities: [
        deprecatedFeature,
        oldComponent,
        oldMetric,
        markdownDecision,
      ],
      relations: historicalRelations,
    }),
  });
  assert.deepEqual(
    partiallyCorrected.semantic_integrity.stale_deprecated_downstream_node_ids,
    [],
  );

  const deprecatedComponent = {
    ...oldComponent,
    status: "deprecated" as const,
    deprecated_by_task_id: task.task_id,
    deprecation_reason: "The rich text editing branch was retired.",
  };
  const deprecatedMetric = {
    ...oldMetric,
    status: "deprecated" as const,
    deprecated_by_task_id: task.task_id,
    deprecation_reason: "The rich text editing branch was retired.",
  };
  const corrected = createCritiqueValidationReport({
    ...baseInput,
    executorResults: [
      {
        ...executorResult,
        entities: [
          deprecatedFeature,
          deprecatedComponent,
          deprecatedMetric,
          markdownDecision,
        ],
      },
    ],
    knowledgeGraph: createGraph({
      entities: [
        deprecatedFeature,
        deprecatedComponent,
        deprecatedMetric,
        markdownDecision,
      ],
      relations: historicalRelations,
    }),
  });
  assert.equal(
    corrected.issues.some(
      (issue) => issue.code === "ACTIVE_SCOPE_CONFLICT",
    ),
    false,
  );
  assert.deepEqual(
    corrected.semantic_integrity.stale_deprecated_downstream_node_ids,
    [],
  );
});

test("critique does not infer conflicts or missing coverage from negative wording", () => {
  const task = createTask("task-10b", 1, "executor-product-strategy");
  const requirement = createRequirement(
    "R-010",
    task.task_id,
    "MVP analytics instrumentation",
    "Establish the instrumentation collection plan during MVP development.",
  );
  const executorResult: ExecutorAgentResult = {
    task_id: task.task_id,
    agent_type: task.assigned_agent,
    focus_layer: "Requirement",
    summary: "Captured the future instrumentation requirement.",
    entities: [requirement],
    relations: [],
    decisions: [],
    risks: [],
    open_questions: [],
    quality_result: { passed: true, notes: "ok" },
  };
  const baseInput = {
    requestAnalysis: createRequestAnalysis(),
    plan: {
      status: "initial" as const,
      request_summary: "Plan MVP analytics instrumentation.",
      dag: { nodes: [task.task_id], edges: [] },
      tasks: [task],
      assumptions: [],
    },
    executorResults: [executorResult],
    userInput: [
      {
        index: 1,
        content: "暂无数据，将在 MVP 开发阶段建立埋点采集方案",
        type: "constraint",
      },
    ],
  };

  const report = createCritiqueValidationReport({
    ...baseInput,
    knowledgeGraph: createGraph({ entities: [requirement] }),
  });
  assert.equal(
    report.issues.some(
      (issue) =>
        issue.code === "ACTIVE_SCOPE_CONFLICT" ||
        issue.code === "UNCOVERED_USER_INPUT",
    ),
    false,
  );
});

test("leaves delivery-chain and metric propagation semantics to Critique Agent", () => {
  const task = createTask("task-11", 1, "executor-product-execution");
  const requirement = createRequirement(
    "R-011",
    task.task_id,
    "Markdown-only editing",
    "The editor must support Markdown-only authoring.",
  );
  const feature: ProductKnowledgeGraph["entities"][number] = {
    id: "F-011",
    type: "Feature",
    name: "Markdown editor",
    description: "Offer Markdown authoring and preview.",
    provenance: createUserInputProvenance(),
    source_task_id: task.task_id,
    status: "proposed",
  };
  const component: ProductKnowledgeGraph["entities"][number] = {
    id: "C-011",
    type: "Component",
    name: "Markdown rendering component",
    description: "Render and preview Markdown content.",
    provenance: createUserInputProvenance(),
    source_task_id: task.task_id,
    status: "proposed",
  };
  const metric: ProductKnowledgeGraph["entities"][number] = {
    id: "M-011",
    type: "Metric",
    name: "Markdown task completion",
    description: "Measure successful Markdown authoring task completion.",
    provenance: createUserInputProvenance(),
    source_task_id: "task-old",
    status: "proposed",
  };
  const plan: TaskExecutionPlan = {
    status: "supplement",
    request_summary: "Propagate the Markdown-only scope.",
    dag: { nodes: [task.task_id], edges: [] },
    tasks: [task],
    assumptions: [],
  };
  const executorResult: ExecutorAgentResult = {
    task_id: task.task_id,
    agent_type: task.assigned_agent,
    focus_layer: "Requirement",
    summary: "Updated the delivery scope.",
    entities: [requirement, feature, component],
    relations: [],
    decisions: [],
    risks: [],
    open_questions: [],
    quality_result: { passed: true, notes: "ok" },
  };
  const input = {
    requestAnalysis: createRequestAnalysis(),
    plan,
    executorResults: [executorResult],
  };

  const missing = createCritiqueValidationReport({
    ...input,
    knowledgeGraph: createGraph({
      entities: [requirement, feature, component, metric],
    }),
  });
  assert.equal(
    missing.issues.some(
      (issue) => issue.code === "BROKEN_REQUIREMENT_DELIVERY_CHAIN",
    ),
    false,
  );
  assert.equal(
    missing.issues.some(
      (issue) => issue.code === "MISSING_SUPPLEMENT_METRIC_PROPAGATION",
    ),
    false,
  );

  const relations: ProductKnowledgeGraph["relations"] = [
    {
      id: "REL-011",
      type: "Satisfies",
      source: feature.id,
      target: requirement.id,
      source_task_id: task.task_id,
    },
    {
      id: "REL-012",
      type: "Implements",
      source: component.id,
      target: feature.id,
      source_task_id: task.task_id,
    },
    {
      id: "REL-013",
      type: "Measures",
      source: metric.id,
      target: feature.id,
      source_task_id: task.task_id,
    },
  ];
  const completed = createCritiqueValidationReport({
    ...input,
    executorResults: [{ ...executorResult, relations }],
    knowledgeGraph: createGraph({
      entities: [requirement, feature, component, metric],
      relations,
    }),
  });
  assert.equal(
    completed.issues.some(
      (issue) =>
        issue.code === "BROKEN_REQUIREMENT_DELIVERY_CHAIN" ||
        issue.code === "MISSING_SUPPLEMENT_METRIC_PROPAGATION",
    ),
    false,
  );
});

test("parallel graph merge preserves a controlled deprecation update", () => {
  const active = createRequirement(
    "R-001",
    "task-old",
    "Rich text editing",
    "The product includes rich text editing.",
  );
  const deprecated = {
    ...active,
    status: "deprecated" as const,
    deprecated_by_task_id: "task-12",
    deprecation_reason: "The user selected Markdown-only editing.",
  };

  const merged = mergeKnowledgeGraphSnapshots(
    createGraph({ entities: [active] }),
    createGraph({ entities: [deprecated] }),
  );

  assert.ok(merged);
  assert.equal(merged.entities[0]?.status, "deprecated");
  assert.equal(merged.entities[0]?.deprecated_by_task_id, "task-12");
});

test("renames non-similar duplicate IDs and remaps relation endpoints", () => {
  const current = createCurrentGraphWithTask03();
  const update = createGraph({
    entities: [
      createRequirement(
        "R-003",
        "task-02",
        "Integration toolkit requirement",
        "Define SDK, webhook, and connector requirements for enterprise integrations.",
      ),
    ],
    relations: [
      createRelation(
        "REL-003",
        "R-003",
        "G-001",
        "task-02",
        "Integration toolkit requirement supports the workspace automation goal.",
      ),
    ],
  });

  const merged = mergeKnowledgeGraphSnapshots(current, update);

  assert.ok(merged);
  const task02Entity = merged.entities.find(
    (entity) => entity.source_task_id === "task-02",
  );
  const task02Relation = merged.relations.find(
    (relation) => relation.source_task_id === "task-02",
  );

  assert.equal(task02Entity?.id, "R-006");
  assert.equal(task02Relation?.id, "REL-018");
  assert.equal(task02Relation?.source, "R-006");
  assert.equal(task02Relation?.target, "G-001");
  assert.equal(
    merged.entities.find((entity) => entity.id === "R-003")?.source_task_id,
    "task-03",
  );
});

test("deduplicates similar duplicate IDs without inserting a second item", () => {
  const current = createGraph({
    entities: [
      createRequirement(
        "R-003",
        "task-03",
        "Checkout payment failure",
        "Users abandon checkout when card authorization fails during payment.",
      ),
    ],
  });
  const update = createGraph({
    entities: [
      createRequirement(
        "R-003",
        "task-02",
        "Checkout payment failure issue",
        "Users abandon checkout when payment card authorization fails.",
      ),
    ],
  });

  const merged = mergeKnowledgeGraphSnapshots(current, update);

  assert.ok(merged);
  assert.deepEqual(
    merged.entities.map((entity) => entity.id),
    ["R-003"],
  );
  assert.equal(merged.entities[0].source_task_id, "task-03");
});

test("merges product context metadata without losing graph items", () => {
  const current = createGraph({
    entities: [createGoal("G-001")],
  });
  const update = createGraph({
    relations: [
      createRelation(
        "REL-001",
        "G-001",
        "G-001",
        "task-02",
        "Self-reference for metadata merge coverage.",
      ),
    ],
  });
  current.current_state = "initial";
  current.description = "Orchestrator Agent started the workflow.";
  update.current_state = "building";
  update.description = "Executor Agent updated the product context.";

  const merged = mergeKnowledgeGraphSnapshots(current, update);

  assert.ok(merged);
  assert.equal(merged.current_state, "building");
  assert.deepEqual(merged.description?.split("\n"), [
    "Orchestrator Agent started the workflow.",
    "Executor Agent updated the product context.",
  ]);
  assert.equal(merged.entities.length, 1);
  assert.equal(merged.relations.length, 1);
});

test("does not restore answered questions from stale graph snapshots", () => {
  const current = createGraph({});
  current.open_questions = [
    { id: "OQ-answered", text: "Answered?", blocking: true },
    { id: "OQ-open", text: "Still open?", blocking: true },
  ];
  const resolved = {
    ...current,
    open_questions: [current.open_questions[1]!],
    resolved_open_question_ids: ["OQ-answered"],
  };

  const merged = mergeKnowledgeGraphSnapshots(current, resolved);
  const staleBranch = {
    ...current,
    open_questions: [
      ...current.open_questions,
      { id: "OQ-new", text: "New question?", blocking: true },
    ],
  };
  const mergedWithStaleBranch = mergeKnowledgeGraphSnapshots(
    merged,
    staleBranch,
  );

  assert.deepEqual(
    mergedWithStaleBranch.open_questions.map((question) => question.id),
    ["OQ-open", "OQ-new"],
  );
  assert.deepEqual(mergedWithStaleBranch.resolved_open_question_ids, [
    "OQ-answered",
  ]);
});

test("critique validation accepts graph items normalized by merge reducer", () => {
  const task03Result = createExecutorResult({
    taskId: "task-03",
    agentType: "executor-product-discovery",
    entity: createRequirement(
      "R-003",
      "task-03",
      "Discovery interview requirement",
      "Capture target-user interview requirements for onboarding research.",
    ),
    relation: createRelation(
      "REL-003",
      "R-003",
      "G-001",
      "task-03",
      "Discovery interview requirement supports the workspace automation goal.",
    ),
  });
  const task02Result = createExecutorResult({
    taskId: "task-02",
    agentType: "executor-market-research",
    entity: createRequirement(
      "R-003",
      "task-02",
      "Integration toolkit requirement",
      "Define SDK, webhook, and connector requirements for enterprise integrations.",
    ),
    relation: createRelation(
      "REL-003",
      "R-003",
      "G-001",
      "task-02",
      "Integration toolkit requirement supports the workspace automation goal.",
    ),
  });
  const mergedGraph = mergeKnowledgeGraphSnapshots(
    createCurrentGraphWithTask03(),
    createGraph({
      entities: task02Result.entities,
      relations: task02Result.relations,
    }),
  );

  assert.ok(mergedGraph);
  const report = createCritiqueValidationReport({
    workspaceId: "workspace-test",
    productContext: "",
    requestAnalysis: createRequestAnalysis(),
    plan: createPlan(),
    executorResults: [task02Result, task03Result],
    knowledgeGraph: mergedGraph,
  });

  assert.deepEqual(report.rejected_task_ids, []);
  assert.deepEqual(report.retry_task_ids, []);
  assert.equal(
    report.issues.some((issue) =>
      [
        "DUPLICATE_ENTITY_ID",
        "DUPLICATE_RELATION_ID",
        "ENTITY_SOURCE_CONFLICT",
        "RELATION_SOURCE_CONFLICT",
      ].includes(issue.code),
    ),
    false,
  );
  assert.equal(
    report.executor_update_records.find(
      (record) => record.task_id === "task-02",
    )?.commit_status,
    "committed",
  );
  assert.deepEqual(
    report.executor_update_records.find(
      (record) => record.task_id === "task-02",
    )?.committed_entity_ids,
    ["R-006"],
  );
});

test("critique validation does not duplicate chained relation renames", () => {
  const goal = createGoal("G-001");
  const task03Entities = Array.from({ length: 11 }, (_, index) =>
    createRequirement(
      `R-${index + 11}`,
      "task-03",
      `Research requirement ${index + 1}`,
      `Research evidence requirement ${index + 1}.`,
    ),
  );
  const task04Entities = Array.from({ length: 20 }, (_, index) => ({
    id: `F-${index + 11}`,
    type: "Feature" as const,
    name: `Discovery feature ${index + 1}`,
    description: `Discovery feature hypothesis ${index + 1}.`,
    provenance: createUserInputProvenance(),
    source_task_id: "task-04",
    status: "proposed" as const,
  }));
  const task03Relations = task03Entities.map((entity, index) =>
    createRelation(
      `REL-${index + 11}`,
      entity.id,
      goal.id,
      "task-03",
      `Research relation ${index + 1}.`,
    ),
  );
  const task04Relations = task04Entities.map((entity, index) =>
    createRelation(
      `REL-${index + 11}`,
      entity.id,
      goal.id,
      "task-04",
      `Discovery relation ${index + 1}.`,
    ),
  );
  const mergedGraph = mergeKnowledgeGraphSnapshots(
    createGraph({
      entities: [goal, ...task03Entities],
      relations: task03Relations,
    }),
    createGraph({
      entities: task04Entities,
      relations: task04Relations,
    }),
  );
  assert.ok(mergedGraph);

  const task04 = createTask("task-04", 4, "executor-product-discovery");
  const report = createCritiqueValidationReport({
    workspaceId: "workspace-test",
    productContext: "",
    requestAnalysis: createRequestAnalysis(),
    plan: {
      status: "initial",
      request_summary: "Create discovery features.",
      dag: { nodes: [task04.task_id], edges: [] },
      tasks: [task04],
      assumptions: [],
    },
    executorResults: [
      {
        task_id: task04.task_id,
        agent_type: "executor-product-discovery",
        focus_layer: "Feature",
        summary: "Created discovery features.",
        entities: task04Entities,
        relations: task04Relations,
        decisions: [],
        risks: [],
        open_questions: [],
        quality_result: { passed: true, notes: "ok" },
      },
    ],
    knowledgeGraph: mergedGraph,
  });
  const record = report.executor_update_records[0];

  assert.deepEqual(record.committed_relation_ids, [
    ...Array.from({ length: 20 }, (_, index) => `REL-${index + 22}`),
  ]);
  assert.equal(new Set(record.committed_relation_ids).size, 20);
  assert.deepEqual(report.rejected_task_ids, []);
});

test("critique validation reports pre-existing integrity failures as legacy warnings", () => {
  const graph = createGraph({
    entities: [
      createGoal("G-001"),
      createRequirement(
        "R-001",
        "task-01",
        "Invalidly connected requirement",
        "This requirement is connected through an invalid direction.",
      ),
      createRequirement(
        "R-002",
        "task-01",
        "Orphan requirement",
        "This requirement has no relation.",
      ),
      {
        id: "F-001",
        type: "Feature",
        name: "Orphan feature",
        description: "This feature has no relation.",
        provenance: createUserInputProvenance(),
        source_task_id: "task-01",
        status: "proposed",
      },
    ],
    relations: [
      {
        id: "REL-INVALID",
        type: "Drives",
        source: "G-001",
        target: "R-001",
        source_task_id: "task-01",
      },
      {
        id: "REL-DANGLING",
        type: "References",
        source: "G-001",
        target: "MISSING",
        source_task_id: "task-01",
      },
    ],
  });
  const report = createCritiqueValidationReport({
    workspaceId: "workspace-test",
    productContext: "",
    requestAnalysis: createRequestAnalysis(),
    plan: {
      status: "initial",
      request_summary: "Review graph integrity.",
      dag: { nodes: [], edges: [] },
      tasks: [],
      assumptions: [],
    },
    executorResults: [],
    knowledgeGraph: graph,
  });

  assert.deepEqual(report.graph_integrity.dangling_relation_ids, [
    "REL-DANGLING",
  ]);
  assert.deepEqual(report.graph_integrity.invalid_direction_relation_ids, [
    "REL-INVALID",
  ]);
  assert.deepEqual(report.graph_integrity.orphan_requirement_ids, ["R-002"]);
  assert.deepEqual(report.graph_integrity.orphan_feature_ids, ["F-001"]);
  assert.deepEqual(
    report.issues.map((issue) => issue.code),
    [
      "LEGACY_RELATION_ENDPOINT_MISSING",
      "LEGACY_INVALID_RELATION_DIRECTION",
      "ORPHAN_REQUIREMENT",
      "ORPHAN_FEATURE",
    ],
  );
  assert.ok(report.issues.every((issue) => issue.severity === "warning"));
  assert.deepEqual(report.retry_task_ids, []);
});

test("critique validation rejects invalid relations committed by the current task", () => {
  const invalidRelation: ProductKnowledgeGraph["relations"][number] = {
    id: "REL-INVALID",
    type: "Drives",
    source: "G-001",
    target: "R-001",
    source_task_id: "task-01",
  };
  const graph = createGraph({
    entities: [
      createGoal("G-001"),
      createRequirement(
        "R-001",
        "task-01",
        "Invalidly connected requirement",
        "This requirement is connected through an invalid direction.",
      ),
    ],
    relations: [invalidRelation],
  });
  const task = createTask("task-01", 1, "executor-product-strategy");
  const report = createCritiqueValidationReport({
    workspaceId: "workspace-test",
    productContext: "",
    requestAnalysis: createRequestAnalysis(),
    plan: {
      status: "initial",
      request_summary: "Review current graph updates.",
      dag: { nodes: [task.task_id], edges: [] },
      tasks: [task],
      assumptions: [],
    },
    executorResults: [
      {
        task_id: task.task_id,
        agent_type: "executor-product-strategy",
        focus_layer: "Goal",
        summary: "Added an invalid relation.",
        entities: [],
        relations: [invalidRelation],
        decisions: [],
        risks: [],
        open_questions: [],
        quality_result: { passed: true, notes: "ok" },
      },
    ],
    knowledgeGraph: graph,
  });

  assert.deepEqual(report.rejected_task_ids, ["task-01"]);
  assert.equal(
    report.executor_update_records[0]?.commit_status,
    "committed",
  );
  assert.equal(report.issues[0]?.code, "INVALID_RELATION_DIRECTION");
});

/**
 * 构造包含 task-03 已提交项的图谱，用于模拟先合并的并行分支。
 */
function createCurrentGraphWithTask03(): ProductKnowledgeGraph {
  return createGraph({
    entities: [
      createGoal("G-001"),
      createRequirement(
        "R-003",
        "task-03",
        "Discovery interview requirement",
        "Capture target-user interview requirements for onboarding research.",
      ),
      createRequirement(
        "R-004",
        "task-03",
        "Research sample requirement",
        "Define minimum sample size for onboarding discovery interviews.",
      ),
      createRequirement(
        "R-005",
        "task-03",
        "Research synthesis requirement",
        "Summarize discovery evidence into prioritized onboarding insights.",
      ),
    ],
    relations: [
      createRelation(
        "REL-003",
        "R-003",
        "G-001",
        "task-03",
        "Discovery interview requirement supports the workspace automation goal.",
      ),
      createRelation(
        "REL-017",
        "R-005",
        "G-001",
        "task-03",
        "Research synthesis requirement references the workspace automation goal.",
      ),
    ],
  });
}

/**
 * 构造最小产品知识图谱。
 */
function createGraph({
  entities = [],
  relations = [],
}: {
  entities?: ProductKnowledgeGraph["entities"];
  relations?: ProductKnowledgeGraph["relations"];
}): ProductKnowledgeGraph {
  return {
    entities,
    relations,
    decisions: [],
    risks: [],
    open_questions: [],
    summary: [],
    markdown: "",
    notes: [],
  };
}

/**
 * 构造测试目标节点。
 */
function createGoal(id: string): ProductKnowledgeGraph["entities"][number] {
  return {
    id,
    type: "Goal",
    name: "Workspace automation goal",
    description: "Improve workspace automation for product teams.",
    provenance: createUserInputProvenance(),
    source_task_id: "task-01",
    status: "proposed",
  };
}

/**
 * 构造测试需求节点。
 */
function createRequirement(
  id: string,
  sourceTaskId: string,
  name: string,
  description: string,
): ProductKnowledgeGraph["entities"][number] {
  return {
    id,
    type: "Requirement",
    name,
    description,
    provenance: createUserInputProvenance(),
    source_task_id: sourceTaskId,
    status: "proposed",
  };
}

/**
 * 为测试中新写入的节点提供最小、可审计的用户输入来源。
 */
function createUserInputProvenance() {
  return [
    {
      kind: "user_input" as const,
      user_input_index: 1,
    },
  ];
}

/**
 * 构造测试关系。
 */
function createRelation(
  id: string,
  source: string,
  target: string,
  sourceTaskId: string,
  description: string,
): ProductKnowledgeGraph["relations"][number] {
  return {
    id,
    type: "References",
    source,
    target,
    description,
    source_task_id: sourceTaskId,
  };
}

/**
 * 构造 Critique 校验所需的 Executor 结果。
 */
function createExecutorResult({
  taskId,
  agentType,
  entity,
  relation,
}: {
  taskId: string;
  agentType: ExecutorAgentResult["agent_type"];
  entity: ProductKnowledgeGraph["entities"][number];
  relation: ProductKnowledgeGraph["relations"][number];
}): ExecutorAgentResult {
  return {
    task_id: taskId,
    agent_type: agentType,
    focus_layer: "Requirement",
    summary: `${taskId} summary`,
    entities: [entity],
    relations: [relation],
    decisions: [],
    risks: [],
    open_questions: [],
    quality_result: {
      passed: true,
      notes: "ok",
    },
  };
}

/**
 * 构造 Critique 校验所需的最小任务计划。
 */
function createPlan(): TaskExecutionPlan {
  const tasks = [
    createTask("task-02", 2, "executor-market-research"),
    createTask("task-03", 3, "executor-product-discovery"),
  ];

  return {
    status: "initial",
    request_summary: "Design a workspace automation workflow.",
    dag: {
      nodes: tasks.map((task) => task.task_id),
      edges: [],
    },
    tasks,
    assumptions: [],
  };
}

/**
 * 构造测试任务节点。
 */
function createTask(
  taskId: string,
  sequence: number,
  assignedAgent: TaskExecutionNode["assigned_agent"],
): TaskExecutionNode {
  return {
    task_id: taskId,
    sequence,
    title: `${taskId} title`,
    description: `${taskId} description`,
    assigned_agent: assignedAgent,
    depends_on: [],
    covered_business_model_indexes: [1],
    expected_output: "Update the product knowledge graph.",
    quality_check: {
      status: "pending",
      criteria: ["Must write traceable graph items."],
    },
  };
}

/**
 * 构造 Critique 校验所需的最小 Request Agent 分析。
 */
function createRequestAnalysis(): RequestAnalysis {
  return {
    business_model: [
      {
        index: 1,
        user_goal: "Design a workspace automation workflow.",
        goal_constraints: ["Keep graph updates traceable."],
        missing_information: [],
        covered_user_input_indexes: [1],
      },
    ],
    questions: [],
    chitchat: [],
  };
}
