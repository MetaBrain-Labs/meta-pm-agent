/**
 * 本地项目与会话 PostgreSQL 集成测试
 *
 * 验证创建、读取、更新、运行态冲突和软删除在真实数据库中的行为。
 *
 * Responsibilities:
 * - 覆盖工作区与会话 CRUD
 * - 验证软删除后 API 不可访问但底层记录仍保留
 * - 验证聊天运行期间拒绝修改路径和删除
 */

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { prisma } from "@repo/database";
import { createApp } from "../src/app";
import {
  registerChatRun,
  unregisterChatRun,
} from "../src/services/chat-run-registry";

test(
  "creates a workspace conversation and initial request form in PostgreSQL",
  { skip: process.env.RUN_DB_INTEGRATION !== "1" },
  async () => {
    const localPath = await mkdtemp(path.join(tmpdir(), "meta-pm-workspace-"));
    const secondPath = await mkdtemp(path.join(tmpdir(), "meta-pm-workspace-"));
    const app = createApp();
    const workspaceName = `workspace-${Date.now()}`;
    const workspaceResponse = await app.request("/api/workspaces", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: workspaceName, localPath }),
    });

    assert.equal(workspaceResponse.status, 201);
    const workspaceBody = (await workspaceResponse.json()) as {
      workspace: { id: string; name: string; localPath: string };
    };
    assert.deepEqual(Object.keys(workspaceBody.workspace).sort(), [
      "createdAt",
      "id",
      "localPath",
      "name",
      "updatedAt",
    ]);

    const title = `conversation-${Date.now()}`;
    const response = await app.request("/api/chats", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        workspaceId: workspaceBody.workspace.id,
        title,
      }),
    });

    assert.equal(response.status, 201);
    const body = (await response.json()) as {
      chat: { id: string; title: string; workspaceId: string };
      requestForm: { id: string; chatId: string };
    };

    const conversationRows = await prisma.$queryRaw<
      Array<{
        id: string;
        workspace_id: string;
        user_id: string;
        title: string | null;
        status: string | null;
      }>
    >`
      SELECT id, workspace_id, user_id, title, status
      FROM "conversation"
      WHERE id = ${body.chat.id}
    `;
    const formRows = await prisma.$queryRaw<
      Array<{ id: string; chat_id: string; status: string }>
    >`
      SELECT id, chat_id, status
      FROM "request_form"
      WHERE id = ${body.requestForm.id}
    `;
    const otherUserId = randomUUID();
    const otherWorkspaceId = randomUUID();
    const otherConversationId = randomUUID();
    const documentRunId = randomUUID();
    await prisma.$executeRaw`
      INSERT INTO "user" ("id", "username")
      VALUES (${otherUserId}, 'Other User')
    `;
    await prisma.$executeRaw`
      INSERT INTO "workspace" ("id", "user_id", "name", "local_path")
      VALUES (${otherWorkspaceId}, ${otherUserId}, 'Other workspace', ${localPath})
    `;
    await prisma.$executeRaw`
      INSERT INTO "conversation" (
        "id", "workspace_id", "user_id", "title", "type", "status"
      )
      VALUES (
        ${otherConversationId}, ${otherWorkspaceId}, ${otherUserId},
        'Other conversation', 'chat', 'active'
      )
    `;

    try {
      const duplicatePathResponse = await app.request("/api/workspaces", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "Duplicate path", localPath }),
      });
      assert.equal(duplicatePathResponse.status, 409);

      assert.deepEqual(conversationRows, [
        {
          id: body.chat.id,
          workspace_id: workspaceBody.workspace.id,
          user_id: "local",
          title,
          status: "active",
        },
      ]);
      assert.deepEqual(formRows, [
        {
          id: body.requestForm.id,
          chat_id: body.chat.id,
          status: "active",
        },
      ]);

      const foreignUpdate = await app.request(
        `/api/workspaces/${otherWorkspaceId}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: "Must not change" }),
        },
      );
      assert.equal(foreignUpdate.status, 404);
      assert.equal(
        (
          await app.request(`/api/workspaces/${otherWorkspaceId}`, {
            method: "DELETE",
          })
        ).status,
        404,
      );
      const foreignChatUpdate = await app.request(
        `/api/chats/${otherConversationId}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ title: "Must not change" }),
        },
      );
      assert.equal(foreignChatUpdate.status, 404);
      assert.equal(
        (
          await app.request(`/api/chats/${otherConversationId}`, {
            method: "DELETE",
          })
        ).status,
        404,
      );

      const renamedWorkspaceResponse = await app.request(
        `/api/workspaces/${workspaceBody.workspace.id}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: "Renamed workspace" }),
        },
      );
      assert.equal(renamedWorkspaceResponse.status, 200);

      const renamedChatResponse = await app.request(`/api/chats/${body.chat.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: "Renamed conversation" }),
      });
      assert.equal(renamedChatResponse.status, 200);

      const runController = new AbortController();
      registerChatRun(body.chat.id, runController);
      try {
        const pathConflict = await app.request(
          `/api/workspaces/${workspaceBody.workspace.id}`,
          {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ localPath: secondPath }),
          },
        );
        assert.equal(pathConflict.status, 409);
        const workspaceConflict = await app.request(
          `/api/workspaces/${workspaceBody.workspace.id}`,
          { method: "DELETE" },
        );
        assert.equal(workspaceConflict.status, 409);
        const chatConflict = await app.request(`/api/chats/${body.chat.id}`, {
          method: "DELETE",
        });
        assert.equal(chatConflict.status, 409);
      } finally {
        unregisterChatRun(body.chat.id, runController);
      }

      const pathResponse = await app.request(
        `/api/workspaces/${workspaceBody.workspace.id}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ localPath: secondPath }),
        },
      );
      assert.equal(pathResponse.status, 200);

      assert.equal(
        (await app.request(`/api/chats/${body.chat.id}`, { method: "DELETE" }))
          .status,
        200,
      );
      assert.equal(
        (await app.request(`/api/chats/${body.chat.id}/messages`)).status,
        404,
      );
      assert.deepEqual(
        await (
          await app.request(
            `/api/chats?workspaceId=${workspaceBody.workspace.id}`,
          )
        ).json(),
        { chats: [] },
      );

      await prisma.$executeRaw`
        INSERT INTO "document_generation_run" (
          "id", "workspace_id", "kind", "status", "workflow_thread_id"
        )
        VALUES (
          ${documentRunId}, ${workspaceBody.workspace.id}, 'prd', 'running',
          ${`document:${documentRunId}`}
        )
      `;
      assert.equal(
        (
          await app.request(`/api/workspaces/${workspaceBody.workspace.id}`, {
            method: "DELETE",
          })
        ).status,
        409,
      );
      await prisma.$executeRaw`
        UPDATE "document_generation_run"
        SET "status" = 'stopped'
        WHERE "id" = ${documentRunId}
      `;

      assert.equal(
        (
          await app.request(`/api/workspaces/${workspaceBody.workspace.id}`, {
            method: "DELETE",
          })
        ).status,
        200,
      );
      const activeWorkspaceList = (await (
        await app.request("/api/workspaces")
      ).json()) as { workspaces: Array<{ id: string }> };
      assert.equal(
        activeWorkspaceList.workspaces.some(
          (workspace) => workspace.id === workspaceBody.workspace.id,
        ),
        false,
      );
      assert.equal(
        (
          await app.request("/api/chats", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              workspaceId: workspaceBody.workspace.id,
              title: "Must not be created",
            }),
          })
        ).status,
        404,
      );

      const deletedRows = await prisma.$queryRaw<
        Array<{
          workspace_status: string;
          workspace_deleted_at: Date | null;
          conversation_status: string;
          conversation_deleted_at: Date | null;
        }>
      >`
        SELECT
          w."status" AS "workspace_status",
          w."deleted_at" AS "workspace_deleted_at",
          c."status" AS "conversation_status",
          c."deleted_at" AS "conversation_deleted_at"
        FROM "workspace" w
        JOIN "conversation" c ON c."workspace_id" = w."id"
        WHERE w."id" = ${workspaceBody.workspace.id}
          AND c."id" = ${body.chat.id}
      `;
      assert.equal(deletedRows[0]?.workspace_status, "deleted");
      assert.ok(deletedRows[0]?.workspace_deleted_at);
      assert.equal(deletedRows[0]?.conversation_status, "deleted");
      assert.ok(deletedRows[0]?.conversation_deleted_at);
    } finally {
      await prisma.$executeRaw`
        DELETE FROM "document_generation_run"
        WHERE id = ${documentRunId}
      `;
      await prisma.$executeRaw`
        DELETE FROM "conversation"
        WHERE id = ${otherConversationId}
      `;
      await prisma.$executeRaw`
        DELETE FROM "workspace"
        WHERE id = ${otherWorkspaceId}
      `;
      await prisma.$executeRaw`
        DELETE FROM "user"
        WHERE id = ${otherUserId}
      `;
      await prisma.$executeRaw`
        DELETE FROM "request_form"
        WHERE id = ${body.requestForm.id}
      `;
      await prisma.$executeRaw`
        DELETE FROM "conversation"
        WHERE id = ${body.chat.id}
      `;
      await prisma.$executeRaw`
        DELETE FROM "workspace"
        WHERE id = ${workspaceBody.workspace.id}
      `;
      await rm(localPath, { force: true, recursive: true });
      await rm(secondPath, { force: true, recursive: true });
      await prisma.$disconnect();
    }
  },
);
