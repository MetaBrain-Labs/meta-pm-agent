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
  selectDefaultModelProfileHandler,
} from "../src/controllers/model-profile-controller";
import { createWorkspaceHandler } from "../src/controllers/chat-controller";
import {
  registerChatRun,
  unregisterChatRun,
} from "../src/services/chat-run-registry";
import { StartDocumentGenerationRequestSchema } from "../src/schemas/document.schema";

test("start-document generation accepts an omitted model profile", () => {
  // 省略 profileId 表示使用用户记住的默认列表；显式传入时才覆盖默认值。
  assert.deepEqual(StartDocumentGenerationRequestSchema.parse({ kind: "prd" }), {
    kind: "prd",
  });
  assert.deepEqual(
    StartDocumentGenerationRequestSchema.parse({
      kind: "prd",
      profileId: "system-default",
    }),
    { kind: "prd", profileId: "system-default" },
  );
  assert.equal(
    StartDocumentGenerationRequestSchema.safeParse({ kind: "prd", profileId: "" })
      .success,
    false,
  );
});

test("rejects a malformed default model profile before database access", async () => {
  const app = new Hono();
  app.put("/model-profiles/default", selectDefaultModelProfileHandler);

  for (const profileId of [undefined, "", "not-a-uuid", 42]) {
    const response = await app.request("/model-profiles/default", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ profileId }),
    });
    assert.equal(response.status, 400, `${String(profileId)} must be rejected`);
    // 校验错误指向 profileId，证明静态路由没有被 /model-profiles/:id 抢先匹配。
    const body = (await response.json()) as {
      error: { fieldErrors: Record<string, unknown> };
    };
    assert.deepEqual(Object.keys(body.error.fieldErrors), ["profileId"]);
  }
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
          modelId: "deepseek-flash",
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

test("rejects a relative workspace path before database access", async () => {
  const app = new Hono();
  app.post("/workspaces", createWorkspaceHandler);
  const response = await app.request("/workspaces", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: "Local project", localPath: "relative/path" }),
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
