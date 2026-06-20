import assert from "node:assert/strict";
import test from "node:test";
import { createApp } from "../src/app";

test("serves the health endpoint", async () => {
  const response = await createApp().request("/api/health");

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    status: "ok",
    agents: ["deepagents-pm-agent"],
  });
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
