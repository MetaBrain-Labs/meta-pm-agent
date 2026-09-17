/**
 * 模型使用列表持久化仓库
 *
 * 使用 raw SQL 访问用户手动创建的模型列表、会话选择与用户默认列表，不依赖 Prisma Schema 或迁移。
 *
 * Responsibilities:
 * - 管理固定本地用户的自定义模型使用列表
 * - 读取和更新会话当前选择，并记住用户最近一次显式选择
 * - 将无选择或已删除选择回退到用户默认列表，再次回退到内置默认列表
 */

import { randomUUID } from "node:crypto";
import { prisma } from "@repo/database";
import {
  ModelUsageProfileConfigSchema,
  SYSTEM_DEFAULT_MODEL_PROFILE,
  SYSTEM_MODEL_PROFILE_ID,
  type ModelUsageProfile,
  type ModelUsageProfileConfig,
} from "@repo/shared";
import { isMissingTableError } from "../utils/postgres-errors";

const LOCAL_USER_ID = "local";

interface ModelProfileRow {
  id: string;
  name: string;
  config: unknown;
  created_at: Date;
  updated_at: Date;
}

interface ConversationSelectionRow extends ModelProfileRow {
  conversation_id: string;
  profile_id: string | null;
}

export class ModelProfileConflictError extends Error {}
export class ModelProfileNotFoundError extends Error {}

/** 返回内置默认与固定本地用户拥有的全部自定义列表。 */
export async function listLocalModelProfiles(): Promise<ModelUsageProfile[]> {
  const rows = await prisma.$queryRaw<ModelProfileRow[]>`
    SELECT "id", "name", "config", "created_at", "updated_at"
    FROM "model_usage_profile"
    WHERE "user_id" = ${LOCAL_USER_ID}
    ORDER BY lower("name") ASC, "created_at" ASC
  `;

  return [SYSTEM_DEFAULT_MODEL_PROFILE, ...rows.map(mapModelProfileRow)];
}

/** 按 ID 读取固定本地用户可使用的列表；内置默认列表不访问数据库。 */
export async function getLocalModelProfile(
  id: string,
): Promise<ModelUsageProfile> {
  return id === SYSTEM_MODEL_PROFILE_ID
    ? SYSTEM_DEFAULT_MODEL_PROFILE
    : getOwnedProfile(id);
}

/** 为固定本地用户创建自定义模型使用列表。 */
export async function createLocalModelProfile(input: {
  name: string;
  config: ModelUsageProfileConfig;
}): Promise<ModelUsageProfile> {
  await ensureLocalUser();
  await assertNameAvailable(input.name);

  const rows = await prisma.$queryRaw<ModelProfileRow[]>`
    INSERT INTO "model_usage_profile" (
      "id", "user_id", "name", "config"
    )
    VALUES (
      ${randomUUID()},
      ${LOCAL_USER_ID},
      ${input.name.trim()},
      ${JSON.stringify(input.config)}::jsonb
    )
    RETURNING "id", "name", "config", "created_at", "updated_at"
  `;

  return requireRow(rows[0]);
}

/** 更新固定本地用户拥有的自定义模型使用列表。 */
export async function updateLocalModelProfile(
  id: string,
  input: { name: string; config: ModelUsageProfileConfig },
): Promise<ModelUsageProfile> {
  if (id === SYSTEM_MODEL_PROFILE_ID) {
    throw new ModelProfileNotFoundError("The system profile cannot be edited.");
  }
  await assertNameAvailable(input.name, id);

  const rows = await prisma.$queryRaw<ModelProfileRow[]>`
    UPDATE "model_usage_profile"
    SET
      "name" = ${input.name.trim()},
      "config" = ${JSON.stringify(input.config)}::jsonb,
      "updated_at" = CURRENT_TIMESTAMP
    WHERE "id" = ${id}
      AND "user_id" = ${LOCAL_USER_ID}
    RETURNING "id", "name", "config", "created_at", "updated_at"
  `;

  return requireRow(rows[0]);
}

