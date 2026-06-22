import { tool } from "langchain/tools";
import { z } from "zod";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const KNOWLEDGE_GRAPH_FILE_NAME = "product-knowledge-graph.md";
export const KNOWLEDGE_GRAPH_FILE_DIR = "product-knowledge-graph";
export const KNOWLEDGE_GRAPH_FILE_PATH = `${KNOWLEDGE_GRAPH_FILE_DIR}/${KNOWLEDGE_GRAPH_FILE_NAME}`;

/**
 * 运行期产品知识图谱 markdown 文件句柄。
 */
export interface KnowledgeGraphFileHandle {
  path: string;
  absolutePath: string;
  read(): string;
  write(content: string): void;
}

/**
 * 创建受控的产品知识图谱 markdown 文件句柄。
 */
export function createKnowledgeGraphFileHandle(
  initialContent: string,
): KnowledgeGraphFileHandle {
  const absolutePath = resolveKnowledgeGraphFilePath();
  mkdirSync(dirname(absolutePath), { recursive: true });
  if (!existsSync(absolutePath)) {
    writeFileSync(absolutePath, initialContent, "utf8");
  }

  return {
    path: KNOWLEDGE_GRAPH_FILE_PATH,
    absolutePath,
    read: () => readFileSync(absolutePath, "utf8"),
    write: (content) => {
      writeFileSync(absolutePath, content, "utf8");
    },
  };
}

/**
 * 创建仅能操作 product-knowledge-graph.md 的文件工具集。
 */
export function createKnowledgeGraphFileTools(handle: KnowledgeGraphFileHandle) {
  return [
    tool(
      async ({ content }) => {
        handle.write(content);
        return formatToolResult("created", handle.read());
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
        return JSON.stringify(
          {
            path: handle.path,
            absolutePath: handle.absolutePath,
            content: handle.read(),
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
        return formatToolResult("inserted", next);
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
              action: "not_found",
              error: "oldText was not found in product-knowledge-graph.md",
            },
            null,
            2,
          );
        }
        const next = current.replace(oldText, newText);
        handle.write(next);
        return formatToolResult("updated", next);
      },
      {
        name: "kg_file_update",
        description:
          "Replace exact markdown text inside product-knowledge-graph.md.",
        schema: z.object({
          oldText: z.string().min(1).describe("Exact existing text to replace."),
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
              action: "not_found",
              error: "text was not found in product-knowledge-graph.md",
            },
            null,
            2,
          );
        }
        const next = current.replace(text, "");
        handle.write(next);
        return formatToolResult("deleted_content", next);
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
function formatToolResult(action: string, content: string): string {
  return JSON.stringify(
    {
      path: KNOWLEDGE_GRAPH_FILE_PATH,
      absolutePath: resolveKnowledgeGraphFilePath(),
      action,
      size: content.length,
      preview: content.slice(Math.max(0, content.length - 2000)),
    },
    null,
    2,
  );
}

/**
 * 定位 agent-runtime 包根目录下的 product-knowledge-graph/product-knowledge-graph.md。
 */
function resolveKnowledgeGraphFilePath(): string {
  const currentFile = fileURLToPath(import.meta.url);
  const packageRoot = resolve(dirname(currentFile), "../../..");
  return resolve(packageRoot, KNOWLEDGE_GRAPH_FILE_PATH);
}
