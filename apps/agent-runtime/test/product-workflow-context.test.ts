/**
 * 产品工作流上下文压缩测试
 *
 * 验证 Executor 输入裁剪工具不会把完整知识图谱和完整 Request 分析继续传给后续
 * Agent，同时保留当前任务依赖所需的来源任务上下文。
 *
 * Responsibilities:
 * - 校验知识图谱摘要只暴露统计和最近上下文
 * - 校验任务相关子图按 depends_on/source_task_id 筛选
 * - 校验 Request 分析按任务覆盖范围裁剪
 */

import assert from "node:assert/strict";
import test from "node:test";
import type {
  ExecutorAgentResult,
  ProductKnowledgeGraph,
  RequestAnalysis,
  TaskExecutionNode,
} from "@repo/shared";
import {
  compactRequestAnalysisForTask,
  createGraphContextSummary,
  createTaskRelevantGraphContext,
} from "../src/agents/product-workflow/common/context";
import { boundPlannerProductContext } from "../src/agents/product-workflow/orchestrator-agent/agent";
import { createKnowledgeGraphTools } from "../src/agents/common/knowledge-graph-file-tool";

const knowledgeGraph: ProductKnowledgeGraph = {
  entities: [
    {
      id: "goal-1",
      type: "Goal",
      name: "Improve onboarding",
      description: "Reduce first-run confusion",
      source_task_id: "task-01",
      status: "proposed",
    },
    {
      id: "metric-1",
      type: "Metric",
      name: "Activation rate",
      description: "Activation metric outside this dependency",
      source_task_id: "task-99",
      status: "proposed",
    },
  ],
  relations: [
    {
      id: "rel-1",
      type: "Drives",
      source: "goal-1",
      target: "metric-1",
      description: "Goal influences activation",
      source_task_id: "task-01",
    },
  ],
  decisions: [],
  risks: [],
  open_questions: [
    { id: "oq-1", text: "Which segment is primary?", blocking: false },
  ],
  summary: ["Initial context", "Strategy summary"],
  markdown: "",
  notes: [],
};

const task: TaskExecutionNode = {
  task_id: "task-02",
  sequence: 2,
  title: "Discovery refinement",
  description: "Refine onboarding opportunities",
  assigned_agent: "executor-product-discovery",
  depends_on: ["task-01"],
  covered_business_model_indexes: [2],
  expected_output: "Feature hypotheses linked to the strategy goal",
  quality_check: {
    status: "pending",
    criteria: ["Trace to upstream goal"],
  },
};

const previousResults: ExecutorAgentResult[] = [
  {
    task_id: "task-01",
    agent_type: "executor-product-strategy",
    focus_layer: "Goal",
    summary: "Defined the onboarding goal.",
    entities: [knowledgeGraph.entities[0]],
    relations: [],
    decisions: [],
    risks: [],
    open_questions: [],
    quality_result: { passed: true, notes: "ok" },
  },
];

const requestAnalysis: RequestAnalysis = {
  business_model: [
    {
      index: 1,
      user_goal: "Unrelated pricing task",
      goal_constraints: [],
      missing_information: [],
      covered_user_input_indexes: [1],
    },
    {
      index: 2,
      user_goal: "Improve onboarding",
      goal_constraints: ["Must launch this quarter"],
      missing_information: [
        { index: 1, description: "Primary segment", importance: 0.8 },
      ],
      covered_user_input_indexes: [2],
    },
  ],
  questions: [],
  chitchat: [],
};

test("creates compact graph summary without full graph arrays", () => {
  const summary = createGraphContextSummary(knowledgeGraph);

  assert.equal(summary.counts.entities, 2);
  assert.deepEqual(summary.latest_summaries, [
    "Initial context",
    "Strategy summary",
  ]);
  assert.equal(summary.recent_nodes.length, 2);
  assert.equal("relations" in summary, false);
  assert.equal("description" in summary, false);
});

test("selects task dependency graph context by source task", () => {
  const context = createTaskRelevantGraphContext({
    knowledgeGraph,
    task,
    previousResults,
  });

  assert.deepEqual(context.dependency_task_ids, ["task-01"]);
  assert.deepEqual(
    context.nodes.map((node) => node.id),
    ["goal-1"],
  );
  assert.deepEqual(
    context.dependency_results.map((result) => result.task_id),
    ["task-01"],
  );
});

test("resolves abbreviated task node references to exact graph IDs", () => {
  const graph: ProductKnowledgeGraph = {
    ...knowledgeGraph,
    entities: [
      ...knowledgeGraph.entities,
      {
        id: "R-9da6bd4d-45b6-4cfb-be2a-c20456e02ec0",
        type: "Requirement",
        name: "Security compliance",
        description: "Private deployment compliance requirement",
        source_task_id: "strategy-01",
        status: "confirmed",
      },
    ],
  };
  const referencedTask: TaskExecutionNode = {
    ...task,
    description: "Create Evidence that validates R-9da6bd4d.",
  };

  const context = createTaskRelevantGraphContext({
    knowledgeGraph: graph,
    task: referencedTask,
    previousResults,
  });

  assert.deepEqual(context.task_node_references, [
    {
      reference: "R-9da6bd4d",
      exact_id: "R-9da6bd4d-45b6-4cfb-be2a-c20456e02ec0",
    },
  ]);
  assert.equal(
    context.nodes[0]?.id,
    "R-9da6bd4d-45b6-4cfb-be2a-c20456e02ec0",
  );
});

test("compacts request analysis to current task coverage", () => {
  const compacted = compactRequestAnalysisForTask(requestAnalysis, task);

  assert.deepEqual(
    compacted.business_model.map((item) => item.index),
    [2],
  );
});

test("bounds the planner product context while keeping both ends", () => {
  const oversized = `${"A".repeat(20_000)}TAIL`;
  const bounded = boundPlannerProductContext(oversized);

  assert.ok(bounded.length < oversized.length);
  assert.ok(bounded.startsWith("A"));
  assert.ok(bounded.endsWith("TAIL"));
  assert.match(bounded, /\[product context truncated: \d+ chars omitted\]/);
  assert.equal(boundPlannerProductContext("short"), "short");
  assert.equal(
    boundPlannerProductContext(undefined),
    "No product context provided.",
  );
});

test("clamps oversized graph tool limits without schema failure", async () => {
  const tool = createKnowledgeGraphTools(knowledgeGraph).find(
    (item) => item.name === "kg_file_read_by_source_task",
  );
  assert.ok(tool);

  const rawResult = await tool.call({
    source_task_ids: ["task-01"],
    limit: 40,
  });
  const result = JSON.parse(String(rawResult)) as {
    requested_limit: number;
    effective_limit: number;
    nodes: unknown[];
  };

  assert.equal(result.requested_limit, 40);
  assert.equal(result.effective_limit, 30);
  assert.equal(result.nodes.length, 1);
});
