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
import { PLANNER_SUBAGENT_PROMPT } from "../src/agents/product-workflow/orchestrator-agent/planner-subagent/prompt";
import { CRITIQUE_AGENT_PROMPT } from "../src/agents/product-workflow/critique-agent/prompt";
import { createExecutorAgentPrompt } from "../src/agents/product-workflow/executor-agent/prompt";
import { productStrategyExecutorProfile } from "../src/agents/product-workflow/executor-agent/product-strategy-executor/profile";

const PLANNER_AGENT_PROMPT = PLANNER_SUBAGENT_PROMPT;
const ORCHESTRATOR_PLANNER_SUBAGENT_PROMPT = PLANNER_SUBAGENT_PROMPT;

test("planner prompt preserves graph-semantics guardrails", () => {
  assert.match(
    PLANNER_AGENT_PROMPT,
    /Missing information, unverified assumptions, and unresolved user preferences must not be planned as confirmed Decision nodes/,
  );
  assert.match(
    PLANNER_AGENT_PROMPT,
    /importance >= 0\.8.*do not schedule a final decision task/,
  );
  assert.match(
    PLANNER_AGENT_PROMPT,
    /A user answer is evidence for the stated product constraint, not proof that a specific technology is optimal/,
  );
  assert.match(
    PLANNER_AGENT_PROMPT,
    /trace which historical open questions or risks the answer resolves or supersedes/,
  );
  assert.match(PLANNER_AGENT_PROMPT, /stable OQ-\* ID/);
  assert.match(
    PLANNER_AGENT_PROMPT,
    /normally no more than 8 new entities total/,
  );
  assert.match(
    PLANNER_AGENT_PROMPT,
    /first plan Goal\/Requirement work plus evidence-producing tasks, then add a downstream Product Strategy refinement task/,
  );
  assert.match(
    PLANNER_AGENT_PROMPT,
    /include an explicit Product Strategy refinement task/,
  );
  assert.match(
    PLANNER_AGENT_PROMPT,
    /Do not lock technical options in Planner task text/,
  );
  assert.doesNotMatch(PLANNER_AGENT_PROMPT, /CRDT|Yjs|Automerge|SAML|OIDC|LDAP/);
  assert.match(
    PLANNER_AGENT_PROMPT,
    /Keep confirmed user facts separate from planning assumptions/,
  );
  assert.match(
    PLANNER_AGENT_PROMPT,
    /Feature-planning tasks must prioritize user-explicit Features/,
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
    /Do not request Goal --Drives--> Requirement/,
  );
  assert.match(
    PLANNER_AGENT_PROMPT,
    /Component --Implements--> Feature/,
  );
  assert.match(
    PLANNER_AGENT_PROMPT,
    /whole JSON should stay under about 6000 tokens/,
  );
  assert.match(PLANNER_AGENT_PROMPT, /Start the response with the JSON object immediately/);
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
    /Component constraint --Constrains--> UI Component/,
  );
  assert.match(
    PLANNER_AGENT_PROMPT,
    /Toolkit compliance or guardrail work must not ask the executor to create Risk nodes/,
  );
  assert.match(
    PLANNER_AGENT_PROMPT,
    /must depend_on every task that produces the evidence, technical comparison, or measurement basis/,
  );
  assert.match(
    PLANNER_AGENT_PROMPT,
    /Artifact coverage must be explicit in the task set/,
  );
  assert.match(
    PLANNER_AGENT_PROMPT,
    /Use a fixed planning sequence/,
  );
  assert.match(
    PLANNER_AGENT_PROMPT,
    /dag must be an object exactly shaped as/,
  );
  assert.match(
    PLANNER_AGENT_PROMPT,
    /Never return dag as an array/,
  );
  assert.match(
    PLANNER_AGENT_PROMPT,
    /Prefer \{"criteria":\["\.\.\.","\.\.\."\]\}/,
  );
  assert.match(
    PLANNER_AGENT_PROMPT,
    /If status is omitted, the runtime treats it as "pending"/,
  );
  assert.match(
    PLANNER_AGENT_PROMPT,
    /knowledge graph write tools are append-only/,
  );
  assert.match(
    PLANNER_AGENT_PROMPT,
    /Do not ask an Executor to "update D-001", "delete REL-001"/,
  );
  assert.match(
    PLANNER_AGENT_PROMPT,
    /Never describe Requirement --Produces--> Decision/,
  );
});

