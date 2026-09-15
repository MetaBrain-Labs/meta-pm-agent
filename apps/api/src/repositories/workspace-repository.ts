/**
 * 本地工作区持久化仓库
 *
 * 负责固定本地用户的工作区创建、查询、更新与软删除，不执行任何磁盘目录写入或删除。
 *
 * Responsibilities:
 * - 仅返回 active 工作区并隐藏未来云端字段
 * - 持久化工作区名称、本地路径和软删除状态
 * - 提供服务层所需的所有权与重复路径查询
 *
 * Notes:
 * - 工作区路径合法性与运行态冲突由服务层校验。
 */
import { randomUUID } from "node:crypto";
import { prisma } from "@repo/database";

const LOCAL_USER_ID = "local";

/**
 * 数据库 workspace 表原始行结构。
 */
interface WorkspaceRow {
  id: string;
  user_id: string;
  name: string;
  storage_type: string | null;
  local_path: string | null;
  cloud_path: string | null;
  sync_status: string | null;
  status: string;
  deleted_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

/**
 * 工作区的数据传输对象。
 */
export interface WorkspaceDto {
  id: string;
  name: string;
  localPath: string | null;
  createdAt: string;
  updatedAt: string;
}

/**
 * 获取本地用户的所有工作区列表，按更新时间降序排列。
 */
export async function listLocalUserWorkspaces(): Promise<WorkspaceDto[]> {
  await ensureLocalUser();

  const rows = await prisma.$queryRaw<WorkspaceRow[]>`
    SELECT
      "id",
      "user_id",
      "name",
      "storage_type",
      "local_path",
      "cloud_path",
      "sync_status",
      "status",
      "deleted_at",
      "created_at",
      "updated_at"
    FROM "workspace"
    WHERE "user_id" = ${LOCAL_USER_ID}
      AND "status" = 'active'
    ORDER BY "updated_at" DESC, "created_at" DESC
  `;

  return rows.map(mapWorkspaceRow);
}

/**
 * 为本地用户创建新工作区，支持指定名称和本地存储路径。
 */
export async function createLocalUserWorkspace(
  name: string,
  localPath: string,
): Promise<WorkspaceDto> {
  await ensureLocalUser();

  const rows = await prisma.$queryRaw<WorkspaceRow[]>`
    INSERT INTO "workspace" (
      "id",
      "user_id",
      "name",
      "storage_type",
      "local_path",
      "sync_status"
    )
    VALUES (${randomUUID()}, ${LOCAL_USER_ID}, ${name}, 'local', ${localPath ?? null}, 'idle')
    RETURNING
      "id",
      "user_id",
      "name",
      "storage_type",
      "local_path",
      "cloud_path",
      "sync_status",
      "status",
      "deleted_at",
      "created_at",
      "updated_at"
  `;
  const workspace = rows[0];
  if (!workspace) {
    throw new Error("Failed to create workspace.");
  }

  return mapWorkspaceRow(workspace);
}

/** 按 ID 读取固定本地用户拥有的 active 工作区。 */
export async function getActiveLocalUserWorkspace(
  workspaceId: string,
): Promise<WorkspaceDto | null> {
  const rows = await prisma.$queryRaw<WorkspaceRow[]>`
    SELECT
      "id", "user_id", "name", "storage_type", "local_path", "cloud_path",
      "sync_status", "status", "deleted_at", "created_at", "updated_at"
    FROM "workspace"
    WHERE "id" = ${workspaceId}
      AND "user_id" = ${LOCAL_USER_ID}
      AND "status" = 'active'
    LIMIT 1
  `;
  return rows[0] ? mapWorkspaceRow(rows[0]) : null;
}

/** 按规范化本地路径查找重复的 active 工作区。 */
export async function findActiveLocalUserWorkspaceByPath(
  localPath: string,
  excludedId?: string,
): Promise<WorkspaceDto | null> {
  const rows = await prisma.$queryRaw<WorkspaceRow[]>`
    SELECT
      "id", "user_id", "name", "storage_type", "local_path", "cloud_path",
      "sync_status", "status", "deleted_at", "created_at", "updated_at"
    FROM "workspace"
    WHERE "user_id" = ${LOCAL_USER_ID}
      AND "status" = 'active'
      AND "local_path" = ${localPath}
      AND (${excludedId ?? null}::text IS NULL OR "id" <> ${excludedId ?? null})
    LIMIT 1
  `;
  return rows[0] ? mapWorkspaceRow(rows[0]) : null;
}

/** 更新 active 工作区名称和本地路径。 */
export async function updateActiveLocalUserWorkspace(
  workspaceId: string,
  input: { name: string; localPath: string },
): Promise<WorkspaceDto | null> {
  const rows = await prisma.$queryRaw<WorkspaceRow[]>`
    UPDATE "workspace"
    SET
      "name" = ${input.name},
      "local_path" = ${input.localPath},
      "updated_at" = CURRENT_TIMESTAMP
    WHERE "id" = ${workspaceId}
      AND "user_id" = ${LOCAL_USER_ID}
      AND "status" = 'active'
    RETURNING
      "id", "user_id", "name", "storage_type", "local_path", "cloud_path",
      "sync_status", "status", "deleted_at", "created_at", "updated_at"
  `;
  return rows[0] ? mapWorkspaceRow(rows[0]) : null;
}

/** 将工作区标记为已删除并保留全部关联应用数据。 */
export async function softDeleteActiveLocalUserWorkspace(
  workspaceId: string,
): Promise<boolean> {
  const changed = await prisma.$executeRaw`
    UPDATE "workspace"
    SET
      "status" = 'deleted',
      "deleted_at" = CURRENT_TIMESTAMP,
      "updated_at" = CURRENT_TIMESTAMP
    WHERE "id" = ${workspaceId}
      AND "user_id" = ${LOCAL_USER_ID}
      AND "status" = 'active'
  `;
  return changed > 0;
}

/**
 * 确保本地用户记录存在，不存在时幂等插入。
 */
async function ensureLocalUser(): Promise<void> {
  await prisma.$executeRaw`
    INSERT INTO "user" ("id", "username")
    VALUES (${LOCAL_USER_ID}, 'Local User')
    ON CONFLICT ("id") DO NOTHING
  `;
}

/**
 * 将数据库行映射为工作区 DTO。
 */
function mapWorkspaceRow(row: WorkspaceRow): WorkspaceDto {
  return {
    id: row.id,
    name: row.name,
    localPath: row.local_path,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}
