/**
 * 本地 API 边界测试
 *
 * Responsibilities:
 * - 验证路由和请求校验
 * - 验证允许的本地来源和不可信来源的拒绝行为
 *
 * Notes:
 * - 不调用真实模型或业务数据库
 */
import assert from "node:assert/strict";
import test from "node:test";
import { createApp } from "../src/app";

/** 验证本地前端可跨域读取健康状态。 */
test("allows configured local browser origins", async () => {
  for (const origin of ["http://localhost:3000", "http://127.0.0.1:3000"]) {
    const response = await createApp().request("/api/health", { headers: { Origin: origin } });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("access-control-allow-origin"), origin);
  }
});

/** 验证外部来源在进入业务处理前被拒绝。 */
test("rejects external and opaque origins before handling mutations", async () => {
  for (const origin of ["https://example.com", "null", "http://localhost:3000.attacker.test"]) {
    const response = await createApp().request("/api/chat", {
      method: "POST", headers: { Origin: origin, "Content-Type": "application/json" }, body: "{}",
    });
    assert.equal(response.status, 403);
    assert.equal(response.headers.get("access-control-allow-origin"), null);
  }
});

/** 验证 SSE 请求的预检允许本地来源。 */
test("allows local chat preflight", async () => {
  const response = await createApp().request("/api/chat", {
    method: "OPTIONS", headers: { Origin: "http://localhost:3000", "Access-Control-Request-Method": "POST" },
  });
  assert.equal(response.status, 204);
  assert.equal(response.headers.get("access-control-allow-origin"), "http://localhost:3000");
});

test("serves the health endpoint", async () => {
  const response = await createApp().request("/api/health");

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    status: "ok",
    agents: ["deepagents-pm-agent"],
  });
});

test("does not expose the local account route", async () => {
  const response = await createApp().request("/api/account");
  assert.equal(response.status, 404);
});

test("requires an explicit local path when adding a workspace", async () => {
  const response = await createApp().request("/api/workspaces", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: "Local project" }),
  });
  assert.equal(response.status, 400);
});

test("keeps the chat endpoint at /api/chat", async () => {
  const response = await createApp().request("/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ messages: [] }),
  });

  assert.equal(response.status, 400);
});

test("returns 400 for malformed JSON", async () => {
  const response = await createApp().request("/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "{",
  });

  assert.equal(response.status, 400);
});

test("rejects unknown chat runtime tools", async () => {
  const response = await createApp().request("/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      enabledTools: ["unknown_tool"],
      messages: [
        {
          id: "local-message",
          role: "user",
          content: "hello",
          timestamp: new Date().toISOString(),
          sessionId: "local",
        },
      ],
    }),
  });

  assert.equal(response.status, 400);
});

test("requires a workspace id when listing chats", async () => {
  const response = await createApp().request("/api/chats");

  assert.equal(response.status, 400);
});

test("requires a workspace id when creating a chat", async () => {
  const response = await createApp().request("/api/chats", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ title: "conversation" }),
  });

  assert.equal(response.status, 400);
});
