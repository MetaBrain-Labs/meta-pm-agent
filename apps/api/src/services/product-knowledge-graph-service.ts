import type { ProductKnowledgeGraph } from "@repo/shared";
import {
  upsertProductKnowledgeGraph,
  getProductKnowledgeGraphByWorkspaceId,
  type ProductKnowledgeGraphRow,
} from "../repositories/product-knowledge-graph-repository";

/**
 * 归档输入，携带结构化知识图谱数据与关联本轮会话/请求表单的溯源信息。
 */
export interface FinalizeProductKnowledgeGraphInput {
  workspaceId?: string;
  conversationId?: string;
  requestFormId?: string;
  /** 完整的知识图谱结构化状态，来自工作流 complete 事件 */
  knowledgeGraph?: ProductKnowledgeGraph;
}

/**
 * 将工作流产出的结构化知识图谱归档到数据库。
 * 不再从文件系统读取 markdown 文件；markdown 由结构化数据按需生成。
 */
export async function finalizeWorkspaceKnowledgeGraph({
  workspaceId,
  conversationId,
  requestFormId,
  knowledgeGraph,
}: FinalizeProductKnowledgeGraphInput): Promise<void> {
  if (!workspaceId || !knowledgeGraph) return;

  // 检查是否有任何结构化数据需要持久化
  const hasData =
    knowledgeGraph.entities.length > 0 ||
    knowledgeGraph.relations.length > 0 ||
    knowledgeGraph.decisions.length > 0 ||
    knowledgeGraph.risks.length > 0 ||
    knowledgeGraph.open_questions.length > 0 ||
    knowledgeGraph.summary.length > 0;

  if (!hasData) return;

  // 从结构化数据生成 markdown 文本（供前端渲染等场景回退使用）
  const markdown = generateMarkdownFromKnowledgeGraph(knowledgeGraph);

  await upsertProductKnowledgeGraph({
    workspaceId,
    conversationId,
    requestFormId,
    markdown,
    summary: knowledgeGraph.summary,
    nodes: knowledgeGraph.entities,
    relations: knowledgeGraph.relations,
    decisions: knowledgeGraph.decisions,
    risks: knowledgeGraph.risks,
    openQuestions: knowledgeGraph.open_questions,
  });
}

/**
 * 从结构化知识图谱数据生成 markdown。
 * 节点和关系使用表格格式，决策/风险/待确认问题使用列表格式。
 */
function generateMarkdownFromKnowledgeGraph(
  kg: ProductKnowledgeGraph,
): string {
  const lines: string[] = [];

  lines.push("# Product Knowledge Graph");
  lines.push("");

  // 摘要
  if (kg.summary.length > 0) {
    lines.push("## Summary");
    lines.push("");
    for (const s of kg.summary) {
      lines.push(`- ${s}`);
    }
    lines.push("");
  }

  // 节点
  if (kg.entities.length > 0) {
    lines.push("## Nodes");
    lines.push("");
    lines.push("| id | type | name | description | source_task_id | status |");
    lines.push("| --- | --- | --- | --- | --- | --- |");
    for (const e of kg.entities) {
      lines.push(
        `| ${escapeMdCell(e.id)} | ${escapeMdCell(e.type)} | ${escapeMdCell(e.name)} | ${escapeMdCell(e.description ?? "")} | ${escapeMdCell(e.source_task_id ?? "")} | ${escapeMdCell(e.status ?? "proposed")} |`,
      );
    }
    lines.push("");
  }

  // 关系
  if (kg.relations.length > 0) {
    lines.push("## Relations");
    lines.push("");
    lines.push("| id | type | source | target | description | source_task_id |");
    lines.push("| --- | --- | --- | --- | --- | --- |");
    for (const r of kg.relations) {
      lines.push(
        `| ${escapeMdCell(r.id)} | ${escapeMdCell(r.type)} | ${escapeMdCell(r.source)} | ${escapeMdCell(r.target)} | ${escapeMdCell(r.description ?? "")} | ${escapeMdCell(r.source_task_id ?? "")} |`,
      );
    }
    lines.push("");
  }

  // 决策
  if (kg.decisions.length > 0) {
    lines.push("## Decisions");
    lines.push("");
    for (const d of kg.decisions) {
      lines.push(`- **${escapeMdCell(d.id)}**：${d.text}`);
    }
    lines.push("");
  }

  // 风险
  if (kg.risks.length > 0) {
    lines.push("## Risks");
    lines.push("");
    for (const r of kg.risks) {
      lines.push(`- **${escapeMdCell(r.id)}**：${r.text}`);
    }
    lines.push("");
  }

  // 待确认问题
  if (kg.open_questions.length > 0) {
    lines.push("## Open Questions");
    lines.push("");
    for (const q of kg.open_questions) {
      lines.push(`- **${escapeMdCell(q.id)}**：${q.text}`);
    }
    lines.push("");
  }

  // 备注
  if (kg.notes.length > 0) {
    lines.push("## Notes");
    lines.push("");
    for (const note of kg.notes) {
      lines.push(`- ${note}`);
    }
    lines.push("");
  }

  return lines.join("\n");
}

/**
 * 转义 markdown 表格单元格中的管道符和换行符。
 */
function escapeMdCell(value: string): string {
  return value.replace(/\|/g, "\\|").replace(/\r?\n/g, " ");
}

