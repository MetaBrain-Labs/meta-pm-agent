/**
 * 知识图谱工具
 *
 * 提供产品知识图谱的结构化操作工具集，包括一个读取工具和六个强类型写入工具。
 * 所有操作基于内存中的 ProductKnowledgeGraph 状态对象，不再依赖文件系统 I/O。
 * 工具直接变更传入的状态对象引用，工具返回 JSON 结构化结果供上层收集与持久化。
 *
 * Responsibilities:
 * - createKnowledgeGraphTools()：构建 1 个读取 + 6 个结构化写入工具
 * - 工具强制 Zod 校验输入参数
 * - 工具返回 StructuredToolCallResult JSON 字符串
 * - 工具将已验证的结构化数据追加到传入的 state 对象中
 *
 * Notes:
 * - 状态对象通过引用传递，同一 Executor 内多次工具调用会累积写入同一 state
 * - 工作流完成后由 API 层将结构化数据归档到数据库
 * - 不再写入运行时 markdown 文件
 */

import type { ProductKnowledgeGraph } from "@repo/shared";
import { tool } from "langchain/tools";
import { z } from "zod";
import {
  createGraphContextSummary,
  readGraphBySourceTasks,
} from "../product-workflow/common/context";

// ============================================================
// 类型常量与 Zod Schemas
// ============================================================

const ENTITY_TYPE_VALUES = [
  "Goal",
  "Requirement",
  "Evidence",
  "Decision",
  "Feature",
  "Component",
  "Metric",
  "Custom",
] as const;

const RELATION_TYPE_VALUES = [
  "Drives",
  "Satisfies",
  "Promotes",
  "Produces",
  "Constrains",
  "Implements",
  "Measures",
  "Validates",
  "References",
  "Composes",
  "Custom",
] as const;

const nodeInputSchema = z.object({
  id: z.string().min(1).describe("Unique node ID, e.g. G-001, D-003"),
  type: z.enum(ENTITY_TYPE_VALUES).describe("Entity type"),
  name: z.string().min(1).describe("Node name"),
  description: z
    .string()
    .min(1)
    .describe("Node description explaining its business meaning"),
  source_task_id: z.string().min(1).describe("Task ID that produced this node"),
  status: z
    .enum(["proposed", "confirmed", "deprecated"])
    .default("proposed")
    .describe("Node status"),
});

const relationInputSchema = z.object({
  id: z.string().min(1).describe("Unique relation ID, e.g. REL-001"),
  type: z.enum(RELATION_TYPE_VALUES).describe("Relation type"),
  source: z.string().min(1).describe("Source node ID"),
  target: z.string().min(1).describe("Target node ID"),
  description: z
    .string()
    .min(1)
    .describe("Relation description explaining the business connection"),
  source_task_id: z
    .string()
    .min(1)
    .describe("Task ID that produced this relation"),
});

const decisionInputSchema = z.object({
  id: z.string().min(1).describe("Decision ID, e.g. D-001"),
  text: z
    .string()
    .min(1)
    .describe("Decision text including choice, rationale, and risk assessment"),
});

const riskInputSchema = z.object({
  id: z.string().min(1).describe("Risk ID, e.g. RISK-001"),
  text: z
    .string()
    .min(1)
    .describe("Risk description including impact and mitigation"),
});

const openQuestionInputSchema = z.object({
  id: z
    .string()
    .min(1)
    .describe(
      "Stable question ID used for internal tracking, e.g. OQ-001. Do not translate this value.",
    ),

  user_language: z
    .enum(["zh", "en"])
    .describe(
      'Language used for all user-facing content. Use "zh" for Simplified Chinese and "en" for English.',
    ),

  text: z
    .string()
    .min(1)
    .describe(
      [
        "The exact user-facing question asking for missing information or confirmation.",
        "The text MUST be written in the language specified by user_language.",
        'For "zh", write entirely in natural Simplified Chinese.',
        'For "en", write entirely in natural English.',
        "Do not translate IDs, enum values, agent IDs, task IDs, graph IDs, URLs, or technical identifiers.",
        "Do not default to English.",
        "Ask one clear and directly answerable question only.",
      ].join(" "),
    ),
});

