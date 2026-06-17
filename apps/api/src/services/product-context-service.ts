import { access, readFile } from "node:fs/promises";
import path from "node:path";
import { getConversationWorkspace } from "../repositories/chat-repository";

const MAX_CONTEXT_CHARS = 24_000;

// 只读取概述性文档。Request Agent 需要项目背景，不需要扫描整个工作区，
// 这样可以避免把无关文件带入提示词。
const OVERVIEW_FILES = [
  "README.md",
  "README-zh.md",
  "overview.md",
  "product-context.md",
  "product-overview.md",
  "product-draft.md",
  "docs/overview.md",
  "docs/product-context.md",
  "docs/product-overview.md",
  "docs/product-draft.md",
];

/**
 * 根据会话 ID 加载对应工作区的产品概述上下文，供 Request Agent 使用。
 * 只读取预定义的概述性文档，避免将整个工作区文件带入提示词。
 */
export async function loadProductContextForConversation(
  conversationId: string | undefined,
): Promise<string> {
  if (!conversationId) return "";

  const workspace = await getConversationWorkspace(conversationId);
  if (!workspace?.localPath) return "";

  const sections: string[] = [
    `Workspace: ${workspace.workspaceName}`,
  ];

  for (const relativeFile of OVERVIEW_FILES) {
    const filePath = path.resolve(workspace.localPath, relativeFile);

    // 候选文件必须位于用户选择的工作区内，避免相对路径逃逸到工作区之外。
    if (!isInsideDirectory(filePath, workspace.localPath)) continue;

    const content = await readTextFileIfExists(filePath);
    if (!content) continue;

    sections.push(`## ${relativeFile}\n${content}`);
    if (sections.join("\n\n").length >= MAX_CONTEXT_CHARS) break;
  }

  return sections.join("\n\n").slice(0, MAX_CONTEXT_CHARS);
}

/**
 * 读取文件内容，文件不存在时返回 null 而非抛出异常。
 */
async function readTextFileIfExists(filePath: string): Promise<string | null> {
  try {
    await access(filePath);
    return await readFile(filePath, "utf8");
  } catch {
    return null;
  }
}

/**
 * 检查文件路径是否位于指定目录之内，防止路径遍历逃逸到工作区外部。
 */
function isInsideDirectory(filePath: string, directory: string): boolean {
  const relative = path.relative(path.resolve(directory), filePath);

  // 当 filePath 位于目录外时，path.relative 会返回以 ".." 开头或绝对路径的结果。
  // 这里用这个特征做跨平台的目录边界检查。
  return relative !== "" &&
    !relative.startsWith("..") &&
    !path.isAbsolute(relative);
}