/** 删除自定义列表，数据库级联清理会话选择。 */
export async function deleteLocalModelProfile(id: string): Promise<void> {
  if (id === SYSTEM_MODEL_PROFILE_ID) {
    throw new ModelProfileNotFoundError("The system profile cannot be deleted.");
  }

  const deleted = await prisma.$executeRaw`
    DELETE FROM "model_usage_profile"
    WHERE "id" = ${id}
      AND "user_id" = ${LOCAL_USER_ID}
  `;
  if (deleted === 0) {
    throw new ModelProfileNotFoundError("Model profile not found.");
  }
}

/** 读取会话当前列表，无显式选择时回退到用户记住的默认列表。 */
export async function getConversationModelProfile(
  conversationId: string,
): Promise<ModelUsageProfile> {
  const rows = await prisma.$queryRaw<ConversationSelectionRow[]>`
    SELECT
      c."id" AS "conversation_id",
      p."id" AS "profile_id",
      p."id",
      p."name",
      p."config",
      p."created_at",
      p."updated_at"
    FROM "conversation" c
    JOIN "workspace" w
      ON w."id" = c."workspace_id"
      AND w."user_id" = c."user_id"
    LEFT JOIN "conversation_model_profile" selection
      ON selection."conversation_id" = c."id"
    LEFT JOIN "model_usage_profile" p
      ON p."id" = selection."profile_id"
      AND p."user_id" = c."user_id"
    WHERE c."id" = ${conversationId}
      AND c."user_id" = ${LOCAL_USER_ID}
      AND c."status" = 'active'
      AND w."status" = 'active'
    LIMIT 1
  `;

  const row = rows[0];
  if (!row) {
    throw new ModelProfileNotFoundError("Conversation not found.");
  }
  return row.profile_id ? mapModelProfileRow(row) : getDefaultModelProfile();
}

/**
 * 读取用户最近一次显式选择的模型使用列表；没有记录或记录已失效时回退内置默认。
 *
 * 未执行建表 SQL 时按「没有记录」处理，保证会话与文档链路在升级前仍可运行。
 */
export async function getDefaultModelProfile(): Promise<ModelUsageProfile> {
  let rows: ModelProfileRow[];
  try {
    rows = await prisma.$queryRaw<ModelProfileRow[]>`
      SELECT p."id", p."name", p."config", p."created_at", p."updated_at"
      FROM "user_default_model_profile" d
      JOIN "model_usage_profile" p
        ON p."id" = d."profile_id"
        AND p."user_id" = d."user_id"
      WHERE d."user_id" = ${LOCAL_USER_ID}
      LIMIT 1
    `;
  } catch (error) {
    if (!isMissingDefaultProfileTable(error)) throw error;
    warnDefaultProfileTableMissing();
    return SYSTEM_DEFAULT_MODEL_PROFILE;
  }
  return rows[0] ? mapModelProfileRow(rows[0]) : SYSTEM_DEFAULT_MODEL_PROFILE;
}

/**
 * 读取用户记住的模型列表 id；未记录时返回内置默认 id。
 *
 * 选择器需要先知道默认 id 才能在新会话、文档页预选，因此单独提供 id 查询。
 */
export async function getDefaultModelProfileId(): Promise<string> {
  return (await getDefaultModelProfile()).id;
}

/**
 * 记住用户的显式选择。
 *
 * 选择内置默认列表时删除记录，保持「没有 override」这一语义；否则先校验归属再写入，
 * 避免把其他用户或已删除的列表记为默认。未执行建表 SQL 时只记录告警，不影响本次运行。
 */
export async function setDefaultModelProfileId(
  profileId: string,
): Promise<void> {
  try {
    if (profileId === SYSTEM_MODEL_PROFILE_ID) {
      await prisma.$executeRaw`
        DELETE FROM "user_default_model_profile"
        WHERE "user_id" = ${LOCAL_USER_ID}
      `;
      return;
    }

    await getOwnedProfile(profileId);
    await prisma.$executeRaw`
      INSERT INTO "user_default_model_profile" (
        "user_id", "profile_id", "updated_at"
      )
      VALUES (${LOCAL_USER_ID}, ${profileId}, CURRENT_TIMESTAMP)
      ON CONFLICT ("user_id") DO UPDATE SET
        "profile_id" = EXCLUDED."profile_id",
        "updated_at" = CURRENT_TIMESTAMP
    `;
  } catch (error) {
    if (!isMissingDefaultProfileTable(error)) throw error;
    warnDefaultProfileTableMissing();
  }
}

