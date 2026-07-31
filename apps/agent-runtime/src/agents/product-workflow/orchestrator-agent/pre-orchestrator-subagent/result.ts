/**
 * Pre-Orchestrator 契约与格式化
 *
 * 定义 Pre-Orchestrator 的 Zod schema、TypeScript 类型、载荷构造、回退逻辑和
 * question-form 格式化逻辑。实际的意图分类由 Orchestrator Agent 通过其
 * Pre-Orchestrator SubAgent 完成。
 *
 * Responsibilities:
 * - 定义 PreOrchResultSchema / PreOrchResult / PreOrchestratorInput 类型
 * - buildPreOrchPayload()：构造 SubAgent 的 task 描述载荷
 * - createFallbackPreOrchResult()：模型不可用时给出确定性回退决策
 * - formatPreOrchQuestionForm()：将结果格式化为 question-form XML
 * - isPreOrchClarificationFormId()：判定表单 ID 是否来自 Pre-Orch 澄清
 *
 * Notes:
 * - question-form 格式与 Conversation Agent 的 question-form 完全兼容
 */

import { z } from "zod";
import type {
  ModelUsageProfile,
  ProductKnowledgeGraph,
} from "@repo/shared";

const ORCHESTRATOR_CLARIFICATION_FORM_PREFIX = "orch-clarification";
const ORCHESTRATOR_GRAPH_CONFLICT_FORM_PREFIX = "orch-graph-conflict";

/**
 * Pre-Orch 澄清问题的字段定义。
 */
const PreOrchQuestionSchema = z.object({
  id: z.string().min(1).describe("Unique question field ID"),
  label: z.string().min(1).describe("User-facing question text"),
  type: z
    .enum(["text", "textarea", "radio", "checkbox", "select"])
    .describe("Question Form control type"),
  required: z.boolean().default(true).describe("Whether the user must answer"),
  placeholder: z
    .string()
    .optional()
    .describe("Placeholder text for text/textarea controls"),
  options: z
    .array(z.string())
    .optional()
    .describe("Options for radio, checkbox, or select controls"),
});

/**
 * Pre-Orch 路由决策结果。
 */
export const PreOrchResultSchema = z.object({
  intent: z
    .enum(["casual_chat", "new_project", "project_evolution"])
    .describe("Classified user intent for this turn"),
  decision: z
    .enum(["HANDOFF_CHAT", "ASK_CLARIFICATION", "PROCEED_TO_WORKFLOW", "RESUME_WORKFLOW", "CHECK_GRAPH_CONFLICT"])
    .describe("Routing decision: chat back to Conversation, ask questions, go to product workflow, resume interrupted workflow, or resolve existing-graph new-project conflict"),
  reason: z
    .string()
    .min(1)
    .max(600)
    .describe("Brief explanation of the routing decision"),
  form_title: z
    .string()
    .optional()
    .describe("Title for the clarification question form"),
  form_description: z
    .string()
    .optional()
    .describe("Description text shown above the questions"),
  questions: z
    .array(PreOrchQuestionSchema)
    .optional()
    .describe("Clarification questions, only populated for ASK_CLARIFICATION"),
});

export type PreOrchResult = z.infer<typeof PreOrchResultSchema>;

export interface PreOrchestratorInput {
  modelProfile?: ModelUsageProfile;
  userMessage: string;
  productContext?: string;
  knowledgeGraph?: ProductKnowledgeGraph | null;
  workspaceId?: string;
  hasExistingProject: boolean;
  workflowThreadId?: string;
  recentMessages?: Array<{ role: string; content: string }>;
  signal?: AbortSignal;
}

/**
 * 构造 Pre-Orchestrator SubAgent 的输入载荷，
 * 供 Orchestrator Agent 通过 task 工具的描述字段传递给 SubAgent。
 */
