/**
 * 知识图谱工具
 *
 * 提供产品知识图谱的结构化操作工具集，包括一个读取工具和六个强类型写入工具。
 * 所有操作基于内存中的 ProductKnowledgeGraph 状态对象，不再依赖文件系统 I/O。
 * 工具直接变更传入的状态对象引用，工具返回 JSON 结构化结果供上层收集与持久化。
 *
 * Responsibilities:
 * - createKnowledgeGraphTools()：构建 6 个读取 + 6 个结构化写入工具
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
import { randomUUID } from "node:crypto";
import { tool } from "langchain/tools";
import { z } from "zod";
import {
  createGraphContextSummary,
  readGraphBySourceTasks,
} from "../product-workflow/common/context";
import { isKnowledgeGraphRelationDirectionValid } from "../product-workflow/common/knowledge-graph";
import type { VerifiedWebSource } from "./web-search-tool";

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
  id: z
    .string()
    .min(1)
    .optional()
    .describe(
      "Optional legacy node ID hint; the runtime always allocates the persisted ID",
    ),
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
  provenance: z
    .array(
      z.discriminatedUnion("kind", [
        z.object({
          kind: z.literal("user_input"),
          user_input_index: z.number().int().positive(),
        }),
        z.object({
          kind: z.literal("web_search"),
          source_id: z.string().min(1),
          title: z.string().min(1),
          url: z.string().url(),
        }),
        z.object({
          kind: z.literal("existing_graph"),
          node_id: z.string().min(1),
        }),
      ]),
    )
    .min(1)
    .describe(
      "Auditable sources. Use user_input with an exact input index, web_search with an actual returned source, or existing_graph with an active node ID.",
    ),
});

const nodeDeprecationInputSchema = z.object({
  node_id: z.string().min(1).describe("Existing active node ID to deprecate"),
  reason: z
    .string()
    .min(1)
    .max(500)
    .describe("Concrete user answer or graph conflict that makes the node obsolete"),
  replacement_node_id: z
    .string()
    .min(1)
    .optional()
    .describe("Optional active replacement node already present in the graph"),
  source_task_id: z
    .string()
    .min(1)
    .describe("Current supplement task ID performing the deprecation"),
});

const relationInputSchema = z.object({
  id: z
    .string()
    .min(1)
    .optional()
    .describe("Optional relation ID; the runtime assigns one when omitted or duplicated"),
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
  source_task_id: z.string().min(1).optional().describe("Source task ID"),
});

const riskInputSchema = z.object({
  id: z
    .string()
    .min(1)
    .optional()
    .describe(
      "Optional legacy risk ID hint; the runtime always allocates the persisted ID",
    ),
  text: z
    .string()
    .min(1)
    .describe("Risk description including impact and mitigation"),
});

const openQuestionInputSchema = z.object({
  id: z
    .string()
    .min(1)
    .optional()
    .describe(
      "Optional legacy question ID hint. Omit it because the runtime always allocates the persisted OQ-* ID.",
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
  blocking: z
    .boolean()
    .describe(
      "Set true only when the current workflow cannot complete usefully without the answer; otherwise set false for backlog questions.",
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
  skipped?: Array<{ id: string; reason: string }>;
}

/**
 * 单个 Executor 的图谱写入权限，由其 Profile 在运行时注入。
 */
export interface KnowledgeGraphToolPolicy {
  allowedEntityTypes?: readonly ProductKnowledgeGraph["entities"][number]["type"][];
  allowedRelationTypes?: readonly ProductKnowledgeGraph["relations"][number]["type"][];
  requiredBlockingOpenQuestionCount?: number;
  allowNodeDeprecation?: boolean;
  sourceTaskId?: string;
  userInput?: ReadonlyArray<{ index: number; content: string }>;
  verifiedWebSources?: ReadonlyMap<string, VerifiedWebSource>;
}

/**
 * 创建知识图谱操作工具集（基于内存状态对象，不写文件）。
 */
