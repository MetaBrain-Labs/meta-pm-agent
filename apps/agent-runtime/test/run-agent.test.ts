/**
 * Agent 通用执行器结果解析测试
 *
 * 验证统一 runner 使用的纯结果解析函数和必需 SubAgent 校验，
 * 避免执行器收敛后改变既有 fallback 判定。
 *
 * Responsibilities:
 * - 验证 JSON 成功、格式失败和 schema 失败
 * - 验证文本成功与空输出失败
 * - 验证必需 SubAgent 调用判断
 */

import assert from "node:assert/strict";
import test from "node:test";
import { AIMessage } from "langchain";
import {
  AgentSubagentExecutionError,
  adaptAgentEventStream,
  getMissingRequiredSubagentError,
  getMissingRequiredSuccessfulToolError,
  resolveJsonOutput,
  resolveTextOutput,
  type AgentEventStreamProjection,
  type AgentEventStreamResult,
  type AgentRunEvent,
} from "../src/agents/common/run-agent";
import type { AgentRunSummaryRecorder } from "../src/agents/common/agent-run-summary";
import { SYSTEM_DEFAULT_MODEL_PROFILE } from "@repo/shared";
import {
  resolveAgentModelSelection,
  type ResolvedAgentModelSelection,
} from "../src/agents/common/model-profile";

/** 构造不含 provider token 数据的解析上下文。 */
const context = (text: string, reasoningText = "") => ({
  text,
  reasoningText,
  tokenUsage: null,
  maxTokens: 100,
});

/** 创建可回放测试 projection 所需的最小异步流。 */
async function* streamOf<T>(...items: T[]): AsyncGenerator<T> {
  for (const item of items) yield item;
}

/** 收集 Event Streaming 适配器事件与最终状态。 */
async function collectEventStream(
  run: AgentEventStreamProjection,
  recorder: AgentRunSummaryRecorder,
  visibleToolNames = new Set(["kg_file_add_nodes", "kg_file_raise_blocker"]),
  subagentSelections?: ReadonlyMap<string, ResolvedAgentModelSelection>,
): Promise<{
  events: AgentRunEvent<"executor">[];
  result: AgentEventStreamResult;
}> {
  const generator = adaptAgentEventStream(run, {
    agentType: "executor",
    visibleToolNames,
    summaryRecorder: recorder,
    subagentSelections,
  });
  const events: AgentRunEvent<"executor">[] = [];
  let next = await generator.next();
  while (!next.done) {
    events.push(next.value);
    next = await generator.next();
  }
  return { events, result: next.value };
}

/** 创建记录 Event Streaming 摘要调用的轻量探针。 */
function createSummaryProbe() {
  const toolCalls: Parameters<AgentRunSummaryRecorder["recordToolCall"]>[0][] =
    [];
  const toolResults: Parameters<
    AgentRunSummaryRecorder["recordToolResult"]
  >[0][] = [];
  const subagentCalls: Parameters<
    AgentRunSummaryRecorder["recordSubagentCall"]
  >[0][] = [];
  const subagentResults: Parameters<
    AgentRunSummaryRecorder["recordSubagentResult"]
  >[0][] = [];
  const recorder: AgentRunSummaryRecorder = {
    async finish() {},
    recordOutput() {},
    recordRuntimeContext() {},
    recordSystemPrompt() {},
    recordThinking() {},
    recordToolCall: (event) => toolCalls.push(event),
    recordToolResult: (event) => toolResults.push(event),
    recordSubagentCall: (event) => subagentCalls.push(event),
    recordSubagentThinking: () => true,
    recordSubagentRawOutput: () => true,
    recordSubagentResult: (event) => subagentResults.push(event),
  };
  return {
    recorder,
    subagentCalls,
    subagentResults,
    toolCalls,
    toolResults,
  };
}

test("resolves valid JSON through the supplied schema", () => {
  const result = resolveJsonOutput(context('{"ok":true}'), {
    safeParse: (value) =>
      typeof value === "object" &&
      value !== null &&
      (value as { ok?: unknown }).ok === true
        ? { success: true as const, data: value as { ok: true } }
        : { success: false as const, error: new Error("invalid") },
  });

  assert.deepEqual(result, { success: true, data: { ok: true } });
});

