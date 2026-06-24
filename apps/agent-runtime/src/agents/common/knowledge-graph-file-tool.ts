/**
 * 知识图谱文件工具
 *
 * 提供受控的产品知识图谱 markdown 文件操作工具集，包括一个读取工具和
 * 六个强类型结构化写入工具。所有操作限定在 workspace-scoped
 * product-knowledge-graph.md 文件中。
 *
 * Responsibilities:
 * - createKnowledgeGraphFileHandle()：创建文件句柄（按 workspaceId 隔离）
 * - createKnowledgeGraphFileTools()：构建 1 个读取 + 6 个结构化写入工具
 * - getKnowledgeGraphFilePath()：计算 workspace-scoped 文件路径
 * - deleteWorkspaceKnowledgeGraphFile()：删除工作区图谱文件
 * - readWorkspaceKnowledgeGraphFile()：读取工作区图谱文件
 *
 * Notes:
 * - 文件操作绑定到当前 workspace 的 product-knowledge-graph.md
 * - 工作流完成后由 API 层归档到数据库后删除运行时文件
 * - 结构化工具强制 Zod 校验，写入 markdown 格式保持一致
 */

import { tool } from "langchain/tools";
import { z } from "zod";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const KNOWLEDGE_GRAPH_FILE_NAME = "product-knowledge-graph.md";
export const KNOWLEDGE_GRAPH_FILE_DIR = "product-knowledge-graph";

// ============================================================
// 文件句柄
// ============================================================

/**
 * 运行期产品知识图谱 markdown 文件句柄。
 */
export interface KnowledgeGraphFileHandle {
  path: string;
  absolutePath: string;
  workspaceId?: string;
  read(): string;
  write(content: string): void;
}

/**
 * 创建受控的产品知识图谱 markdown 文件句柄。
 */
export function createKnowledgeGraphFileHandle(
  initialContent: string,
  workspaceId?: string,
): KnowledgeGraphFileHandle {
  const filePath = getKnowledgeGraphFilePath(workspaceId);
  const absolutePath = resolveKnowledgeGraphFilePath(workspaceId);
  mkdirSync(dirname(absolutePath), { recursive: true });
  if (!existsSync(absolutePath)) {
    writeFileSync(absolutePath, initialContent, "utf8");
  }

  return {
    path: filePath,
    absolutePath,
    workspaceId,
    read: () => readFileSync(absolutePath, "utf8"),
    write: (content) => {
      writeFileSync(absolutePath, content, "utf8");
    },
  };
}

/**
 * 读取指定工作区的运行时知识图谱文件。
 */
export function readWorkspaceKnowledgeGraphFile(
  workspaceId: string,
): string | null {
  const absolutePath = resolveKnowledgeGraphFilePath(workspaceId);
  if (!existsSync(absolutePath)) return null;
  return readFileSync(absolutePath, "utf8");
}

/**
 * 删除指定工作区的运行时知识图谱文件及其工作区目录。
 */
export function deleteWorkspaceKnowledgeGraphFile(workspaceId: string): void {
  const absolutePath = resolveKnowledgeGraphFilePath(workspaceId);
  if (!existsSync(absolutePath)) return;

  rmSync(dirname(absolutePath), { recursive: true, force: true });
}

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

export interface StructuredToolCallResult<T = unknown> {
  action: string;
  count: number;
  items: T[];
  filePath: string;
  fileSize: number;
}

/**
 * 创建知识图谱文件操作工具集。
 */