export function buildPreOrchPayload(input: PreOrchestratorInput) {
  const graph = input.knowledgeGraph;
  return {
    user_message: input.userMessage,
    has_existing_project: input.hasExistingProject,
    project_context: input.productContext?.trim() || "No product context provided.",
    workflow_thread_id: input.workflowThreadId ?? null,
    recent_messages: input.recentMessages?.slice(-8) ?? [],
    knowledge_graph_summary: graph
      ? {
          entities_count: graph.entities.length,
          relations_count: graph.relations.length,
          recent_entities: graph.entities
            .slice(-5)
            .map((e) => `${e.type}:${e.name}`),
        }
      : null,
    graph_stats: graph
      ? {
          current_state: graph.current_state ?? null,
          description: graph.description ?? "",
          entities: graph.entities.length,
          relations: graph.relations.length,
          decisions: graph.decisions.length,
          risks: graph.risks.length,
          open_questions: graph.open_questions.length,
          summary_items: graph.summary.length,
        }
      : null,
  };
}

/**
 * 模型失败或 SubAgent 无输出时给出保守的 Pre-Orch 回退决策。
 *
 * 安全策略：
 * - 问候类 → 闲聊
 * - 含产品信号 + 已有项目 + 已有知识图谱 → 图谱冲突确认
 * - 含产品信号 + 已有项目无图谱 → 项目演化澄清
 * - 含产品信号 + 新项目 → 新项目澄清
 * - 其他非产品消息 → 闲聊（保守路由，避免误生成问题表单）
 */
export function createFallbackPreOrchResult(
  input: PreOrchestratorInput,
): PreOrchResult {
  const message = input.userMessage.trim();
  const isGreetingLike = /^(你好|hi|hello|hey|在吗|hi there|yo)\b/i.test(
    message,
  );

  if (isGreetingLike) {
    return {
      intent: "casual_chat",
      decision: "HANDOFF_CHAT",
      reason:
        "Fallback: message appears to be a greeting, routing to casual chat.",
    };
  }

  // 检测产品相关信号：含常见产品词、交付物词或创建/修改动词
  const hasProductSignals =
    /设计|开发|搭建|做一个|创建|制作|规划|方案|需求|产品|工具|系统|平台|功能|模块|报表|流程|接口|机器人|配置|规则|页面|应用|app|build|create|design|develop|plan|project|feature/i.test(
      message,
    );

  if (!hasProductSignals) {
    // 无产品信号的消息 → 保守路由到闲聊
    return {
      intent: "casual_chat",
      decision: "HANDOFF_CHAT",
      reason:
        "Fallback: message contains no product-related signals, routing to casual chat for safety.",
    };
  }

  // 已有项目且知识图谱存在实体 → 无法判断是新项目还是项目演化，
  // 保守路由到图谱冲突确认，让用户决定处理方式。
  const hasKnowledgeGraphEntities =
    input.knowledgeGraph && (input.knowledgeGraph.entities?.length ?? 0) > 0;

  if (input.hasExistingProject && hasKnowledgeGraphEntities) {
    return {
      intent: "new_project",
      decision: "CHECK_GRAPH_CONFLICT",
      reason:
        "Fallback: existing project with knowledge graph detected, routing to conflict resolution.",
    };
  }

  if (input.hasExistingProject && input.productContext) {
    return {
      intent: "project_evolution",
      decision: "ASK_CLARIFICATION",
      reason: "请您进一步澄清以便生成高质量的输出。",
      form_title: "确认需求",
      form_description: "为了更好地帮你推进项目，我需要先确认几个关键信息。",
      questions: [
        {
          id: "goal",
          label: "你这次最想完成的目标是什么？",
          type: "textarea",
          required: true,
          placeholder: "请描述你的具体需求或目标...",
        },
        {
          id: "scope",
          label: "这次改动涉及哪些范围？",
          type: "textarea",
          required: true,
          placeholder: "例如：特定模块、页面、流程或功能...",
        },
        {
          id: "users",
          label: "主要给谁使用？",
          type: "text",
          required: false,
          placeholder: "例如：内部员工、客户、运营团队...",
        },
        {
          id: "deliverable",
          label: "你希望最终产出什么？",
          type: "select",
          required: true,
          options: ["PRD（产品需求文档）", "实施方案", "页面原型说明", "技术方案", "其他"],
        },
        {
          id: "constraints",
          label: "有什么必须遵守的约束吗？",
          type: "text",
          required: false,
          placeholder: "例如：时间限制、技术栈、兼容性要求...",
        },
      ],
    };
  }

  return {
    intent: "new_project",
    decision: "ASK_CLARIFICATION",
      reason: "请您进一步澄清以便生成高质量的输出。",
      form_title: "确认需求",
    form_description: "为了更好地理解你的需求，我需要先确认几个关键信息。",
    questions: [
      {
        id: "goal",
        label: "这个项目最核心想解决什么问题？",
        type: "textarea",
        required: true,
        placeholder: "请描述项目的核心目标和要解决的问题...",
      },
      {
        id: "users",
        label: "主要给谁使用？",
        type: "text",
        required: true,
        placeholder: "例如：内部员工、客户、运营团队...",
      },
      {
        id: "scope",
        label: "你希望这个项目覆盖哪些功能范围？",
        type: "textarea",
        required: true,
        placeholder: "请描述核心功能和主要使用场景...",
      },
      {
        id: "deliverable",
        label: "你希望最终产出什么？",
        type: "select",
        required: true,
        options: ["PRD（产品需求文档）", "实施方案", "页面原型说明", "技术方案", "其他（请在下一题补充）"],
      },
      {
        id: "constraints",
        label: "有什么必须遵守的约束吗？",
        type: "textarea",
        required: false,
        placeholder: "例如：时间限制、技术栈、兼容性要求、预算限制...",
      },
    ],
  };
}