const blockerInputSchema = z.object({
  category: z
    .enum(["hard_conflict", "runtime_error"])
    .describe("Hard blocker type that requires human input before continuing"),
  title: z.string().min(1).describe("Short blocker title"),
  details: z
    .string()
    .min(1)
    .describe("Concrete contradiction or execution error details"),
  needed_user_input: z
    .string()
    .min(1)
    .describe("The exact user information needed to unblock this task"),
});

const graphQuerySchema = z.object({
  ids: z.array(z.string().min(1)).optional().describe("Exact graph item IDs"),
  source_task_ids: z
    .array(z.string().min(1))
    .optional()
    .describe("Source task IDs to retrieve"),
  query: z.string().optional().describe("Keyword query for names/descriptions"),
  limit: z
    .number()
    .int()
    .positive()
    .default(12)
    .describe(
      "Requested result limit. The tool clamps large values internally.",
    ),
});

/**
 * 工具调用返回的 JSON 结构化结果，供 SSE 透传与持久化层收集。
 */
export interface StructuredToolCallResult<T = unknown> {
  action: string;
  count: number;
  items: T[];
}

/**
 * 创建知识图谱操作工具集（基于内存状态对象，不写文件）。
 */
export function createKnowledgeGraphTools(state: ProductKnowledgeGraph) {
  return [
    // ── 读取 ──
    tool(
      async () => {
        return stringifyToolResult({
          action: "read_summary",
          ...createGraphContextSummary(state),
        });
      },
      {
        name: "kg_file_read",
        description:
          "Read a compact summary of the current product knowledge graph state before planning updates. This does not return the full graph.",
        schema: z.object({}),
      },
    ),
    tool(
      async () => {
        return stringifyToolResult({
          action: "read_summary",
          ...createGraphContextSummary(state),
        });
      },
      {
        name: "kg_file_read_summary",
        description:
          "Read counts and recent nodes from the product knowledge graph.",
        schema: z.object({}),
      },
    ),
    tool(
      async ({ ids = [], source_task_ids = [], query = "", limit = 12 }) => {
        const items = queryNodes(state, {
          ids,
          source_task_ids,
          query,
          limit,
        });
        return stringifyToolResult({
          action: "query_nodes",
          count: items.length,
          items,
        });
      },
      {
        name: "kg_file_query_nodes",
        description:
          "Query graph nodes by exact IDs, source task IDs, or a small keyword query. Use this instead of reading the full graph.",
        schema: graphQuerySchema,
      },
    ),
    tool(
      async ({ ids = [], source_task_ids = [], query = "", limit = 12 }) => {
        const items = queryRelations(state, {
          ids,
          source_task_ids,
          query,
          limit,
        });
        return stringifyToolResult({
          action: "query_relations",
          count: items.length,
          items,
        });
      },
      {
        name: "kg_file_query_relations",
        description:
          "Query graph relations by relation IDs, source task IDs, endpoint node IDs, or a small keyword query.",
        schema: graphQuerySchema,
      },
    ),
    tool(
      async ({ task_id, limit = 12 }) => {
        const effectiveLimit = normalizeLimit(limit);
        return stringifyToolResult({
          action: "read_task_delta",
          requested_limit: limit,
          effective_limit: effectiveLimit,
          ...readGraphBySourceTasks(state, [task_id], effectiveLimit),
        });
      },
      {
        name: "kg_file_read_task_delta",
        description:
          "Read the compact graph delta produced by a single source task ID.",
        schema: z.object({
          task_id: z.string().min(1),
          limit: z
            .number()
            .int()
            .positive()
            .default(12)
            .describe(
              "Requested result limit. The tool clamps large values internally.",
            ),
        }),
      },
    ),
    tool(
      async ({ source_task_ids, limit = 12 }) => {
        const effectiveLimit = normalizeLimit(limit);
        return stringifyToolResult({
          action: "read_by_source_task",
          requested_limit: limit,
          effective_limit: effectiveLimit,
          ...readGraphBySourceTasks(state, source_task_ids, effectiveLimit),
        });
      },
      {
        name: "kg_file_read_by_source_task",
        description:
          "Read compact graph nodes and relations produced by one or more source task IDs.",
        schema: z.object({
          source_task_ids: z.array(z.string().min(1)).min(1),
          limit: z
            .number()
            .int()
            .positive()
            .default(12)
            .describe(
              "Requested result limit. The tool clamps large values internally.",
            ),
        }),
      },
    ),
    // ── 摘要 ──
    tool(
      async ({ summary }) => {
        const normalizedSummary = summary.trim();
        state.summary.push(normalizedSummary);
        return JSON.stringify(
          {
            action: "add_summary",
            count: 1,
            items: [{ summary: normalizedSummary }],
          } satisfies StructuredToolCallResult,
          null,
          2,
        );
      },
      {
        name: "kg_file_add_summary",
        description:
          "Write the execution summary for the current Executor task. Call this first before writing nodes and relations.",
        schema: z.object({
          summary: z
            .string()
            .min(1)
            .describe("Execution summary describing the output of this task"),
        }),
      },
    ),
    // ── 节点 ──
    tool(
      async ({ nodes }) => {
        const validated = nodes.map((n) => nodeInputSchema.parse(n));
        state.entities.push(...validated);
        return JSON.stringify(
          {
            action: "add_nodes",
            count: validated.length,
            items: validated as unknown[],
          } satisfies StructuredToolCallResult,
          null,
          2,
        );
      },
      {
        name: "kg_file_add_nodes",
        description:
          "Write structured nodes to the knowledge graph. Each node must have: id, type, name, description, source_task_id, status. Allowed types: Goal/Requirement/Evidence/Decision/Feature/Component/Metric/Risk/OpenQuestion/Custom. Prefer kg_file_add_risks and kg_file_add_open_questions for uncertainty records.",
        schema: z.object({
          nodes: z
            .array(nodeInputSchema)
            .min(1)
            .describe("Array of nodes to write, at least 1 node required"),
        }),
      },
    ),
    // ── 关系 ──
    tool(
      async ({ relations }) => {
        const validated = relations.map((r) => relationInputSchema.parse(r));
        state.relations.push(...validated);
        return JSON.stringify(
          {
            action: "add_relations",
            count: validated.length,
            items: validated as unknown[],
          } satisfies StructuredToolCallResult,
          null,
          2,
        );
      },
      {
        name: "kg_file_add_relations",
        description:
          "Write structured relations to the knowledge graph. Each relation must have: id, type, source, target, description, source_task_id. Allowed types: Drives/Satisfies/Promotes/Produces/Constrains/Implements/Measures/Validates/References/Composes/Custom. source/target must reference existing node IDs.",
        schema: z.object({
          relations: z
            .array(relationInputSchema)
            .min(1)
            .describe(
              "Array of relations to write, at least 1 relation required",
            ),
        }),
      },
    ),
    // ── 决策 ──
    tool(
      async ({ decisions }) => {
        const validated = decisions.map((d) => decisionInputSchema.parse(d));
        state.decisions.push(...validated);
        return JSON.stringify(
          {
            action: "add_decisions",
            count: validated.length,
            items: validated as unknown[],
          } satisfies StructuredToolCallResult,
          null,
          2,
        );
      },
      {
        name: "kg_file_add_decisions",
        description:
          "Write structured decisions to the knowledge graph. Each decision has id, text, and optional source_task_id fields.",
        schema: z.object({
          decisions: z
            .array(decisionInputSchema)
            .min(1)
            .describe("Array of decisions to write"),
        }),
      },
    ),
    // ── 风险 ──
    tool(
      async ({ risks }) => {
        const validated = risks.map((r) => riskInputSchema.parse(r));
        state.risks.push(...validated);
        return JSON.stringify(
          {
            action: "add_risks",
            count: validated.length,
            items: validated as unknown[],
          } satisfies StructuredToolCallResult,
          null,
          2,
        );
      },
      {
        name: "kg_file_add_risks",
        description:
          "Write structured risks to the knowledge graph. Each risk has id, text, and optional source_task_id fields.",
        schema: z.object({
          risks: z
            .array(riskInputSchema)
            .min(1)
            .describe("Array of risks to write"),
        }),
      },
    ),
    // ── 待确认问题 ──
    tool(
      async ({ questions }) => {
        const validated = questions.map((q) =>
          openQuestionInputSchema.parse(q),
        );
        state.open_questions.push(...validated);
        return JSON.stringify(
          {
            action: "add_open_questions",
            count: validated.length,
            items: validated as unknown[],
          } satisfies StructuredToolCallResult,
          null,
          2,
        );
      },
      {
        name: "kg_file_add_open_questions",
        description:
          "Write structured open questions to the knowledge graph. Each question has id, text, and optional source_task_id fields.",
        schema: z.object({
          questions: z
            .array(openQuestionInputSchema)
            .min(1)
            .describe("Array of questions to write"),
        }),
      },
    ),
    tool(
      async (input) => {
        const blocker = blockerInputSchema.parse(input);
        return stringifyToolResult({
          action: "raise_blocker",
          count: 1,
          items: [blocker],
        });
      },
      {
        name: "kg_file_raise_blocker",
        description:
          "Raise a hard conflict or program/runtime blocker that cannot be resolved by assumptions. Use this only when execution must pause for Human-in-the-Loop input.",
        schema: blockerInputSchema,
      },
    ),
  ];
}

