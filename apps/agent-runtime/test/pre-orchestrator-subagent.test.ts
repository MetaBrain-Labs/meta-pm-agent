/**
 * Pre-Orchestrator SubAgent 结果提取测试
 *
 * 验证 Orchestrator pre-check 模式在不同 DeepAgents 返回形态下，都能稳定提取
 * Pre-Orchestrator SubAgent 的结构化澄清问题，避免模型已生成有效问题但页面退回保底表单。
 *
 * Responsibilities:
 * - 覆盖已解析对象作为结果来源的提取路径
 * - 覆盖 ToolMessage content 字段作为结果来源的提取路径
 * - 验证提取失败时仍保留确定性 fallback
 */

import assert from "node:assert/strict";
import test from "node:test";
import {
  createPreOrchestratorSubagent,
  extractPreOrchFromSubagentResult,
  type PreOrchestratorInput,
} from "../src/agents/product-workflow/orchestrator-agent/pre-orchestrator-subagent";

const INPUT: PreOrchestratorInput = {
  userMessage: "设计一个文档协同工具",
  hasExistingProject: false,
};

/**
 * 构造模型生成的定制澄清问题结果。
 */
function createModelResult() {
  return {
    intent: "new_project",
    decision: "ASK_CLARIFICATION",
    reason: "用户提出了文档协同工具的新产品请求，需要澄清目标用户和核心功能。",
    form_title: "文档协同工具信息收集",
    form_description: "请补充关键产品信息。",
    questions: [
      {
        id: "collaboration_scenario",
        label: "这个文档协同工具主要支持哪类协作场景？",
        type: "textarea",
        required: true,
      },
      {
        id: "core_capabilities",
        label: "你希望优先覆盖哪些文档协同能力？",
        type: "checkbox",
        required: true,
        options: ["实时编辑", "评论批注", "权限管理"],
      },
    ],
  };
}

test("forces the pre-orchestrator task result to be JSON", () => {
  process.env.OPENAI_API_KEY ??= "test-key";
  const model = createPreOrchestratorSubagent().model as {
    modelKwargs?: Record<string, unknown>;
  };

  assert.deepEqual(model.modelKwargs?.response_format, {
    type: "json_object",
  });
});

test("extracts pre-orch result from already parsed orchestrator output", () => {
  const result = extractPreOrchFromSubagentResult(createModelResult(), INPUT);

  assert.equal(result.form_title, "文档协同工具信息收集");
  assert.equal(
    result.questions?.[0]?.label,
    "这个文档协同工具主要支持哪类协作场景？",
  );
});

test("extracts pre-orch result from tool message content", () => {
  const result = extractPreOrchFromSubagentResult(
    { content: JSON.stringify(createModelResult()) },
    INPUT,
  );

  assert.equal(result.questions?.[1]?.id, "core_capabilities");
  assert.deepEqual(result.questions?.[1]?.options, [
    "实时编辑",
    "评论批注",
    "权限管理",
  ]);
});

test("falls back when pre-orch result is not parseable", () => {
  const result = extractPreOrchFromSubagentResult("not json", INPUT);

  assert.equal(result.form_title, "确认需求");
  assert.equal(result.questions?.[0]?.label, "这个项目最核心想解决什么问题？");
});
