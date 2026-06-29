/**
 * tagged-block-stream 单元测试
 *
 * 验证 streamTaggedBlock 对 question-form 和 user-input 标记块的
 * 检测、收集和事件转换逻辑，覆盖基本标记块、嵌套、混合和空白输入场景。
 *
 * Responsibilities:
 * - 测试 question-form 标记块的正确分段
 * - 测试 user-input 标记块的正确分段
 * - 测试标记块前导/尾部文本透传
 * - 测试空输入和缺失闭合标记的边界情况
 */

import assert from "node:assert/strict";
import test from "node:test";
import { streamTaggedBlock } from "../src/utils/tagged-block-stream";
import type { StreamChunk } from "../src/types";

test("parses a tagged block split across chunks", async () => {
  const events = await collect([
    text("Before <question"),
    text('-form id="discovery">{}'),
    text("</question-form>After"),
  ]);

  assert.deepEqual(events, [
    { type: "text", content: "Before " },
    { type: "question-form-start" },
    {
      type: "question-form-complete",
      content:
        '<question-form id="discovery">{}</question-form>',
    },
    { type: "text", content: "After" },
  ]);
});

test("passes reasoning through without disturbing text buffering", async () => {
  const events = await collect([
    text("<ques"),
    { type: "reasoning", content: "thinking" },
    text('tion-form id="discovery">{}'),
    text("</question-form>"),
  ]);

  assert.deepEqual(events, [
    { type: "reasoning", content: "thinking" },
    { type: "question-form-start" },
    {
      type: "question-form-complete",
      content:
        '<question-form id="discovery">{}</question-form>',
    },
  ]);
});

test("flushes an unclosed tagged block as text", async () => {
  const events = await collect([
    text("Before <question-form incomplete"),
  ]);

  assert.deepEqual(events, [
    { type: "text", content: "Before " },
    { type: "question-form-start" },
    { type: "text", content: "<question-form incomplete" },
  ]);
});

test("parses user-input blocks with multiple tag options", async () => {
  const events = await Array.fromAsync(
    streamTaggedBlock(toAsyncIterable([
      text("Before <user"),
      text('-input>{"user_input":[]}'),
      text("</user-input>After"),
    ]), [
      {
        startMarker: "<question-form",
        endMarker: "</question-form>",
        startEvent: "question-form-start",
        completeEvent: "question-form-complete",
      },
      {
        startMarker: "<user-input",
        endMarker: "</user-input>",
        startEvent: "user-input-start",
        completeEvent: "user-input-complete",
      },
    ]),
  );

  assert.deepEqual(events, [
    { type: "text", content: "Before " },
    { type: "user-input-start" },
    {
      type: "user-input-complete",
      content:
        '<user-input>{"user_input":[]}</user-input>',
    },
    { type: "text", content: "After" },
  ]);
});

test("parses workflow-resume blocks with multiple tag options", async () => {
  const events = await Array.fromAsync(
    streamTaggedBlock(toAsyncIterable([
      text('<workflow-resume>{"intent":"continue_interrupted_workflow"}'),
      text("</workflow-resume>"),
    ]), [
      {
        startMarker: "<question-form",
        endMarker: "</question-form>",
        startEvent: "question-form-start",
        completeEvent: "question-form-complete",
      },
      {
        startMarker: "<workflow-resume",
        endMarker: "</workflow-resume>",
        startEvent: "workflow-resume-start",
        completeEvent: "workflow-resume-complete",
      },
    ]),
  );

  assert.deepEqual(events, [
    { type: "workflow-resume-start" },
    {
      type: "workflow-resume-complete",
      content:
        '<workflow-resume>{"intent":"continue_interrupted_workflow"}</workflow-resume>',
    },
  ]);
});

async function collect(chunks: StreamChunk[]) {
  return Array.fromAsync(
    streamTaggedBlock(toAsyncIterable(chunks), {
      startMarker: "<question-form",
      endMarker: "</question-form>",
      startEvent: "question-form-start",
      completeEvent: "question-form-complete",
    }),
  );
}

async function* toAsyncIterable(chunks: StreamChunk[]) {
  yield* chunks;
}

function text(content: string): StreamChunk {
  return { type: "text", content };
}
