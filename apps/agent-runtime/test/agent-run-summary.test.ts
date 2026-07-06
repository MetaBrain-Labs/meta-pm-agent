/**
 * Agent 运行汇总写入器测试
 *
 * 验证本地调试汇总在默认关闭时不会产生文件副作用，在开启后会按固定类别顺序
 * 写入 Markdown 文件，确保该能力可用于测试排查但不影响正常 Agent 流程。
 *
 * Responsibilities:
 * - 覆盖未开启开关时的空实现行为
 * - 覆盖开启四类汇总后的 Markdown 写入结果
 * - 验证输出章节顺序符合调试约定
 */

import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { createAgentRunSummaryRecorder } from "../src/agents/common/agent-run-summary";

const SUMMARY_ENV_KEYS = [
  "AGENT_SUMMARY_THINKING_ENABLED",
  "AGENT_SUMMARY_TOOL_CALLS_ENABLED",
  "AGENT_SUMMARY_CONTEXT_ENABLED",
  "AGENT_SUMMARY_OUTPUT_ENABLED",
  "AGENT_SUMMARY_SUBAGENTS_ENABLED",
  "AGENT_SUMMARY_OUTPUT_DIR",
] as const;

test("does not create summary files when all switches are disabled", async () => {
  const tempRoot = await mkdtemp(path.join(tmpdir(), "agent-summary-off-"));
  const outputDir = path.join(tempRoot, "summaries");

  try {
    await withSummaryEnv(
      {
        AGENT_SUMMARY_CONTEXT_ENABLED: "false",
        AGENT_SUMMARY_OUTPUT_DIR: outputDir,
        AGENT_SUMMARY_OUTPUT_ENABLED: "false",
        AGENT_SUMMARY_SUBAGENTS_ENABLED: "false",
        AGENT_SUMMARY_THINKING_ENABLED: "false",
        AGENT_SUMMARY_TOOL_CALLS_ENABLED: "false",
      },
      async () => {
        const recorder = createAgentRunSummaryRecorder({
          agentLabel: "Test Agent",
          agentName: "test-agent",
          agentType: "test",
          context: { input: "ignored" },
        });

        recorder.recordThinking("ignored thinking");
        recorder.recordOutput("ignored output");
        await recorder.finish({ output: "ignored" });

        assert.equal(existsSync(outputDir), false);
      },
    );
  } finally {
    await rm(tempRoot, { force: true, recursive: true });
  }
});

