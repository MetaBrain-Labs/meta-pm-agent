/**
 * Document Agent Markdown 清理测试
 *
 * 验证 Document Agent 在持久化 PRD 前会移除 DeepAgents 子任务编排说明，
 * 避免内部运行过程进入用户下载的 Markdown 文档。
 *
 * Responsibilities:
 * - 验证正式 PRD 标题前的内部调度文本会被裁剪
 * - 验证已经干净的 Markdown 不会被破坏
 *
 * Notes:
 * - 本测试不调用模型，只覆盖 Markdown 后处理函数。
 */

import assert from "node:assert/strict";
import test from "node:test";
import { sanitizePrdMarkdown } from "../src/agents/document-agent/agent";

test("removes orchestration text before the PRD heading", () => {
  const markdown = sanitizePrdMarkdown(`
Now dispatching three parallel subagent tasks to handle the heavy lifting.
User stories generated successfully. Now preparing the final deliverable.

# Product Requirements Document (PRD): 技术团队文档协同平台

## Background

正式 PRD 内容。
`);

  assert.equal(
    markdown.startsWith("# Product Requirements Document (PRD): 技术团队文档协同平台"),
    true,
  );
  assert.equal(markdown.includes("Now dispatching"), false);
});

test("keeps already clean PRD markdown unchanged except trimming", () => {
  const markdown = sanitizePrdMarkdown(`
# Product Requirements Document (PRD): Clean Draft

## Goals

- Keep this content.
`);

  assert.equal(
    markdown,
    [
      "# Product Requirements Document (PRD): Clean Draft",
      "",
      "## Goals",
      "",
      "- Keep this content.",
    ].join("\n"),
  );
});
