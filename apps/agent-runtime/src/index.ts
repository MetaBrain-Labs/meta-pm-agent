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
  isAcceptedDocumentEvidenceWorkflowResult,
  streamConversation,
} from "./agents/conversation/stream";
export {
  resolveAnsweredGraphOpenQuestions,
} from "./agents/conversation/workflow-resume";
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
} from "./agents/product-workflow/orchestrator-agent/planner-subagent";
export type {
  ProductWorkflowInput,
  ProductWorkflowStreamEvent,
} from "./agents/product-workflow/agent";
export {
  createWorkflowThreadId,
  graph,
  hasRetryableWorkflowTaskCheckpoint,
  runWorkflowGraph,
} from "./graph/workflow";
export {
  createDocumentWorkflowThreadId,
  documentGraph,
  selectNextNodeAfterScore,
  streamDocumentWorkflow,
} from "./graph/document-workflow";
export {
  createScoreRetryFeedback,
  DOCUMENT_SCORE_MAX_ATTEMPTS,
} from "./agents/document-agent/scoring";
export {
  createDocumentEvidenceAnswerResult,
  createDocumentEvidenceResolutionFormId,
  createDocumentEvidenceResolutionThreadId,
  formatDocumentEvidenceQuestionForm,
  isDocumentEvidenceResolutionFormId,
  resumeDocumentEvidenceResolutionWorkflow,
  startDocumentEvidenceResolutionWorkflow,
  type DocumentEvidenceAnswerResult,
  type DocumentEvidenceResolutionWorkflowInput,
} from "./graph/document-evidence-resolution-workflow";
export {
  createFallbackDocumentEvidenceResolution,
  normalizeDocumentEvidenceResolution,
  type DocumentEvidenceBlocker,
  type DocumentEvidenceResolution,
  type DocumentEvidenceResolutionInput,
} from "./agents/product-workflow/orchestrator-agent/document-evidence-resolver-subagent";
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
  WorkflowAnswerResolution,
} from "./types";
export {
  getFormAnswerId,
  isFormAnswer,
  isProductWorkflowAcceptanceAnswer,
  isProductWorkflowOptionalStopAnswer,
} from "./utils/form-parser";
export { parseGraphConflictAction, isPreOrchGraphConflictFormId } from "./agents/product-workflow/orchestrator-agent/pre-orchestrator-subagent";