test("writes enabled summary sections as markdown after finish", async () => {
  const tempRoot = await mkdtemp(path.join(tmpdir(), "agent-summary-on-"));
  const outputDir = path.join(tempRoot, "summaries");

  try {
    await withSummaryEnv(
      {
        AGENT_SUMMARY_CONTEXT_ENABLED: "true",
        AGENT_SUMMARY_OUTPUT_DIR: outputDir,
        AGENT_SUMMARY_OUTPUT_ENABLED: "true",
        AGENT_SUMMARY_THINKING_ENABLED: "true",
        AGENT_SUMMARY_TOOL_CALLS_ENABLED: "true",
      },
      async () => {
        const recorder = createAgentRunSummaryRecorder({
          agentLabel: "Test Agent",
          agentName: "test-agent",
          agentType: "test",
          context: {
            payload: { request: "build" },
            systemPrompt: "## System Title\n\n- Follow the supplied context.",
          },
        });

        recorder.recordSystemPrompt(
          [
            "## System Title",
            "",
            "- Render me as markdown.",
            "",
            "## `write_todos`",
            "",
            "DeepAgents middleware prompt.",
          ].join("\n"),
        );
        recorder.recordRuntimeContext({
          userId: "user-123",
          featureFlag: "debug-summary",
        });
        recorder.recordThinking("reasoning chunk");
        recorder.recordThinking(" continued");
        recorder.recordToolCall({
          toolCallId: "call-1",
          toolName: "web_search",
          toolArgs: { query: "test" },
        });
        recorder.recordToolResult({
          toolCallId: "call-1",
          toolName: "web_search",
          toolResult: { results: [] },
        });
        recorder.recordOutput("streamed answer");
        await recorder.finish({
          output: { done: true },
          status: "completed",
          tokenUsage: { totalTokens: 3 },
        });

        const dateDirs = await readdir(outputDir);
        assert.equal(dateDirs.length, 1);
        const files = await readdir(path.join(outputDir, dateDirs[0]));
        assert.equal(files.length, 1);

        const markdown = await readFile(
          path.join(outputDir, dateDirs[0], files[0]),
          "utf8",
        );
        assert.match(markdown, /# Agent Run Summary/);
        assert.match(markdown, /## 1\. Agent 思考过程汇总/);
        assert.match(markdown, /## 2\. Agent 工具调用汇总/);
        assert.match(markdown, /## 3\. Agent 接收上下文汇总/);
        assert.match(markdown, /## 4\. Agent 输出汇总/);
        assert.match(markdown, /### Actual System Prompt/);
        assert.match(markdown, /## System Title/);
        assert.match(markdown, /### Payload/);
        assert.match(markdown, /### Runtime Context/);
        assert.match(markdown, /user-123/);
        assert.match(markdown, /write_todos/);
        assert.doesNotMatch(markdown, /### Chunk 1/);
        assert.ok(
          markdown.indexOf("## 1. Agent 思考过程汇总") <
            markdown.indexOf("## 2. Agent 工具调用汇总"),
        );
        assert.ok(
          markdown.indexOf("## 2. Agent 工具调用汇总") <
            markdown.indexOf("## 3. Agent 接收上下文汇总"),
        );
        assert.ok(
          markdown.indexOf("## 3. Agent 接收上下文汇总") <
            markdown.indexOf("## 4. Agent 输出汇总"),
        );
        assert.match(markdown, /reasoning chunk continued/);
        assert.match(markdown, /web_search/);
        assert.match(markdown, /streamed answer/);
      },
    );
  } finally {
    await rm(tempRoot, { force: true, recursive: true });
  }
});

/**
 * 验证重复引用不会被误写成循环引用，便于排查 Critique Agent fallback 输出。
 */
test("records subagent invocations when AGENT_SUMMARY_SUBAGENTS_ENABLED is on", async () => {
  const tempRoot = await mkdtemp(path.join(tmpdir(), "agent-summary-sub-"));
  const outputDir = path.join(tempRoot, "summaries");

  try {
    await withSummaryEnv(
      {
        AGENT_SUMMARY_CONTEXT_ENABLED: "false",
        AGENT_SUMMARY_OUTPUT_DIR: outputDir,
        AGENT_SUMMARY_OUTPUT_ENABLED: "false",
        AGENT_SUMMARY_THINKING_ENABLED: "false",
        AGENT_SUMMARY_TOOL_CALLS_ENABLED: "false",
        AGENT_SUMMARY_SUBAGENTS_ENABLED: "true",
      },
      async () => {
        const recorder = createAgentRunSummaryRecorder({
          agentLabel: "Test Agent",
          agentName: "test-agent",
          agentType: "test",
        });

        recorder.recordSubagentCall({
          toolCallId: "call-task-1",
          subagentType: "planner-agent",
          description: "Generate DAG from product request",
          input: { subagent_type: "planner-agent", description: "generate DAG" },
        });
        recorder.recordSubagentThinking({
          toolCallId: "call-task-1",
          content: "Planner subagent reasoned about task ordering.",
        });
        recorder.recordSubagentResult({
          toolCallId: "call-task-1",
          subagentType: "planner-agent",
          output: { tasks: [{ id: "t1", title: "research" }], plan_type: "initial" },
        });

        await recorder.finish({ status: "completed" });

        const dateDirs = await readdir(outputDir);
        const files = await readdir(path.join(outputDir, dateDirs[0]));
        const markdown = await readFile(
          path.join(outputDir, dateDirs[0], files[0]),
          "utf8",
        );
        assert.match(markdown, /## 5\. SubAgent 执行汇总/);
        assert.match(markdown, /### 1\. SubAgent: `planner-agent`/);
        assert.match(markdown, /- 描述: Generate DAG from product request/);
        assert.match(markdown, /#### 输入/);
        assert.match(markdown, /planner-agent/);
        assert.match(markdown, /#### 思考过程/);
        assert.match(markdown, /Planner subagent reasoned about task ordering/);
        assert.match(markdown, /#### 返回给主 Agent 的结果/);
        assert.match(markdown, /t1/);
        assert.ok(
          !markdown.includes("## 1. Agent 思考过程汇总"),
          "non-enabled thinking section should not appear",
        );
      },
    );
  } finally {
    await rm(tempRoot, { force: true, recursive: true });
  }
});

test("keeps repeated non-cyclic references in summary output", async () => {
  const tempRoot = await mkdtemp(path.join(tmpdir(), "agent-summary-ref-"));
  const outputDir = path.join(tempRoot, "summaries");
  const sharedRetryTaskIds = ["task-01"];

  try {
    await withSummaryEnv(
      {
        AGENT_SUMMARY_CONTEXT_ENABLED: "false",
        AGENT_SUMMARY_OUTPUT_DIR: outputDir,
        AGENT_SUMMARY_OUTPUT_ENABLED: "true",
        AGENT_SUMMARY_THINKING_ENABLED: "false",
        AGENT_SUMMARY_TOOL_CALLS_ENABLED: "false",
      },
      async () => {
        const recorder = createAgentRunSummaryRecorder({
          agentLabel: "Test Agent",
          agentName: "test-agent",
          agentType: "test",
        });

        await recorder.finish({
          output: {
            review: {
              retry_task_ids: sharedRetryTaskIds,
            },
            knowledge_graph_review: {
              retry_task_ids: sharedRetryTaskIds,
            },
          },
          status: "completed",
        });

        const dateDirs = await readdir(outputDir);
        const files = await readdir(path.join(outputDir, dateDirs[0]));
        const markdown = await readFile(
          path.join(outputDir, dateDirs[0], files[0]),
          "utf8",
        );

        assert.doesNotMatch(markdown, /\[Circular\]/);
        assert.match(markdown, /"task-01"/);
      },
    );
  } finally {
    await rm(tempRoot, { force: true, recursive: true });
  }
});

/**
 * 临时覆盖汇总环境变量，避免测试之间互相污染。
 */
async function withSummaryEnv(
  env: Record<(typeof SUMMARY_ENV_KEYS)[number], string>,
  run: () => Promise<void>,
): Promise<void> {
  const previous = new Map<string, string | undefined>();
  for (const key of SUMMARY_ENV_KEYS) {
    previous.set(key, process.env[key]);
    process.env[key] = env[key];
  }

  try {
    await run();
  } finally {
    for (const key of SUMMARY_ENV_KEYS) {
      const value = previous.get(key);
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  }
}
