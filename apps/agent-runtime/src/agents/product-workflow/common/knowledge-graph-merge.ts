/**
 * 产品知识图谱快照合并工具
 *
 * 负责在 LangGraph 并行 Executor 分支回收时合并完整知识图谱快照，处理同 ID
 * 内容冲突、相似内容去重和关系端点重写，避免后到分支覆盖先到分支。
 *
 * Responsibilities:
 * - mergeProductKnowledgeGraphSnapshots()：合并两个 ProductKnowledgeGraph 快照
 * - areKnowledgeGraphItemsSimilar()：为 Critique 校验复用图谱项相似判断
 * - generateNextGraphItemId()：为非相似冲突生成同前缀递增 ID
 *
 * Notes:
 * - 该工具只处理运行时内存图谱，不修改数据库持久化结构
 */

import type {
  KnowledgeGraphDecisionInput,
  KnowledgeGraphEntity,
  KnowledgeGraphOpenQuestionInput,
  KnowledgeGraphRelation,
  KnowledgeGraphRiskInput,
  ProductKnowledgeGraph,
} from "@repo/shared";

type KnowledgeGraphAuxiliaryItem =
  | KnowledgeGraphDecisionInput
  | KnowledgeGraphRiskInput
  | KnowledgeGraphOpenQuestionInput;

type KnowledgeGraphItemKind = "entity" | "relation" | "auxiliary";

interface MergeItemsResult<T extends { id: string }> {
  items: T[];
  idMap: Map<string, string>;
}

const SIMILARITY_THRESHOLD = 0.72;

/**
 * 合并两个完整图谱快照，保留 append-only 语义并解决并行分支的 ID 冲突。
 */
export function mergeProductKnowledgeGraphSnapshots(
  current: ProductKnowledgeGraph,
  update: ProductKnowledgeGraph,
): ProductKnowledgeGraph {
  const entityMerge = mergeGraphItems({
    current: current.entities,
    update: update.entities,
    kind: "entity",
  });
  const remappedRelations = update.relations.map((relation) =>
    remapRelationEndpoints(relation, entityMerge.idMap),
  );

  return {
    ...current,
    entities: entityMerge.items,
    relations: mergeGraphItems({
      current: current.relations,
      update: remappedRelations,
      kind: "relation",
    }).items,
    decisions: mergeGraphItems({
      current: current.decisions,
      update: update.decisions,
      kind: "auxiliary",
    }).items,
    risks: mergeGraphItems({
      current: current.risks,
      update: update.risks,
      kind: "auxiliary",
    }).items,
    open_questions: mergeGraphItems({
      current: current.open_questions,
      update: update.open_questions,
      kind: "auxiliary",
    }).items,
    summary: mergeTextList(current.summary, update.summary),
    markdown: update.markdown || current.markdown,
    notes: mergeTextList(current.notes, update.notes),
  };
}

/**
 * 判断两个知识图谱项是否表达相同或高度相似的业务内容。
 */
export function areKnowledgeGraphItemsSimilar(
  left:
    | KnowledgeGraphEntity
    | KnowledgeGraphRelation
    | KnowledgeGraphAuxiliaryItem,
  right:
    | KnowledgeGraphEntity
    | KnowledgeGraphRelation
    | KnowledgeGraphAuxiliaryItem,
  kind: KnowledgeGraphItemKind,
): boolean {
  if (kind === "entity") {
    const leftEntity = left as KnowledgeGraphEntity;
    const rightEntity = right as KnowledgeGraphEntity;
    return (
      leftEntity.type === rightEntity.type &&
      areTextValuesSimilar(
        `${leftEntity.name} ${leftEntity.description ?? ""}`,
        `${rightEntity.name} ${rightEntity.description ?? ""}`,
      )
    );
  }

  if (kind === "relation") {
    const leftRelation = left as KnowledgeGraphRelation;
    const rightRelation = right as KnowledgeGraphRelation;
    return (
      leftRelation.type === rightRelation.type &&
      leftRelation.source === rightRelation.source &&
      leftRelation.target === rightRelation.target &&
      areTextValuesSimilar(
        leftRelation.description ?? "",
        rightRelation.description ?? "",
      )
    );
  }

  return areTextValuesSimilar(
    (left as KnowledgeGraphAuxiliaryItem).text,
    (right as KnowledgeGraphAuxiliaryItem).text,
  );
}

/**
 * 合并同类图谱项：相似冲突保留一个，非相似冲突自动分配新 ID。
 */
