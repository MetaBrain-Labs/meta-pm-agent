import { aiShippingExecutorProfile } from "./ai-shipping-executor/profile";
import { dataAnalyticsExecutorProfile } from "./data-analytics-executor/profile";
import { gtmExecutorProfile } from "./gtm-executor/profile";
import { interfaceCraftExecutorProfile } from "./interface-craft-executor/profile";
import { marketResearchExecutorProfile } from "./market-research-executor/profile";
import { marketingGrowthExecutorProfile } from "./marketing-growth-executor/profile";
import { productDiscoveryExecutorProfile } from "./product-discovery-executor/profile";
import { productExecutionExecutorProfile } from "./product-execution-executor/profile";
import { productStrategyExecutorProfile } from "./product-strategy-executor/profile";
import { toolkitExecutorProfile } from "./toolkit-executor/profile";

/**
 * Executor Agent 的固定职责定义，顺序体现默认图谱细化链路。
 */
export const EXECUTOR_DEFINITIONS = [
  productStrategyExecutorProfile,
  marketResearchExecutorProfile,
  gtmExecutorProfile,
  productDiscoveryExecutorProfile,
  productExecutionExecutorProfile,
  marketingGrowthExecutorProfile,
  dataAnalyticsExecutorProfile,
  aiShippingExecutorProfile,
  toolkitExecutorProfile,
  interfaceCraftExecutorProfile,
] as const;

/**
 * 单个领域 Executor Agent 的职责配置。
 */
export type ExecutorAgentDefinition = (typeof EXECUTOR_DEFINITIONS)[number];

/**
 * 可被 Planner 分配任务的 Executor Agent 类型。
 */
export type ExecutorAgentType = ExecutorAgentDefinition["agentType"];

/**
 * 判断给定 Agent 类型是否属于 10 个 Executor Agent。
 */
export function isExecutorAgentType(value: string): value is ExecutorAgentType {
  return EXECUTOR_DEFINITIONS.some((item) => item.agentType === value);
}

/**
 * 获取 Executor Agent 的职责定义。
 */
export function getExecutorDefinition(
  agentType: ExecutorAgentType,
): ExecutorAgentDefinition {
  return EXECUTOR_DEFINITIONS.find((item) => item.agentType === agentType)!;
}

/**
 * 将所有 Executor Agent 类型拼成提示词可读的枚举文本。
 */
export function formatExecutorAgentTypeList(): string {
  return EXECUTOR_DEFINITIONS.map((item) => item.agentType).join(", ");
}