export function createKnowledgeGraphFileTools(
  handle: KnowledgeGraphFileHandle,
) {
  return [
    // ── 读取 ──
    tool(
      async () => {
        const content = handle.read();
        return JSON.stringify(
          {
            path: handle.path,
            absolutePath: handle.absolutePath,
            workspaceId: handle.workspaceId,
            action: "read",
            size: content.length,
            preview: content.slice(Math.max(0, content.length - 2000)),
          },
          null,
          2,
        );
      },
      {
        name: "kg_file_read",
        description:
          "Read the current product-knowledge-graph.md markdown content before planning updates.",
        schema: z.object({}),
      },
    ),
    // ── 摘要 ──
    tool(
      async ({ summary }) => {
        const markdown = `### Summary\n\n${summary.trim()}\n`;
        appendToFile(handle, markdown);
        return JSON.stringify(
          {
            action: "add_summary",
            count: 1,
            items: [{ summary: summary.trim() }],
            filePath: handle.path,
            fileSize: handle.read().length,
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
        const markdown = buildNodesMarkdownTable(validated);
        appendToFile(handle, markdown);
        return JSON.stringify(
          {
            action: "add_nodes",
            count: validated.length,
            items: validated as unknown[],
            filePath: handle.path,
            fileSize: handle.read().length,
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
        const markdown = buildRelationsMarkdownTable(validated);
        appendToFile(handle, markdown);
        return JSON.stringify(
          {
            action: "add_relations",
            count: validated.length,
            items: validated as unknown[],
            filePath: handle.path,
            fileSize: handle.read().length,
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
        const markdown = buildDecisionsMarkdownList(validated);
        appendToFile(handle, markdown);
        return JSON.stringify(
          {
            action: "add_decisions",
            count: validated.length,
            items: validated as unknown[],
            filePath: handle.path,
            fileSize: handle.read().length,
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
        const markdown = buildRisksMarkdownList(validated);
        appendToFile(handle, markdown);
        return JSON.stringify(
          {
            action: "add_risks",
            count: validated.length,
            items: validated as unknown[],
            filePath: handle.path,
            fileSize: handle.read().length,
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
        const markdown = buildOpenQuestionsMarkdownList(validated);
        appendToFile(handle, markdown);
        return JSON.stringify(
          {
            action: "add_open_questions",
            count: validated.length,
            items: validated as unknown[],
            filePath: handle.path,
            fileSize: handle.read().length,
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

// ============================================================
// Markdown 序列化辅助函数
// ============================================================

function buildNodesMarkdownTable(
  nodes: z.infer<typeof nodeInputSchema>[],
): string {
  const header = "| id | type | name | description | source_task_id | status |";
  const separator = "| --- | --- | --- | --- | --- | --- |";
  const rows = nodes.map(
    (n) =>
      `| ${escapeMdCell(n.id)} | ${escapeMdCell(n.type)} | ${escapeMdCell(n.name)} | ${escapeMdCell(n.description)} | ${escapeMdCell(n.source_task_id)} | ${escapeMdCell(n.status)} |`,
  );
  return `### Nodes\n\n${header}\n${separator}\n${rows.join("\n")}\n`;
}

function buildRelationsMarkdownTable(
  relations: z.infer<typeof relationInputSchema>[],
): string {
  const header =
    "| id | type | source | target | description | source_task_id |";
  const separator = "| --- | --- | --- | --- | --- | --- |";
  const rows = relations.map(
    (r) =>
      `| ${escapeMdCell(r.id)} | ${escapeMdCell(r.type)} | ${escapeMdCell(r.source)} | ${escapeMdCell(r.target)} | ${escapeMdCell(r.description)} | ${escapeMdCell(r.source_task_id)} |`,
  );
  return `### Relations\n\n${header}\n${separator}\n${rows.join("\n")}\n`;
}

function buildDecisionsMarkdownList(
  decisions: z.infer<typeof decisionInputSchema>[],
): string {
  const items = decisions.map((d) => `- **${escapeMdCell(d.id)}**：${d.text}`);
  return `### Decisions\n\n${items.join("\n")}\n`;
}

function buildRisksMarkdownList(
  risks: z.infer<typeof riskInputSchema>[],
): string {
  const items = risks.map((r) => `- **${escapeMdCell(r.id)}**：${r.text}`);
  return `### Risks\n\n${items.join("\n")}\n`;
}

function buildOpenQuestionsMarkdownList(
  questions: z.infer<typeof openQuestionInputSchema>[],
): string {
  const items = questions.map((q) => `- **${escapeMdCell(q.id)}**：${q.text}`);
  return `### Open Questions\n\n${items.join("\n")}\n`;
}

function appendToFile(handle: KnowledgeGraphFileHandle, content: string): void {
  const current = handle.read();
  const next = `${current.trimEnd()}\n\n${content.trim()}\n`;
  handle.write(next);
}

function escapeMdCell(value: string): string {
  return value.replace(/\|/g, "\\|").replace(/\r?\n/g, " ");
}

// ============================================================
// 路径工具
// ============================================================

function getKnowledgeGraphFilePath(workspaceId?: string): string {
  const safeWorkspaceId = sanitizeWorkspaceId(workspaceId);
  return safeWorkspaceId
    ? `${KNOWLEDGE_GRAPH_FILE_DIR}/${safeWorkspaceId}/${KNOWLEDGE_GRAPH_FILE_NAME}`
    : `${KNOWLEDGE_GRAPH_FILE_DIR}/${KNOWLEDGE_GRAPH_FILE_NAME}`;
}

function resolveKnowledgeGraphFilePath(workspaceId?: string): string {
  const currentFile = fileURLToPath(import.meta.url);
  const packageRoot = resolve(dirname(currentFile), "../../..");
  return resolve(packageRoot, getKnowledgeGraphFilePath(workspaceId));
}

function sanitizeWorkspaceId(workspaceId: string | undefined): string | null {
  if (!workspaceId) return null;
  const normalized = workspaceId.trim().replace(/[^a-zA-Z0-9_-]/g, "-");
  return normalized || null;
}
