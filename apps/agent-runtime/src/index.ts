/**
 * Agent Runtime 统一导出入口
 *
 * 将所有 Agent（Conversation、Request、Product Workflow）、图工作流、
 * 知识图谱文件工具和公共类型从各自模块集中导出，供 API 层和外部消费者引用。
 *
 * Responsibilities:
 * - 汇总并导出 Agent 创建、流式执行和格式化相关的函数
 * - 导出 LangGraph 工作流图和运行入口
 * - 导出知识图谱文件句柄的创建与删除工具
 * - 导出公共流事件类型和表单工具判定函数
 */

export {
  parseExistingGraphNewProjectAction,
  streamConversation,
} from "./agents/conversation/stream";
export {
  createRequestAgent,
  formatRequestAnalysisBlock,
  runRequestAgent,
} from "./agents/request/agent";
export {
  formatProductWorkflowBlock,
  formatProductWorkflowConfirmationQuestionForm,
  formatProductWorkflowProposalQuestionForm,
  getProposalDecisionId,
} from "./agents/product-workflow/agent";
export {
  normalizeTaskExecutionPlan,
  createFallbackPlan,
  formatTaskExecutionPlanBlock,
  formatPlannerReasoningSummary,
} from "./agents/product-workflow/orchestrator-agent/planner-subagent";
export type {
  ProductWorkflowInput,
  ProductWorkflowStreamEvent,
} from "./agents/product-workflow/agent";
export { createWorkflowThreadId, graph, runWorkflowGraph } from "./graph/workflow";
export {
  createDocumentWorkflowThreadId,
  documentGraph,
  streamDocumentWorkflow,
} from "./graph/document-workflow";
export type {
  DocumentWorkflowInput,
  DocumentWorkflowResult,
  DocumentWorkflowStreamEvent,
} from "./graph/document-workflow";
export {
  createHumanInTheLoopThreadId,
  extractQuestionFormId,
  releaseQuestionFormHumanInterrupt,
  resumeQuestionFormHumanInterrupt,
} from "./graph/human-in-the-loop";
export type {
  HumanInTheLoopInterrupt,
  HumanInTheLoopRequest,
  HumanInTheLoopResponse,
} from "./graph/human-in-the-loop";
export type {
  ConversationStreamEvent,
  ConversationStreamOptions,
  StreamChunk,
} from "./types";
export { getFormAnswerId, isFormAnswer } from "./utils/form-parser";