function mergeGraphItems<T extends { id: string }>({
  current,
  update,
  kind,
}: {
  current: T[];
  update: T[];
  kind: KnowledgeGraphItemKind;
}): MergeItemsResult<T> {
  const merged = [...current];
  const byId = new Map(merged.map((item) => [item.id, item]));
  const usedIds = new Set(merged.map((item) => item.id));
  const idMap = new Map<string, string>();

  for (const item of update) {
    const existing = byId.get(item.id);
    if (!existing) {
      merged.push(item);
      byId.set(item.id, item);
      usedIds.add(item.id);
      idMap.set(item.id, item.id);
      continue;
    }

    if (
      areKnowledgeGraphItemsSimilar(
        existing as unknown as Parameters<
          typeof areKnowledgeGraphItemsSimilar
        >[0],
        item as unknown as Parameters<typeof areKnowledgeGraphItemsSimilar>[1],
        kind,
      )
    ) {
      // 相似内容只保留既有图谱项，后续关系端点继续指向保留下来的 ID。
      idMap.set(item.id, existing.id);
      continue;
    }

    const nextId = generateNextGraphItemId(item.id, usedIds);
    const renamedItem = { ...item, id: nextId };
    merged.push(renamedItem);
    byId.set(nextId, renamedItem);
    usedIds.add(nextId);
    idMap.set(item.id, nextId);
  }

  return { items: merged, idMap };
}

/**
 * 根据实体冲突合并结果重写同一快照内的关系端点。
 */
function remapRelationEndpoints(
  relation: KnowledgeGraphRelation,
  entityIdMap: Map<string, string>,
): KnowledgeGraphRelation {
  return {
    ...relation,
    source: entityIdMap.get(relation.source) ?? relation.source,
    target: entityIdMap.get(relation.target) ?? relation.target,
  };
}

/**
 * 为冲突项生成同前缀下一个可用 ID。
 */
export function generateNextGraphItemId(
  preferredId: string,
  usedIds: Set<string>,
): string {
  const parsed = parseTrailingNumber(preferredId);
  if (!parsed) {
    let suffix = 2;
    let candidate = `${preferredId}-${suffix}`;
    while (usedIds.has(candidate)) {
      suffix += 1;
      candidate = `${preferredId}-${suffix}`;
    }
    return candidate;
  }

  let maxNumber = parsed.value;
  for (const usedId of usedIds) {
    const used = parseTrailingNumber(usedId);
    if (used?.prefix === parsed.prefix) {
      maxNumber = Math.max(maxNumber, used.value);
    }
  }

  let nextNumber = maxNumber + 1;
  let candidate = formatNumberedId(parsed.prefix, nextNumber, parsed.width);
  while (usedIds.has(candidate)) {
    nextNumber += 1;
    candidate = formatNumberedId(parsed.prefix, nextNumber, parsed.width);
  }
  return candidate;
}

/**
 * 合并摘要和备注，保留首次出现顺序。
 */
function mergeTextList(current: string[], update: string[]): string[] {
  return [...new Set([...current, ...update].map((item) => item.trim()))].filter(
    Boolean,
  );
}

/**
 * 判断两段文本是否相似，使用保守的包含关系和 Dice 系数。
 */
function areTextValuesSimilar(left: string, right: string): boolean {
  const leftText = normalizeComparableText(left);
  const rightText = normalizeComparableText(right);
  if (!leftText || !rightText) return leftText === rightText;
  if (leftText === rightText) return true;

  const [shorter, longer] =
    leftText.length <= rightText.length
      ? [leftText, rightText]
      : [rightText, leftText];
  if (
    shorter.length >= 12 &&
    longer.includes(shorter) &&
    shorter.length / longer.length >= 0.55
  ) {
    return true;
  }

  const leftTokens = createSimilarityTokens(leftText);
  const rightTokens = createSimilarityTokens(rightText);
  if (Math.min(leftTokens.size, rightTokens.size) < 3) return false;

  let intersection = 0;
  for (const token of leftTokens) {
    if (rightTokens.has(token)) intersection += 1;
  }

  return (
    (2 * intersection) / (leftTokens.size + rightTokens.size) >=
    SIMILARITY_THRESHOLD
  );
}

/**
 * 归一化可比较文本，去掉大小写、全半角和标点差异。
 */
function normalizeComparableText(text: string): string {
  return text
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * 生成兼容英文词和中文短语的相似度 token。
 */
function createSimilarityTokens(text: string): Set<string> {
  const tokens = new Set<string>();
  for (const token of text.match(/[a-z0-9]+/g) ?? []) {
    if (token.length > 1) tokens.add(token);
  }

  const hanChars = [...text.matchAll(/\p{Script=Han}/gu)].map(
    (match) => match[0],
  );
  for (let index = 0; index < hanChars.length - 1; index += 1) {
    tokens.add(`${hanChars[index]}${hanChars[index + 1]}`);
  }
  if (hanChars.length === 1) tokens.add(hanChars[0]);

  return tokens;
}

/**
 * 解析 ID 尾部数字，用于保留 R-003、REL-017 这类编号格式。
 */
function parseTrailingNumber(
  value: string,
): { prefix: string; value: number; width: number } | null {
  const match = value.match(/^(.*?)(\d+)$/);
  if (!match) return null;

  return {
    prefix: match[1],
    value: Number(match[2]),
    width: match[2].length,
  };
}

/**
 * 按原始宽度格式化递增后的编号。
 */
function formatNumberedId(
  prefix: string,
  value: number,
  width: number,
): string {
  return `${prefix}${String(value).padStart(width, "0")}`;
}
