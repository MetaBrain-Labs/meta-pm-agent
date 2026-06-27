/**
 * LangGraph Human-in-the-Loop 桥接测试。
 *
 * 验证 Question Form 被包装为 LangGraph interrupt 后，可以通过同一 threadId
 * 使用 Command(resume) 恢复，确保前后端 HITL 提交闭环成立。
 *
 * Responsibilities:
 * - 覆盖 Question Form interrupt payload 生成
 * - 覆盖 HITL respond 决策恢复
 */

import assert from "node:assert/strict";
import test from "node:test";
import {
  createHumanInTheLoopThreadId,
  releaseQuestionFormHumanInterrupt,
  resumeQuestionFormHumanInterrupt,
} from "../src/graph/human-in-the-loop";

test("releases and resumes a question-form HITL interrupt", async () => {
  const questionForm = `<question-form id="discovery" title="需求确认">
{
  "questions": [
    { "id": "goal", "label": "目标", "type": "text", "required": true }
  ]
}
</question-form>`;
  const threadId = createHumanInTheLoopThreadId({
    scopeId: "request-form-test",
    formId: "discovery",
  });

  const interrupt = await releaseQuestionFormHumanInterrupt({
    threadId,
    questionForm,
    agentType: "conversation",
  });

  assert.ok(interrupt);
  assert.equal(interrupt.threadId, threadId);
  assert.equal(interrupt.value.actionRequests[0]?.name, "question_form");
  assert.equal(interrupt.value.reviewConfigs[0]?.allowedDecisions[0], "respond");

  const response = {
    decisions: [{ type: "respond" as const, message: "[form answers - discovery]" }],
  };

  const resumed = await resumeQuestionFormHumanInterrupt({
    threadId,
    response,
  });

  assert.deepEqual(resumed, response);
});
