/**
 * Document Agent 技能文件加载
 *
 * 将 PRD 专用和可复用文档 Skill 映射为 DeepAgents StateBackend 中的只读
 * 虚拟文件，使主 Agent 与自定义 SubAgent 能按需渐进加载，同时不接触宿主机文件系统。
 *
 * Responsibilities:
 * - 选择 PRD 工作流可用的七个 Skill
 * - 将仓库文件映射为稳定的 /skills/<name>/SKILL.md
 * - 在模型调用前报告缺失或无法读取的 Skill
 *
 * Notes:
 * - user-stories 与 grammar-check 直接复用现有 Executor Skill 源文件。
 * - 当前仅 PRD 使用该目录；不预建 BRD/MRD Skill 配置。
 */

import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import type { FileData } from "deepagents";

export const DOCUMENT_SKILLS_SOURCE = "/skills/";
const REPOSITORY_ROOT_URL = new URL("../../../../../", import.meta.url);

/** 单个 Document Agent Skill 的仓库来源。 */
export interface DocumentSkillDefinition {
  name: string;
  repositoryPath: string;
}

/** Document Agent 本轮使用的虚拟 Skill 集合。 */
export interface DocumentSkillBundle {
  sources: string[];
  files: Record<string, FileData>;
}

export const PRD_DOCUMENT_SKILLS: readonly DocumentSkillDefinition[] = [
  {
    name: "source-grounded-writing",
    repositoryPath:
      "references/document-agent/skills/source-grounded-writing/SKILL.md",
  },
  {
    name: "deliver-prd",
    repositoryPath: "references/document-agent/skills/deliver-prd/SKILL.md",
  },
    {
            name: "deliver-visuals",
      repositoryPath:
                "references/document-agent/skills/deliver-visuals/SKILL.md",
    },
  {
    name: "user-stories",
    repositoryPath:
      "references/executor/product-execution-executor/skills/user-stories/SKILL.md",
  },
  {
    name: "deliver-acceptance-criteria",
    repositoryPath:
      "references/document-agent/skills/deliver-acceptance-criteria/SKILL.md",
  },
  {
    name: "deliver-edge-cases",
    repositoryPath:
      "references/document-agent/skills/deliver-edge-cases/SKILL.md",
  },
  {
    name: "grammar-check",
    repositoryPath:
      "references/executor/toolkit-executor/skills/grammar-check/SKILL.md",
  },
] as const;

/**
 * 加载 PRD Document Agent Skill，并写入隔离的虚拟文件映射。
 */
export async function createPrdDocumentSkillBundle(
  definitions: readonly DocumentSkillDefinition[] = PRD_DOCUMENT_SKILLS,
): Promise<DocumentSkillBundle> {
  const files: Record<string, FileData> = {};
  const timestamp = new Date().toISOString();

  for (const definition of definitions) {
    const sourcePath = fileURLToPath(
      new URL(definition.repositoryPath, REPOSITORY_ROOT_URL),
    );
    let content: string;

    try {
      content = await readFile(sourcePath, "utf8");
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      throw new Error(
        `Failed to load Document Agent skill "${definition.name}" from ${sourcePath}: ${reason}`,
      );
    }

    files[`${DOCUMENT_SKILLS_SOURCE}${definition.name}/SKILL.md`] = {
      content: content.replace(/\r\n?/g, "\n"),
      mimeType: "text/markdown",
      created_at: timestamp,
      modified_at: timestamp,
    };
  }

  return {
    sources: definitions.length > 0 ? [DOCUMENT_SKILLS_SOURCE] : [],
    files,
  };
}