test("recovers schema-valid JSON from reasoning when final text is invalid", () => {
  const schema = {
    safeParse: (value: unknown) =>
      typeof value === "object" &&
      value !== null &&
      (value as { ok?: unknown }).ok === true
        ? { success: true as const, data: value as { ok: true } }
        : { success: false as const, error: new Error("invalid") },
  };

  assert.deepEqual(
    resolveJsonOutput(
      context("", 'analysis before output\n```json\n{"ok":true}\n```\n'),
      schema,
    ),
    { success: true, data: { ok: true } },
  );
  assert.equal(
    resolveJsonOutput(context('{"ok":false}', '{"ok":true}'), schema).success,
    false,
  );
});

test("reports invalid JSON and schema failures", () => {
  assert.equal(
    resolveJsonOutput(context("not-json"), {
      safeParse: () => ({ success: true as const, data: true }),
    }).success,
    false,
  );

  const schemaFailure = resolveJsonOutput(context('{"ok":false}'), {
    safeParse: () => ({
      success: false as const,
      error: { issues: [{ path: ["ok"], message: "Expected true" }] },
    }),
  });
  assert.deepEqual(schemaFailure, {
    success: false,
    reason: "schema-validation: ok: Expected true",
  });
});

test("resolves trimmed text and rejects empty output", () => {
  assert.deepEqual(resolveTextOutput(context("  result  ")), {
    success: true,
    data: "result",
  });
  assert.deepEqual(resolveTextOutput(context("   ")), {
    success: false,
    reason: "empty-output",
  });
});

test("requires an actual SubAgent invocation", () => {
  assert.equal(
    getMissingRequiredSubagentError("planner", new Set()),
    "required-subagent-not-invoked: planner",
  );
  assert.equal(
    getMissingRequiredSubagentError("planner", new Set(["planner"])),
    null,
  );
});

test("adapts native tool and SubAgent projections without parsing tool_calls", async () => {
  const probe = createSummaryProbe();
  const run: AgentEventStreamProjection = {
    messages: streamOf({
      text: streamOf("coordinator output"),
      reasoning: streamOf("coordinator reasoning"),
      output: Promise.resolve(new AIMessage("coordinator output")),
    }),
    toolCalls: streamOf(
      {
        name: "kg_file_add_nodes",
        callId: "kg-call-1",
        input: {
          nodes: [{ type: "Goal", name: "Ship MVP" }],
        },
        output: Promise.resolve(
          '{"action":"add_nodes","count":1,"items":[{"id":"G-1"}]}',
        ),
        status: Promise.resolve("finished" as const),
        error: Promise.resolve(undefined),
      },
      {
        name: "read_file",
        callId: "skill-call-1",
        input: { path: "/skills/product/SKILL.md" },
        output: Promise.resolve("private Skill instructions"),
        status: Promise.resolve("finished" as const),
        error: Promise.resolve(undefined),
      },
      {
        name: "kg_file_raise_blocker",
        callId: "blocker-call-1",
        input: { reason: "User choice required" },
        output: Promise.resolve('{"action":"raise_blocker","count":1}'),
        status: Promise.resolve("finished" as const),
        error: Promise.resolve(undefined),
      },
    ),
    subagents: streamOf(
      {
        name: "planner",
        taskInput: Promise.resolve("Plan A"),
        messages: streamOf({
          text: streamOf("planner result A"),
          reasoning: streamOf("planner reasoning A"),
          output: Promise.resolve(new AIMessage("planner result A")),
        }),
        output: Promise.resolve({
          messages: [new AIMessage("planner result A")],
        }),
      },
      {
        name: "planner",
        taskInput: Promise.resolve("Plan B"),
        messages: streamOf({
          text: streamOf("planner result B"),
          reasoning: streamOf("planner reasoning B"),
          output: Promise.resolve(new AIMessage("planner result B")),
        }),
        output: Promise.resolve({
          messages: [new AIMessage("planner result B")],
        }),
      },
    ),
    output: Promise.resolve({ messages: [] }),
  };

  const { events, result } = await collectEventStream(run, probe.recorder);
  const toolCall = events.find(
    (event) =>
      event.type === "tool-call" && event.toolName === "kg_file_add_nodes",
  );
  assert.deepEqual(
    toolCall?.type === "tool-call" ? toolCall.toolArgs : undefined,
    {
      nodes: [{ type: "Goal", name: "Ship MVP" }],
    },
  );
  assert.ok(
    events.some(
      (event) =>
        event.type === "tool-result" &&
        event.toolName === "kg_file_add_nodes" &&
        String(event.toolResult).includes('"count":1'),
    ),
  );
  assert.ok(
    events.some(
      (event) =>
        event.type === "tool-result" &&
        event.toolName === "kg_file_raise_blocker",
    ),
  );
  assert.equal(
    events.some(
      (event) =>
        (event.type === "tool-call" || event.type === "tool-result") &&
        event.toolName === "read_file",
    ),
    false,
  );

  const starts = events.filter((event) => event.type === "subagent-start");
  assert.equal(starts.length, 2);
  assert.equal(
    starts.every((event) => event.subagentType === "planner"),
    true,
  );
  assert.equal(new Set(starts.map((event) => event.toolCallId)).size, 2);
  assert.ok(
    events.some(
      (event) =>
        event.type === "reasoning" && event.content === "coordinator reasoning",
    ),
  );
  assert.ok(
    events.some(
      (event) =>
        event.type === "subagent-thinking" &&
        event.content === "planner reasoning A",
    ),
  );
  assert.deepEqual(
    events
      .filter((event) => event.type === "subagent-result")
      .map((event) => event.result)
      .sort(),
    ["planner result A", "planner result B"],
  );
  assert.equal(result.responseText, "coordinator output");
  assert.equal(result.reasoningText, "coordinator reasoning");
  assert.deepEqual([...result.invokedSubagentTypes], ["planner"]);
  assert.deepEqual([...result.successfulToolNames].sort(), [
    "kg_file_add_nodes",
    "kg_file_raise_blocker",
  ]);
  assert.equal(
    JSON.stringify(probe.toolResults).includes("private Skill instructions"),
    false,
  );
  assert.ok(
    probe.toolResults.some(
      (record) =>
        record.toolName === "read_file" &&
        JSON.stringify(record.toolResult).includes(
          "Skill file content omitted.",
        ),
    ),
  );
  assert.deepEqual(
    probe.subagentCalls.map((record) => record.input),
    [{ description: "Plan A" }, { description: "Plan B" }],
  );
});