/**
 * 更新会话选择；选择内置默认时删除显式关联，同时记住本次选择供后续会话与文档运行复用。
 */
export async function selectConversationModelProfile(
  conversationId: string,
  profileId: string,
): Promise<ModelUsageProfile> {
  await assertConversationExists(conversationId);

  if (profileId === SYSTEM_MODEL_PROFILE_ID) {
    await prisma.$executeRaw`
      DELETE FROM "conversation_model_profile"
      WHERE "conversation_id" = ${conversationId}
    `;
    await setDefaultModelProfileId(profileId);
    return SYSTEM_DEFAULT_MODEL_PROFILE;
  }

  const profile = await getLocalModelProfile(profileId);
  await prisma.$executeRaw`
    INSERT INTO "conversation_model_profile" (
      "conversation_id", "profile_id", "updated_at"
    )
    VALUES (${conversationId}, ${profileId}, CURRENT_TIMESTAMP)
    ON CONFLICT ("conversation_id") DO UPDATE SET
      "profile_id" = EXCLUDED."profile_id",
      "updated_at" = CURRENT_TIMESTAMP
  `;
  await setDefaultModelProfileId(profileId);
  return profile;
}

async function getOwnedProfile(id: string): Promise<ModelUsageProfile> {
  const rows = await prisma.$queryRaw<ModelProfileRow[]>`
    SELECT "id", "name", "config", "created_at", "updated_at"
    FROM "model_usage_profile"
    WHERE "id" = ${id}
      AND "user_id" = ${LOCAL_USER_ID}
    LIMIT 1
  `;
  return requireRow(rows[0]);
}

async function assertConversationExists(conversationId: string): Promise<void> {
  const rows = await prisma.$queryRaw<Array<{ id: string }>>`
    SELECT c."id"
    FROM "conversation" c
    JOIN "workspace" w
      ON w."id" = c."workspace_id"
      AND w."user_id" = c."user_id"
    WHERE c."id" = ${conversationId}
      AND c."user_id" = ${LOCAL_USER_ID}
      AND c."status" = 'active'
      AND w."status" = 'active'
    LIMIT 1
  `;
  if (!rows[0]) {
    throw new ModelProfileNotFoundError("Conversation not found.");
  }
}

async function assertNameAvailable(
  name: string,
  excludedId?: string,
): Promise<void> {
  const rows = await prisma.$queryRaw<Array<{ id: string }>>`
    SELECT "id"
    FROM "model_usage_profile"
    WHERE "user_id" = ${LOCAL_USER_ID}
      AND lower("name") = lower(${name.trim()})
      AND (${excludedId ?? null}::text IS NULL OR "id" <> ${excludedId ?? null})
    LIMIT 1
  `;
  if (rows[0]) {
    throw new ModelProfileConflictError("Model profile name already exists.");
  }
}

async function ensureLocalUser(): Promise<void> {
  await prisma.$executeRaw`
    INSERT INTO "user" ("id", "username")
    VALUES (${LOCAL_USER_ID}, 'Local User')
    ON CONFLICT ("id") DO NOTHING
  `;
}

/** 识别未执行默认列表建表 SQL 的情况。 */
function isMissingDefaultProfileTable(error: unknown): boolean {
  return isMissingTableError(error, "user_default_model_profile");
}

/** 只在首次缺失时提示一次，避免每次请求都刷日志。 */
let warnedMissingDefaultProfileTable = false;
function warnDefaultProfileTableMissing(): void {
  if (warnedMissingDefaultProfileTable) return;
  warnedMissingDefaultProfileTable = true;
  console.warn(
    "[model-profile] user_default_model_profile table is missing; run packages/database/sql/20260919_user_default_model_profile.sql to remember the selected model profile.",
  );
}

function requireRow(row: ModelProfileRow | undefined): ModelUsageProfile {
  if (!row) {
    throw new ModelProfileNotFoundError("Model profile not found.");
  }
  return mapModelProfileRow(row);
}

function mapModelProfileRow(row: ModelProfileRow): ModelUsageProfile {
  return {
    id: row.id,
    name: row.name,
    isSystem: false,
    config: ModelUsageProfileConfigSchema.parse(row.config),
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}