export function createKnowledgeGraphTools(
  state: ProductKnowledgeGraph,
  policy: KnowledgeGraphToolPolicy = {},
) {
  const requiredBlockingOpenQuestionCount =
    policy.requiredBlockingOpenQuestionCount ?? 0;
  const openQuestionsSchema = z
    .array(openQuestionInputSchema)
    .min(1)
    .refine(
      (questions) =>
        questions.filter((question) => question.blocking).length >=
        requiredBlockingOpenQuestionCount,
      `Include at least ${requiredBlockingOpenQuestionCount} questions with blocking=true.`,
    )
    .describe(
      `Array of questions to write. At least ${requiredBlockingOpenQuestionCount} must use blocking=true.`,
    );

  return [
    // 从当前上下文中读取 product context
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
    // 从当前上下文中读取 nodes
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
    // 从当前上下文中读取 relations
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
    // 从当前上下文中读取 依赖任务产生的 nodes 和 relations
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

    // 将 summary 写入当前上下文中
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
          "Write an optional execution summary after structured graph items have been committed. Runtime-managed Executors generate this summary automatically.",
        schema: z.object({
          summary: z
            .string()
            .min(1)
            .describe("Execution summary describing the output of this task"),
        }),
      },
    ),
    // 将 nodes 写入当前上下文中
    tool(
      async ({ nodes }) => {
        const parsedNodes = nodes.map((node) => nodeInputSchema.parse(node));
        validateNodeWrites(parsedNodes, state, policy);
        const validated = allocatePersistedIds(
          parsedNodes,
          (node) => ENTITY_ID_PREFIXES[node.type],
        );
        const authorized = filterAuthorizedItems(
          validated,
          policy.allowedEntityTypes,
          "unauthorized_entity_type",
        );
        const appendResult = filterAppendOnlyItems(
          authorized.items,
          state.entities.map((item) => item.id),
        );
        state.entities.push(...appendResult.items);
        return JSON.stringify(
          {
            action: "add_nodes",
            count: appendResult.items.length,
            items: compactWrittenItems(appendResult.items),
            skipped: [...authorized.skipped, ...appendResult.skipped],
          } satisfies StructuredToolCallResult,
          null,
          2,
        );
      },
      {
        name: "kg_file_add_nodes",
        description:
          `Append structured nodes to the knowledge graph. Omit id: the runtime atomically allocates the persisted ID and returns it for later relation or decision calls. Every node requires auditable provenance. Evidence accepts only explicit user_input or verified web_search provenance. Entity types outside this Agent's authorization are skipped. Allowed types for this Agent: ${(policy.allowedEntityTypes ?? ENTITY_TYPE_VALUES).join("/")}. Prefer kg_file_add_risks and kg_file_add_open_questions for uncertainty records.`,
        schema: z.object({
          nodes: z
            .array(nodeInputSchema)
            .min(1)
            .describe("Array of nodes to write, at least 1 node required"),
        }),
      },
    ),
    // 补充流程通过受控状态变更退役冲突节点，保留完整历史。
    tool(
      async ({ deprecations }) => {
        if (!policy.allowNodeDeprecation) {
          throw new Error(
            "Node deprecation is allowed only during a supplement workflow.",
          );
        }

        const parsed = deprecations.map((item) =>
          nodeDeprecationInputSchema.parse(item),
        );
        const items: ProductKnowledgeGraph["entities"] = [];
        const skipped: Array<{ id: string; reason: string }> = [];
        for (const deprecation of parsed) {
          const nodeIndex = state.entities.findIndex(
            (entity) => entity.id === deprecation.node_id,
          );
          const existing = state.entities[nodeIndex];
          if (!existing) {
            skipped.push({
              id: deprecation.node_id,
              reason: "missing_deprecation_target",
            });
            continue;
          }
          if (
            policy.allowedEntityTypes &&
            !policy.allowedEntityTypes.includes(existing.type)
          ) {
            skipped.push({
              id: existing.id,
              reason: `unauthorized_entity_type:${existing.type}`,
            });
            continue;
          }
          if (
            policy.sourceTaskId &&
            deprecation.source_task_id !== policy.sourceTaskId
          ) {
            skipped.push({
              id: existing.id,
              reason: "source_task_id_mismatch",
            });
            continue;
          }
          const replacement = deprecation.replacement_node_id
            ? state.entities.find(
                (entity) =>
                  entity.id === deprecation.replacement_node_id &&
                  entity.status !== "deprecated",
              )
            : undefined;
          if (deprecation.replacement_node_id && !replacement) {
            skipped.push({
              id: existing.id,
              reason: "missing_active_replacement_node",
            });
            continue;
          }

          const deprecated = {
            ...existing,
            status: "deprecated" as const,
            deprecated_by_task_id: deprecation.source_task_id,
            deprecation_reason: deprecation.reason,
            replacement_node_id: replacement?.id,
          };
          state.entities[nodeIndex] = deprecated;
          items.push(deprecated);
        }

        return stringifyToolResult({
          action: "deprecate_nodes",
          count: items.length,
          items: items.map((item) => ({
            id: item.id,
            status: item.status,
            replacement_node_id: item.replacement_node_id,
          })),
          skipped,
        } satisfies StructuredToolCallResult);
      },
      {
        name: "kg_file_deprecate_nodes",
        description:
          "Deprecate active graph nodes during a supplement workflow without deleting history. Use the domain owner for each node type. Provide the concrete correction reason and an active replacement node when one exists.",
        schema: z.object({
          deprecations: z
            .array(nodeDeprecationInputSchema)
            .min(1)
            .describe("Nodes to deprecate, at least one item required"),
        }),
      },
    ),
    // 将 relations 写入当前上下文中
    tool(
      async ({ relations }) => {
        const validated = allocatePersistedIds(
          relations.map((r) => relationInputSchema.parse(r)),
          () => "REL",
        );
        const appendResult = filterAppendOnlyRelations(
          validated,
          state,
          policy.allowedRelationTypes,
        );
        state.relations.push(...appendResult.items);
        return JSON.stringify(
          {
            action: "add_relations",
            count: appendResult.items.length,
            items: compactWrittenItems(appendResult.items),
            skipped: appendResult.skipped,
          } satisfies StructuredToolCallResult,
          null,
          2,
        );
      },
      {
        name: "kg_file_add_relations",
        description:
          `Append structured relations to the knowledge graph. Omit id: the runtime atomically allocates the persisted REL-* ID. Use persisted node IDs returned by kg_file_add_nodes as endpoints. Unauthorized relation types, missing endpoints, and invalid typed-relation directions are skipped. Allowed types for this Agent: ${(policy.allowedRelationTypes ?? RELATION_TYPE_VALUES).join("/")}; Custom remains available only for a clearly described non-canonical connection.`,
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
    // 将 decisions 写入当前上下文中
    tool(
      async ({ decisions }) => {
        const validated = decisions.map((d) => decisionInputSchema.parse(d));
        const decisionNodeIds = new Set(
          state.entities
            .filter((entity) => entity.type === "Decision")
            .map((entity) => entity.id),
        );
        const authorized =
          policy.allowedEntityTypes?.includes("Decision") === false
            ? {
                items: [] as typeof validated,
                skipped: validated.map((item) => ({
                  id: item.id,
                  reason: "unauthorized_entity_type:Decision",
                })),
              }
            : {
                items: validated.filter((item) => decisionNodeIds.has(item.id)),
                skipped: validated
                  .filter((item) => !decisionNodeIds.has(item.id))
                  .map((item) => ({
                    id: item.id,
                    reason: "missing_canonical_decision_node",
                  })),
              };
        const appendResult = filterAppendOnlyItems(
          authorized.items,
          state.decisions.map((item) => item.id),
        );
        state.decisions.push(...appendResult.items);
        return JSON.stringify(
          {
            action: "add_decisions",
            count: appendResult.items.length,
            items: compactWrittenItems(appendResult.items),
            skipped: [...authorized.skipped, ...appendResult.skipped],
          } satisfies StructuredToolCallResult,
          null,
          2,
        );
      },
      {
        name: "kg_file_add_decisions",
        description:
          `Append decision metadata for canonical Decision nodes already written through kg_file_add_nodes. Every item must reuse the exact D-* node id; DEC-* aliases and metadata without a matching Decision node are rejected. Duplicate IDs are skipped instead of updated. This Agent ${policy.allowedEntityTypes?.includes("Decision") === false ? "is not authorized" : "is authorized"} to write Decision records.`,
        schema: z.object({
          decisions: z
            .array(decisionInputSchema)
            .min(1)
            .describe("Array of decisions to write"),
        }),
      },
    ),
    // 将 risks 写入当前上下文中
    tool(
      async ({ risks }) => {
        const validated = allocatePersistedIds(
          risks.map((r) => riskInputSchema.parse(r)),
          () => "RISK",
        );
        const appendResult = filterAppendOnlyItems(
          validated,
          state.risks.map((item) => item.id),
        );
        state.risks.push(...appendResult.items);
        return JSON.stringify(
          {
            action: "add_risks",
            count: appendResult.items.length,
            items: compactWrittenItems(appendResult.items),
            skipped: appendResult.skipped,
          } satisfies StructuredToolCallResult,
          null,
          2,
        );
      },
      {
        name: "kg_file_add_risks",
        description:
          "Write structured risks to the knowledge graph. Omit id: the runtime atomically allocates the persisted RISK-* ID. Each risk also has text and optional source_task_id fields.",
        schema: z.object({
          risks: z
            .array(riskInputSchema)
            .min(1)
            .describe("Array of risks to write"),
        }),
      },
    ),
    // 将 open questions 写入当前上下文中
    tool(
      async ({ questions }) => {
        const validated = allocatePersistedIds(
          questions.map((q) => openQuestionInputSchema.parse(q)),
          () => "OQ",
        );
        const appendResult = filterAppendOnlyItems(
          validated,
          state.open_questions.map((item) => item.id),
        );
        state.open_questions.push(...appendResult.items);
        return JSON.stringify(
          {
            action: "add_open_questions",
            count: appendResult.items.length,
            items: compactWrittenItems(appendResult.items),
            skipped: appendResult.skipped,
          } satisfies StructuredToolCallResult,
          null,
          2,
        );
      },
      {
        name: "kg_file_add_open_questions",
        description:
          `Append structured open questions to the knowledge graph. Omit id: the runtime atomically allocates the persisted OQ-* ID. Each question must include text and mark whether it blocks current workflow completion. This task requires at least ${requiredBlockingOpenQuestionCount} questions with blocking=true in this call.`,
        schema: z.object({
          questions: openQuestionsSchema,
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

type NodeWriteInput = z.infer<typeof nodeInputSchema>;

/**
 * 在状态写入前校验来源真实性和用户未声明的基础设施细节。
 */
function validateNodeWrites(
  nodes: NodeWriteInput[],
  state: ProductKnowledgeGraph,
  policy: KnowledgeGraphToolPolicy,
): void {
  const userInputByIndex = new Map(
    (policy.userInput ?? []).map((item) => [item.index, item.content] as const),
  );
  const entityById = new Map(state.entities.map((entity) => [entity.id, entity]));
  const allUserInput = [...userInputByIndex.values()].join("\n");
  const errors: string[] = [];

  for (const node of nodes) {
    if (node.status === "deprecated") {
      errors.push(
        `${node.type} "${node.name}": new_nodes_cannot_start_deprecated; use kg_file_deprecate_nodes for an existing active node`,
      );
    }
    if (policy.sourceTaskId && node.source_task_id !== policy.sourceTaskId) {
      errors.push(`${node.type} "${node.name}": source_task_id_mismatch`);
    }

    const referencedUserInput: string[] = [];
    let hasEvidenceSource = false;
    for (const provenance of node.provenance) {
      if (provenance.kind === "user_input") {
        const source = userInputByIndex.get(provenance.user_input_index);
        if (!source) {
          errors.push(
            `${node.type} "${node.name}": unknown_user_input_index:${provenance.user_input_index}`,
          );
          continue;
        }
        referencedUserInput.push(source);
        hasEvidenceSource = true;
        continue;
      }

      if (provenance.kind === "existing_graph") {
        const source = entityById.get(provenance.node_id);
        if (!source || source.status === "deprecated") {
          errors.push(
            `${node.type} "${node.name}": missing_active_graph_source:${provenance.node_id}`,
          );
        }
        continue;
      }

      const verified = policy.verifiedWebSources?.get(provenance.source_id);
      if (!verified) {
        errors.push(
          `${node.type} "${node.name}": web_source_id_missing:${provenance.source_id}`,
        );
        continue;
      }
      if (
        normalizeAuditText(verified.url) !== normalizeAuditText(provenance.url)
      ) {
        errors.push(
          `${node.type} "${node.name}": web_source_url_mismatch:${provenance.source_id}`,
        );
        continue;
      }
      if (
        normalizeAuditText(verified.title) !==
        normalizeAuditText(provenance.title)
      ) {
        errors.push(
          `${node.type} "${node.name}": web_source_title_mismatch:${provenance.source_id}`,
        );
        continue;
      }
      hasEvidenceSource = true;
    }

    if (node.type === "Evidence" && !hasEvidenceSource) {
      errors.push(
        `Evidence "${node.name}": evidence_requires_user_input_or_verified_web_search`,
      );
    }

    const nodeText = `${node.name} ${node.description}`;
    if (
      node.type === "Evidence" &&
      !node.provenance.some((item) => item.kind === "web_search")
    ) {
      const sourceNumbers = new Set(
        referencedUserInput.flatMap(extractNumericClaims),
      );
      const unsupportedNumbers = extractNumericClaims(nodeText).filter(
        (value) => !sourceNumbers.has(value),
      );
      if (unsupportedNumbers.length > 0) {
        errors.push(
          `Evidence "${node.name}": unsupported_numeric_claims:${[
            ...new Set(unsupportedNumbers),
          ].join(",")}`,
        );
      }
    }

    const unsupportedInfrastructureTerms = findUnsupportedInfrastructureTerms(
      nodeText,
      allUserInput,
    );
    if (unsupportedInfrastructureTerms.length > 0) {
      errors.push(
        `${node.type} "${node.name}": unsupported_infrastructure_scope:${unsupportedInfrastructureTerms.join(",")}`,
      );
    }
  }

  if (errors.length > 0) {
    throw new Error(`Node provenance validation failed: ${errors.join("; ")}`);
  }
}

/**
 * 提取数字、百分比和容量值，阻止用户未提供的精确数字伪装成 Evidence。
 */
function extractNumericClaims(value: string): string[] {
  return (
    value
      .normalize("NFKC")
      .toLowerCase()
      .match(/\b\d+(?:\.\d+)?\s*(?:%|ms|s|mbps|gbps|kb|mb|gb|tb|万|亿)?\b/g) ??
    []
  ).map((item) => item.replace(/\s+/g, ""));
}

/**
 * 检查用户未声明的高风险基础设施范围，要求 Executor 改写成 Risk。
 */
function findUnsupportedInfrastructureTerms(
  nodeText: string,
  userInput: string,
): string[] {
  const terms = [
    ["bandwidth", /bandwidth|带宽/i],
    ["data-residency", /data\s+(?:residency|locality)|数据(?:地域|驻留|主权)/i],
    ["deployment-topology", /deployment\s+topology|部署拓扑/i],
    ["hosting-model", /hosting\s+model|托管模式/i],
    ["deployment-region", /deployment\s+region|部署地域|部署区域/i],
  ] as const;

  return terms
    .filter(
      ([, pattern]) => pattern.test(nodeText) && !pattern.test(userInput),
    )
    .map(([name]) => name);
}

/**
 * 归一化来源文本，允许大小写和空白差异但不允许替换 URL 或标题。
 */
function normalizeAuditText(value: string): string {
  return value.normalize("NFKC").trim().replace(/\s+/g, " ").toLowerCase();
}

/**
 * 仅回显写入记录 ID，避免后续模型轮次重复携带完整图谱对象。
 */
function compactWrittenItems<T extends { id: string }>(
  items: T[],
): Array<{ id: string }> {
  return items.map(({ id }) => ({ id }));
}

/**
 * 不同实体类型使用稳定前缀，便于工具结果被后续关系和决策调用引用。
 */
const ENTITY_ID_PREFIXES: Record<(typeof ENTITY_TYPE_VALUES)[number], string> = {
  Goal: "G",
  Requirement: "R",
  Evidence: "E",
  Decision: "D",
  Feature: "F",
  Component: "COMP",
  Metric: "M",
  Custom: "CUS",
};

/**
 * 为一批图谱写入原子分配不可预测 ID，避免并行 Executor 基于相同快照产生冲突。
 */
function allocatePersistedIds<T extends { id?: string }>(
  items: T[],
  getPrefix: (item: T) => string,
): Array<Omit<T, "id"> & { id: string }> {
  return items.map(({ id: _legacyId, ...item }) => ({
    ...item,
    id: `${getPrefix(item as T)}-${randomUUID()}`,
  }));
}

/**
 * 过滤追加式写入中的重复 ID，避免 Executor 用旧 ID 模拟原地更新。
 */
function filterAppendOnlyItems<T extends { id: string }>(
  items: T[],
  existingIds: string[],
): { items: T[]; skipped: Array<{ id: string; reason: string }> } {
  const seenIds = new Set(existingIds);
  const accepted: T[] = [];
  const skipped: Array<{ id: string; reason: string }> = [];

  for (const item of items) {
    if (seenIds.has(item.id)) {
      skipped.push({
        id: item.id,
        reason: "duplicate_id_append_only_graph",
      });
      continue;
    }
    seenIds.add(item.id);
    accepted.push(item);
  }

  return { items: accepted, skipped };
}

/**
 * 在追加和端点校验前过滤 Agent Profile 未授权的结构化类型。
 */
function filterAuthorizedItems<T extends { id: string; type: string }>(
  items: T[],
  allowedTypes: readonly string[] | undefined,
  reasonPrefix: string,
): { items: T[]; skipped: Array<{ id: string; reason: string }> } {
  if (!allowedTypes) return { items, skipped: [] };

  const allowed = new Set(allowedTypes);
  const accepted: T[] = [];
  const skipped: Array<{ id: string; reason: string }> = [];
  for (const item of items) {
    if (allowed.has(item.type) || (reasonPrefix === "unauthorized_relation_type" && item.type === "Custom")) {
      accepted.push(item);
    } else {
      skipped.push({ id: item.id, reason: `${reasonPrefix}:${item.type}` });
    }
  }
  return { items: accepted, skipped };
}

/**
 * 过滤追加式关系写入，确保关系 ID 唯一且端点已存在于当前图谱。
 */
function filterAppendOnlyRelations<
  T extends ProductKnowledgeGraph["relations"][number],
>(
  relations: T[],
  state: ProductKnowledgeGraph,
  allowedTypes?: readonly ProductKnowledgeGraph["relations"][number]["type"][],
): { items: T[]; skipped: Array<{ id: string; reason: string }> } {
  const authorized = filterAuthorizedItems(
    relations,
    allowedTypes,
    "unauthorized_relation_type",
  );
  const appendResult = filterAppendOnlyItems(
    authorized.items,
    state.relations.map((item) => item.id),
  );
  const entityById = new Map(state.entities.map((item) => [item.id, item]));
  const accepted: T[] = [];
  const skipped = [...authorized.skipped, ...appendResult.skipped];

  for (const relation of appendResult.items) {
    const source = entityById.get(relation.source);
    const target = entityById.get(relation.target);
    if (!source || !target) {
      skipped.push({
        id: relation.id,
        reason: "missing_relation_endpoint",
      });
      continue;
    }
    if (
      !isKnowledgeGraphRelationDirectionValid(
        relation.type,
        source.type,
        target.type,
      )
    ) {
      skipped.push({
        id: relation.id,
        reason: `invalid_relation_direction:${source.type}--${relation.type}-->${target.type}`,
      });
      continue;
    }
    accepted.push(relation);
  }

  return { items: accepted, skipped };
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
