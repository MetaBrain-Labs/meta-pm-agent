/**
 * 产品知识图谱持久化归一化测试
 *
 * 验证 API 归档边界会把运行时图谱中的实体、决策、风险和待确认问题统一转换为
 * product_knowledge_graph.nodes，确保数据库只保留 nodes/relations 时不会丢失辅助事实。
 *
 * Responsibilities:
 * - 覆盖 entities 持久化为 nodes
 * - 覆盖 decisions/risks/open_questions 规范化为节点
 * - 验证已有实体节点优先于同 ID 的简化 decision
 * - 验证历史 DEC-* 别名不会与 canonical D-* 重复持久化
 */

import assert from "node:assert/strict";
import test from "node:test";
import type { ProductKnowledgeGraph } from "@repo/shared";
import {
  buildPersistentNodes,
  createProductContextSnapshotKnowledgeGraph,
} from "../src/services/product-knowledge-graph-service";

test("normalizes runtime graph facts into persisted nodes", () => {
  const nodes = buildPersistentNodes(createKnowledgeGraph());

  assert.deepEqual(
    nodes.map((node) => [node.id, node.type]),
    [
      ["D-001", "Decision"],
      ["G-001", "Goal"],
      ["RISK-001", "Risk"],
      ["OQ-001", "OpenQuestion"],
    ],
  );
  assert.equal(
    nodes.find((node) => node.id === "D-001")?.name,
    "实体决策节点",
  );
  assert.equal(
    nodes.find((node) => node.id === "RISK-001")?.source_task_id,
    "task-02",
  );
  assert.equal(
    nodes.find((node) => node.id === "OQ-001")?.description,
    "首批目标用户是否包含外部协作者？",
  );
});

test("strips nodes and relations from product context snapshots", () => {
  const snapshot = createProductContextSnapshotKnowledgeGraph({
    ...createKnowledgeGraph(),
    current_state: "building",
    description: "Executor Agent updated the product context.",
  });

  assert.equal(snapshot.current_state, "building");
  assert.equal(snapshot.description, "Executor Agent updated the product context.");
  assert.deepEqual(snapshot.entities, []);
  assert.deepEqual(snapshot.relations, []);
  assert.equal(snapshot.decisions.length, 1);
  assert.equal(snapshot.risks.length, 1);
  assert.equal(snapshot.open_questions.length, 1);
});

/**
 * 构造包含四类运行时图谱事实的最小快照。
 */
function createKnowledgeGraph(): ProductKnowledgeGraph {
  return {
    entities: [
      {
        id: "D-001",
        type: "Decision",
        name: "实体决策节点",
        description: "这是已经结构化为实体的决策。",
        source_task_id: "task-01",
        status: "proposed",
      },
      {
        id: "G-001",
        type: "Goal",
        name: "提升协作效率",
        description: "团队希望减少需求澄清成本。",
        source_task_id: "task-01",
        status: "proposed",
      },
      {
        id: "DEC-001",
        type: "Decision",
        name: "历史辅助决策别名",
        description: "该节点应由 canonical D-001 取代。",
        source_task_id: "task-01",
        status: "proposed",
      },
    ],
    relations: [],
    decisions: [
      {
        id: "D-001",
        text: "同 ID 的简化 decision 不应覆盖实体 Decision 节点。",
        source_task_id: "task-99",
      },
    ],
    risks: [
      {
        id: "RISK-001",
        text: "缺少真实团队协作样本可能导致优先级偏差。",
        source_task_id: "task-02",
      },
    ],
    open_questions: [
      {
        id: "OQ-001",
        text: "首批目标用户是否包含外部协作者？",
        source_task_id: "task-03",
      },
    ],
    summary: [],
    markdown: "",
    notes: [],
  };
}
