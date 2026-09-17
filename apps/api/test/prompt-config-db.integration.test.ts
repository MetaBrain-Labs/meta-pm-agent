/**
 * 提示词 override 落库集成测试
 *
 * 验证保存、工作区隔离、恢复默认（删除 override）与 workspace 删除级联清理真正作用于
 * PostgreSQL，而不是只停留在纯函数层。
 *
 * Notes:
 * - 仅在显式启用时访问测试数据库（RUN_DB_INTEGRATION=1），默认跳过
 * - 使用独立临时工作区并在结束时清理，不修改既有工作区或用户数据
 * - 前置条件：已执行 packages/database/sql/20260918_prompt_override.sql
 */

import "../src/env";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { prisma } from "@repo/database";
import { PROMPT_CATALOG } from "@repo/agent-runtime";
import { loadWorkspacePromptOverrideMap } from "../src/repositories/prompt-override-repository";
import {
  listWorkspacePrompts,
  resetWorkspacePrompt,
  saveWorkspacePrompt,
} from "../src/services/prompt-config-service";
import { LOCAL_USER_ID } from "../src/services/prompt-permission-service";

const CHAT_PROMPT_ID = "conversation-agent-chat";
const CUSTOM_CHAT_PROMPT = "# Custom chat policy";

/** 读取内置默认正文，用于断言恢复默认后回到程序内置版本。 */
function builtInPrompt(promptId: string): string {
  const entry = PROMPT_CATALOG.find((item) => item.id === promptId);
  assert.ok(entry, `prompt ${promptId} must be registered`);
  return entry.defaultContent;
}

test("saves, isolates and resets workspace prompt overrides", {
  skip: process.env.RUN_DB_INTEGRATION !== "1",
}, async () => {
  const workspaceA = randomUUID();
  const workspaceB = randomUUID();
  const existingUser = await prisma.$queryRaw<Array<{ id: string }>>`
    SELECT "id" FROM "user" WHERE "id" = ${LOCAL_USER_ID} LIMIT 1
  `;

  try {
    await prisma.$executeRaw`
      INSERT INTO "user" ("id", "username")
      VALUES (${LOCAL_USER_ID}, 'Local User')
      ON CONFLICT ("id") DO NOTHING
    `;
    for (const [workspaceId, name] of [
      [workspaceA, "Prompt override test A"],
      [workspaceB, "Prompt override test B"],
    ] as const) {
      await prisma.$executeRaw`
        INSERT INTO "workspace" ("id", "user_id", "name", "local_path")
        VALUES (${workspaceId}, ${LOCAL_USER_ID}, ${name}, ${`/tmp/prompt-override-${workspaceId}`})
      `;
    }

    // 1. 保存后列表显示「已自定义」，运行时快照拿到 override 正文。
    const saved = await saveWorkspacePrompt({
      workspaceId: workspaceA,
      promptId: CHAT_PROMPT_ID,
      content: CUSTOM_CHAT_PROMPT,
    });
    assert.equal(saved.customized, true);
    assert.equal(saved.content, CUSTOM_CHAT_PROMPT);
    assert.equal(saved.storedOverrideIgnored, false);

    const promptsA = await listWorkspacePrompts(workspaceA);
    const chatA = promptsA.find((prompt) => prompt.id === CHAT_PROMPT_ID);
    assert.equal(chatA?.customized, true);
    assert.equal(chatA?.defaultContent, builtInPrompt(CHAT_PROMPT_ID));
    assert.deepEqual(await loadWorkspacePromptOverrideMap(workspaceA), {
      [CHAT_PROMPT_ID]: CUSTOM_CHAT_PROMPT,
    });

    // 2. 工作区隔离：另一个工作区仍是默认状态，且没有 override 快照。
    const promptsB = await listWorkspacePrompts(workspaceB);
    assert.equal(
      promptsB.find((prompt) => prompt.id === CHAT_PROMPT_ID)?.customized,
      false,
    );
    assert.deepEqual(await loadWorkspacePromptOverrideMap(workspaceB), {});

    // 3. 恢复默认 = 删除 override（而不是写入默认副本），并且幂等。
    const restored = await resetWorkspacePrompt({
      workspaceId: workspaceA,
      promptId: CHAT_PROMPT_ID,
    });
    assert.equal(restored.customized, false);
    assert.equal(restored.content, builtInPrompt(CHAT_PROMPT_ID));
    assert.equal(restored.updatedAt, null);
    const restoredAgain = await resetWorkspacePrompt({
      workspaceId: workspaceA,
      promptId: CHAT_PROMPT_ID,
    });
    assert.equal(restoredAgain.customized, false);
    assert.deepEqual(await loadWorkspacePromptOverrideMap(workspaceA), {});

    const storedRows = await prisma.$queryRaw<Array<{ count: number }>>`
      SELECT count(*)::int AS "count" FROM "prompt_override"
      WHERE "workspace_id" = ${workspaceA}
    `;
    assert.equal(storedRows[0]?.count, 0, "reset must delete the override row");

    // 4. 删除工作区时 override 由外键级联清理。
    await saveWorkspacePrompt({
      workspaceId: workspaceB,
      promptId: CHAT_PROMPT_ID,
      content: CUSTOM_CHAT_PROMPT,
    });
    await prisma.$executeRaw`DELETE FROM "workspace" WHERE "id" = ${workspaceB}`;
    const cascaded = await prisma.$queryRaw<Array<{ count: number }>>`
      SELECT count(*)::int AS "count" FROM "prompt_override"
      WHERE "workspace_id" = ${workspaceB}
    `;
    assert.equal(cascaded[0]?.count, 0);
  } finally {
    await prisma.$executeRaw`
      DELETE FROM "prompt_override"
      WHERE "workspace_id" IN (${workspaceA}, ${workspaceB})
    `;
    await prisma.$executeRaw`
      DELETE FROM "workspace" WHERE "id" IN (${workspaceA}, ${workspaceB})
    `;
    if (!existingUser[0]) {
      await prisma.$executeRaw`DELETE FROM "user" WHERE "id" = ${LOCAL_USER_ID}`;
    }
  }
});
