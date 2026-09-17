/**
 * 提示词配置 API 边界测试
 *
 * 验证请求参数、Prompt Registry 白名单和内容校验规则，这些检查都发生在数据库访问
 * 之前，因此用例不需要数据库。
 *
 * Notes:
 * - 只使用真实路由，确保 API 表面与前端调用一致
 * - 命中数据库的保存 / 读取路径由 gated 集成测试覆盖
 */

import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { MAX_PROMPT_CONTENT_LENGTH } from "@repo/shared";
import { createPromptSummary, PROMPT_CATALOG } from "@repo/agent-runtime";
import { createApp } from "../src/app";
import { isMissingPromptOverrideTable } from "../src/repositories/prompt-override-repository";
import { createOverrideSnapshot } from "../src/services/prompt-config-service";

const PROMPT_ID = "conversation-agent-chat";
const REQUIRED_TOKEN_PROMPT_ID = "conversation-agent-project";
const CUSTOM_CHAT_PROMPT = "# Custom chat policy";
const SAVED_AT = "2026-09-18T00:00:00.000Z";

/** 构造工作区提示词接口地址。 */
function promptUrl(workspaceId: string, promptId: string): string {
  return `/api/workspaces/${workspaceId}/prompts/${promptId}`;
}

/** 发起保存请求。 */
function savePrompt(
  app: ReturnType<typeof createApp>,
  workspaceId: string,
  promptId: string,
  content: unknown,
) {
  return app.request(promptUrl(workspaceId, promptId), {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ content }),
  });
}

test("rejects an invalid workspace id before any database access", async () => {
  const app = createApp();
  const response = await app.request("/api/workspaces/not-a-uuid/prompts");
  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), { error: "工作区 ID 不合法。" });
});

test("rejects internal and unknown prompt ids with 404", async () => {
  const app = createApp();
  const workspaceId = randomUUID();

  for (const promptId of [
    "orchestrator-agent-routing",
    "planner-subagent-planning",
    "../../etc/passwd",
    "conversation-agent-project-evil",
  ]) {
    const save = await savePrompt(app, workspaceId, promptId, "# Custom");
    assert.equal(save.status, 404, `${promptId} must not be writable`);
    const reset = await app.request(promptUrl(workspaceId, promptId), {
      method: "DELETE",
    });
    assert.equal(reset.status, 404, `${promptId} must not be resettable`);
  }
});

test("rejects malformed save bodies", async () => {
  const app = createApp();
  const workspaceId = randomUUID();

  for (const content of [undefined, null, 42, { nested: true }]) {
    const response = await savePrompt(app, workspaceId, PROMPT_ID, content);
    assert.equal(response.status, 400);
  }

  const malformed = await app.request(promptUrl(workspaceId, PROMPT_ID), {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: "{",
  });
  assert.equal(malformed.status, 400);
});

test("rejects blank and oversized prompt content with readable messages", async () => {
  const app = createApp();
  const workspaceId = randomUUID();

  const blank = await savePrompt(app, workspaceId, PROMPT_ID, "   \n  ");
  assert.equal(blank.status, 400);
  assert.equal(
    ((await blank.json()) as { error: string }).error,
    "提示词内容不能为空。",
  );

  const oversized = await savePrompt(
    app,
    workspaceId,
    PROMPT_ID,
    "a".repeat(MAX_PROMPT_CONTENT_LENGTH + 1),
  );
  assert.equal(oversized.status, 400);
  assert.match(
    ((await oversized.json()) as { error: string }).error,
    /提示词内容过长/,
  );
});

test("rejects content that dropped a required token and reports it", async () => {
  const app = createApp();
  const response = await savePrompt(
    app,
    randomUUID(),
    REQUIRED_TOKEN_PROMPT_ID,
    "# Conversation policy without protocol markers",
  );

  assert.equal(response.status, 400);
  const body = (await response.json()) as {
    error: string;
    missingTokens: string[];
  };
  assert.match(body.error, /缺少必要变量/);
  assert.deepEqual(body.missingTokens, [
    "<user-input>",
    "</user-input>",
    "user_input",
    "<question-form>",
  ]);
});

test("returns the capability envelope for a workspace request without a database", async () => {
  // 权限校验通过后才访问数据库，因此这里只断言权限层结果不被降级为 403。
  const app = createApp();
  const response = await app.request("/api/prompt-config/access");
  assert.equal(response.status, 200);
  const body = (await response.json()) as { access: { canRead: boolean } };
  assert.equal(body.access.canRead, true);
});

test("reports the saved override as the current prompt state", () => {
  const promptId = "conversation-agent-chat";
  const entry = PROMPT_CATALOG.find((item) => item.id === promptId);
  assert.ok(entry);

  // 保存接口返回的状态必须来自刚落库的 override，而不是内置默认。
  const saved = createPromptSummary(
    promptId,
    createOverrideSnapshot([
      { promptId, content: CUSTOM_CHAT_PROMPT, updatedAt: SAVED_AT },
    ]),
    SAVED_AT,
  );
  assert.equal(saved.customized, true);
  assert.equal(saved.content, CUSTOM_CHAT_PROMPT);
  assert.equal(saved.updatedAt, SAVED_AT);

  // 恢复默认走同一入口，必须回显内置默认正文且不再标记自定义。
  const restored = createPromptSummary(promptId, {}, null);
  assert.equal(restored.customized, false);
  assert.equal(restored.content, entry.defaultContent);
  assert.equal(restored.updatedAt, null);
});

test("detects a missing prompt_override table to keep runs working before migration", () => {
  assert.equal(
    isMissingPromptOverrideTable({
      message: 'relation "prompt_override" does not exist',
    }),
    true,
  );
  assert.equal(isMissingPromptOverrideTable({ meta: { code: "42P01" } }), true);
  assert.equal(isMissingPromptOverrideTable({ code: "23505" }), false);
  assert.equal(isMissingPromptOverrideTable(new Error("connection reset")), false);
  assert.equal(isMissingPromptOverrideTable(null), false);
});
