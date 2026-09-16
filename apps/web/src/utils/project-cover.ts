/**
 * 项目封面配色
 *
 * 为本地项目分配一个稳定的低饱和封面底色。颜色由项目 ID 决定，因此同一项目
 * 在列表、刷新和换机后都保持同一配色，不需要持久化。
 *
 * Responsibilities:
 * - 从项目 ID 计算稳定的色板下标
 * - 输出可直接写入 style 的 CSS 变量
 *
 * Notes:
 * - 只消费 design-tokens 中的封面色板，不在页面内另行定义颜色。
 * - 不使用高饱和色，避免大面积色块破坏整体黑白视觉体系。
 */

import { DESIGN_TOKENS } from "../theme/design-tokens";

/** 封面颜色变量；未命中色板时回退到中性底色。 */
export interface ProjectCoverStyle {
  "--cover-tint": string;
  "--cover-ink": string;
}

/** 项目 ID 的稳定哈希，保证同一项目始终得到同一封面。 */
function hashProjectId(projectId: string): number {
  let hash = 0;
  for (let index = 0; index < projectId.length; index += 1) {
    hash = (hash * 31 + projectId.charCodeAt(index)) % 1_000_003;
  }
  return hash;
}

/** 取得项目封面样式变量。 */
export function getProjectCoverStyle(projectId: string): ProjectCoverStyle {
  const palette = DESIGN_TOKENS.cover;
  const entry = palette[hashProjectId(projectId) % palette.length] ?? palette[0]!;
  return {
    "--cover-tint": entry.tint,
    "--cover-ink": entry.ink,
  } as ProjectCoverStyle;
}
