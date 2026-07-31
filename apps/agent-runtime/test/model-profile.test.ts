/**
 * Chat 模型使用列表运行时测试
 *
 * 验证分类/通用职责解析、自定义计价和无密钥诊断快照。
 */

import assert from "node:assert/strict";
import test from "node:test";
import {
  DeepSeekModelConfigSchema,
  ModelUsageProfileConfigSchema,
  SYSTEM_DEFAULT_MODEL_PROFILE,
  type ModelUsageProfile,
} from "@repo/shared";
import { calculateCost } from "../src/config";
import {
  createModelSummarySnapshot,
  resolveAgentModelSelection,
  toLlmPricing,
} from "../src/agents/common/model-profile";

test("resolves default responsibility groups to the expected tiers", () => {
  assert.equal(
    resolveAgentModelSelection(SYSTEM_DEFAULT_MODEL_PROFILE, "planner")?.tier,
    "reasoning",
  );
  assert.equal(
    resolveAgentModelSelection(SYSTEM_DEFAULT_MODEL_PROFILE, "executors")?.tier,
    "standard",
  );
  assert.equal(
    resolveAgentModelSelection(SYSTEM_DEFAULT_MODEL_PROFILE, "conversation")?.tier,
    "fast",
  );
});

test("applies one universal model to every responsibility group", () => {
  const universal: ModelUsageProfile = {
    ...SYSTEM_DEFAULT_MODEL_PROFILE,
    id: "universal-test",
    config: {
      mode: "universal",
      model: SYSTEM_DEFAULT_MODEL_PROFILE.config.mode === "tiered"
        ? SYSTEM_DEFAULT_MODEL_PROFILE.config.models.standard
        : SYSTEM_DEFAULT_MODEL_PROFILE.config.model,
    },
  };
  const request = resolveAgentModelSelection(universal, "request");
  const critique = resolveAgentModelSelection(universal, "critique");
  assert.equal(request?.tier, "universal");
  assert.equal(request?.model.modelId, critique?.model.modelId);
});

test("uses the selected model pricing and never includes an API key in summaries", () => {
  const selection = resolveAgentModelSelection(
    SYSTEM_DEFAULT_MODEL_PROFILE,
    "planner",
  );
  const cost = calculateCost(1_000_000, 1_000_000, 1_000_000, toLlmPricing(selection));
  assert.deepEqual(cost, { costInput: 3.025, costOutput: 6, costTotal: 9.025 });

  const summary = createModelSummarySnapshot(selection);
  assert.equal(summary?.thinking, true);
  assert.equal(summary?.samplingParametersEffective, false);
  assert.equal(JSON.stringify(summary).includes("apiKey"), false);
});

test("validates parameter boundaries and all tiered responsibilities", () => {
  const base = SYSTEM_DEFAULT_MODEL_PROFILE.config;
  assert.equal(ModelUsageProfileConfigSchema.safeParse(base).success, true);
  if (base.mode !== "tiered") return;

  const repeatedModels = {
    ...base,
    models: {
      reasoning: base.models.fast,
      standard: base.models.fast,
      fast: base.models.fast,
    },
  };
  assert.equal(ModelUsageProfileConfigSchema.safeParse(repeatedModels).success, true);
  assert.equal(
    ModelUsageProfileConfigSchema.safeParse({
      ...base,
      assignments: { ...base.assignments, planner: undefined },
    }).success,
    false,
  );
  assert.equal(
    DeepSeekModelConfigSchema.safeParse({
      ...base.models.reasoning,
      baseUrl: "file:///unsafe",
      maxTokens: 393_217,
      pricing: { ...base.models.reasoning.pricing, outputPricePerMillion: -1 },
    }).success,
    false,
  );
  assert.equal(
    DeepSeekModelConfigSchema.safeParse({
      ...base.models.reasoning,
      reasoningEffort: "low",
    }).success,
    false,
  );
});
