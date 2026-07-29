/**
 * Executor Agent 技能文件加载
 *
 * 将仓库内的 Executor SKILL.md 读取为 DeepAgents StateBackend 可消费的
 * 虚拟文件，避免向模型开放宿主机文件系统。
 *
 * Responsibilities:
 * - 根据 Executor 定义选择本轮可用技能
 * - 归一化文本换行并生成 FileDataV2
 * - 建立稳定的 /skills/<name>/SKILL.md 虚拟路径
 *
 * Notes:
 * - 当前技能目录没有 supporting files，因此只加载 SKILL.md
 * - supplement Product Strategy 只加载 product-strategy
 */

import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import type { FileData } from "deepagents";
import type {
  ExecutorAgentDefinition,
  ExecutorAgentType,
} from "./definitions";

const VIRTUAL_SKILLS_SOURCE = "/skills/";
const REPOSITORY_ROOT_URL = new URL("../../../../../../", import.meta.url);

/** Executor 本轮使用的虚拟技能文件集合。 */
export interface ExecutorSkillBundle {
  sources: string[];
  files: Record<string, FileData>;
}

/**
 * 读取 Executor 本轮需要的技能并映射到隔离的 StateBackend 文件空间。
 */
export async function createExecutorSkillBundle(
  definition: ExecutorAgentDefinition,
  supplement = false,
): Promise<ExecutorSkillBundle> {
  const skillNames = selectExecutorSkillNames(
    definition.agentType,
    definition.skills,
    supplement,
  );
  const files: Record<string, FileData> = {};
  const timestamp = new Date().toISOString();

  for (const skillName of skillNames) {
    const sourcePath = fileURLToPath(
      new URL(
        `${definition.referencePath}/skills/${skillName}/SKILL.md`,
        REPOSITORY_ROOT_URL,
      ),
    );

    let content: string;
    try {
      content = await readFile(sourcePath, "utf8");
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      throw new Error(
        `Failed to load Executor skill "${skillName}" for ${definition.agentType} from ${sourcePath}: ${reason}`,
      );
    }

    files[`${VIRTUAL_SKILLS_SOURCE}${skillName}/SKILL.md`] = {
      content: content.replace(/\r\n?/g, "\n"),
      mimeType: "text/markdown",
      created_at: timestamp,
      modified_at: timestamp,
    };
  }

  return {
    sources: skillNames.length > 0 ? [VIRTUAL_SKILLS_SOURCE] : [],
    files,
  };
}

/**
 * 按工作流状态收窄 Executor 可见技能，避免 supplement 重放完整策略技能集。
 */
function selectExecutorSkillNames(
  agentType: ExecutorAgentType,
  skillNames: readonly string[],
  supplement: boolean,
): readonly string[] {
  return supplement && agentType === "executor-product-strategy"
    ? skillNames.filter((skillName) => skillName === "product-strategy")
    : skillNames;
}
