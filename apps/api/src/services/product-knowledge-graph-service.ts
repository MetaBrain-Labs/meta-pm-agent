/**
 * 产品知识图谱服务
 *
 * 负责把运行时 ProductKnowledgeGraph 归档到数据库，并为前端知识图谱查看器
 * 返回结构化节点、关系和可下载 Markdown。数据库长期只保留 nodes/relations，
 * 运行期辅助字段会在归档边界规范化为节点写入 nodes。
 *
 * Responsibilities:
 * - finalizeWorkspaceKnowledgeGraph()：归档当前工作区的图谱节点和关系
 * - clearWorkspaceKnowledgeGraph()：在用户确认替换当前项目时清空图谱
 * - getWorkspaceKnowledgeGraph()：读取图谱并生成前端展示 DTO
 * - 对节点和关系按业务 key 去重，避免重试或并行合并造成重复
 *
 * Notes:
 * - summary 只保留为运行期结构，不作为 DB 列交互。
 * - decisions、risks、open_questions 以 Decision/Risk/OpenQuestion 节点形式持久化。
 */

import type {
  KnowledgeGraphEntity,
  KnowledgeGraphRelation,
  ProductKnowledgeGraph,
} from "@repo/shared";
import {
  clearProductKnowledgeGraphByWorkspaceId,
  getProductKnowledgeGraphByWorkspaceId,
  upsertProductKnowledgeGraph,
  type ProductKnowledgeGraphRow,
} from "../repositories/product-knowledge-graph-repository";
import {
  clearProductContextSnapshotByWorkspaceId,
  upsertProductContextSnapshot,
} from "../repositories/product-context-snapshot-repository";
import {
  clearProductContextResourceSnapshot,
  writeProductContextResourceSnapshot,
} from "./product-context-resource-service";

/**
 * 归档输入，携带结构化知识图谱数据与关联本轮会话/请求表单的溯源信息。
 */
export interface FinalizeProductKnowledgeGraphInput {
  workspaceId?: string;
  conversationId?: string;
  requestFormId?: string;
  /** 完整的运行时知识图谱状态。 */
  knowledgeGraph?: ProductKnowledgeGraph;
  /** 是否把本次写入计为一轮完成的知识图谱版本。 */
  advanceVersion?: boolean;
}

/**
 * 将工作流产出的知识图谱节点和关系归档到数据库。
 */
export async function finalizeWorkspaceKnowledgeGraph({
  workspaceId,
  conversationId,
  requestFormId,
  knowledgeGraph,
  advanceVersion = true,
}: FinalizeProductKnowledgeGraphInput): Promise<void> {
  if (!workspaceId || !knowledgeGraph) return;
  if (!hasRuntimeContextData(knowledgeGraph)) return;

  const normalizedGraph = normalizeKnowledgeGraphForPersistence(knowledgeGraph);
  const hasGraphData =
    normalizedGraph.nodes.length > 0 || normalizedGraph.relations.length > 0;
  await persistProductContextSnapshots({
    workspaceId,
    conversationId,
    requestFormId,
    knowledgeGraph,
    advanceVersion,
  });
  if (!hasGraphData) return;

  await upsertProductKnowledgeGraph({
    workspaceId,
    conversationId,
    requestFormId,
    advanceVersion,
    nodes: normalizedGraph.nodes,
    relations: normalizedGraph.relations,
  });
}

/**
 * 清空当前工作区的产品知识图谱，避免新项目沿用旧项目节点和关系。
 */
export async function clearWorkspaceKnowledgeGraph(
  workspaceId: string | undefined,
): Promise<void> {
  if (!workspaceId) return;
  await clearProductContextResourceSnapshot(workspaceId);
  await clearOptionalProductContextSnapshot(workspaceId);
  await clearProductKnowledgeGraphByWorkspaceId(workspaceId);
}

/**
 * 前端知识图谱查询的返回结果。
 */
