/**
 * 提示词配置权限测试
 *
 * 验证能力矩阵、可信权限来源解析，以及「绕过 UI 直接调用 API」时服务端仍会拒绝
 * 缺少 prompt:read / prompt:write / prompt:reset 的请求。
 *
 * Notes:
 * - 权限拒绝必须发生在数据库访问之前，因此这些用例不需要数据库
 * - 角色通过服务端环境变量注入，与前端开关无关
 */

import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import {
  PROMPT_ROLE_CAPABILITIES,
  type PromptAccessRole,
} from "@repo/shared";
import { createApp } from "../src/app";
import {
  createPromptPrincipal,
  parsePromptAccessRole,
  PROMPT_CONFIG_ACCESS_ROLE_ENV,
  resolvePromptPrincipal,
  toPromptConfigAccess,
} from "../src/services/prompt-permission-service";

/** 在用例内临时设置可信权限来源，结束后恢复原值。 */
function withAccessRole(role: string | undefined, run: () => Promise<void>) {
  const previous = process.env[PROMPT_CONFIG_ACCESS_ROLE_ENV];
  if (role === undefined) delete process.env[PROMPT_CONFIG_ACCESS_ROLE_ENV];
  else process.env[PROMPT_CONFIG_ACCESS_ROLE_ENV] = role;

  return run().finally(() => {
    if (previous === undefined) delete process.env[PROMPT_CONFIG_ACCESS_ROLE_ENV];
    else process.env[PROMPT_CONFIG_ACCESS_ROLE_ENV] = previous;
  });
}

test("maps every access role to the documented capability matrix", () => {
  assert.deepEqual(PROMPT_ROLE_CAPABILITIES.owner, [
    "prompt:read",
    "prompt:write",
    "prompt:reset",
  ]);
  assert.deepEqual(PROMPT_ROLE_CAPABILITIES.editor, [
    "prompt:read",
    "prompt:write",
  ]);
  assert.deepEqual(PROMPT_ROLE_CAPABILITIES.viewer, ["prompt:read"]);
  assert.deepEqual(PROMPT_ROLE_CAPABILITIES.none, []);

  for (const role of ["owner", "editor", "viewer", "none"] as PromptAccessRole[]) {
    const access = toPromptConfigAccess(createPromptPrincipal(role, "local"));
    assert.equal(access.role, role);
    assert.equal(access.canRead, role !== "none", `${role} read`);
    assert.equal(access.canWrite, role === "owner" || role === "editor", `${role} write`);
    assert.equal(access.canReset, role === "owner", `${role} reset`);
  }
});

test("reads the trusted role from the environment and fails closed", () => {
  assert.equal(parsePromptAccessRole(undefined), "owner");
  assert.equal(parsePromptAccessRole("  VIEWER "), "viewer");
  assert.equal(parsePromptAccessRole("editor"), "editor");
  assert.equal(parsePromptAccessRole("superuser"), "none");
  assert.equal(parsePromptAccessRole(""), "owner");
});

test("defaults to the local workspace owner for the single-user deployment", () => {
  const principal = resolvePromptPrincipal();
  assert.equal(principal.userId, "local");
  assert.equal(principal.role, "owner");
});

test("reports capabilities without exposing prompt content", async () => {
  const response = await createApp().request("/api/prompt-config/access");
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    access: { role: "owner", canRead: true, canWrite: true, canReset: true },
  });
});

test("denies every prompt endpoint when the principal has no capability", async () => {
  await withAccessRole("none", async () => {
    const app = createApp();
    const workspaceId = randomUUID();
    const url = `/api/workspaces/${workspaceId}/prompts/conversation-agent-chat`;

    // 无 prompt:read：连正文都不可读取，且在访问数据库之前就被拒绝。
    const list = await app.request(`/api/workspaces/${workspaceId}/prompts`);
    assert.equal(list.status, 403);

    const save = await app.request(url, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: "# Custom chat policy" }),
    });
    assert.equal(save.status, 403);

    const reset = await app.request(url, { method: "DELETE" });
    assert.equal(reset.status, 403);

    const body = (await save.json()) as Record<string, unknown>;
    assert.deepEqual(Object.keys(body), ["error"]);
    assert.deepEqual(await (await app.request("/api/prompt-config/access")).json(), {
      access: { role: "none", canRead: false, canWrite: false, canReset: false },
    });
  });
});

test("allows reading but denies writes and resets for a read-only principal", async () => {
  await withAccessRole("viewer", async () => {
    const app = createApp();
    const workspaceId = randomUUID();
    const url = `/api/workspaces/${workspaceId}/prompts/conversation-agent-chat`;

    assert.deepEqual(await (await app.request("/api/prompt-config/access")).json(), {
      access: { role: "viewer", canRead: true, canWrite: false, canReset: false },
    });

    const save = await app.request(url, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: "# Custom chat policy" }),
    });
    assert.equal(save.status, 403);
    assert.equal(
      ((await save.json()) as { error: string }).error,
      "当前身份没有修改提示词的权限。",
    );

    const reset = await app.request(url, { method: "DELETE" });
    assert.equal(reset.status, 403);
  });
});

test("denies reset but allows writes for an editor principal", async () => {
  await withAccessRole("editor", async () => {
    const app = createApp();
    const workspaceId = randomUUID();
    const url = `/api/workspaces/${workspaceId}/prompts/conversation-agent-chat`;

    assert.deepEqual(await (await app.request("/api/prompt-config/access")).json(), {
      access: { role: "editor", canRead: true, canWrite: true, canReset: false },
    });

    // 编辑器缺少 prompt:reset：恢复默认必须在数据库访问之前被拒绝。
    const reset = await app.request(url, { method: "DELETE" });
    assert.equal(reset.status, 403);
    assert.equal(
      ((await reset.json()) as { error: string }).error,
      "当前身份没有恢复默认提示词的权限。",
    );
  });
});

test("blocks cross-origin prompt reads and writes", async () => {
  const app = createApp();
  const response = await app.request("/api/prompt-config/access", {
    headers: { Origin: "https://example.com" },
  });
  assert.equal(response.status, 403);

  const write = await app.request(
    `/api/workspaces/${randomUUID()}/prompts/conversation-agent-chat`,
    {
      method: "PUT",
      headers: { Origin: "https://example.com", "Content-Type": "application/json" },
      body: JSON.stringify({ content: "# Custom chat policy" }),
    },
  );
  assert.equal(write.status, 403);
});