test("reports a compact diagnostic when a SubAgent produces no text", async () => {
  const probe = createSummaryProbe();
  // 复现"只有思考、没有正文"：最终消息只含 reasoning block，且 finish_reason=length。
  const finalMessage = new AIMessage({
    content: [
      { type: "reasoning", reasoning: "planner reasoning only", index: 1 },
    ],
    response_metadata: { finish_reason: "length" },
    usage_metadata: {
      input_tokens: 100,
      output_tokens: 50_000,
      total_tokens: 50_100,
    },
  });
  const run: AgentEventStreamProjection = {
    messages: streamOf({
      text: streamOf("coordinator output"),
      reasoning: streamOf(""),
      output: Promise.resolve(new AIMessage("coordinator output")),
    }),
    toolCalls: streamOf(),
    subagents: streamOf({
      name: "planner",
      taskInput: Promise.resolve("Plan A"),
      messages: streamOf({
        text: streamOf(),
        reasoning: streamOf("planner reasoning only"),
        output: Promise.resolve(finalMessage),
      }),
      output: Promise.resolve({ messages: [finalMessage], todos: [] }),
    }),
    output: Promise.resolve({ messages: [] }),
  };
  const resolvedPlannerSelection = resolveAgentModelSelection(
    SYSTEM_DEFAULT_MODEL_PROFILE,
    "planner",
  );
  assert.ok(resolvedPlannerSelection);

  const plannerSelection: ResolvedAgentModelSelection = {
    ...resolvedPlannerSelection,
    model: {
      ...resolvedPlannerSelection.model,
      pricing: {
        cacheHitInputPricePerMillion: 0.5,
        cacheMissInputPricePerMillion: 3,
        outputPricePerMillion: 6,
      },
    },
  };

  const { events } = await collectEventStream(
    run,
    probe.recorder,
    new Set(),
    new Map([["planner", plannerSelection]]),
  );
  const subagentResults = events.filter(
    (
      event,
    ): event is Extract<
      AgentRunEvent<"executor">,
      { type: "subagent-result" }
    > => event.type === "subagent-result",
  );

  assert.equal(subagentResults.length, 1);
  assert.deepEqual(subagentResults[0]?.result, {
    error: "subagent-empty-output",
    finishReason: "length",
    completionTokens: 50_000,
    maxTokens: plannerSelection.model.maxTokens,
  });
  // 原始 SubAgent 状态不得进入事件流，避免整段推理被推送和持久化。
  assert.equal(
    JSON.stringify(subagentResults[0]?.result).includes(
      "planner reasoning only",
    ),
    false,
  );
});