/**
 * 将 Pre-Orch 澄清结果格式化为 question-form XML 块，
 * 与 Conversation Agent 生成的 question-form 格式完全兼容。
 */
export function formatPreOrchQuestionForm(result: PreOrchResult): string {
  const form = {
    description: result.form_description ?? "我需要确认几个关键信息。",
    questions: result.questions ?? [],
    submitLabel: "提交",
  };

  const title = escapeAttribute(result.form_title ?? "确认需求");
  const formId = `${ORCHESTRATOR_CLARIFICATION_FORM_PREFIX}-${Date.now()}`;

  return `<question-form id="${formId}" title="${title}">\n${JSON.stringify(
    form,
    null,
    2,
  )}\n</question-form>`;
}

/**
 * 标识该 Form ID 是否来自 Pre-Orchestrator 的澄清表单。
 */
export function isPreOrchClarificationFormId(formId: string): boolean {
  return formId.startsWith(ORCHESTRATOR_CLARIFICATION_FORM_PREFIX);
}

/**
 * 标识该 Form ID 是否来自 Pre-Orchestrator 的知识图谱冲突表单。
 */
export function isPreOrchGraphConflictFormId(formId: string): boolean {
  return formId.startsWith(ORCHESTRATOR_GRAPH_CONFLICT_FORM_PREFIX);
}

/**
 * 生成知识图谱冲突确认表单。
 * 当用户在新工作区请求新项目但当前工作区已有知识图谱时，要求用户选择处理方式。
 */
export function formatPreOrchGraphConflictForm(): string {
  const form = {
    description:
      "当前工作区已存在一个产品知识图谱。请选择如何处理新项目：",
    questions: [
      {
        id: "action",
        label: "如何处理当前知识图谱？",
        type: "radio",
        required: true,
        options: [
          "删除当前知识图谱，并在当前工作区开始新项目",
          "创建新的工作区开始新项目",
        ],
      },
    ],
    submitLabel: "确认",
  };

  const formId = `${ORCHESTRATOR_GRAPH_CONFLICT_FORM_PREFIX}-${Date.now()}`;
  const title = escapeAttribute("知识图谱冲突");

  return `<question-form id="${formId}" title="${title}">\n${JSON.stringify(
    form,
    null,
    2,
  )}\n</question-form>`;
}

/**
 * 解析知识图谱冲突表单答案，返回用户选择的操作。
 */
export function parseGraphConflictAction(
  content: string,
): "replace_current_graph" | "create_new_workspace" | null {
  const normalized = content.toLowerCase();
  if (/创建新的工作区|新建工作区|create (a )?new workspace/.test(normalized)) {
    return "create_new_workspace";
  }
  if (/删除当前知识图谱|替换当前|delete .*graph|replace .*graph/.test(normalized)) {
    return "replace_current_graph";
  }
  return null;
}

/**
 * 转义 tagged block 属性值，避免标题或 ID 破坏 question-form 标签。
 */
function escapeAttribute(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/"/g, "&quot;");
}
