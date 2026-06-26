import type {
  KnowledgeGraphEntity,
  KnowledgeGraphRelation,
  ProductKnowledgeGraph,
} from "@repo/shared";
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
  /** 是否把本次写入计为一轮完成的知识图谱版本。 */
  advanceVersion?: boolean;
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
  advanceVersion = true,
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

  const normalizedGraph = normalizeKnowledgeGraphForPersistence(knowledgeGraph);

  // 仅持久化结构化列；content 保持为空，前端展示时按需生成 markdown。
  await upsertProductKnowledgeGraph({
    workspaceId,
    conversationId,
    requestFormId,
    advanceVersion,
    summary: normalizedGraph.summary,
    nodes: normalizedGraph.entities,
    relations: normalizedGraph.relations,
    decisions: normalizedGraph.decisions,
    risks: normalizedGraph.risks,
    openQuestions: normalizedGraph.open_questions,
  });
}

/**
 * 前端知识图谱查询的返回结构。
 */
export interface WorkspaceKnowledgeGraphData {
  /** nodes 和 relations 都有数据时可用 */
  hasData: boolean;
  /** 结构化数据按参考格式生成的 markdown */
  markdown: string;
  /** 结构化节点数据，供图可视化使用 */
  nodes: KnowledgeGraphEntity[];
  /** 结构化关系数据，供图可视化使用 */
  relations: KnowledgeGraphRelation[];
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

  const normalizedRow = normalizeKnowledgeGraphRow(row);
  const nodes = (Array.isArray(normalizedRow.nodes)
    ? normalizedRow.nodes
    : []) as KnowledgeGraphEntity[];
  const relations = (Array.isArray(normalizedRow.relations)
    ? normalizedRow.relations
    : []) as KnowledgeGraphRelation[];
  const hasData = nodes.length > 0 && relations.length > 0;

  // 有数据时生成参考格式 markdown；无数据时也返回空字符串供前端判断
  const markdown = hasData
    ? generateReferenceMarkdown(normalizedRow)
    : "";

  return {
    hasData,
    markdown,
    nodes,
    relations,
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

/**
 * 读取时规范化历史图谱行，避免旧重复数据污染展示层。
 */
function normalizeKnowledgeGraphRow(
  row: ProductKnowledgeGraphRow,
): ProductKnowledgeGraphRow {
  return {
    ...row,
    summary: dedupeUnknownText(row.summary),
    nodes: dedupeUnknownByKey(row.nodes, (item) => getStringField(item, "id")),
    relations: dedupeUnknownByKey(
      row.relations,
      (item) =>
        getStringField(item, "id") ||
        [
          getStringField(item, "type"),
          getStringField(item, "source"),
          getStringField(item, "target"),
          getStringField(item, "source_task_id"),
        ].join(":"),
    ),
    decisions: dedupeUnknownByKey(row.decisions, (item) =>
      getStringField(item, "id"),
    ),
    risks: dedupeUnknownByKey(row.risks, (item) => getStringField(item, "id")),
    openQuestions: dedupeUnknownByKey(
      row.openQuestions,
      (item) => getStringField(item, "id") || getStringField(item, "text"),
    ),
  };
}

/**
 * 入库前规范化图谱数组，避免 Executor 重试或并行合并造成重复记录。
 */
function normalizeKnowledgeGraphForPersistence(
  knowledgeGraph: ProductKnowledgeGraph,
): ProductKnowledgeGraph {
  return {
    ...knowledgeGraph,
    entities: dedupeByKey(knowledgeGraph.entities, (item) => item.id),
    relations: dedupeByKey(
      knowledgeGraph.relations,
      (item) =>
        item.id ||
        `${item.type}:${item.source}:${item.target}:${item.source_task_id ?? ""}`,
    ),
    decisions: dedupeByKey(knowledgeGraph.decisions, (item) => item.id),
    risks: dedupeByKey(knowledgeGraph.risks, (item) => item.id),
    open_questions: dedupeByKey(
      knowledgeGraph.open_questions,
      (item) => item.id || item.text,
    ),
    summary: dedupeText(knowledgeGraph.summary),
    notes: dedupeText(knowledgeGraph.notes),
  };
}

/**
 * 按稳定键去重，保留同键最后一次写入的完整对象。
 */
function dedupeByKey<T>(items: T[], getKey: (item: T) => string): T[] {
  const merged = new Map<string, T>();
  for (const item of items) {
    const key = getKey(item).trim();
    if (!key) continue;
    merged.set(key, item);
  }

  return [...merged.values()];
}

/**
 * 文本数组去重，过滤空白项。
 */
function dedupeText(items: string[]): string[] {
  return [...new Set(items.map((item) => item.trim()).filter(Boolean))];
}

/**
 * 对 unknown 数组按业务键去重，兼容数据库历史 JSON 结构。
 */
function dedupeUnknownByKey<T>(
  items: T[],
  getKey: (item: T) => string,
): T[] {
  const merged = new Map<string, T>();
  for (const item of items) {
    const key = getKey(item).trim();
    if (!key) continue;
    merged.set(key, item);
  }

  return [...merged.values()];
}

/**
 * 对 unknown 文本数组去重，兼容数据库 JSONB 返回值。
 */
function dedupeUnknownText(items: unknown[]): unknown[] {
  const result: unknown[] = [];
  const seen = new Set<string>();
  for (const item of items) {
    if (typeof item !== "string") {
      result.push(item);
      continue;
    }
    const normalized = item.trim();
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    result.push(normalized);
  }

  return result;
}

/**
 * 从未知 JSON 对象里读取字符串字段。
 */
function getStringField(item: unknown, field: string): string {
  if (!item || typeof item !== "object") return "";
  const value = (item as Record<string, unknown>)[field];
  return typeof value === "string" ? value : "";
}
