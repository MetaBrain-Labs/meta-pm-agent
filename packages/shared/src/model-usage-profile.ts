/**
 * 模型使用列表共享契约
 *
 * 定义 DeepSeek 模型参数、分层/通用模型使用列表以及 Chat 产品流中的 Agent 职责分组，
 * 供 API 持久化、Agent Runtime 解析和前端 DTO 校验共同使用。
 *
 * Responsibilities:
 * - 校验 DeepSeek V4 Flash/Pro 的可配置参数
 * - 定义三类模型用途与 Agent 职责映射
 * - 提供不可变的内置默认模型使用列表
 *
 * Notes:
 * - API Key 不属于该契约，始终由服务端环境变量提供
 * - thinking 固定为 true；temperature/topP 仅保存和展示
 */

import { z } from "zod";

export const DeepSeekModelIdSchema = z.enum([
  "deepseek-v4-flash",
  "deepseek-v4-pro",
]);

export const ModelTierSchema = z.enum(["reasoning", "standard", "fast"]);

export const AgentModelGroupSchema = z.enum([
  "conversation",
  "pre-orchestrator",
  "request",
  "orchestrator",
  "planner",
  "executors",
  "critique",
]);

export const ModelPricingSchema = z.object({
  cacheHitInputPricePerMillion: z.number().finite().nonnegative(),
  cacheMissInputPricePerMillion: z.number().finite().nonnegative(),
  outputPricePerMillion: z.number().finite().nonnegative(),
});

export const DeepSeekModelConfigSchema = z
  .object({
    provider: z.literal("deepseek"),
    modelId: DeepSeekModelIdSchema,
    customName: z.string().trim().min(1).max(64),
    baseUrl: z
      .string()
      .trim()
      .url()
      .refine((value) => /^https?:\/\//i.test(value), {
        message: "baseUrl must use http or https.",
      }),
    thinking: z.literal(true),
    temperature: z.number().finite().min(0).max(2),
    topP: z.number().finite().min(0).max(1),
    maxTokens: z.number().int().min(1).max(393_216),
    reasoningEffort: z.enum(["low", "high", "max"]),
    pricing: ModelPricingSchema,
  })
  .superRefine((value, context) => {
    if (
      value.modelId === "deepseek-v4-pro" &&
      value.reasoningEffort === "low"
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "deepseek-v4-pro supports high or max reasoning effort.",
        path: ["reasoningEffort"],
      });
    }
  });

export const AgentTierAssignmentsSchema = z.object({
  conversation: ModelTierSchema,
  "pre-orchestrator": ModelTierSchema,
  request: ModelTierSchema,
  orchestrator: ModelTierSchema,
  planner: ModelTierSchema,
  executors: ModelTierSchema,
  critique: ModelTierSchema,
});

export const TieredModelUsageConfigSchema = z.object({
  mode: z.literal("tiered"),
  models: z.object({
    reasoning: DeepSeekModelConfigSchema,
    standard: DeepSeekModelConfigSchema,
    fast: DeepSeekModelConfigSchema,
  }),
  assignments: AgentTierAssignmentsSchema,
});

export const UniversalModelUsageConfigSchema = z.object({
  mode: z.literal("universal"),
  model: DeepSeekModelConfigSchema,
});

export const ModelUsageProfileConfigSchema = z.discriminatedUnion("mode", [
  TieredModelUsageConfigSchema,
  UniversalModelUsageConfigSchema,
]);

export const ModelUsageProfileSchema = z.object({
  id: z.string().min(1),
  name: z.string().trim().min(1).max(80),
  isSystem: z.boolean(),
  config: ModelUsageProfileConfigSchema,
  createdAt: z.string().datetime().optional(),
  updatedAt: z.string().datetime().optional(),
});

