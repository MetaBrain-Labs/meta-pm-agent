/**
 * Planner Agent 提示词语义护栏测试
 *
 * 验证 Planner Agent 的系统提示词持续包含关键知识图谱语义约束，避免后续修改
 * 重新引入“未知信息变确认决策”“先决策后找证据”或关系方向模糊的问题。
 *
 * Responsibilities:
 * - 校验缺失信息不得直接规划为 confirmed Decision
 * - 校验证据回流到决策和技术选项比较规则
 * - 校验关系方向约定仍在提示词中
 *
 * Notes:
 * - 该测试不调用模型，只防止提示词契约回退。
 */

import assert from "node:assert/strict";
import test from "node:test";
import { PLANNER_AGENT_PROMPT } from "../src/agents/product-workflow/planner-agent/prompt";

test("planner prompt preserves graph-semantics guardrails", () => {
  assert.match(
    PLANNER_AGENT_PROMPT,
    /Missing information, unverified assumptions, and unresolved user preferences must not be planned as confirmed Decision nodes/,
  );
  assert.match(
    PLANNER_AGENT_PROMPT,
    /first plan Goal\/Requirement\/OpenQuestion work plus evidence-producing tasks, then add a downstream strategy refinement task/,
  );
  assert.match(
    PLANNER_AGENT_PROMPT,
    /Do not lock technical options in Planner task text/,
  );
  assert.match(
    PLANNER_AGENT_PROMPT,
    /Data Analytics tasks for a greenfield product should define metrics, measurement plans, instrumentation, and benchmark gaps/,
  );
  assert.match(
    PLANNER_AGENT_PROMPT,
    /Goal --Drives--> Decision/,
  );
  assert.match(
    PLANNER_AGENT_PROMPT,
    /Component --Implements--> Feature/,
  );
  assert.match(
    PLANNER_AGENT_PROMPT,
    /whole JSON should stay under about 6000 tokens/,
  );
  assert.match(
    PLANNER_AGENT_PROMPT,
    /Do not enumerate detailed components, libraries, frameworks, vendor lists/,
  );
  assert.match(
    PLANNER_AGENT_PROMPT,
    /Do not plan beyond the user's intent/,
  );
  assert.match(
    PLANNER_AGENT_PROMPT,
    /must not ask its assigned executor to create entity node types outside that executor's Allowed entities list/,
  );
  assert.match(
    PLANNER_AGENT_PROMPT,
    /Do not ask Data Analytics to create Custom nodes/,
  );
  assert.match(
    PLANNER_AGENT_PROMPT,
    /Evidence --Validates--> Goal is not allowed/,
  );
  assert.match(
    PLANNER_AGENT_PROMPT,
    /Evidence must not be the source of Constrains/,
  );
  assert.match(
    PLANNER_AGENT_PROMPT,
    /must depend_on every task that produces the evidence, technical comparison, or measurement basis/,
  );
  assert.match(
    PLANNER_AGENT_PROMPT,
    /Prefer \{"criteria":\["\.\.\.","\.\.\."\]\}/,
  );
  assert.match(
    PLANNER_AGENT_PROMPT,
    /If status is omitted, the runtime treats it as "pending"/,
  );
});
