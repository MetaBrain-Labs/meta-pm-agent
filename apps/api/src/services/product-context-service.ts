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

async function readTextFileIfExists(filePath: string): Promise<string | null> {
  try {
    await access(filePath);
    return await readFile(filePath, "utf8");
  } catch {
    return null;
  }
}

function isInsideDirectory(filePath: string, directory: string): boolean {
  const relative = path.relative(path.resolve(directory), filePath);

  // 当 filePath 位于目录外时，path.relative 会返回以 ".." 开头或绝对路径的结果。
  // 这里用这个特征做跨平台的目录边界检查。
  return relative !== "" &&
    !relative.startsWith("..") &&
    !path.isAbsolute(relative);
}
