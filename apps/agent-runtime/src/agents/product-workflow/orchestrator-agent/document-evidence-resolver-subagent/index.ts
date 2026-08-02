/**
 * 文档证据阻断 Resolver 模块导出
 *
 * 汇总专用 SubAgent、结果契约和格式化常量，供 LangGraph 与测试使用。
 *
 * Responsibilities:
 * - 提供稳定的模块导出面
 *
 * Notes:
 * - 不包含持久化或知识图谱写入逻辑。
 */

export {
  createDocumentEvidenceResolverSubagent,
  streamOrchestratorEvidenceResolution,
} from "./agent";
export {
  DOCUMENT_EVIDENCE_FORM_PREFIX,
  DocumentEvidenceQuestionSchema,
  DocumentEvidenceResolutionSchema,
  createFallbackDocumentEvidenceResolution,
  normalizeDocumentEvidenceResolution,
  type DocumentEvidenceBlocker,
  type DocumentEvidenceResolution,
  type DocumentEvidenceResolutionInput,
} from "./result";
