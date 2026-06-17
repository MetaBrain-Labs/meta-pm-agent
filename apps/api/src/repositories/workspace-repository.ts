import { randomUUID } from "node:crypto";
import { prisma } from "@repo/database";

const LOCAL_USER_ID = "local";
const DEFAULT_WORKSPACE_NAME = "\u672c\u5730\u5de5\u4f5c\u533a";

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
  created_at: Date;
  updated_at: Date;
}

/**
 * 数据库 user 表原始行结构。
 */
interface UserRow {
  id: string;
  email: string | null;
  username: string | null;
  avatar: string | null;
  created_at: Date | null;
  updated_at: Date | null;
}

/**
 * 工作区的数据传输对象。
 */
export interface WorkspaceDto {
  id: string;
  userId: string;
  name: string;
  storageType: string | null;
  localPath: string | null;
  cloudPath: string | null;
  syncStatus: string | null;
  createdAt: string;
  updatedAt: string;
}

/**
 * 账户信息的数据传输对象。
 */
export interface AccountDto {
  id: string;
  email: string | null;
  username: string | null;
  avatar: string | null;
  createdAt: string | null;
  updatedAt: string | null;
}

/**
 * 获取本地用户的账户信息，不存在时自动创建。
 */
export async function getLocalUserAccount(): Promise<AccountDto> {
  await ensureLocalUser();

  const rows = await prisma.$queryRaw<UserRow[]>`
    SELECT
      "id",
      "email",
      "username",
      "avatar",
      "created_at",
      "updated_at"
    FROM "user"
    WHERE "id" = ${LOCAL_USER_ID}
    LIMIT 1
  `;

  const user = rows[0];
  if (!user) {
    throw new Error("Failed to load local user.");
  }

  return mapUserRow(user);
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
      "created_at",
      "updated_at"
    FROM "workspace"
    WHERE "user_id" = ${LOCAL_USER_ID}
    ORDER BY "updated_at" DESC, "created_at" DESC
  `;

  return rows.map(mapWorkspaceRow);
}

/**
 * 为本地用户创建新工作区，支持指定名称和本地存储路径。
 */
export async function createLocalUserWorkspace(
  name = DEFAULT_WORKSPACE_NAME,
  localPath?: string,
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
      "created_at",
      "updated_at"
  `;
  const workspace = rows[0];
  if (!workspace) {
    throw new Error("Failed to create workspace.");
  }

  return mapWorkspaceRow(workspace);
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
    userId: row.user_id,
    name: row.name,
    storageType: row.storage_type,
    localPath: row.local_path,
    cloudPath: row.cloud_path,
    syncStatus: row.sync_status,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

/**
 * 将数据库行映射为用户账户 DTO。
 */
function mapUserRow(row: UserRow): AccountDto {
  return {
    id: row.id,
    email: row.email,
    username: row.username,
    avatar: row.avatar,
    createdAt: row.created_at?.toISOString() ?? null,
    updatedAt: row.updated_at?.toISOString() ?? null,
  };
}
