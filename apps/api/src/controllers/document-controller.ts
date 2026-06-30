/**
 * 文档生成 API 控制器
 *
 * 提供策划产出文档页面需要的后台任务接口，包括启动 PRD 生成、查询任务状态、
 * 查询单个 run 和手动中断运行。
 *
 * Responsibilities:
 * - 校验文档生成请求参数
 * - 调用文档生成服务并返回统一 JSON
 * - 将业务错误转换为紧凑可读的 HTTP 响应
 *
 * Notes:
 * - 文档生成不走聊天 SSE；页面通过状态轮询观察后台 run。
 */

import type { Context } from "hono";
import { z } from "zod";
import { DocumentKindSchema } from "@repo/shared";
import {
  StartDocumentGenerationRequestSchema,
  StopDocumentGenerationRequestSchema,
} from "../schemas";
import {
  DocumentGenerationServiceError,
  getDocumentGenerationStatusByRunId,
  getLatestDocumentGenerationStatus,
  startDocumentGeneration,
  stopDocumentGeneration,
} from "../services/document-generation-service";

const WorkspaceParamSchema = z.object({
  workspaceId: z.string().uuid(),
});

/**
 * 启动指定工作区的文档生成后台任务。
 */
export async function startDocumentGenerationHandler(c: Context) {
  const params = WorkspaceParamSchema.safeParse({
    workspaceId: c.req.param("workspaceId"),
  });
  if (!params.success) {
    return c.json({ error: "工作区 ID 不合法。" }, 400);
  }

  const body = await readJsonBody(c.req.raw);
  const parsed = StartDocumentGenerationRequestSchema.safeParse(body ?? {});
  if (!parsed.success) {
    return c.json({ error: parsed.error.flatten() }, 400);
  }

  try {
    const data = await startDocumentGeneration({
      workspaceId: params.data.workspaceId,
      kind: parsed.data.kind,
    });
    return c.json(data, 202);
  } catch (error) {
    return jsonServiceError(c, error);
  }
}

/**
 * 查询指定工作区某类文档的最新生成状态。
 */
export async function getLatestDocumentGenerationHandler(c: Context) {
  const params = WorkspaceParamSchema.safeParse({
    workspaceId: c.req.param("workspaceId"),
  });
  if (!params.success) {
    return c.json({ error: "工作区 ID 不合法。" }, 400);
  }

  const kind = DocumentKindSchema.safeParse(c.req.query("kind") ?? "prd");
  if (!kind.success) {
    return c.json({ error: "文档类型不合法。" }, 400);
  }

  try {
    return c.json(
      await getLatestDocumentGenerationStatus({
        workspaceId: params.data.workspaceId,
        kind: kind.data,
      }),
    );
  } catch (error) {
    return jsonServiceError(c, error);
  }
}

/**
 * 按 run ID 查询文档生成状态。
 */
export async function getDocumentGenerationRunHandler(c: Context) {
  const parsed = StopDocumentGenerationRequestSchema.safeParse({
    runId: c.req.param("runId"),
  });
  if (!parsed.success) {
    return c.json({ error: "文档任务 ID 不合法。" }, 400);
  }

  try {
    const data = await getDocumentGenerationStatusByRunId(parsed.data.runId);
    if (!data.run) {
      return c.json({ error: "文档任务不存在。" }, 404);
    }
    return c.json(data);
  } catch (error) {
    return jsonServiceError(c, error);
  }
}

/**
 * 手动中断文档生成任务。
 */
export async function stopDocumentGenerationHandler(c: Context) {
  const parsed = StopDocumentGenerationRequestSchema.safeParse({
    runId: c.req.param("runId"),
  });
  if (!parsed.success) {
    return c.json({ error: "文档任务 ID 不合法。" }, 400);
  }

  try {
    await stopDocumentGeneration(parsed.data.runId);
    return c.json({ stopped: true });
  } catch (error) {
    return jsonServiceError(c, error);
  }
}

/**
 * 安全读取 JSON 请求体。
 */
async function readJsonBody(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    return undefined;
  }
}

/**
 * 将业务错误转换为 JSON 响应。
 */
function jsonServiceError(c: Context, error: unknown) {
  if (error instanceof DocumentGenerationServiceError) {
    const status = error.statusCode === 409 ? 409 : 400;
    return c.json({ error: error.message }, status);
  }

  console.error("[document-generation] API error:", error);
  return c.json({ error: "文档生成服务暂时不可用，请稍后重试。" }, 503);
}