/** 当前设置页允许选择的 DeepSeek 模型标识。 */
export type DeepSeekModelId = z.infer<typeof DeepSeekModelIdSchema>;
/** 分类模式中的三种模型用途。 */
export type ModelTier = z.infer<typeof ModelTierSchema>;
/** Chat 产品工作流可独立映射的 Agent 职责组。 */
export type AgentModelGroup = z.infer<typeof AgentModelGroupSchema>;
/** 人民币每百万 Token 的三项计价快照。 */
export type ModelPricing = z.infer<typeof ModelPricingSchema>;
/** 单个 DeepSeek 模型的完整可持久化配置。 */
export type DeepSeekModelConfig = z.infer<typeof DeepSeekModelConfigSchema>;
/** 分类模式职责组到模型用途的完整映射。 */
export type AgentTierAssignments = z.infer<
  typeof AgentTierAssignmentsSchema
>;
/** 分类或通用模式的模型使用列表配置。 */
export type ModelUsageProfileConfig = z.infer<
  typeof ModelUsageProfileConfigSchema
>;
/** 设置、API 与 Runtime 共享的模型使用列表。 */
export type ModelUsageProfile = z.infer<typeof ModelUsageProfileSchema>;

export const SYSTEM_MODEL_PROFILE_ID = "system-default";

export const DEFAULT_AGENT_TIER_ASSIGNMENTS: AgentTierAssignments = {
  conversation: "fast",
  "pre-orchestrator": "fast",
  request: "standard",
  orchestrator: "reasoning",
  planner: "reasoning",
  executors: "standard",
  critique: "reasoning",
};

export const DEFAULT_DEEPSEEK_PRICING: Record<
  DeepSeekModelId,
  ModelPricing
> = {
  "deepseek-v4-flash": {
    cacheHitInputPricePerMillion: 0.02,
    cacheMissInputPricePerMillion: 1,
    outputPricePerMillion: 2,
  },
  "deepseek-v4-pro": {
    cacheHitInputPricePerMillion: 0.025,
    cacheMissInputPricePerMillion: 3,
    outputPricePerMillion: 6,
  },
};

/**
 * 创建 DeepSeek 模型默认参数，避免 API、前端和运行时各自维护不同初值。
 */
export function createDefaultDeepSeekModelConfig(
  modelId: DeepSeekModelId,
  options: {
    customName: string;
    maxTokens: number;
    reasoningEffort: DeepSeekModelConfig["reasoningEffort"];
  },
): DeepSeekModelConfig {
  return {
    provider: "deepseek",
    modelId,
    customName: options.customName,
    baseUrl: "https://api.deepseek.com",
    thinking: true,
    temperature: 1,
    topP: 1,
    maxTokens: options.maxTokens,
    reasoningEffort: options.reasoningEffort,
    pricing: { ...DEFAULT_DEEPSEEK_PRICING[modelId] },
  };
}

export const SYSTEM_DEFAULT_MODEL_PROFILE: ModelUsageProfile = {
  id: SYSTEM_MODEL_PROFILE_ID,
  name: "内置默认模型列表",
  isSystem: true,
  config: {
    mode: "tiered",
    models: {
      reasoning: createDefaultDeepSeekModelConfig("deepseek-v4-pro", {
        customName: "DeepSeek V4 Pro 强推理",
        maxTokens: 16_384,
        reasoningEffort: "max",
      }),
      standard: createDefaultDeepSeekModelConfig("deepseek-v4-flash", {
        customName: "DeepSeek V4 Flash 普通",
        maxTokens: 16_384,
        reasoningEffort: "high",
      }),
      fast: createDefaultDeepSeekModelConfig("deepseek-v4-flash", {
        customName: "DeepSeek V4 Flash 快速",
        maxTokens: 4_096,
        reasoningEffort: "low",
      }),
    },
    assignments: { ...DEFAULT_AGENT_TIER_ASSIGNMENTS },
  },
};

/**
 * 按职责组解析列表中实际生效的模型；通用模式直接返回唯一模型。
 */
export function resolveProfileModel(
  profile: ModelUsageProfile,
  group: AgentModelGroup,
): { model: DeepSeekModelConfig; tier: ModelTier | "universal" } {
  if (profile.config.mode === "universal") {
    return { model: profile.config.model, tier: "universal" };
  }

  const tier = profile.config.assignments[group];
  return { model: profile.config.models[tier], tier };
}
