/**
 * Executor Agent 技能加载测试
 *
 * 使用真实 DeepAgents StateBackend 与 SkillsMiddleware 验证 Executor 技能
 * 能从隔离的虚拟文件空间完成发现和读取。
 *
 * Responsibilities:
 * - 验证十个 Executor 的全部技能元数据可被发现
 * - 验证 CRLF 会在注入前归一化
 * - 验证 supplement Product Strategy 只加载目标技能
 *
 * Notes:
 * - 测试不创建模型，也不访问宿主文件系统工具
 */

import assert from "node:assert/strict";
import test from "node:test";
import { createSkillsMiddleware, StateBackend } from "deepagents";
import {
  EXECUTOR_DEFINITIONS,
  getExecutorDefinition,
  type ExecutorAgentDefinition,
} from "../src/agents/product-workflow/executor-agent/definitions";
import {
  createExecutorSkillBundle,
  type ExecutorSkillBundle,
} from "../src/agents/product-workflow/executor-agent/skills";

test("all Executor skills are discoverable from isolated StateBackend files", async () => {
  let discoveredSkillCount = 0;

  for (const definition of EXECUTOR_DEFINITIONS) {
    const bundle = await createExecutorSkillBundle(definition);
    const metadata = await discoverSkills(bundle);
    const expectedNames = [...definition.skills].sort();
    const actualNames = metadata.map((skill) => skill.name).sort();

    assert.deepEqual(actualNames, expectedNames, definition.agentType);
    assert.deepEqual(bundle.sources, ["/skills/"]);
    assert.equal(Object.keys(bundle.files).length, definition.skills.length);

    for (const skill of metadata) {
      assert.equal(skill.path, `/skills/${skill.name}/SKILL.md`);
    }
    for (const file of Object.values(bundle.files)) {
      assert.equal(typeof file.content, "string");
      if (typeof file.content === "string") {
        assert.equal(file.content.includes("\r"), false);
        assert.match(file.content, /^---\nname: [a-z0-9-]+\n/);
      }
    }

    discoveredSkillCount += metadata.length;
  }

  assert.equal(discoveredSkillCount, 81);
});

test("supplement Product Strategy loads only product-strategy", async () => {
  const definition = getExecutorDefinition("executor-product-strategy");
  const bundle = await createExecutorSkillBundle(definition, true);
  const metadata = await discoverSkills(bundle);

  assert.deepEqual(Object.keys(bundle.files), [
    "/skills/product-strategy/SKILL.md",
  ]);
  assert.deepEqual(
    metadata.map((skill) => skill.name),
    ["product-strategy"],
  );
});

test("normalized skill content is readable through StateBackend", async () => {
  const definition = getExecutorDefinition("executor-product-strategy");
  const bundle = await createExecutorSkillBundle(definition, true);
  const backend = createStateBackend(bundle);
  const result = backend.read("/skills/product-strategy/SKILL.md", 0, 5);

  assert.equal(result.error, undefined);
  assert.equal(typeof result.content, "string");
  assert.match(String(result.content), /^---\nname: product-strategy\n/);
  assert.equal(String(result.content).includes("\r"), false);
});

test("missing skill errors identify the Executor, skill, and source path", async () => {
  const definition = {
    ...getExecutorDefinition("executor-product-strategy"),
    skills: ["missing-skill"],
  } as unknown as ExecutorAgentDefinition;

  await assert.rejects(
    createExecutorSkillBundle(definition),
    (error: unknown) =>
      error instanceof Error &&
      error.message.includes("executor-product-strategy") &&
      error.message.includes('"missing-skill"') &&
      error.message.includes("missing-skill") &&
      error.message.includes("SKILL.md"),
  );
});

/**
 * 通过 DeepAgents 自带中间件执行与生产一致的技能发现流程。
 */
async function discoverSkills(
  bundle: ExecutorSkillBundle,
): Promise<Array<{ name: string; path: string }>> {
  const middleware = createSkillsMiddleware({
    backend: createStateBackend(bundle),
    sources: bundle.sources,
  });
  const beforeAgent = middleware.beforeAgent as
    | ((state: unknown) => Promise<{
        skillsMetadata?: Array<{ name: string; path: string }>;
      }>)
    | undefined;

  assert.ok(beforeAgent);
  const update = await beforeAgent({ files: bundle.files });
  return update?.skillsMetadata ?? [];
}

/**
 * 使用 legacy runtime 构造只读测试后端，避免依赖 LangGraph 执行上下文。
 */
function createStateBackend(bundle: ExecutorSkillBundle): StateBackend {
  return new StateBackend({
    state: { files: bundle.files },
  } as ConstructorParameters<typeof StateBackend>[0]);
}
