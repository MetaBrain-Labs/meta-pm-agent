/**
 * Chat SSE 适配器测试
 *
 * 验证 runtime 内部事件不会泄漏到浏览器协议，并确认公开事件使用共享契约。
 *
 * Responsibilities:
 * - 校验 reasoning 到 thinking 的映射
 * - 校验 complete 与完整图谱事件被过滤
 */

import assert from "node:assert/strict";
import test from "node:test";
import { ChatSseEventSchema } from "@repo/shared";
import { toApiEvent } from "../src/services/agent-stream-service";

test("maps runtime reasoning through the shared public schema", () => {
  const event = toApiEvent({
    type: "reasoning",
    content: "Inspecting request.",
    agentType: "request",
  });
  assert.deepEqual(event, {
    type: "thinking",
    content: "Inspecting request.",
    agentType: "request",
  });
  assert.equal(ChatSseEventSchema.safeParse(event).success, true);
});

test("filters runtime-only completion and knowledge graph events", () => {
  assert.equal(
    toApiEvent({
      type: "knowledge-graph-update",
      knowledgeGraph: {
        entities: [],
        relations: [],
        decisions: [],
        risks: [],
        open_questions: [],
        summary: [],
        markdown: "",
        notes: [],
      },
    }),
    null,
  );
  assert.equal(
    toApiEvent({ type: "complete", result: {} } as never),
    null,
  );
});

test("shared schema rejects removed and unknown chat event types", () => {
  for (const type of ["thinking-done", "todo-update", "step-finish", "finish", "complete"]) {
    assert.equal(ChatSseEventSchema.safeParse({ type }).success, false, type);
  }
});