test("requires at least one successful correction write tool", () => {
  const required = new Set(["kg_file_add_nodes", "kg_file_add_relations"]);
  assert.equal(
    getMissingRequiredSuccessfulToolError(required, new Set()),
    "required-structured-write-not-invoked",
  );
  assert.equal(
    getMissingRequiredSuccessfulToolError(
      required,
      new Set(["kg_file_add_relations"]),
    ),
    null,
  );
});

test("observes a SubAgent output rejection before delayed task input resolves", async () => {
  const probe = createSummaryProbe();
  const plannerFailure = new Error("Subagent planner failed");
  let rejectOutput!: (reason: unknown) => void;
  const output = new Promise<unknown>((_resolve, reject) => {
    rejectOutput = reject;
  });
  const taskInput = new Promise<string>((resolve) => {
    setTimeout(() => resolve("Delayed planner task"), 20);
  });
  const run: AgentEventStreamProjection = {
    messages: streamOf(),
    toolCalls: streamOf(),
    subagents: streamOf({
      name: "planner",
      taskInput,
      messages: streamOf(),
      output,
    }),
    output: Promise.resolve({ messages: [] }),
  };

  setTimeout(() => rejectOutput(plannerFailure), 0);

  await assert.rejects(
    collectEventStream(run, probe.recorder),
    (error: unknown) =>
      error instanceof AgentSubagentExecutionError &&
      error.subagentType === "planner" &&
      error.message === plannerFailure.message,
  );
  assert.deepEqual(probe.subagentResults, [
    {
      toolCallId: probe.subagentResults[0]?.toolCallId,
      subagentType: "planner",
      output: { error: "Subagent planner failed" },
    },
  ]);
});

test("drains SubAgent watchers when the projection iterator also fails", async () => {
  const probe = createSummaryProbe();
  const plannerFailure = new Error("Subagent planner failed");
  const projectionFailure = new Error("subagent projection stream failed");
  const unhandledRejections: unknown[] = [];
  const onUnhandledRejection = (reason: unknown) => {
    unhandledRejections.push(reason);
  };
  let rejectOutput!: (reason: unknown) => void;
  const output = new Promise<unknown>((_resolve, reject) => {
    rejectOutput = reject;
  });
  const subagent = {
    name: "planner",
    taskInput: Promise.resolve("Plan after projection failure"),
    messages: streamOf(),
    output,
  };
  async function* failingSubagents() {
    yield subagent;
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    rejectOutput(plannerFailure);
    throw projectionFailure;
  }
  const run: AgentEventStreamProjection = {
    messages: streamOf(),
    toolCalls: streamOf(),
    subagents: failingSubagents(),
    output: Promise.resolve({ messages: [] }),
  };

  process.on("unhandledRejection", onUnhandledRejection);
  try {
    await assert.rejects(
      collectEventStream(run, probe.recorder),
      (error: unknown) =>
        error instanceof AgentSubagentExecutionError &&
        error.subagentType === "planner" &&
        error.message === plannerFailure.message,
    );
    await new Promise<void>((resolve) => setImmediate(resolve));
  } finally {
    process.off("unhandledRejection", onUnhandledRejection);
  }

  assert.deepEqual(unhandledRejections, []);
});

test("observes top-level message output before delayed chunks finish", async () => {
  const probe = createSummaryProbe();
  const messageFailure = new Error("top-level message output failed");
  const unhandledRejections: unknown[] = [];
  const onUnhandledRejection = (reason: unknown) => {
    unhandledRejections.push(reason);
  };
  let rejectOutput!: (reason: unknown) => void;
  const output = new Promise<unknown>((_resolve, reject) => {
    rejectOutput = reject;
  });
  async function* delayedText() {
    await new Promise<void>((resolve) => setTimeout(resolve, 20));
    yield "late text";
  }
  const run: AgentEventStreamProjection = {
    messages: streamOf({
      text: delayedText(),
      reasoning: streamOf(),
      output,
    }),
    toolCalls: streamOf(),
    subagents: streamOf(),
    output: Promise.resolve({ messages: [] }),
  };

  process.on("unhandledRejection", onUnhandledRejection);
  try {
    setTimeout(() => rejectOutput(messageFailure), 0);
    await assert.rejects(
      collectEventStream(run, probe.recorder),
      messageFailure,
    );
    await new Promise<void>((resolve) => setImmediate(resolve));
  } finally {
    process.off("unhandledRejection", onUnhandledRejection);
  }

  assert.deepEqual(unhandledRejections, []);
});

