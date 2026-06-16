import assert from "node:assert/strict";
import test from "node:test";
import { prisma } from "@repo/database";
import { createApp } from "../src/app";

test(
  "creates a chat and initial request form in PostgreSQL",
  { skip: process.env.RUN_DB_INTEGRATION !== "1" },
  async () => {
    const title = `联通验证-${Date.now()}`;
    const response = await createApp().request("/api/chats", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title }),
    });

    assert.equal(response.status, 201);
    const body = await response.json() as {
      chat: { id: string; title: string };
      requestForm: { id: string; chatId: string };
    };

    const chatRows = await prisma.$queryRaw<
      Array<{ id: string; title: string | null; status: string | null }>
    >`
      SELECT id, title, status
      FROM "chat"
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
      assert.deepEqual(chatRows, [
        { id: body.chat.id, title, status: "active" },
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
        DELETE FROM "chat"
        WHERE id = ${body.chat.id}
      `;
      await prisma.$disconnect();
    }
  },
);
