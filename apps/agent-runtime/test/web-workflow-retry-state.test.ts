/**
 * 前端工作流重试状态测试
 *
 * 验证定点重试结果会归并到最近的 Planner DAG，并确保 Critique 结果可回传给恢复接口。
 *
 * Responsibilities:
 * - 覆盖跨消息 Executor 结果归并
 * - 覆盖 product-workflow 历史序列化
 * - 覆盖完成卡片历史恢复
 */

import assert from "node:assert/strict";
import test from "node:test";
import {
  MAX_VISIBLE_REASONING_CHARS,
  appendBoundedReasoning,
} from "@repo/shared";
import type { Message, ProductWorkflowResult } from "../../web/src/types";
import {
  applyBufferedReasoningEventsToMessages,
  applyChatStreamEventToMessages,
  mergeBufferedReasoningEvent,
  serializeMessageContentForRequest,
  startWorkflowRound,
} from "../../web/src/pages/chat/chat-run-store";
import { mapPersistedMessageToMessage } from "../../web/src/mappers/persisted-message";

test("retry result updates only the nearest matching Planner DAG", () => {
  const messages = [
    plannerMessage("old"),
    plannerMessage("new"),
    { id: "retry", role: "agent", content: "", timestamp: 3 } satisfies Message,
  ];
  const result = {
    task_id: "supplement-task-01",
    agent_type: "executor-product-strategy",
    focus_layer: "Goal",
    summary: "completed",
    entities: [],
    relations: [],
    decisions: [],
    risks: [],
    open_questions: [],
    quality_result: { passed: true, notes: "ok" },
  };

  const next = applyChatStreamEventToMessages(
    messages,
    "retry",
    {
      type: "text",
      agentType: "executor-product-strategy",
      content: `<executor-result>\n${JSON.stringify(result)}\n</executor-result>`,
    },
    true,
  );

  assert.equal(next[0]?.executorResults, undefined);
  assert.equal(
    next[1]?.executorResults?.[0]?.task_id,
    "supplement-task-01",
  );
});

test("separates consecutive Planner DAG rounds into ordered messages", () => {
  const initialMessages = [
    {
      id: "assistant-run",
      role: "agent",
      content: "",
      timestamp: 1,
    } satisfies Message,
  ];
  const firstRound = startWorkflowRound(
    initialMessages,
    "assistant-run",
    "round-1",
  );
  const firstPlan = {
    ...createWorkflowResult().planner,
    status: "initial" as const,
  };
  const withFirstPlan = applyChatStreamEventToMessages(
    firstRound.messages,
    firstRound.activeAgentMsgId,
    {
      type: "text",
      agentType: "planner",
      content: `<task-execution>\n${JSON.stringify(firstPlan)}\n</task-execution>`,
    },
    false,
  );
  const secondRound = startWorkflowRound(
    withFirstPlan,
    firstRound.activeAgentMsgId,
    "round-2",
  );
  const withSecondPlan = applyChatStreamEventToMessages(
    secondRound.messages,
    secondRound.activeAgentMsgId,
    {
      type: "text",
      agentType: "planner",
      content: `<task-execution>\n${JSON.stringify(createWorkflowResult().planner)}\n</task-execution>`,
    },
    false,
  );

  assert.equal(withSecondPlan.length, 2);
  assert.equal(withSecondPlan[0]?.workflowRoundId, "round-1");
  assert.equal(withSecondPlan[0]?.plannerExecution?.plan.status, "initial");
  assert.equal(withSecondPlan[1]?.workflowRoundId, "round-2");
  assert.equal(withSecondPlan[1]?.plannerExecution?.plan.status, "supplement");
});

test("serializes Critique result and restores completion card", () => {
  const workflow = createWorkflowResult();
  const content = serializeMessageContentForRequest({
    id: "review",
    role: "agent",
    content: "",
    timestamp: 1,
    plannerReview: { state: "complete", result: workflow },
  });
  const restored = mapPersistedMessageToMessage({
    id: "complete",
    role: "assistant",
    type: "conversation_confirmation",
    content: "本轮产品工作流已正式结束。当前成果已归档。",
    timestamp: "2026-07-24T12:56:42.000Z",
  });

  assert.match(content, /<product-workflow>/);
  assert.equal(restored.content, "");
  assert.match(restored.workflowCompletion?.content ?? "", /正式结束/);
});

test("coalesces adjacent SubAgent reasoning before updating React state", () => {
  const first = {
    type: "subagent-thinking" as const,
    agentType: "orchestrator" as const,
    subagentType: "document-evidence-resolver",
    toolCallId: "subagent-1",
    content: "first ",
  };
  const merged = mergeBufferedReasoningEvent(
    mergeBufferedReasoningEvent([], first),
    { ...first, content: "second" },
  );

  assert.equal(merged.length, 1);
  assert.equal(merged[0]?.content, "first second");

  const messages = applyBufferedReasoningEventsToMessages(
    [{ id: "agent", role: "agent", content: "", timestamp: 1 }],
    "agent",
    merged,
  );
  assert.equal(
    messages[0]?.subagentTraces?.[0]?.thinking,
    "first second",
  );
});

test("bounds retained reasoning while keeping the newest streamed content", () => {
  const content = appendBoundedReasoning(
    "a".repeat(MAX_VISIBLE_REASONING_CHARS),
    "latest-result",
  );

  assert.equal(content.length, MAX_VISIBLE_REASONING_CHARS);
  assert.match(content, /^\[较早的思考过程已截断以保护页面内存\]/);
  assert.match(content, /latest-result$/);
});

/**
 * 构造包含规范化补充任务的 Planner 消息。
 */
function plannerMessage(id: string): Message {
  return {
    id,
    role: "agent",
    content: "",
    timestamp: id === "old" ? 1 : 2,
    plannerExecution: {
      state: "complete",
      content: "",
      plan: createWorkflowResult().planner,
    },
  };
}

/**
 * 构造最小 Critique 结果。
 */
function createWorkflowResult(): ProductWorkflowResult {
  return {
    status: "pending_user_confirmation",
    confirmation_id: "critique-result",
    request_summary: "Refine strategy",
    planner: {
      status: "supplement",
      request_summary: "Refine strategy",
      dag: { nodes: ["supplement-task-01"], edges: [] },
      tasks: [
        {
          task_id: "supplement-task-01",
          sequence: 1,
          title: "Refine strategy",
          description: "Apply confirmed constraints.",
          assigned_agent: "executor-product-strategy",
          depends_on: [],
          covered_business_model_indexes: [1],
          expected_output: "Updated strategy graph",
          quality_check: { status: "pending", criteria: ["traceable"] },
        },
      ],
      assumptions: [],
    },
    executor_results: [],
    review: {
      accepted_task_ids: [],
      rejected_task_ids: ["supplement-task-01"],
      retry_task_ids: ["supplement-task-01"],
      issues: [],
      notes: "Known issue retained.",
    },
    product_context_update: "Known issue retained.",
    knowledge_graph_update: {
      entities: [],
      relations: [],
      notes: [],
    },
    proposal_questions: [],
    confirmation_message: "Confirm.",
  };
}
