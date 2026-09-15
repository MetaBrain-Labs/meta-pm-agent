/**
 * Agent 用户可见错误文本测试
 *
 * 验证运行时失败会压缩成「阻塞点 + 受影响 Agent + 下一步」的中文提示，
 * 同时未知故障保持原始消息，避免隐藏真实问题。
 *
 * Responsibilities:
 * - 覆盖 Planner 输出预算耗尽与运行时超时两类已知失败
 * - 覆盖未知错误原样透传
 */

import assert from "node:assert/strict";
import test from "node:test";
import { toUserVisibleAgentError } from "../src/agents/common/agent-error-message";

test("maps planner output starvation to an actionable message", () => {
  const message = toUserVisibleAgentError(
    new Error(
      "document-evidence-planner-invalid:planner-output-starved(finish_reason=length, completion_tokens=50000, max_tokens=50000)",
    ),
  );

  assert.match(message, /规划子代理/);
  assert.match(message, /推理强度/);
  assert.doesNotMatch(message, /planner-output-starved/);
});

test("maps orchestrator deadline expiry with the configured limit", () => {
  const message = toUserVisibleAgentError(
    new Error("agent-deadline-exceeded: orchestrator-agent exceeded 300000ms"),
  );

  assert.match(message, /300 秒/);
});

test("maps invalid evidence plans without leaking internal reasons", () => {
  const message = toUserVisibleAgentError(
    new Error(
      "document-evidence-planner-invalid:Planner subagent returned no parseable output",
    ),
  );

  assert.match(message, /规划子代理/);
  assert.doesNotMatch(message, /no parseable output/);
});

test("keeps unknown failures verbatim", () => {
  assert.equal(toUserVisibleAgentError(new Error("boom")), "boom");
  assert.equal(toUserVisibleAgentError("plain text"), "plain text");
});
