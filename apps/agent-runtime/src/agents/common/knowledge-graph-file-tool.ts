/**
 * 知识图谱文件工具
 *
 * 提供受控的产品知识图谱 markdown 文件操作工具集，包括创建、读取、
 * 插入、更新和删除内容五个工具，以及强类型结构化的节点/关系/决策/
 * 风险/待确认问题写入工具。所有操作限定在 workspace-scoped
 * product-knowledge-graph.md 文件中。
 *
 * Responsibilities:
 * - createKnowledgeGraphFileHandle()：创建文件句柄（按 workspaceId 隔离）
 * - createKnowledgeGraphFileTools()：构建 5 个 LangChain tool 实例（文本操作）
 * - createStructuredKnowledgeGraphFileTools()：构建 6 个强类型结构化写入工具
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

/**
 * 创建仅能操作当前工作区 product-knowledge-graph.md 的文件工具集。
 */
export function createKnowledgeGraphFileTools(
  handle: KnowledgeGraphFileHandle,
) {
  return [
    tool(
      async ({ content }) => {
        handle.write(content);
        return formatToolResult(handle, "created", handle.read());
      },
      {
        name: "kg_file_create",
        description:
          "Create or overwrite the product knowledge graph markdown file. Only product-knowledge-graph.md is available.",
        schema: z.object({
          content: z.string().describe("Full markdown content for the graph."),
        }),
      },
    ),
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
    tool(
      async ({ afterText, content }) => {
        const current = handle.read();
        const next = afterText
          ? insertAfterText(current, afterText, content)
          : `${current.trimEnd()}\n\n${content.trim()}\n`;
        handle.write(next);
        return formatToolResult(handle, "inserted", next);
      },
      {
        name: "kg_file_insert",
        description:
          "Insert markdown into product-knowledge-graph.md. If afterText is omitted, append to the end.",
        schema: z.object({
          afterText: z
            .string()
            .optional()
            .describe("Existing text after which to insert content."),
          content: z.string().min(1).describe("Markdown content to insert."),
        }),
      },
    ),
    tool(
      async ({ oldText, newText }) => {
        const current = handle.read();
        if (!current.includes(oldText)) {
          return JSON.stringify(
            {
              path: handle.path,
              workspaceId: handle.workspaceId,
              action: "not_found",
              error: "oldText was not found in product-knowledge-graph.md",
            },
            null,
            2,
          );
        }
        const next = current.replace(oldText, newText);
        handle.write(next);
        return formatToolResult(handle, "updated", next);
      },
      {
        name: "kg_file_update",
        description:
          "Replace exact markdown text inside product-knowledge-graph.md.",
        schema: z.object({
          oldText: z
            .string()
            .min(1)
            .describe("Exact existing text to replace."),
          newText: z.string().describe("Replacement markdown text."),
        }),
      },
    ),
    tool(
      async ({ text }) => {
        const current = handle.read();
        if (!current.includes(text)) {
          return JSON.stringify(
            {
              path: handle.path,
              workspaceId: handle.workspaceId,
              action: "not_found",
              error: "text was not found in product-knowledge-graph.md",
            },
            null,
            2,
          );
        }
        const next = current.replace(text, "");
        handle.write(next);
        return formatToolResult(handle, "deleted_content", next);
      },
      {
        name: "kg_file_delete_content",
        description:
          "Delete exact markdown text from product-knowledge-graph.md.",
        schema: z.object({
          text: z.string().min(1).describe("Exact existing text to delete."),
        }),
      },
    ),
  ];
}

/**
 * 知识图谱实体类型枚举。
 */
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

/**
 * 知识图谱关系类型枚举。
 */
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

/**
 * 结构化节点输入 schema。
 */
const nodeInputSchema = z.object({
  id: z.string().min(1).describe("Unique node ID, e.g. G-001, D-003"),
  type: z.enum(ENTITY_TYPE_VALUES).describe("Entity type"),
  name: z.string().min(1).describe("Node name"),
  description: z.string().min(1).describe("Node description explaining its business meaning"),
  source_task_id: z.string().min(1).describe("Task ID that produced this node"),
  status: z
    .enum(["proposed", "confirmed", "deprecated"])
    .default("proposed")
    .describe("Node status"),
});

/**
 * 结构化关系输入 schema。
 */
const relationInputSchema = z.object({
  id: z.string().min(1).describe("Unique relation ID, e.g. REL-001"),
  type: z.enum(RELATION_TYPE_VALUES).describe("Relation type"),
  source: z.string().min(1).describe("Source node ID"),
  target: z.string().min(1).describe("Target node ID"),
  description: z.string().min(1).describe("Relation description explaining the business connection"),
  source_task_id: z.string().min(1).describe("Task ID that produced this relation"),
});

/**
 * 结构化决策输入 schema。
 */
const decisionInputSchema = z.object({
  id: z.string().min(1).describe("Decision ID, e.g. D-001"),
  text: z.string().min(1).describe("Decision text including choice, rationale, and risk assessment"),
});

/**
 * 结构化风险输入 schema。
 */
const riskInputSchema = z.object({
  id: z.string().min(1).describe("Risk ID, e.g. RISK-001"),
  text: z.string().min(1).describe("Risk description including impact and mitigation"),
});

