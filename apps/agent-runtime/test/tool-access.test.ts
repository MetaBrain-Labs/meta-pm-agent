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
import { filterToolsByAllowedNames } from "../src/agents/common/deep-agent-tool-policy";

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

test("conversation allowlist removes DeepAgents built-in tools unless web search is enabled", () => {
  const deepAgentInjectedTools = createNamedTools([
    "write_todos",
    "task",
    "edit_file",
    "web_search",
  ]);
  const disabledAllowedNames = new Set(
    createToolsForAgent("conversation", []).map((tool) => tool.name),
  );
  const enabledAllowedNames = new Set(
    createToolsForAgent("conversation", ["web_search"]).map(
      (tool) => tool.name,
    ),
  );

  assert.deepEqual(
    filterToolsByAllowedNames(
      deepAgentInjectedTools,
      disabledAllowedNames,
    )?.map((tool) => tool.name),
    [],
  );
  assert.deepEqual(
    filterToolsByAllowedNames(
      deepAgentInjectedTools,
      enabledAllowedNames,
    )?.map((tool) => tool.name),
    ["web_search"],
  );
});

test("product workflow allowlist keeps only runtime-authorized tools", () => {
  const deepAgentInjectedTools = createNamedTools([
    "write_todos",
    "task",
    "edit_file",
    "web_search",
    "kg_file_read",
    "kg_file_add_nodes",
  ]);
  const allowedNames = new Set(
    createToolsForAgent(
      "executor-market-research",
      getExecutorDefaultToolNames("executor-market-research"),
      { knowledgeGraph: createEmptyKnowledgeGraph() },
    ).map((tool) => tool.name),
  );

  assert.deepEqual(
    filterToolsByAllowedNames(deepAgentInjectedTools, allowedNames)?.map(
      (tool) => tool.name,
    ),
    ["web_search", "kg_file_read", "kg_file_add_nodes"],
  );
});

test("document allowlist keeps only the explicitly required builtin tools", () => {
  const deepAgentInjectedTools = createNamedTools([
    "write_todos",
    "task",
    "read_file",
    "edit_file",
    "web_search",
  ]);

  assert.deepEqual(
    filterToolsByAllowedNames(
      deepAgentInjectedTools,
      new Set(["write_todos", "task"]),
    )?.map((tool) => tool.name),
    ["write_todos", "task"],
  );
});

function createNamedTools(names: string[]): Array<{ name: string }> {
  return names.map((name) => ({ name }));
}

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
