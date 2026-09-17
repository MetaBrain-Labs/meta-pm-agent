/**
 * 模型使用列表 API 控制器
 *
 * 暴露本地模型列表 CRUD 与会话选择接口，并在会话运行期间拒绝切换。
 *
 * Responsibilities:
 * - 校验模型列表请求体
 * - 映射持久化冲突与未找到错误
 * - 保证运行中会话不能切换模型列表
 */

import type { Context } from "hono";
import { DEFAULT_DEEPSEEK_PRICING } from "@repo/shared";
import {
  createLocalModelProfile,
  deleteLocalModelProfile,
  getConversationModelProfile,
  getDefaultModelProfileId,
  listLocalModelProfiles,
  ModelProfileConflictError,
  ModelProfileNotFoundError,
  selectConversationModelProfile,
  setDefaultModelProfileId,
  updateLocalModelProfile,
} from "../repositories/model-profile-repository";
import {
  SaveModelProfileRequestSchema,
  SelectModelProfileRequestSchema,
} from "../schemas/model-profile.schema";
import { isChatRunActive } from "../services/chat-run-registry";

const MODEL_CATALOG = [
  {
    modelId: "deepseek-flash" as const,
    label: "DeepSeek Flash",
    baseUrl: "https://api.deepseek.com",
    pricing: DEFAULT_DEEPSEEK_PRICING["deepseek-flash"],
  },
];

/** 返回本地模型列表、当前可配置模型目录与用户记住的默认列表。 */
export async function listModelProfilesHandler(c: Context) {
  return c.json({
    profiles: await listLocalModelProfiles(),
    catalog: MODEL_CATALOG,
    defaultProfileId: await getDefaultModelProfileId(),
  });
}

/**
 * 记住用户选择的默认模型列表。
 *
 * 新会话、新文档运行都会以此默认值为起点；选择内置默认列表表示清除记录。
 */
export async function selectDefaultModelProfileHandler(c: Context) {
  const parsed = SelectModelProfileRequestSchema.safeParse(
    await readJsonBody(c.req.raw),
  );
  if (!parsed.success) return c.json({ error: parsed.error.flatten() }, 400);

  try {
    await setDefaultModelProfileId(parsed.data.profileId);
    return c.json({ defaultProfileId: await getDefaultModelProfileId() });
  } catch (error) {
    return mapModelProfileError(c, error);
  }
}

/** 校验并创建自定义模型使用列表。 */
export async function createModelProfileHandler(c: Context) {
  const parsed = SaveModelProfileRequestSchema.safeParse(
    await readJsonBody(c.req.raw),
  );
  if (!parsed.success) return c.json({ error: parsed.error.flatten() }, 400);

  try {
    return c.json({ profile: await createLocalModelProfile(parsed.data) }, 201);
  } catch (error) {
    return mapModelProfileError(c, error);
  }
}

/** 校验并更新指定自定义模型使用列表。 */
export async function updateModelProfileHandler(c: Context) {
  const parsed = SaveModelProfileRequestSchema.safeParse(
    await readJsonBody(c.req.raw),
  );
  if (!parsed.success) return c.json({ error: parsed.error.flatten() }, 400);

  try {
    return c.json({
      profile: await updateLocalModelProfile(c.req.param("id")!, parsed.data),
    });
  } catch (error) {
    return mapModelProfileError(c, error);
  }
}

/** 删除指定自定义模型使用列表。 */
export async function deleteModelProfileHandler(c: Context) {
  try {
    await deleteLocalModelProfile(c.req.param("id")!);
    return c.json({ deleted: true });
  } catch (error) {
    return mapModelProfileError(c, error);
  }
}

/** 返回指定会话当前生效的模型使用列表。 */
export async function getConversationModelProfileHandler(c: Context) {
  try {
    return c.json({
      profile: await getConversationModelProfile(c.req.param("id")!),
    });
  } catch (error) {
    return mapModelProfileError(c, error);
  }
}

/** 仅在会话非运行态时更新其模型使用列表。 */
export async function selectConversationModelProfileHandler(c: Context) {
  const chatId = c.req.param("id")!;
  if (isChatRunActive(chatId)) {
    return c.json(
      { error: "Model profile cannot be changed while the chat is running." },
      409,
    );
  }

  const parsed = SelectModelProfileRequestSchema.safeParse(
    await readJsonBody(c.req.raw),
  );
  if (!parsed.success) return c.json({ error: parsed.error.flatten() }, 400);

  try {
    return c.json({
      profile: await selectConversationModelProfile(
        chatId,
        parsed.data.profileId,
      ),
    });
  } catch (error) {
    return mapModelProfileError(c, error);
  }
}

function mapModelProfileError(c: Context, error: unknown) {
  if (error instanceof ModelProfileConflictError) {
    return c.json({ error: error.message }, 409);
  }
  if (error instanceof ModelProfileNotFoundError) {
    return c.json({ error: error.message }, 404);
  }
  if (isUniqueNameViolation(error)) {
    return c.json({ error: "Model profile name already exists." }, 409);
  }
  throw error;
}

/** 识别并发写入绕过预检查时由 PostgreSQL 返回的唯一索引冲突。 */
function isUniqueNameViolation(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  const record = error as {
    code?: string;
    message?: string;
    meta?: { code?: string; message?: string };
  };
  return (
    record.code === "23505" ||
    record.meta?.code === "23505" ||
    record.message?.includes("model_usage_profile_user_name_key") === true ||
    record.meta?.message?.includes("model_usage_profile_user_name_key") === true
  );
}

async function readJsonBody(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    return null;
  }
}