/**
 * 查询符合条件的节点，默认限制返回数量。
 */
function queryNodes(
  state: ProductKnowledgeGraph,
  {
    ids,
    source_task_ids,
    query,
    limit,
  }: {
    ids: string[];
    source_task_ids: string[];
    query: string;
    limit: number;
  },
) {
  const idSet = new Set(ids);
  const sourceTaskIdSet = new Set(source_task_ids);
  const normalizedQuery = query.trim().toLowerCase();

  return state.entities
    .filter((entity) => {
      if (idSet.size > 0 && idSet.has(entity.id)) return true;
      if (
        sourceTaskIdSet.size > 0 &&
        entity.source_task_id &&
        sourceTaskIdSet.has(entity.source_task_id)
      ) {
        return true;
      }
      if (!normalizedQuery) {
        return idSet.size === 0 && sourceTaskIdSet.size === 0;
      }
      return matchesQuery(
        [entity.id, entity.type, entity.name, entity.description ?? ""].join(
          " ",
        ),
        normalizedQuery,
      );
    })
    .slice(0, normalizeLimit(limit));
}

/**
 * 查询符合条件的关系，支持按关系 ID、来源任务或端点节点过滤。
 */
function queryRelations(
  state: ProductKnowledgeGraph,
  {
    ids,
    source_task_ids,
    query,
    limit,
  }: {
    ids: string[];
    source_task_ids: string[];
    query: string;
    limit: number;
  },
) {
  const idSet = new Set(ids);
  const sourceTaskIdSet = new Set(source_task_ids);
  const normalizedQuery = query.trim().toLowerCase();

  return state.relations
    .filter((relation) => {
      if (
        idSet.size > 0 &&
        (idSet.has(relation.id) ||
          idSet.has(relation.source) ||
          idSet.has(relation.target))
      ) {
        return true;
      }
      if (
        sourceTaskIdSet.size > 0 &&
        relation.source_task_id &&
        sourceTaskIdSet.has(relation.source_task_id)
      ) {
        return true;
      }
      if (!normalizedQuery) {
        return idSet.size === 0 && sourceTaskIdSet.size === 0;
      }
      return matchesQuery(
        [
          relation.id,
          relation.type,
          relation.source,
          relation.target,
          relation.description ?? "",
        ].join(" "),
        normalizedQuery,
      );
    })
    .slice(0, normalizeLimit(limit));
}

/**
 * 判断文本是否匹配工具查询词。
 */
function matchesQuery(text: string, normalizedQuery: string): boolean {
  return text.toLowerCase().includes(normalizedQuery);
}

/**
 * 限制工具查询返回量，避免重新制造大上下文。
 */
function normalizeLimit(limit: number): number {
  return Math.min(Math.max(limit, 1), 30);
}

/**
 * 统一格式化工具结果。
 */
function stringifyToolResult(value: unknown): string {
  return JSON.stringify(value, null, 2);
}