test("orchestrator planner subagent prompt satisfies json response format", () => {
  assert.match(ORCHESTRATOR_PLANNER_SUBAGENT_PROMPT, /json/i);
  assert.match(
    ORCHESTRATOR_PLANNER_SUBAGENT_PROMPT,
    /The JSON object must include: status, request_summary, dag, tasks, assumptions/,
  );
  assert.match(
    ORCHESTRATOR_PLANNER_SUBAGENT_PROMPT,
    /status must be "initial" for the first DAG and "supplement"/,
  );
  assert.match(
    ORCHESTRATOR_PLANNER_SUBAGENT_PROMPT,
    /Defer detailed architecture and exhaustive component decomposition to a supplement DAG/,
  );
  assert.match(
    ORCHESTRATOR_PLANNER_SUBAGENT_PROMPT,
    /required_open_question_ids/,
  );
  assert.match(
    ORCHESTRATOR_PLANNER_SUBAGENT_PROMPT,
    /do not create placeholder capacity metrics, numeric targets/,
  );
});

test("critique agent prompt stays compact and does not request full graph copies", () => {
  assert.match(
    CRITIQUE_AGENT_PROMPT,
    /The JSON object must include only: status, confirmation_id, request_summary, review, product_context_update, knowledge_graph_review, proposal_questions, confirmation_message/,
  );
  assert.match(
    CRITIQUE_AGENT_PROMPT,
    /Never reconstruct entities or relations from executor summaries/,
  );
  assert.match(
    CRITIQUE_AGENT_PROMPT,
    /Never output planner, executor_results, product_knowledge_graph, knowledge_graph_update/,
  );
  assert.match(
    CRITIQUE_AGENT_PROMPT,
    /Include every unresolved blocking question after semantic deduplication/,
  );
  assert.match(CRITIQUE_AGENT_PROMPT, /exact open_question_id/);
  assert.match(CRITIQUE_AGENT_PROMPT, /Never invent an open_question_id/);
  assert.match(CRITIQUE_AGENT_PROMPT, /timelines for internal consistency/);
  assert.match(
    CRITIQUE_AGENT_PROMPT,
    /Status is a critique classification, not an execution command/,
  );
  assert.match(
    CRITIQUE_AGENT_PROMPT,
    /graph_ref must be an object/,
  );
  assert.match(
    CRITIQUE_AGENT_PROMPT,
    /Review content only/,
  );
  assert.match(
    CRITIQUE_AGENT_PROMPT,
    /Single-task critique dimensions/,
  );
  assert.match(
    CRITIQUE_AGENT_PROMPT,
    /Global critique dimensions/,
  );
  assert.match(
    CRITIQUE_AGENT_PROMPT,
    /No silent truncation/,
  );
  assert.match(
    CRITIQUE_AGENT_PROMPT,
    /does not prove semantic uniqueness, evidence quality, or architecture proportionality/,
  );
  assert.match(CRITIQUE_AGENT_PROMPT, /Use task_semantic_updates/);
  assert.match(CRITIQUE_AGENT_PROMPT, /unsupported numeric targets/);
  assert.match(
    CRITIQUE_AGENT_PROMPT,
    /product_context_update must be one short string/,
  );
  assert.match(
    CRITIQUE_AGENT_PROMPT,
    /Every radio\/select option must answer the same decision dimension/,
  );
  assert.match(
    CRITIQUE_AGENT_PROMPT,
    /Rank questions by downstream graph impact/,
  );
  assert.match(
    CRITIQUE_AGENT_PROMPT,
    /Never ask a proposal question that the current user_input already answered/,
  );
  assert.doesNotMatch(
    CRITIQUE_AGENT_PROMPT,
    /knowledge_graph_update must contain the final knowledge graph state/,
  );
  assert.doesNotMatch(CRITIQUE_AGENT_PROMPT, /kg_file_read/);
});

test("executor prompt preserves append-only graph writing semantics", () => {
  const prompt = createExecutorAgentPrompt(productStrategyExecutorProfile);

  assert.match(prompt, /ONLY create new traceable records/);
  assert.match(prompt, /The graph tools are append-only/);
  assert.match(prompt, /Never reuse an existing node, relation, decision, risk, or open-question ID/);
  assert.match(prompt, /all new IDs unique/);
  assert.match(prompt, /runtime generates the execution summary/);
  assert.match(prompt, /write one new blocking OQ-\*/);
  assert.match(prompt, /specific technology, algorithm, vendor, protocol/);
  assert.match(prompt, /at most two search attempts per topic/);
  assert.match(prompt, /do not add an unsupported numeric target/);
  assert.match(prompt, /persist every exact ID/);
});
