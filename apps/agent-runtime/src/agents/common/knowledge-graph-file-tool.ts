/**
 * 知识图谱文件工具
 *
 * 提供受控的产品知识图谱 markdown 文件操作工具集，包括创建、读取、
 * 插入、更新和删除内容五个工具。所有操作限定在 workspace-scoped
 * product-knowledge-graph.md 文件中。
 *
 * Responsibilities:
 * - createKnowledgeGraphFileHandle()：创建文件句柄（按 workspaceId 隔离）
 * - createKnowledgeGraphFileTools()：构建 5 个 LangChain tool 实例
 * - getKnowledgeGraphFilePath()：计算 workspace-scoped 文件路径
 * - deleteWorkspaceKnowledgeGraphFile()：删除工作区图谱文件
 * - readWorkspaceKnowledgeGraphFile()：读取工作区图谱文件
 *
 * Notes:
 * - 文件操作绑定到当前 workspace 的 product-knowledge-graph.md
 * - 工作流完成后由 API 层归档到数据库后删除运行时文件
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
