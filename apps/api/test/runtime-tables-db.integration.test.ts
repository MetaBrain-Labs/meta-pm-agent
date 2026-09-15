/**
 * 开源空库初始化集成测试
 *
 * Responsibilities:
 * - 验证模型列表、Token、图谱和文档表支持运行时写入
 * - 验证文档双向关联和清理约束
 *
 * Notes:
 * - 仅在显式启用时访问一次性测试数据库，所有样本在事务结束时回滚
 */
import "../src/env";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { prisma } from "@repo/database";
import { EXECUTOR_DEFINITIONS } from "../../agent-runtime/src/agents/product-workflow/executor-agent/definitions";
import { persistAssistantMessage } from "../src/repositories/message-repository";

/** 验证 README 初始化后所有 raw SQL 表可供业务流程使用。 */
test("supports graph, profile, token and document writes after initialization", {
  skip: process.env.RUN_DB_INTEGRATION !== "1",
}, async () => {
  const rollback = new Error("Rollback synthetic release fixtures");
  const [user, workspace, conversation, run, artifact, profile, token, graph] =
    Array.from({ length: 8 }, () => randomUUID());
  try {
    await prisma.$transaction(async (db) => {
      await db.$executeRaw`INSERT INTO "user" (id) VALUES (${user})`;
      await db.$executeRaw`INSERT INTO workspace (id, user_id, name) VALUES (${workspace}, ${user}, 'Synthetic release test')`;
      await db.$executeRaw`INSERT INTO conversation (id, workspace_id, user_id) VALUES (${conversation}, ${workspace}, ${user})`;
      // 结构化图谱写入不提供历史 Markdown 列。
      await db.$executeRaw`INSERT INTO product_knowledge_graph (id, workspace_id, nodes, relations) VALUES (${graph}, ${workspace}, '[]'::jsonb, '[]'::jsonb)`;
      await db.$executeRaw`INSERT INTO model_usage_profile (id, user_id, name, config) VALUES (${profile}, ${user}, 'Test', '{}'::jsonb)`;
      await db.$executeRaw`INSERT INTO conversation_model_profile (conversation_id, profile_id) VALUES (${conversation}, ${profile})`;
      await db.$executeRaw`INSERT INTO token_usage (id, conversation_id, agent_type) VALUES (${token}, ${conversation}, 'conversation')`;
      await db.$executeRaw`INSERT INTO product_context_snapshot (id, workspace_id) VALUES (${randomUUID()}, ${workspace})`;
      await db.$executeRaw`INSERT INTO document_generation_run (id, workspace_id, kind, status, workflow_thread_id) VALUES (${run}, ${workspace}, 'prd', 'awaiting_input', 'synthetic-release-test')`;
      await db.$executeRaw`INSERT INTO document_artifact (id, workspace_id, run_id, kind, title, content_markdown) VALUES (${artifact}, ${workspace}, ${run}, 'prd', 'Synthetic PRD', '# Synthetic PRD')`;
      await db.$executeRaw`UPDATE document_generation_run SET document_artifact_id=${artifact}, status='completed' WHERE id=${run}`;
      const rows = await db.$queryRaw<Array<{ content_markdown: string }>>`SELECT a.content_markdown FROM document_generation_run r JOIN document_artifact a ON a.id=r.document_artifact_id WHERE r.id=${run}`;
      assert.equal(rows[0]?.content_markdown, "# Synthetic PRD");
      await db.$executeRaw`DELETE FROM document_artifact WHERE id=${artifact}`;
      const runs = await db.$queryRaw<Array<{ document_artifact_id: string | null }>>`SELECT document_artifact_id FROM document_generation_run WHERE id=${run}`;
      assert.equal(runs[0]?.document_artifact_id, null);
      throw rollback;
    });
  } catch (error) {
    if (error !== rollback) throw error;
  }
});

/** 验证首次建库能完整保存确认阶段和所有 Executor 标识，样本回滚不留业务数据。 */
test("persists complete confirmation and executor message types", {
  skip: process.env.RUN_DB_INTEGRATION !== "1",
}, async () => {
  const rollback = new Error("Rollback synthetic message fixtures");
  const user = randomUUID();
  const workspace = randomUUID();
  const conversation = randomUUID();
  const transaction = prisma.$transaction;
  const types = ["conversation_confirmation", ...EXECUTOR_DEFINITIONS.map((definition) => definition.agentType)];
  try {
    await prisma.$transaction(async (db) => {
      await db.$executeRaw`INSERT INTO "user" (id) VALUES (${user})`;
      await db.$executeRaw`INSERT INTO workspace (id, user_id, name) VALUES (${workspace}, ${user}, 'Synthetic message type test')`;
      await db.$executeRaw`INSERT INTO conversation (id, workspace_id, user_id) VALUES (${conversation}, ${workspace}, ${user})`;
      // 仓库写入复用样本事务；实际 INSERT 和 UPDATE 仍在 PostgreSQL 执行。
      prisma.$transaction = (async (callback: (tx: typeof db) => unknown) => callback(db)) as typeof prisma.$transaction;
      try {
        for (const type of types) {
          const messageId = await persistAssistantMessage({ conversationId: conversation, content: "Synthetic result", userInput: null, type });
          const rows = await db.$queryRaw<Array<{ type: string; role: string }>>`SELECT type, role FROM message WHERE id=${messageId}`;
          assert.equal(rows[0]?.type, type);
          assert.equal(rows[0]?.role, "assistant");
        }
      } finally {
        prisma.$transaction = transaction;
      }
      throw rollback;
    }, { timeout: 15_000 });
  } catch (error) {
    if (error !== rollback) throw error;
  }
});
