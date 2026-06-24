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
  id: z.string().min(1).describe("Question ID, e.g. OQ-001"),
  text: z
    .string()
    .min(1)
    .describe("Question text explaining what needs to be confirmed"),
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
export function createKnowledgeGraphTools(
  state: ProductKnowledgeGraph,
) {
  return [
    // ── 读取 ──
    tool(
      async () => {
        return JSON.stringify(
          {
            action: "read",
            entities: state.entities,
            relations: state.relations,
            decisions: state.decisions,
            risks: state.risks,
            open_questions: state.open_questions,
            summary: state.summary,
          },
          null,
          2,
        );
      },
      {
        name: "kg_file_read",
        description:
          "Read the current product knowledge graph state before planning updates.",
        schema: z.object({}),
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
          "Write structured nodes to the knowledge graph. Each node must have: id, type, name, description, source_task_id, status. Allowed types: Goal/Requirement/Evidence/Decision/Feature/Component/Metric/Custom.",
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
          "Write structured decisions to the knowledge graph. Each decision has id and text fields.",
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
          "Write structured risks to the knowledge graph. Each risk has id and text fields.",
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
          "Write structured open questions to the knowledge graph. Each question has id and text fields.",
        schema: z.object({
          questions: z
            .array(openQuestionInputSchema)
            .min(1)
            .describe("Array of questions to write"),
        }),
      },
    ),
  ];
}
