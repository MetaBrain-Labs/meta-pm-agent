/**
 * 用户默认模型使用列表集成测试
 *
 * 验证「记住用户选择」真正作用于数据库：会话切换列表会更新默认值，没有显式选择的
 * 新会话回退到该默认值，删除列表后再次回退内置默认。
 *
 * Notes:
 * - 仅在显式启用时访问测试数据库（RUN_DB_INTEGRATION=1），默认跳过
 * - 使用独立临时工作区 / 会话 / 列表并在结束时清理，不修改既有数据
 * - 前置条件：已执行 packages/database/sql/20260919_user_default_model_profile.sql
 */

import "../src/env";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { prisma } from "@repo/database";
import {
  SYSTEM_DEFAULT_MODEL_PROFILE,
  type ModelUsageProfileConfig,
} from "@repo/shared";
import {
  createLocalModelProfile,
  deleteLocalModelProfile,
  getConversationModelProfile,
  getDefaultModelProfileId,
  selectConversationModelProfile,
  setDefaultModelProfileId,
} from "../src/repositories/model-profile-repository";

const LOCAL_USER_ID = "local";

/** 与设置页新建列表一致的默认配置。 */
function createProfileConfig(): ModelUsageProfileConfig {
  const base =
    SYSTEM_DEFAULT_MODEL_PROFILE.config.mode === "tiered"
      ? SYSTEM_DEFAULT_MODEL_PROFILE.config
      : null;
  assert.ok(base, "system default profile must be tiered");
  return { ...base, models: { ...base.models } };
}

test("remembers the selected model profile as the default", {
  skip: process.env.RUN_DB_INTEGRATION !== "1",
}, async () => {
  const workspaceId = randomUUID();
  const selectedConversationId = randomUUID();
  const freshConversationId = randomUUID();
  const createdProfileIds: string[] = [];
  const existingUser = await prisma.$queryRaw<Array<{ id: string }>>`
    SELECT "id" FROM "user" WHERE "id" = ${LOCAL_USER_ID} LIMIT 1
  `;

  try {
    await prisma.$executeRaw`
      INSERT INTO "user" ("id", "username")
      VALUES (${LOCAL_USER_ID}, 'Local User')
      ON CONFLICT ("id") DO NOTHING
    `;
    await prisma.$executeRaw`
      INSERT INTO "workspace" ("id", "user_id", "name", "local_path")
      VALUES (${workspaceId}, ${LOCAL_USER_ID}, 'Model default test', ${`/tmp/model-default-${workspaceId}`})
    `;
    for (const conversationId of [selectedConversationId, freshConversationId]) {
      await prisma.$executeRaw`
        INSERT INTO "conversation" ("id", "workspace_id", "user_id", "title")
        VALUES (${conversationId}, ${workspaceId}, ${LOCAL_USER_ID}, 'Model default test')
      `;
    }

    const flash = await createLocalModelProfile({
      name: `Flash ${workspaceId.slice(0, 8)}`,
      config: createProfileConfig(),
    });
    createdProfileIds.push(flash.id);

    // 1. 会话里显式选择列表 → 该选择成为默认，新会话回退到它而不是内置默认。
    await selectConversationModelProfile(selectedConversationId, flash.id);
    assert.equal(
      (await getConversationModelProfile(selectedConversationId)).id,
      flash.id,
    );
    assert.equal(await getDefaultModelProfileId(), flash.id);
    assert.equal(
      (await getConversationModelProfile(freshConversationId)).id,
      flash.id,
    );

    // 2. 显式选择内置默认 → 默认记录被删除，新会话回退内置默认。
    await setDefaultModelProfileId(SYSTEM_DEFAULT_MODEL_PROFILE.id);
    assert.equal(
      await getDefaultModelProfileId(),
      SYSTEM_DEFAULT_MODEL_PROFILE.id,
    );
    assert.equal(
      (await getConversationModelProfile(freshConversationId)).id,
      SYSTEM_DEFAULT_MODEL_PROFILE.id,
    );

    // 3. 删除被记住的列表 → 级联清理默认记录，不会指向失效列表。
    await setDefaultModelProfileId(flash.id);
    await deleteLocalModelProfile(flash.id);
    createdProfileIds.length = 0;
    assert.equal(
      await getDefaultModelProfileId(),
      SYSTEM_DEFAULT_MODEL_PROFILE.id,
    );
    assert.equal(
      (await getConversationModelProfile(freshConversationId)).id,
      SYSTEM_DEFAULT_MODEL_PROFILE.id,
    );
  } finally {
    for (const profileId of createdProfileIds) {
      await prisma.$executeRaw`
        DELETE FROM "model_usage_profile" WHERE "id" = ${profileId}
      `;
    }
    await prisma.$executeRaw`
      DELETE FROM "user_default_model_profile" WHERE "user_id" = ${LOCAL_USER_ID}
    `;
    await prisma.$executeRaw`
      DELETE FROM "conversation" WHERE "workspace_id" = ${workspaceId}
    `;
    await prisma.$executeRaw`
      DELETE FROM "workspace" WHERE "id" = ${workspaceId}
    `;
    if (!existingUser[0]) {
      await prisma.$executeRaw`DELETE FROM "user" WHERE "id" = ${LOCAL_USER_ID}`;
    }
  }
});
