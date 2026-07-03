/**
 * Agent 工具授权策略测试
 *
 * 验证 Conversation Agent 的用户可选工具仍由前端 enabledTools 控制，
 * 同时需要外部事实的 Executor Agent 可由 runtime 默认获得 web_search。
 *
 * Responsibilities:
 * - 验证 Conversation Agent 未启用时不可见 web_search
 * - 验证需要外部事实的 Executor 默认获得 web_search
 * - 验证不需要外部事实的 Executor 不默认获得 web_search
 *
 * Notes:
 * - 该测试只检查工具可见性，不实际调用网络搜索。
 */

import assert from "node:assert/strict";
import test from "node:test";
import type { ProductKnowledgeGraph } from "@repo/shared";
import {
  createToolsForAgent,
  getExecutorDefaultToolNames,
} from "../src/agents/common/tool-access";

test("conversation web search remains controlled by enabledTools", () => {
  assert.equal(
    createToolsForAgent("conversation", [])
      .map((tool) => tool.name)
      .includes("web_search"),
    false,
  );

  assert.equal(
    createToolsForAgent("conversation", ["web_search"])
      .map((tool) => tool.name)
      .includes("web_search"),
    true,
  );
});

test("research-oriented executors receive runtime web search by default", () => {
  const toolNames = createToolsForAgent(
    "executor-market-research",
    getExecutorDefaultToolNames("executor-market-research"),
    { knowledgeGraph: createEmptyKnowledgeGraph() },
  ).map((tool) => tool.name);

  assert.equal(toolNames.includes("web_search"), true);
  assert.equal(toolNames.includes("kg_file_read"), true);
  assert.equal(toolNames.includes("kg_file_add_nodes"), true);
});

test("strategy executor does not receive web search by default", () => {
  const toolNames = createToolsForAgent(
    "executor-product-strategy",
    getExecutorDefaultToolNames("executor-product-strategy"),
    { knowledgeGraph: createEmptyKnowledgeGraph() },
  ).map((tool) => tool.name);

  assert.equal(toolNames.includes("web_search"), false);
  assert.equal(toolNames.includes("kg_file_read"), true);
});

function createEmptyKnowledgeGraph(): ProductKnowledgeGraph {
  return {
    entities: [],
    relations: [],
    decisions: [],
    risks: [],
    open_questions: [],
    summary: [],
    markdown: "",
    notes: [],
  };
}
