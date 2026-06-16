import { randomUUID } from "node:crypto";
import { prisma } from "@repo/database";
import type { UserInputRecord } from "../utils/user-input";

export async function replaceRequestFormItems(
  requestFormId: string,
  items: UserInputRecord[],
): Promise<void> {
  await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`
      DELETE FROM "request_form_item"
      WHERE "form_id" = ${requestFormId}
    `;

    for (const item of items) {
      const payload = JSON.stringify(item);
      await tx.$executeRaw`
        INSERT INTO "request_form_item" (
          "id",
          "form_id",
          "type",
          "status",
          "agent",
          "priority",
          "payload"
        )
        VALUES (
          ${randomUUID()},
          ${requestFormId},
          ${item.type},
          'active',
          'conversation',
          ${item.index},
          ${payload}::json
        )
      `;
    }
  });
}
