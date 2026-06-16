import assert from "node:assert/strict";
import test from "node:test";
import { prisma } from "@repo/database";
import { createApp } from "../src/app";

test(
  "creates a workspace conversation and initial request form in PostgreSQL",
  { skip: process.env.RUN_DB_INTEGRATION !== "1" },
  async () => {
    const workspaceName = `workspace-${Date.now()}`;
    const workspaceResponse = await createApp().request("/api/workspaces", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: workspaceName }),
    });

    assert.equal(workspaceResponse.status, 201);
    const workspaceBody = (await workspaceResponse.json()) as {
      workspace: { id: string; name: string };
    };

    const title = `conversation-${Date.now()}`;
    const response = await createApp().request("/api/chats", {
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

    try {
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
    } finally {
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
      await prisma.$disconnect();
    }
  },
);
