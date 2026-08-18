/**
 * 文档证据阻断问题结果
 *
 * 定义证据阻断 Resolver SubAgent 的结构化输出，并以确定性校验保证每条原始阻断
 * 至少被一个必填问题覆盖。
 *
 * Responsibilities:
 * - 定义阻断、问题和 Resolver 结果契约
 * - 校验问题数量、必填属性和 blocker 覆盖率
 * - 在模型输出无效时生成覆盖全部阻断的安全兜底问题
 *
 * Notes:
 * - 语义去重由 Agent 完成，后端仅校验索引覆盖等精确不变量。
 */

import { z } from "zod";
import type { ModelUsageProfile, ProductKnowledgeGraph } from "@repo/shared";

export const DOCUMENT_EVIDENCE_FORM_PREFIX = "document-evidence-resolution";
const MAX_QUESTION_LABEL_CHARS = 240;
const MAX_QUESTION_HELP_CHARS = 1200;
const MAX_QUESTION_PLACEHOLDER_CHARS = 800;
const MAX_QUESTION_OPTION_CHARS = 240;

export const DocumentEvidenceQuestionSchema = z
  .object({
    id: z.string().min(1).max(80).describe("Stable question field ID"),
    label: z
      .string()
      .min(1)
      .max(MAX_QUESTION_LABEL_CHARS)
      .describe("User-facing question text"),
    type: z
      .enum(["radio", "select", "text", "textarea"])
      .describe("Question Form control type"),
    required: z.literal(true).describe("Every question must be answered"),
    help: z
      .string()
      .trim()
      .min(1)
      .max(MAX_QUESTION_HELP_CHARS)
      .optional()
      .catch(undefined)
      .describe("User-facing known context and blocker reason"),
    placeholder: z
      .string()
      .max(MAX_QUESTION_PLACEHOLDER_CHARS)
      .optional()
      .describe("Optional input guidance"),
    options: z
      .array(z.string().min(1).max(MAX_QUESTION_OPTION_CHARS))
      .max(8)
      .optional()
      .describe("Options for radio or select questions"),
    blockerIndexes: z
      .array(z.number().int().nonnegative())
      .min(1)
      .describe("Zero-based indexes of original blockers covered by this question"),
    suggestedAgentTypes: z
      .array(z.string().min(1).max(64))
      .max(6)
      .default([])
      .describe("Recommended executor agent types for the supplement DAG"),
    relatedNodeIds: z
      .array(z.string().min(1).max(128))
      .max(40)
      .default([])
      .describe("Knowledge graph node IDs related to this question"),
  })
  .superRefine((question, context) => {
    if (
      (question.type === "radio" || question.type === "select") &&
      (!question.options || question.options.length < 2)
    ) {
      context.addIssue({
        code: "custom",
        message: "radio/select questions require at least two options",
      });
    }
  });

export const DocumentEvidenceResolutionSchema = z.object({
  summary: z.string().min(1).max(500),
  questions: z.array(DocumentEvidenceQuestionSchema).min(1).max(10),
});

/** 持久化评分结果中的单条原始阻断及 Reviewer 来源。 */
export interface DocumentEvidenceBlocker {
  index: number;
  reviewerId: string;
  reviewerName: string;
  text: string;
  relatedNodeIds?: string[];
  sources?: Array<{
    reviewerId: string;
    reviewerName: string;
    text: string;
    relatedNodeIds?: string[];
  }>;
}

/** Resolver SubAgent 使用的可信服务端上下文。 */
export interface DocumentEvidenceResolutionInput {
  runId: string;
  workspaceId: string;
  sourceGraphVersion: number;
  blockers: DocumentEvidenceBlocker[];
  knowledgeGraph: ProductKnowledgeGraph;
  modelProfile?: ModelUsageProfile;
  signal?: AbortSignal;
}

export type DocumentEvidenceResolution = z.infer<
  typeof DocumentEvidenceResolutionSchema
>;

/**
 * 校验并归一化 Resolver 结果；任何结构或覆盖率错误都整体降级为兜底问题。
 */
