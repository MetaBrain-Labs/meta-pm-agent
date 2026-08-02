/**
 * JSON 解析器边界测试
 *
 * 验证结构化模型输出解析器在混合文本和截断输出下的行为，避免截断的根 JSON 被错误降级
 * 为内部对象并触发误导性的 schema 校验错误。
 *
 * Responsibilities:
 * - 验证完整根 JSON 可被正常解析
 * - 验证 Markdown fenced JSON 不会触发昂贵的模型重试
 * - 验证带前后缀文本的完整 JSON 仍可被提取
 * - 验证带前言的嵌套 JSON 不会退化为最后一个内部对象
 * - 验证截断根 JSON 不会退化解析内部对象
 *
 * Notes:
 * - 该测试不调用模型，只覆盖本地 JSON 提取策略。
 */

import assert from "node:assert/strict";
import test from "node:test";
import { parseJsonObject } from "../src/utils/json";

test("parseJsonObject returns the full root JSON object", () => {
  assert.deepEqual(parseJsonObject('{"outer":{"inner":true}}'), {
    outer: { inner: true },
  });
});

test("parseJsonObject accepts markdown fenced JSON", () => {
  assert.deepEqual(parseJsonObject('```json\n{"status":"supplement"}\n```'), {
    status: "supplement",
  });
});

test("parseJsonObject extracts a complete object from mixed text", () => {
  assert.deepEqual(parseJsonObject('prefix {"ok":true} suffix'), {
    ok: true,
  });
});

test("parseJsonObject keeps the outer object when prefixed JSON is nested", () => {
  assert.deepEqual(
    parseJsonObject(
      'result: {"summary":"ok","questions":[{"id":"q1","label":"Answer"}]}',
    ),
    {
      summary: "ok",
      questions: [{ id: "q1", label: "Answer" }],
    },
  );
});

test("parseJsonObject does not parse nested objects from a truncated root JSON", () => {
  const truncated =
    '{"status":"initial","tasks":[{"task_id":"task-1","quality_check":{"criteria":["done"]}';

  assert.equal(parseJsonObject(truncated), null);
});
