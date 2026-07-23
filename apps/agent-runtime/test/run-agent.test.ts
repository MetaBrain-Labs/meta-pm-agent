/**
 * Agent 通用执行器结果解析测试
 *
 * 验证统一 runner 使用的纯结果解析函数和必需 SubAgent 校验，
 * 避免执行器收敛后改变既有 fallback 判定。
 *
 * Responsibilities:
 * - 验证 JSON 成功、格式失败和 schema 失败
 * - 验证文本成功与空输出失败
 * - 验证必需 SubAgent 调用判断
 */

import assert from "node:assert/strict";
import test from "node:test";
import {
  getMissingRequiredSubagentError,
  resolveJsonOutput,
  resolveTextOutput,
} from "../src/agents/common/run-agent";

/** 构造不含 provider token 数据的解析上下文。 */
const context = (text: string) => ({
  text,
  tokenUsage: null,
  maxTokens: 100,
});

test("resolves valid JSON through the supplied schema", () => {
  const result = resolveJsonOutput(context('{"ok":true}'), {
    safeParse: (value) =>
      typeof value === "object" &&
      value !== null &&
      (value as { ok?: unknown }).ok === true
        ? { success: true as const, data: value as { ok: true } }
        : { success: false as const, error: new Error("invalid") },
  });

  assert.deepEqual(result, { success: true, data: { ok: true } });
});

test("reports invalid JSON and schema failures", () => {
  assert.equal(
    resolveJsonOutput(context("not-json"), {
      safeParse: () => ({ success: true as const, data: true }),
    }).success,
    false,
  );

  const schemaFailure = resolveJsonOutput(context('{"ok":false}'), {
    safeParse: () => ({
      success: false as const,
      error: { issues: [{ path: ["ok"], message: "Expected true" }] },
    }),
  });
  assert.deepEqual(schemaFailure, {
    success: false,
    reason: "schema-validation: ok: Expected true",
  });
});

test("resolves trimmed text and rejects empty output", () => {
  assert.deepEqual(resolveTextOutput(context("  result  ")), {
    success: true,
    data: "result",
  });
  assert.deepEqual(resolveTextOutput(context("   ")), {
    success: false,
    reason: "empty-output",
  });
});

test("requires an actual SubAgent invocation", () => {
  assert.equal(
    getMissingRequiredSubagentError("planner", new Set()),
    "required-subagent-not-invoked: planner",
  );
  assert.equal(
    getMissingRequiredSubagentError("planner", new Set(["planner"])),
    null,
  );
});
