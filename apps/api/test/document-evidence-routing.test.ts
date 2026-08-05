/**
 * 文档证据阻断会话路由测试
 *
 * 验证服务端优先使用专用会话关联恢复 request form，并拒绝客户端提供的跨会话
 * 或过期表单 ID，防止补证启动请求静默进入普通 Pre-Orchestrator。
 *
 * Responsibilities:
 * - 验证缺失客户端表单 ID 时可从 chatId 恢复
 * - 验证表单与会话不一致时明确失败
 * - 验证同一 run 的不同图谱版本不会复用旧补证会话
 *
 * Notes:
 * - 测试仅覆盖纯路由选择，不连接数据库。
 */

import assert from "node:assert/strict";
import test from "node:test";
import { prisma } from "@repo/database";
import { resolveDocumentEvidenceResolutionContext } from "../src/controllers/chat-controller";
import {
  findDocumentEvidenceResolutionCycle,
  type DocumentEvidenceResolutionRecord,
} from "../src/repositories/request-form-repository";

const resolution: DocumentEvidenceResolutionRecord = {
  itemId: "item-1",
  requestFormId: "form-1",
  conversationId: "chat-1",
  workspaceId: "workspace-1",
  runId: "run-1",
  sourceGraphVersion: 3,
  blockers: [],
  status: "ready",
};

test("restores the authoritative request form from the dedicated conversation", () => {
  const result = resolveDocumentEvidenceResolutionContext({
    chatId: "chat-1",
    requestFormId: undefined,
    resolutionByConversation: resolution,
    resolutionByRequestForm: null,
  });

  assert.equal(result.resolution, resolution);
  assert.equal(result.effectiveRequestFormId, "form-1");
});

test("rejects a stale request form for the dedicated conversation", () => {
  assert.throws(
    () =>
      resolveDocumentEvidenceResolutionContext({
        chatId: "chat-1",
        requestFormId: "form-stale",
        resolutionByConversation: resolution,
        resolutionByRequestForm: null,
      }),
    /different request form/,
  );
});

test("rejects a request form belonging to another conversation", () => {
  assert.throws(
    () =>
      resolveDocumentEvidenceResolutionContext({
        chatId: "chat-2",
        requestFormId: "form-1",
        resolutionByConversation: null,
        resolutionByRequestForm: resolution,
      }),
    /does not belong to this conversation/,
  );
});

test("queries evidence resolution by run and source graph version", async (t) => {
  const query = t.mock.method(prisma, "$queryRaw", async () => []);

  assert.equal(
    await findDocumentEvidenceResolutionCycle("run-1", 4),
    null,
  );
  assert.deepEqual(query.mock.calls[0]?.arguments.slice(1), ["run-1", "4"]);
});
