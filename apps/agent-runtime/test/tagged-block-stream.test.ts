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