/**
 * 前端知识图谱查询的返回结构。
 */
export interface WorkspaceKnowledgeGraphData {
  /** nodes 和 relations 都有数据时可用 */
  hasData: boolean;
  /** 结构化数据按参考格式生成的 markdown */
  markdown: string;
  version: number;
  updatedAt: string;
}

/**
 * 按工作区 ID 获取产品知识图谱数据及生成的 markdown。
 * 如果数据库无记录返回 null；如果有记录但 nodes/relations 为空也返回 hasData: false。
 */
export async function getWorkspaceKnowledgeGraph(
  workspaceId: string,
): Promise<WorkspaceKnowledgeGraphData | null> {
  const row = await getProductKnowledgeGraphByWorkspaceId(workspaceId);
  if (!row) return null;

  const nodes = Array.isArray(row.nodes) ? row.nodes : [];
  const relations = Array.isArray(row.relations) ? row.relations : [];
  const hasData = nodes.length > 0 && relations.length > 0;

  // 有数据时生成参考格式 markdown；无数据时也返回空字符串供前端判断
  const markdown = hasData
    ? generateReferenceMarkdown(row)
    : "";

  return {
    hasData,
    markdown,
    version: row.version,
    updatedAt: row.updatedAt,
  };
}

/**
 * 从 DB 行数据按参考格式生成 markdown。
 * 格式参考 @参考.md：Graph Updates 下按 Summary / Nodes / Relations / Decisions / Risks / Open Questions 组织。
 */
function generateReferenceMarkdown(row: ProductKnowledgeGraphRow): string {
  const lines: string[] = [];

  lines.push("# Product Knowledge Graph");
  lines.push("");
  lines.push(
    "> 当前文件由 Executor Agent 按任务逐步维护。初始项目为空图谱，后续演化以本文档为上下文。",
  );
  lines.push("");
  lines.push("## Graph Updates");
  lines.push("");

  // 摘要 —— DB 中 summary 字段可能包含多个任务阶段的摘要
  const summary = Array.isArray(row.summary) ? row.summary : [];
  if (summary.length > 0) {
    for (const item of summary) {
      if (typeof item === "string" && item.trim()) {
        lines.push("### Summary");
        lines.push("");
        lines.push(item.trim());
        lines.push("");
      }
    }
  }

  // 节点
  const nodes = Array.isArray(row.nodes) ? row.nodes : [];
  if (nodes.length > 0) {
    lines.push("### Nodes");
    lines.push("");
    lines.push(
      "| id | type | name | description | source_task_id | status |",
    );
    lines.push(
      "| --- | --- | --- | --- | --- | --- |",
    );
    for (const node of nodes) {
      if (node && typeof node === "object") {
        const n = node as Record<string, unknown>;
        lines.push(
          `| ${esc(String(n.id))} | ${esc(String(n.type))} | ${esc(String(n.name))} | ${esc(String(n.description ?? ""))} | ${esc(String(n.source_task_id ?? ""))} | ${esc(String(n.status ?? "proposed"))} |`,
        );
      }
    }
    lines.push("");
  }

  // 关系
  const relations = Array.isArray(row.relations) ? row.relations : [];
  if (relations.length > 0) {
    lines.push("### Relations");
    lines.push("");
    lines.push(
      "| id | type | source | target | description | source_task_id |",
    );
    lines.push(
      "| --- | --- | --- | --- | --- | --- |",
    );
    for (const rel of relations) {
      if (rel && typeof rel === "object") {
        const r = rel as Record<string, unknown>;
        lines.push(
          `| ${esc(String(r.id))} | ${esc(String(r.type))} | ${esc(String(r.source))} | ${esc(String(r.target))} | ${esc(String(r.description ?? ""))} | ${esc(String(r.source_task_id ?? ""))} |`,
        );
      }
    }
    lines.push("");
  }

  // 决策
  const decisions = Array.isArray(row.decisions) ? row.decisions : [];
  if (decisions.length > 0) {
    lines.push("### Decisions");
    lines.push("");
    for (const d of decisions) {
      if (d && typeof d === "object") {
        const decision = d as Record<string, unknown>;
        lines.push(
          `- **${esc(String(decision.id))}**：${esc(String(decision.text))}`,
        );
      }
    }
    lines.push("");
  }

  // 风险
  const risks = Array.isArray(row.risks) ? row.risks : [];
  if (risks.length > 0) {
    lines.push("### Risks");
    lines.push("");
    for (const r of risks) {
      if (r && typeof r === "object") {
        const risk = r as Record<string, unknown>;
        lines.push(
          `- **${esc(String(risk.id))}**：${esc(String(risk.text))}`,
        );
      }
    }
    lines.push("");
  }

  // 待确认问题
  const openQuestions = Array.isArray(row.openQuestions)
    ? row.openQuestions
    : [];
  if (openQuestions.length > 0) {
    lines.push("### Open Questions");
    lines.push("");
    for (const q of openQuestions) {
      if (q && typeof q === "object") {
        const question = q as Record<string, unknown>;
        lines.push(
          `- **${esc(String(question.id))}**：${esc(String(question.text))}`,
        );
      }
    }
    lines.push("");
  }

  return lines.join("\n");
}

/**
 * 转义 markdown 表格中的管道符。
 */
function esc(value: string): string {
  return value.replace(/\|/g, "\\|").replace(/\r?\n/g, " ");
}