test("prices SubAgent usage with its own responsibility model", async () => {
  const probe = createSummaryProbe();

  const resolvedPlannerSelection = resolveAgentModelSelection(
    SYSTEM_DEFAULT_MODEL_PROFILE,
    "planner",
  );
  assert.ok(resolvedPlannerSelection);

  const plannerSelection: ResolvedAgentModelSelection = {
    ...resolvedPlannerSelection,
    model: {
      ...resolvedPlannerSelection.model,
      pricing: {
        cacheHitInputPricePerMillion: 0.5,
        cacheMissInputPricePerMillion: 3,
        outputPricePerMillion: 6,
      },
    },
  };

  const usageMessage = new AIMessage({
    content: "planner result",
    usage_metadata: {
      input_tokens: 1_000_000,
      output_tokens: 1_000_000,
      total_tokens: 2_000_000,
      input_token_details: { cache_read: 0 },
    },
  });

  const run: AgentEventStreamProjection = {
    messages: streamOf(),
    toolCalls: streamOf(),
    subagents: streamOf({
      name: "planner",
      taskInput: Promise.resolve("Plan"),
      messages: streamOf({
        text: streamOf("planner result"),
        reasoning: streamOf(),
        output: Promise.resolve(usageMessage),
      }),
      output: Promise.resolve({ messages: [usageMessage] }),
    }),
    output: Promise.resolve({ messages: [] }),
  };

  const { events } = await collectEventStream(
    run,
    probe.recorder,
    new Set(),
    new Map([["planner", plannerSelection]]),
  );

  const usage = events.find((event) => event.type === "token-usage");

  assert.equal(usage?.agentType, "planner");
  assert.equal(usage?.costInput, 3);
  assert.equal(usage?.costOutput, 6);
});

test("emits structured tool errors and propagates projection failures", async () => {
  const errorProbe = createSummaryProbe();
  const failedToolRun: AgentEventStreamProjection = {
    messages: streamOf(),
    toolCalls: streamOf({
      name: "kg_file_add_nodes",
      callId: "kg-call-error",
      input: { nodes: [{ type: "Goal" }] },
      output: Promise.reject(new Error("schema rejected output")),
      status: Promise.resolve("error" as const),
      error: Promise.resolve("schema rejected"),
    }),
    subagents: streamOf(),
    output: Promise.resolve({}),
  };
  const failedTool = await collectEventStream(
    failedToolRun,
    errorProbe.recorder,
  );
  assert.ok(
    failedTool.events.some(
      (event) =>
        event.type === "tool-result" &&
        event.toolName === "kg_file_add_nodes" &&
        JSON.stringify(event.toolResult).includes("schema rejected"),
    ),
  );

  const promotedToolProbe = createSummaryProbe();
  const promotedToolGenerator = adaptAgentEventStream(
    {
      messages: streamOf(),
      toolCalls: streamOf({
        name: "kg_file_add_nodes",
        callId: "kg-call-promoted-error",
        input: { nodes: [{ type: "Goal" }] },
        output: Promise.reject(new Error("provenance rejected output")),
        status: Promise.resolve("error" as const),
        error: Promise.resolve("provenance rejected"),
      }),
      subagents: streamOf(),
      output: Promise.resolve({}),
    },
    {
      agentType: "executor",
      visibleToolNames: new Set(["kg_file_add_nodes"]),
      summaryRecorder: promotedToolProbe.recorder,
      getToolResultError: (_toolName, toolResult) =>
        new Error(String((toolResult as { error: unknown }).error)),
    },
  );
  const promotedToolCall = await promotedToolGenerator.next();
  assert.equal(promotedToolCall.done, false);
  if (promotedToolCall.done) return;
  assert.equal(promotedToolCall.value.type, "tool-call");
  const promotedToolResult = await promotedToolGenerator.next();
  assert.equal(promotedToolResult.done, false);
  if (promotedToolResult.done) return;
  assert.equal(promotedToolResult.value.type, "tool-result");
  await assert.rejects(promotedToolGenerator.next(), /provenance rejected/);

  const projectionProbe = createSummaryProbe();
  const projectionError = new Error("projection failed");
  const failedRun: AgentEventStreamProjection = {
    messages: streamOf(),
    toolCalls: streamOf(),
    subagents: streamOf(),
    output: Promise.reject(projectionError),
  };
  await assert.rejects(
    collectEventStream(failedRun, projectionProbe.recorder),
    /projection failed/,
  );
});
