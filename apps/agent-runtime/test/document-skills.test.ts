/**
 * Document Agent Skill 与 PRD 规则测试
 *
 * 使用真实 DeepAgents StateBackend 验证六个文档 Skill 的发现和读取，并检查
 * 主 Agent、紧凑 payload、评分提示词和内置工具可见性遵循既定边界。
 *
 * Responsibilities:
 * - 验证 PRD Skill bundle 的虚拟路径、元数据、许可证和错误信息
 * - 验证主 Agent 直接使用 Skill，且 payload 不重复章节证据
 * - 验证关键需求验收深度、稀疏证据和评分门禁规则
 *
 * Notes:
 * - 测试不调用模型，也不访问外部网络。
 */

import assert from "node:assert/strict";
import test from "node:test";
import { createSkillsMiddleware, StateBackend } from "deepagents";
import {
  PRD_DOCUMENT_AGENT_PROMPT,
  PRD_SCORING_REVIEWER_PROMPT,
} from "../src/agents/document-agent/prompt";
import { createPrdDocumentAgentPayload } from "../src/agents/document-agent/agent";
import {
  createDocumentAllowedBuiltinToolNames,
  DOCUMENT_VISIBLE_BUILTIN_TOOL_NAMES,
} from "../src/agents/document-agent/run-document-agent";
import {
  createPrdDocumentSkillBundle,
  PRD_DOCUMENT_SKILLS,
  type DocumentSkillBundle,
} from "../src/agents/document-agent/skills";

test("discovers all PRD Document Agent skills from isolated StateBackend files", async () => {
  const bundle = await createPrdDocumentSkillBundle();
  const metadata = await discoverSkills(bundle);
  const expectedNames = PRD_DOCUMENT_SKILLS.map((skill) => skill.name).sort();

  assert.deepEqual(
    metadata.map((skill) => skill.name).sort(),
    expectedNames,
  );
  assert.deepEqual(bundle.sources, ["/skills/"]);
  assert.equal(Object.keys(bundle.files).length, 6);

  for (const skill of metadata) {
    assert.equal(skill.path, `/skills/${skill.name}/SKILL.md`);
  }
  for (const file of Object.values(bundle.files)) {
    assert.equal(typeof file.content, "string");
    assert.equal(String(file.content).includes("\r"), false);
    assert.match(String(file.content), /^---\nname: [a-z0-9-]+\n/);
  }

  for (const skillName of [
    "deliver-prd",
    "deliver-acceptance-criteria",
    "deliver-edge-cases",
  ]) {
    assert.match(
      String(bundle.files[`/skills/${skillName}/SKILL.md`]?.content),
      /\nlicense: Apache-2\.0\n/,
    );
  }
});

test("loads skill content through StateBackend and reports missing sources", async () => {
  const bundle = await createPrdDocumentSkillBundle();
  const backend = createStateBackend(bundle);
  const result = backend.read("/skills/source-grounded-writing/SKILL.md", 0, 8);

  assert.equal(result.error, undefined);
  assert.match(
    String(result.content),
    /^---\nname: source-grounded-writing\n/,
  );

  await assert.rejects(
    createPrdDocumentSkillBundle([
      {
        name: "missing-document-skill",
        repositoryPath:
          "references/document-agent/skills/missing-document-skill/SKILL.md",
      },
    ]),
    (error: unknown) =>
      error instanceof Error &&
      error.message.includes('"missing-document-skill"') &&
      error.message.includes("SKILL.md"),
  );
});

test("removes duplicated dossier evidence from the main agent payload", () => {
  const payload = createPrdDocumentAgentPayload({
    workspaceId: "workspace-1",
    runId: "run-1",
    graph: {
      nodes: [
        {
          id: "G-12345678",
          type: "Goal",
          name: "Goal",
          description: "Goal detail",
          status: "confirmed",
          source_task_id: "task-1",
        },
      ],
      relations: [],
    },
    dossiers: [
      {
        id: "overview",
        title: "Overview",
        purpose: "Explain why",
        nodeIds: ["G-12345678"],
        relationIds: [],
        evidence: ["duplicated long evidence"],
      },
    ],
  });

  assert.equal("evidence" in payload.sectionDossiers[0]!, false);
  assert.equal("source_task_id" in payload.graph.nodes[0]!, false);
  assert.equal(
    JSON.stringify(payload).includes("duplicated long evidence"),
    false,
  );
});

test("keeps skill reads internal while enforcing PRD detail and gap rules", () => {
  const allowedTools = createDocumentAllowedBuiltinToolNames(true);

  assert.equal(allowedTools.has("read_file"), true);
  assert.equal(
    new Set<string>(DOCUMENT_VISIBLE_BUILTIN_TOOL_NAMES).has("read_file"),
    false,
  );
  assert.equal(DOCUMENT_VISIBLE_BUILTIN_TOOL_NAMES.length, 0);
  assert.match(PRD_DOCUMENT_AGENT_PROMPT, /virtual \/skills paths/);
  assert.match(PRD_DOCUMENT_AGENT_PROMPT, /Do not call write_todos or task/);
  assert.match(PRD_DOCUMENT_AGENT_PROMPT, /reserve at least half of the output budget/);
  assert.match(PRD_DOCUMENT_AGENT_PROMPT, /P0, critical-path, or high-risk/);
  assert.match(PRD_DOCUMENT_AGENT_PROMPT, /Given\/When\/Then/);
  assert.match(PRD_DOCUMENT_AGENT_PROMPT, /Keep P1 and P2 requirements concise/);
  assert.match(PRD_DOCUMENT_AGENT_PROMPT, /mark missing facts with specific TBD/);
  assert.match(PRD_DOCUMENT_AGENT_PROMPT, /Never invent priority/);
  assert.match(
    PRD_SCORING_REVIEWER_PROMPT,
    /cannot score 85 or higher/,
  );
  assert.match(
    PRD_SCORING_REVIEWER_PROMPT,
    /product, design, engineering, QA, and business/,
  );
  assert.match(PRD_SCORING_REVIEWER_PROMPT, /sourceGroundingIssues/);
});

/**
 * 通过生产一致的 SkillsMiddleware 发现虚拟 Skill。
 */
async function discoverSkills(
  bundle: DocumentSkillBundle,
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
 * 使用 legacy runtime 构造只读测试后端。
 */
function createStateBackend(bundle: DocumentSkillBundle): StateBackend {
  return new StateBackend({
    state: { files: bundle.files },
  } as ConstructorParameters<typeof StateBackend>[0]);
}
