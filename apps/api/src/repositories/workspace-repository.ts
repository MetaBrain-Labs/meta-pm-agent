import { randomUUID } from "node:crypto";
import { prisma } from "@repo/database";

const LOCAL_USER_ID = "local";
const DEFAULT_WORKSPACE_NAME = "\u672c\u5730\u5de5\u4f5c\u533a";

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

interface UserRow {
  id: string;
  email: string | null;
  username: string | null;
  avatar: string | null;
  created_at: Date | null;
  updated_at: Date | null;
}

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

export interface AccountDto {
  id: string;
  email: string | null;
  username: string | null;
  avatar: string | null;
  createdAt: string | null;
  updatedAt: string | null;
}

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

async function ensureLocalUser(): Promise<void> {
  await prisma.$executeRaw`
    INSERT INTO "user" ("id", "username")
    VALUES (${LOCAL_USER_ID}, 'Local User')
    ON CONFLICT ("id") DO NOTHING
  `;
}

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
