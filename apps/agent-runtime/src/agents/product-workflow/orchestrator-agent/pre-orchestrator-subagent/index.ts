/**
 * Pre-Orchestrator SubAgent 模块聚合导出
 *
 * 统一导出 Pre-Orchestrator SubAgent 的构造、提取、结果和格式化逻辑，
 * 供 orchestrator-agent 和 conversation stream 复用。
 */

export { PRE_ORCHESTRATOR_SUBAGENT_PROMPT } from "./prompt";
export {
  createPreOrchestratorSubagent,
  extractPreOrchFromSubagentResult,
  extractPreOrchReasoning,
  resolveToolMessageContent,
} from "./agent";
export {
  PreOrchResultSchema,
  type PreOrchResult,
  type PreOrchestratorInput,
  buildPreOrchPayload,
  createFallbackPreOrchResult,
  formatPreOrchQuestionForm,
  isPreOrchClarificationFormId,
} from "./result";
