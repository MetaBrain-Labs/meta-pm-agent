/**
 * Chat 模型使用列表运行时解析
 *
 * 将账号模型使用列表转换为单个 Agent 的不可变模型快照，并提供自定义人民币单价计费适配。
 *
 * Responsibilities:
 * - 按 Agent 职责组解析分类或通用模型
 * - 从 LangGraph configurable 中安全恢复本次运行快照
 * - 将列表价格映射为现有 Token 计费结构
 *
 * Notes:
 * - 该模块不读取 API Key，密钥仍仅由全局 LLM 配置提供
 */

import type { RunnableConfig } from "@langchain/core/runnables";
import {
  ModelUsageProfileSchema,
  resolveProfileModel,
  type AgentModelGroup,
  type DeepSeekModelConfig,
  type ModelTier,
  type ModelUsageProfile,
} from "@repo/shared";
import type { LlmPricing } from "../../config";

export const MODEL_PROFILE_RUN_CONFIG_KEY = "model_profile";

/** 单个 Agent 在一次运行中实际使用的模型快照。 */
export interface ResolvedAgentModelSelection {
  profileId: string;
  profileName: string;
  profileMode: ModelUsageProfile["config"]["mode"];
  group: AgentModelGroup;
  tier: ModelTier | "universal";
  model: DeepSeekModelConfig;
}

/** 按职责组解析实际模型，并复制嵌套价格避免调用方意外修改列表对象。 */
export function resolveAgentModelSelection(
  profile: ModelUsageProfile | undefined,
  group: AgentModelGroup,
): ResolvedAgentModelSelection | undefined {
  if (!profile) return undefined;
  const resolved = resolveProfileModel(profile, group);
  return {
    profileId: profile.id,
    profileName: profile.name,
    profileMode: profile.config.mode,
    group,
    tier: resolved.tier,
    model: { ...resolved.model, pricing: { ...resolved.model.pricing } },
  };
}

/** 从当前 LangGraph run config 获取 API 注入的模型快照。 */
export function getModelProfileFromRunnableConfig(
  config: RunnableConfig | undefined,
): ModelUsageProfile | undefined {
  const candidate = config?.configurable?.[MODEL_PROFILE_RUN_CONFIG_KEY];
  const parsed = ModelUsageProfileSchema.safeParse(candidate);
  return parsed.success ? parsed.data : undefined;
}

/** 将列表中的三项人民币单价适配到现有费用计算器。 */
export function toLlmPricing(
  selection: ResolvedAgentModelSelection | undefined,
): LlmPricing | undefined {
  if (!selection) return undefined;
  return {
    cacheHitInputPricePerMillion:
      selection.model.pricing.cacheHitInputPricePerMillion,
    inputPricePerMillion:
      selection.model.pricing.cacheMissInputPricePerMillion,
    outputPricePerMillion: selection.model.pricing.outputPricePerMillion,
  };
}

/** 生成不含 API Key 的 Agent Run Summary 模型区块数据。 */
export function createModelSummarySnapshot(
  selection: ResolvedAgentModelSelection | undefined,
): Record<string, unknown> | undefined {
  if (!selection) return undefined;
  return {
    profileId: selection.profileId,
    profileName: selection.profileName,
    mode: selection.profileMode,
    agentGroup: selection.group,
    tier: selection.tier,
    modelId: selection.model.modelId,
    customName: selection.model.customName,
    baseUrl: selection.model.baseUrl,
    thinking: true,
    reasoningEffort: selection.model.reasoningEffort,
    maxTokens: selection.model.maxTokens,
    temperature: selection.model.temperature,
    topP: selection.model.topP,
    samplingParametersEffective: false,
    samplingParametersNote:
      "temperature and topP are stored for display but are not sent while thinking is enabled.",
    pricingCnyPerMillionTokens: selection.model.pricing,
  };
}
