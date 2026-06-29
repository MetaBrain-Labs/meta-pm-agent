/**
 * 产品工作流 LangGraph checkpoint 提供器
 *
 * 为主产品工作流图创建可持久化的 checkpointer。运行时优先使用 PostgresSaver，
 * 当依赖或数据库配置不可用时降级到 MemorySaver，保证本地开发和测试仍可运行。
 *
 * Responsibilities:
 * - 按环境配置创建 LangGraph checkpoint saver
 * - 初始化 PostgresSaver 所需的数据表
 * - 缓存 checkpointer，避免每次请求重复初始化连接
 *
 * Notes:
 * - PostgresSaver 依赖通过动态导入加载，避免未安装可选依赖时破坏本地构建。
 */

import { MemorySaver, type BaseCheckpointSaver } from "@langchain/langgraph";

type PostgresSaverConstructor = {
  fromConnString?: (connectionString: string) => BaseCheckpointSaver & {
    setup?: () => Promise<void>;
  };
  new (options: unknown): BaseCheckpointSaver & { setup?: () => Promise<void> };
};

let checkpointerPromise: Promise<BaseCheckpointSaver> | null = null;

/**
 * 获取产品工作流主图使用的 checkpointer。
 */
export function getWorkflowCheckpointer(): Promise<BaseCheckpointSaver> {
  checkpointerPromise ??= createWorkflowCheckpointer();
  return checkpointerPromise;
}

/**
 * 创建实际 checkpointer，优先连接 PostgresSaver。
 */
async function createWorkflowCheckpointer(): Promise<BaseCheckpointSaver> {
  const databaseUrl =
    process.env.LANGGRAPH_CHECKPOINT_DATABASE_URL ?? process.env.DATABASE_URL;

  if (!databaseUrl) {
    return new MemorySaver();
  }

  try {
    const module = await dynamicImport<{
      PostgresSaver?: PostgresSaverConstructor;
    }>("@langchain/langgraph-checkpoint-postgres");
    const PostgresSaver = module.PostgresSaver;
    if (!PostgresSaver) {
      throw new Error("PostgresSaver export was not found.");
    }

    const saver = PostgresSaver.fromConnString
      ? PostgresSaver.fromConnString(databaseUrl)
      : new PostgresSaver({ connectionString: databaseUrl });
    await saver.setup?.();
    return saver;
  } catch (error) {
    console.warn(
      "[workflow-checkpointer] Falling back to MemorySaver. Install @langchain/langgraph-checkpoint-postgres and configure DATABASE_URL to enable durable resume.",
      error,
    );
    return new MemorySaver();
  }
}

/**
 * 使用间接动态导入，避免 TypeScript 在可选依赖未安装时解析模块。
 */
async function dynamicImport<T>(specifier: string): Promise<T> {
  const importer = new Function(
    "specifier",
    "return import(specifier)",
  ) as (value: string) => Promise<T>;
  return importer(specifier);
}