/**
 * 结构化待确认问题输入 schema。
 */
const openQuestionInputSchema = z.object({
  id: z.string().min(1).describe("Question ID, e.g. OQ-001"),
  text: z.string().min(1).describe("Question text explaining what needs to be confirmed"),
});

export interface StructuredToolCallResult<T = unknown> {
  action: string;
  count: number;
  items: T[];
  filePath: string;
  fileSize: number;
}

/**
 * 创建强类型结构化的知识图谱写入工具集。
 *
 * 每个工具接收 Zod 校验的数组输入，序列化为统一 markdown 格式后追加到
 * product-knowledge-graph.md，并返回结构化确认数据供 ExecutorAgentResult
 * 填充使用。
 */
export function createStructuredKnowledgeGraphFileTools(
  handle: KnowledgeGraphFileHandle,
) {
  return [
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
    tool(
      async ({ nodes }) => {
        // Zod 校验每个节点
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
            .describe("Array of relations to write, at least 1 relation required"),
        }),
      },
    ),
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
          risks: z.array(riskInputSchema).min(1).describe("Array of risks to write"),
        }),
      },
    ),
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

/**
 * 将节点数组序列化为 markdown 表格。
 */
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

/**
 * 将关系数组序列化为 markdown 表格。
 */
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

/**
 * 将决策数组序列化为 markdown 列表。
 */
function buildDecisionsMarkdownList(
  decisions: z.infer<typeof decisionInputSchema>[],
): string {
  const items = decisions.map((d) => `- **${escapeMdCell(d.id)}**：${d.text}`);
  return `### Decisions\n\n${items.join("\n")}\n`;
}

/**
 * 将风险数组序列化为 markdown 列表。
 */
function buildRisksMarkdownList(
  risks: z.infer<typeof riskInputSchema>[],
): string {
  const items = risks.map((r) => `- **${escapeMdCell(r.id)}**：${r.text}`);
  return `### Risks\n\n${items.join("\n")}\n`;
}

/**
 * 将待确认问题数组序列化为 markdown 列表。
 */
function buildOpenQuestionsMarkdownList(
  questions: z.infer<typeof openQuestionInputSchema>[],
): string {
  const items = questions.map((q) => `- **${escapeMdCell(q.id)}**：${q.text}`);
  return `### Open Questions\n\n${items.join("\n")}\n`;
}

/**
 * 追加内容到文件末尾，确保与前文以空行分隔。
 */
function appendToFile(handle: KnowledgeGraphFileHandle, content: string): void {
  const current = handle.read();
  const next = `${current.trimEnd()}\n\n${content.trim()}\n`;
  handle.write(next);
}

/**
 * 转义 markdown 表格单元格内的特殊字符。
 */
function escapeMdCell(value: string): string {
  return value.replace(/\|/g, "\\|").replace(/\r?\n/g, " ");
}

/**
 * 在指定文本后插入 markdown；找不到锚点时退化为追加，避免工具调用中断工作流。
 */
function insertAfterText(
  current: string,
  afterText: string,
  content: string,
): string {
  const index = current.indexOf(afterText);
  if (index === -1) {
    return `${current.trimEnd()}\n\n${content.trim()}\n`;
  }

  const insertAt = index + afterText.length;
  return `${current.slice(0, insertAt)}\n\n${content.trim()}\n${current.slice(insertAt)}`;
}

/**
 * 格式化文件工具结果，控制返回体大小并保留状态。
 */
function formatToolResult(
  handle: KnowledgeGraphFileHandle,
  action: string,
  content: string,
): string {
  return JSON.stringify(
    {
      path: handle.path,
      absolutePath: handle.absolutePath,
      workspaceId: handle.workspaceId,
      action,
      size: content.length,
      preview: content.slice(Math.max(0, content.length - 2000)),
    },
    null,
    2,
  );
}

/**
 * 返回工作区隔离后的知识图谱相对路径。
 */
function getKnowledgeGraphFilePath(workspaceId?: string): string {
  const safeWorkspaceId = sanitizeWorkspaceId(workspaceId);
  return safeWorkspaceId
    ? `${KNOWLEDGE_GRAPH_FILE_DIR}/${safeWorkspaceId}/${KNOWLEDGE_GRAPH_FILE_NAME}`
    : `${KNOWLEDGE_GRAPH_FILE_DIR}/${KNOWLEDGE_GRAPH_FILE_NAME}`;
}

/**
 * 定位 agent-runtime 包根目录下的工作区知识图谱文件。
 */
function resolveKnowledgeGraphFilePath(workspaceId?: string): string {
  const currentFile = fileURLToPath(import.meta.url);
  const packageRoot = resolve(dirname(currentFile), "../../..");
  return resolve(packageRoot, getKnowledgeGraphFilePath(workspaceId));
}

/**
 * 将工作区 ID 压缩为安全目录名，避免模型或接口参数影响文件边界。
 */
function sanitizeWorkspaceId(workspaceId: string | undefined): string | null {
  if (!workspaceId) return null;
  const normalized = workspaceId.trim().replace(/[^a-zA-Z0-9_-]/g, "-");
  return normalized || null;
}
