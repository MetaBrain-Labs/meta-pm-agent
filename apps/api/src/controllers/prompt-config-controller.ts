/**
 * 提示词配置 API 控制器
 *
 * 暴露设置页「提示词管理」所需的读、写、恢复默认接口，并在任何数据库访问之前完成
 * 服务端权限校验与 Prompt Registry 校验。
 *
 * Responsibilities:
 * - 返回当前身份的提示词配置能力，供设置导航显隐
 * - 列出工作区白名单提示词的默认 / 已自定义状态
 * - 保存自定义提示词、恢复内置默认
 * - 把权限、注册表、内容校验错误映射为统一的 JSON 错误
 *
 * Notes:
 * - 权限不依赖前端隐藏按钮：即使直接调用 API，缺少 prompt:write / prompt:reset /
 *   prompt:read 也会被拒绝
 * - 不记录提示词正文，避免自定义内容进入普通日志
 */

import type { Context } from "hono";
import { validatePromptContent } from "@repo/shared";
import { isMissingPromptOverrideTable } from "../repositories/prompt-override-repository";
import {
  PromptIdParamsSchema,
  SavePromptOverrideRequestSchema,
  WorkspacePromptParamsSchema,
} from "../schemas/prompt-config.schema";
import {
  PromptConfigError,
  listWorkspacePrompts,
  requireRegisteredPrompt,
  resetWorkspacePrompt,
  saveWorkspacePrompt,
} from "../services/prompt-config-service";
import {
  PromptPermissionError,
  requirePromptCapability,
  resolvePromptPrincipal,
  toPromptConfigAccess,
} from "../services/prompt-permission-service";
import { WorkspaceServiceError } from "../services/workspace-service";

/** 返回当前身份可执行的提示词配置动作。 */
export function getPromptConfigAccessHandler(c: Context) {
  return c.json({ access: toPromptConfigAccess(resolvePromptPrincipal()) });
}

/** 列出当前工作区白名单提示词及其默认 / 自定义状态。 */
export async function listWorkspacePromptsHandler(c: Context) {
  try {
    const principal = resolvePromptPrincipal();
    requirePromptCapability(principal, "prompt:read", "查看提示词");

    const params = WorkspacePromptParamsSchema.safeParse({
      workspaceId: c.req.param("workspaceId"),
    });
    if (!params.success) {
      return c.json({ error: "工作区 ID 不合法。" }, 400);
    }

    return c.json({
      prompts: await listWorkspacePrompts(params.data.workspaceId),
      access: toPromptConfigAccess(principal),
    });
  } catch (error) {
    return jsonPromptConfigError(c, error);
  }
}

/** 保存工作区自定义提示词。 */
export async function saveWorkspacePromptHandler(c: Context) {
  try {
    const principal = resolvePromptPrincipal();
    requirePromptCapability(principal, "prompt:write", "修改提示词");

    const params = parsePromptParams(c);
    if ("error" in params) return params.error;
    // 先校验注册表与可编辑性，非法 prompt id 不会触发任何数据库访问。
    const entry = requireRegisteredPrompt(params.promptId, { editable: true });

    const parsed = SavePromptOverrideRequestSchema.safeParse(
      await readJsonBody(c.req.raw),
    );
    if (!parsed.success) {
      return c.json({ error: "提示词内容不合法。" }, 400);
    }

    const validation = validatePromptContent(parsed.data.content, {
      requiredTokens: entry.requiredTokens,
    });
    if (!validation.ok) {
      return c.json(
        { error: validation.message, missingTokens: validation.missingTokens },
        400,
      );
    }

    return c.json({
      prompt: await saveWorkspacePrompt({
        workspaceId: params.workspaceId,
        promptId: entry.id,
        content: parsed.data.content,
      }),
    });
  } catch (error) {
    return jsonPromptConfigError(c, error);
  }
}

/** 删除工作区自定义提示词，使运行时回退内置默认。 */
export async function resetWorkspacePromptHandler(c: Context) {
  try {
    const principal = resolvePromptPrincipal();
    requirePromptCapability(principal, "prompt:reset", "恢复默认提示词");

    const params = parsePromptParams(c);
    if ("error" in params) return params.error;
    const entry = requireRegisteredPrompt(params.promptId, { resettable: true });

    return c.json({
      prompt: await resetWorkspacePrompt({
        workspaceId: params.workspaceId,
        promptId: entry.id,
      }),
    });
  } catch (error) {
    return jsonPromptConfigError(c, error);
  }
}

/** 解析并校验工作区 id 与 prompt id 路径参数。 */
function parsePromptParams(
  c: Context,
):
  | { workspaceId: string; promptId: string }
  | { error: Response } {
  const workspace = WorkspacePromptParamsSchema.safeParse({
    workspaceId: c.req.param("workspaceId"),
  });
  if (!workspace.success) {
    return { error: c.json({ error: "工作区 ID 不合法。" }, 400) };
  }
  const prompt = PromptIdParamsSchema.safeParse({
    promptId: c.req.param("promptId"),
  });
  if (!prompt.success) {
    return { error: c.json({ error: "提示词 ID 不合法。" }, 400) };
  }
  return {
    workspaceId: workspace.data.workspaceId,
    promptId: prompt.data.promptId,
  };
}

/** 安全读取 JSON 请求体。 */
async function readJsonBody(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    return undefined;
  }
}

/** 将业务错误转换为紧凑的 JSON 响应。 */
function jsonPromptConfigError(c: Context, error: unknown) {
  if (error instanceof PromptPermissionError) {
    return c.json({ error: error.message }, 403);
  }
  if (error instanceof PromptConfigError) {
    return c.json({ error: error.message }, error.statusCode);
  }
  if (error instanceof WorkspaceServiceError) {
    return c.json({ error: error.message }, error.statusCode);
  }
  if (isMissingPromptOverrideTable(error)) {
    return c.json(
      {
        error:
          "提示词配置尚未初始化，请先执行 packages/database/sql/20260918_prompt_override.sql。",
      },
      503,
    );
  }

  console.error("[prompt-config] API error:", error);
  return c.json({ error: "提示词配置暂时不可用，请稍后重试。" }, 503);
}
