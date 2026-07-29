/**
 * 模型 reasoning 兼容适配测试
 *
 * 验证 OpenAI 兼容接口的 reasoning_content 会被提升为 Event Streaming v3
 * 可识别的 reasoning block，同时保留同一增量中的可见文本。
 */

import assert from "node:assert/strict";
import test from "node:test";
import { AIMessage, AIMessageChunk, ToolMessage } from "langchain";
import {
  prepareMessagesForProvider,
  promoteReasoningContent,
  restoreProviderReasoningContent,
} from "../src/agents/common/model";
import {
  getReasoningContent,
  getTextContent,
} from "../src/utils/message-adapter";

test("promotes provider reasoning_content into v3 content blocks", () => {
  const message = new AIMessageChunk({
    content: "323",
    additional_kwargs: {
      reasoning_content: "Calculate the multiplication.",
    },
  });

  promoteReasoningContent(message);

  assert.equal(getReasoningContent(message), "Calculate the multiplication.");
  assert.equal(getTextContent(message), "323");
  assert.deepEqual(message.content, [
    {
      type: "reasoning",
      reasoning: "Calculate the multiplication.",
      index: 1,
    },
    { type: "text", text: "323", index: 0 },
  ]);
});

test("removes reasoning blocks only from copied provider history", () => {
  const message = new AIMessage({
    content: [
      {
        type: "reasoning",
        reasoning: "Decide which tool to call.",
        index: 1,
      },
      { type: "text", text: "Calling the worker.", index: 0 },
    ],
    additional_kwargs: {
      reasoning_content: "Decide which tool to call.",
    },
    response_metadata: { output_version: "v1" },
    tool_calls: [
      {
        id: "call-1",
        name: "task",
        args: { subagent_type: "worker" },
        type: "tool_call",
      },
    ],
  });

  const [providerMessage] = prepareMessagesForProvider([message]);

  assert.notEqual(providerMessage, message);
  assert.equal(providerMessage?.content, "Calling the worker.");
  assert.equal(
    providerMessage?.additional_kwargs.reasoning_content,
    "Decide which tool to call.",
  );
  assert.equal(providerMessage?.response_metadata.output_version, undefined);
  assert.deepEqual(
    AIMessage.isInstance(providerMessage) ? providerMessage.tool_calls : [],
    message.tool_calls,
  );
  assert.equal(getReasoningContent(message), "Decide which tool to call.");
});

test("removes subagent reasoning blocks from copied task results", () => {
  const message = new ToolMessage({
    content: [
      {
        type: "reasoning",
        reasoning: "Calculate the result.",
        index: 1,
      },
      { type: "text", text: '{"answer":323}', index: 0 },
    ],
    tool_call_id: "call-1",
    status: "success",
  });

  const [providerMessage] = prepareMessagesForProvider([message]);

  assert.notEqual(providerMessage, message);
  assert.equal(providerMessage?.content, '{"answer":323}');
  assert.equal(
    ToolMessage.isInstance(providerMessage)
      ? providerMessage.tool_call_id
      : undefined,
    "call-1",
  );
  assert.equal(getReasoningContent(message), "Calculate the result.");
});

test("passes reasoning_content back with assistant tool calls", () => {
  const history = new AIMessage({
    content: [
      {
        type: "reasoning",
        reasoning: "Research before writing graph evidence.",
        index: 1,
      },
    ],
    additional_kwargs: {
      reasoning_content: "Research before writing graph evidence.",
    },
    tool_calls: [
      {
        id: "call-search",
        name: "web_search",
        args: { query: "private deployment" },
        type: "tool_call",
      },
    ],
  });
  const request = {
    stream: true,
    messages: [
      {
        role: "assistant",
        content: "",
        tool_calls: [
          {
            id: "call-search",
            type: "function",
            function: {
              name: "web_search",
              arguments: '{"query":"private deployment"}',
            },
          },
        ],
      },
    ],
  };

  const restored = restoreProviderReasoningContent(request, [history]);

  assert.equal(
    restored.messages[0]?.reasoning_content,
    "Research before writing graph evidence.",
  );
  assert.equal(restored.messages[0]?.content, "");
});
