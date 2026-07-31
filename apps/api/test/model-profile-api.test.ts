/**
 * 模型使用列表 API 边界测试
 *
 * 在不依赖手动建表的情况下验证请求参数校验与运行态切换保护。
 */

import assert from "node:assert/strict";
import test from "node:test";
import { Hono } from "hono";
import {
  createModelProfileHandler,
  selectConversationModelProfileHandler,
} from "../src/controllers/model-profile-controller";
import {
  registerChatRun,
  unregisterChatRun,
} from "../src/services/chat-run-registry";
import { StartDocumentGenerationRequestSchema } from "../src/schemas/document.schema";

test("requires a model profile when starting Document generation", () => {
  assert.equal(
    StartDocumentGenerationRequestSchema.safeParse({ kind: "prd" }).success,
    false,
  );
  assert.deepEqual(
    StartDocumentGenerationRequestSchema.parse({
      kind: "prd",
      profileId: "system-default",
    }),
    { kind: "prd", profileId: "system-default" },
  );
});

test("rejects an invalid model profile before database access", async () => {
  const app = new Hono();
  app.post("/model-profiles", createModelProfileHandler);
  const response = await app.request("/model-profiles", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name: "invalid",
      config: {
        mode: "universal",
        model: {
          provider: "deepseek",
          modelId: "deepseek-v4-pro",
          customName: "bad",
          baseUrl: "file:///unsafe",
          thinking: true,
          temperature: 3,
          topP: 2,
          maxTokens: 0,
          reasoningEffort: "low",
          pricing: {
            cacheHitInputPricePerMillion: -1,
            cacheMissInputPricePerMillion: 3,
            outputPricePerMillion: 6,
          },
        },
      },
    }),
  });
  assert.equal(response.status, 400);
});

test("returns 409 before database access when a chat is running", async () => {
  const app = new Hono();
  app.put("/chats/:id/model-profile", selectConversationModelProfileHandler);
  const controller = new AbortController();
  registerChatRun("chat-running", controller);
  try {
    const response = await app.request("/chats/chat-running/model-profile", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ profileId: "system-default" }),
    });
    assert.equal(response.status, 409);
  } finally {
    unregisterChatRun("chat-running", controller);
  }
});