export function normalizeDocumentEvidenceResolution(
  value: unknown,
  input: DocumentEvidenceResolutionInput,
): DocumentEvidenceResolution {
  const parsed = DocumentEvidenceResolutionSchema.safeParse(value);
  if (!parsed.success || !coversEveryBlocker(parsed.data, input.blockers)) {
    return createFallbackDocumentEvidenceResolution(input);
  }

  const validIndexes = new Set(input.blockers.map((blocker) => blocker.index));
  const validNodeIds = new Set([
    ...input.knowledgeGraph.entities.map((entity) => entity.id),
    ...input.knowledgeGraph.risks.map((risk) => risk.id),
    ...input.knowledgeGraph.open_questions.map((question) => question.id),
  ]);
  const questions = parsed.data.questions.map((question, index) => ({
    ...question,
    id: question.id.trim() || `evidence-question-${index + 1}`,
    help: question.help?.trim() || formatDocumentEvidenceQuestionHelp(
      question.blockerIndexes,
      input.blockers,
    ),
    blockerIndexes: [...new Set(question.blockerIndexes)].filter((blockerIndex) =>
      validIndexes.has(blockerIndex),
    ),
    suggestedAgentTypes: [...new Set(question.suggestedAgentTypes)],
    relatedNodeIds: [...new Set(question.relatedNodeIds)].filter((nodeId) =>
      validNodeIds.has(nodeId),
    ),
  }));

  return { ...parsed.data, questions };
}

/**
 * 生成一个覆盖全部原始 blocker 的必填 textarea，确保用户始终存在可执行入口。
 */
export function createFallbackDocumentEvidenceResolution(
  input: DocumentEvidenceResolutionInput,
): DocumentEvidenceResolution {
  return {
    summary: "需要补充能够解除当前 PRD 证据或决策阻断的事实与确认。",
    questions: [
      {
        id: "evidence-resolution-details",
        label: "请逐项补充以下证据或决策；暂时无法确认的内容也请明确填写延期、未知或待负责人确认。",
        type: "textarea",
        required: true,
        help: formatDocumentEvidenceQuestionHelp(
          input.blockers.map((blocker) => blocker.index),
          input.blockers,
        ),
        placeholder: limitText(
          input.blockers
            .map((blocker) => `${blocker.index + 1}. ${blocker.text}`)
            .join("\n"),
          MAX_QUESTION_PLACEHOLDER_CHARS,
        ),
        blockerIndexes: input.blockers.map((blocker) => blocker.index),
        suggestedAgentTypes: ["executor-product-discovery"],
        relatedNodeIds: [],
      },
    ],
  };
}

/**
 * 使用持久化评审阻断补齐用户可见资料，避免模型遗漏 help 时只展示孤立问题。
 */
function formatDocumentEvidenceQuestionHelp(
  blockerIndexes: number[],
  blockers: DocumentEvidenceBlocker[],
): string {
  const selected = blockers.filter((blocker) =>
    blockerIndexes.includes(blocker.index),
  );
  const reasons = (selected.length > 0 ? selected : blockers)
    .map((blocker) => blocker.text.trim())
    .filter(Boolean);
  return limitText([
    "当前已知资料：暂无更多已确认资料。",
    `阻断原因：${reasons.join("；") || "当前流程仍存在必须由用户确认的信息。"}`,
  ].join("\n"), MAX_QUESTION_HELP_CHARS);
}

/** 在用户可见字段上应用稳定字符上限，避免模型和 SSE 承载无限增长的 blocker 文本。 */
function limitText(value: string, maxChars: number): string {
  if (value.length <= maxChars) return value;
  return `${value.slice(0, Math.max(0, maxChars - 1)).trimEnd()}…`;
}

/**
 * 精确检查每个原始 blocker 索引是否至少被一个问题覆盖。
 */
function coversEveryBlocker(
  resolution: DocumentEvidenceResolution,
  blockers: DocumentEvidenceBlocker[],
): boolean {
  const covered = new Set(
    resolution.questions.flatMap((question) => question.blockerIndexes),
  );
  return blockers.length > 0 && blockers.every((blocker) => covered.has(blocker.index));
}