export interface WorkspaceKnowledgeGraphData {
  /** nodes 有数据时可用。 */
  hasData: boolean;
  /** 结构化数据按参考格式生成的 markdown。 */
  markdown: string;
  /** 结构化节点数据，供图可视化使用。 */
  nodes: KnowledgeGraphEntity[];
  /** 结构化关系数据，供图可视化使用。 */
  relations: KnowledgeGraphRelation[];
  version: number;
  updatedAt: string;
}

/**
 * 按工作区 ID 获取产品知识图谱数据及生成的 markdown。
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
  const hasData = nodes.length > 0;

  return {
    hasData,
    markdown: hasData ? generateReferenceMarkdown(normalizedRow) : "",
    nodes,
    relations,
    version: row.version,
    updatedAt: row.updatedAt,
  };
}

/**
 * 从 DB 行数据按参考格式生成 markdown。
 */
function generateReferenceMarkdown(row: ProductKnowledgeGraphRow): string {
  const lines: string[] = [];

  lines.push("# Product Knowledge Graph");
  lines.push("");
  lines.push(
    "> 当前文件由 Executor Agent 按任务逐步维护。数据库长期事实源只保留 nodes 和 relations；决策、风险和待确认问题会规范化为节点。",
  );
  lines.push("");
  lines.push("## Graph Updates");
  lines.push("");

  const nodes = Array.isArray(row.nodes) ? row.nodes : [];
  if (nodes.length > 0) {
    lines.push("### Nodes");
    lines.push("");
    lines.push("| id | type | name | description | source_task_id | status |");
    lines.push("| --- | --- | --- | --- | --- | --- |");
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

  const relations = Array.isArray(row.relations) ? row.relations : [];
  if (relations.length > 0) {
    lines.push("### Relations");
    lines.push("");
    lines.push("| id | type | source | target | description | source_task_id |");
    lines.push("| --- | --- | --- | --- | --- | --- |");
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

  return lines.join("\n");
}

/**
 * 转义 markdown 表格中的管道和换行。
 */
function esc(value: string): string {
  return value.replace(/\|/g, "\\|").replace(/\r?\n/g, " ");
}

/**
 * 读取时规范化历史图谱行。
 */
function normalizeKnowledgeGraphRow(
  row: ProductKnowledgeGraphRow,
): ProductKnowledgeGraphRow {
  return {
    ...row,
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
  };
}

/**
 * 入库前规范化图谱数据，避免 Executor 重试或并行合并造成重复记录。
 */
function normalizeKnowledgeGraphForPersistence(
  knowledgeGraph: ProductKnowledgeGraph,
): { nodes: KnowledgeGraphEntity[]; relations: KnowledgeGraphRelation[] } {
  return {
    nodes: buildPersistentNodes(knowledgeGraph),
    relations: dedupeByKey(
      knowledgeGraph.relations,
      (item) =>
        item.id ||
        `${item.type}:${item.source}:${item.target}:${item.source_task_id ?? ""}`,
    ),
  };
}

/**
 * 判断运行时图谱是否包含任何可恢复上下文。
 */
function hasRuntimeContextData(knowledgeGraph: ProductKnowledgeGraph): boolean {
  return (
    knowledgeGraph.entities.length > 0 ||
    knowledgeGraph.relations.length > 0 ||
    knowledgeGraph.decisions.length > 0 ||
    knowledgeGraph.risks.length > 0 ||
    knowledgeGraph.open_questions.length > 0 ||
    knowledgeGraph.summary.length > 0 ||
    knowledgeGraph.notes.length > 0 ||
    Boolean(knowledgeGraph.markdown.trim())
  );
}

/**
 * 同步写入 resources 快照和可选 DB 快照，作为下次 Orchestrator 加载上下文的来源。
 */
async function persistProductContextSnapshots({
  workspaceId,
  conversationId,
  requestFormId,
  knowledgeGraph,
  advanceVersion,
}: Required<Pick<FinalizeProductKnowledgeGraphInput, "workspaceId" | "knowledgeGraph">> &
  Pick<
    FinalizeProductKnowledgeGraphInput,
    "conversationId" | "requestFormId" | "advanceVersion"
  >): Promise<void> {
  try {
    await writeProductContextResourceSnapshot({
      workspaceId,
      conversationId,
      requestFormId,
      knowledgeGraph,
    });
  } catch (error) {
    console.warn("[knowledge-graph] Failed to write resources snapshot:", error);
  }

  try {
    await upsertProductContextSnapshot({
      workspaceId,
      conversationId,
      requestFormId,
      advanceVersion,
      context: {
        kind: "product_context_snapshot",
        knowledgeGraph,
      },
    });
  } catch (error) {
    if (!isMissingOptionalSnapshotTableError(error)) {
      throw error;
    }
  }
}

/**
 * 清理可选 DB 快照；表未创建时安静降级。
 */
async function clearOptionalProductContextSnapshot(
  workspaceId: string,
): Promise<void> {
  try {
    await clearProductContextSnapshotByWorkspaceId(workspaceId);
  } catch (error) {
    if (!isMissingOptionalSnapshotTableError(error)) {
      throw error;
    }
  }
}

/**
 * 判断可选 product_context_snapshot 表是否尚未创建。
 */
function isMissingOptionalSnapshotTableError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return (
    message.includes("product_context_snapshot") &&
    (message.includes("42P01") ||
      message.includes("does not exist") ||
      message.includes("不存在"))
  );
}

/**
 * 把运行时图谱中的实体、决策、风险和待确认问题统一归档为 nodes。
 */
export function buildPersistentNodes(
  knowledgeGraph: ProductKnowledgeGraph,
): KnowledgeGraphEntity[] {
  const nodes = new Map<string, KnowledgeGraphEntity>();

  for (const entity of knowledgeGraph.entities) {
    const key = entity.id.trim();
    if (!key) continue;
    nodes.set(key, entity);
  }

  for (const decision of knowledgeGraph.decisions) {
    addAuxiliaryNode(nodes, {
      id: decision.id,
      type: "Decision",
      name: toNodeName(decision.text),
      description: decision.text,
      source_task_id: decision.source_task_id,
      status: "proposed",
    });
  }

  for (const risk of knowledgeGraph.risks) {
    addAuxiliaryNode(nodes, {
      id: risk.id,
      type: "Risk",
      name: toNodeName(risk.text),
      description: risk.text,
      source_task_id: risk.source_task_id,
      status: "proposed",
    });
  }

  for (const question of knowledgeGraph.open_questions) {
    addAuxiliaryNode(nodes, {
      id: question.id,
      type: "OpenQuestion",
      name: toNodeName(question.text),
      description: question.text,
      source_task_id: question.source_task_id,
      status: "proposed",
    });
  }

  return [...nodes.values()];
}

/**
 * 追加辅助节点；实体节点已存在时不覆盖，避免 Decision 实体被简化 decision 替换。
 */
function addAuxiliaryNode(
  nodes: Map<string, KnowledgeGraphEntity>,
  node: KnowledgeGraphEntity,
): void {
  const key = node.id.trim();
  if (!key || nodes.has(key)) return;
  nodes.set(key, node);
}

/**
 * 从长文本生成紧凑节点名。
 */
function toNodeName(text: string): string {
  const normalized = text.trim().replace(/\s+/g, " ");
  return normalized.length > 80 ? `${normalized.slice(0, 79)}…` : normalized;
}

/**
 * 按稳定 key 去重，保留同 key 最后一次写入的完整对象。
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
 * 对 unknown 数组按业务 key 去重，兼容数据库历史 JSON 结构。
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
 * 从未知 JSON 对象里读取字符串字段。
 */
function getStringField(item: unknown, field: string): string {
  if (!item || typeof item !== "object") return "";
  const value = (item as Record<string, unknown>)[field];
  return typeof value === "string" ? value : "";
}
