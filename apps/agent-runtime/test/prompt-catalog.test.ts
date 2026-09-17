/**
 * 提示词注册表与解析器测试
 *
 * 验证 default → workspace override → effective 的解析规则、白名单边界，以及提示词
 * override 真正进入 Conversation / Request / Document Agent 系统提示与 LangGraph 运行配置。
 */

import assert from "node:assert/strict";
import test from "node:test";
import {
  PromptCatalogEntrySchema,
  validatePromptContent,
} from "@repo/shared";
import {
  getPromptCatalogEntry,
  isConfigurablePromptId,
  PROMPT_CATALOG,
} from "../src/prompts/catalog";
import {
  createPromptSummaries,
  createPromptSummary,
  getPromptOverridesFromRunnableConfig,
  PROMPT_OVERRIDES_RUN_CONFIG_KEY,
  resolvePrompt,
  resolvePromptContent,
  sanitizePromptOverrides,
} from "../src/prompts/resolver";
import { createConversationAgentSystemPrompt } from "../src/agents/conversation/agent";
import { resolveRequestAgentSystemPrompt } from "../src/agents/request/agent";
import { CHAT_ONLY_PROMPT, DISCOVERY_PROMPT } from "../src/agents/conversation/prompt";
import { REQUEST_AGENT_PROMPT } from "../src/agents/request/prompt";
import {
  PRD_DOCUMENT_AGENT_PROMPT,
  PRD_DOCUMENT_AGENT_STRUCTURE,
} from "../src/agents/document-agent/prompt";
import { createWorkflowRunConfig } from "../src/graph/workflow";

/** 满足 project 提示词必填标记的自定义正文。 */
const CUSTOM_PROJECT_PROMPT =
  "# Custom Conversation Agent\n\nAlways answer inside <user-input> and </user-input> with the user_input key, and ask a <question-form> only when the request is incomplete.";

/** 满足 request 提示词必填 JSON 字段名的自定义正文。 */
const CUSTOM_REQUEST_PROMPT =
  "# Custom Request Agent\n\nbusiness_model questions chitchat user_goal goal_constraints missing_information covered_user_input_indexes";

test("registers only whitelisted prompts with complete metadata", () => {
  assert.ok(PROMPT_CATALOG.length >= 3, "expected several configurable prompts");

  const ids = new Set<string>();
  for (const entry of PROMPT_CATALOG) {
    const parsed = PromptCatalogEntrySchema.safeParse(entry);
    assert.equal(
      parsed.success,
      true,
      `catalog entry ${entry.id} must satisfy the shared contract`,
    );
    assert.equal(ids.has(entry.id), false, `duplicate prompt id ${entry.id}`);
    ids.add(entry.id);
    assert.equal(entry.editable, true);
    assert.equal(entry.resettable, true);
    // 必填标记必须真实存在于内置默认文本中，否则用户无法保存任何内容。
    for (const token of entry.requiredTokens) {
      assert.ok(
        entry.defaultContent.includes(token),
        `${entry.id} declares missing required token ${token}`,
      );
    }
  }
});

test("keeps internal protocol prompts out of the configurable registry", () => {
  for (const internalId of [
    "orchestrator-agent-routing",
    "planner-subagent-planning",
    "critique-agent-review",
    "executor-product-strategy",
    "product-knowledge-graph-metamodel",
    "web-search-usage",
    "document-scoring-reviewer",
  ]) {
    assert.equal(isConfigurablePromptId(internalId), false);
    assert.equal(getPromptCatalogEntry(internalId), null);
  }
});

test("returns the built-in default when no override exists", () => {
  const resolved = resolvePrompt("conversation-agent-chat");
  assert.equal(resolved.content, CHAT_ONLY_PROMPT);
  assert.equal(resolved.customized, false);
  assert.equal(resolved.storedOverrideIgnored, false);
  assert.equal(resolvePromptContent("conversation-agent-project"), DISCOVERY_PROMPT);
  assert.equal(
    resolvePromptContent("document-agent-prd-structure"),
    PRD_DOCUMENT_AGENT_STRUCTURE,
  );
});

test("applies a valid workspace override and reverts after reset", () => {
  const overrides = { "conversation-agent-chat": "# Custom chat policy" };
  const customized = resolvePrompt("conversation-agent-chat", overrides);
  assert.equal(customized.content, "# Custom chat policy");
  assert.equal(customized.customized, true);

  // 恢复默认的语义是删除 override，解析器随即回退内置默认。
  const afterReset = resolvePrompt("conversation-agent-chat", {});
  assert.equal(afterReset.content, CHAT_ONLY_PROMPT);
  assert.equal(afterReset.customized, false);
});

test("keeps workspace snapshots isolated and pure", () => {
  const workspaceA = { "conversation-agent-project": CUSTOM_PROJECT_PROMPT };
  const workspaceB = {};

  assert.equal(
    resolvePrompt("conversation-agent-project", workspaceA).customized,
    true,
  );
  assert.equal(
    resolvePromptContent("conversation-agent-project", workspaceB),
    DISCOVERY_PROMPT,
  );
  // 解析器不持有共享状态：同一个快照重复解析结果一致。
  assert.deepEqual(
    resolvePrompt("conversation-agent-project", workspaceA),
    resolvePrompt("conversation-agent-project", workspaceA),
  );
});

test("falls back to the default when a stored override lost required tokens", () => {
  const broken = "# Custom chat only";
  const resolved = resolvePrompt("conversation-agent-project", {
    "conversation-agent-project": broken,
  });
  assert.equal(resolved.content, DISCOVERY_PROMPT);
  assert.equal(resolved.customized, false);
  assert.equal(resolved.storedOverrideIgnored, true);
});

test("sanitizes unknown ids, blank content and malformed snapshots", () => {
  const sanitized = sanitizePromptOverrides({
    "conversation-agent-chat": "  # Custom chat policy\n",
    "orchestrator-agent-routing": "should never be accepted",
    "conversation-agent-project": "   ",
    "request-agent-analysis": CUSTOM_REQUEST_PROMPT,
  });
  assert.deepEqual(Object.keys(sanitized).sort(), [
    "conversation-agent-chat",
    "request-agent-analysis",
  ]);
  assert.deepEqual(sanitizePromptOverrides(null), {});
  assert.deepEqual(sanitizePromptOverrides(["not", "a", "record"]), {});
  assert.deepEqual(sanitizePromptOverrides({ "conversation-agent-chat": 42 }), {});
});

test("reports default and customized state for the settings view", () => {
  const summaries = createPromptSummaries(
    { "conversation-agent-chat": "# Custom chat policy" },
    { "conversation-agent-chat": "2026-09-18T00:00:00.000Z" },
  );
  const chat = summaries.find((item) => item.id === "conversation-agent-chat");
  const project = summaries.find(
    (item) => item.id === "conversation-agent-project",
  );

  assert.equal(chat?.customized, true);
  assert.equal(chat?.content, "# Custom chat policy");
  assert.equal(chat?.defaultContent, CHAT_ONLY_PROMPT);
  assert.equal(chat?.updatedAt, "2026-09-18T00:00:00.000Z");
  assert.equal(project?.customized, false);
  assert.equal(project?.content, DISCOVERY_PROMPT);
  assert.equal(project?.updatedAt, null);
  // 必要标记与可编辑性必须随列表返回，前端据此给出保护提示。
  assert.deepEqual(project?.requiredTokens, [
    "<user-input>",
    "</user-input>",
    "user_input",
    "<question-form>",
  ]);

  const ignored = createPromptSummary("conversation-agent-project", {
    "conversation-agent-project": "# missing protocol markers",
  });
  assert.equal(ignored.customized, false);
  assert.equal(ignored.storedOverrideIgnored, true);
});

test("blocks saving content that dropped a required token", () => {
  const missing = validatePromptContent("# no protocol markers", {
    requiredTokens: ["<user-input>", "<question-form>"],
  });
  assert.equal(missing.ok, false);
  assert.equal(missing.ok === false ? missing.code : null, "missing_tokens");
  assert.deepEqual(
    missing.ok === false ? missing.missingTokens : [],
    ["<user-input>", "<question-form>"],
  );
  assert.equal(
    validatePromptContent(CUSTOM_PROJECT_PROMPT, {
      requiredTokens: ["<user-input>", "</user-input>", "user_input", "<question-form>"],
    }).ok,
    true,
  );
});

test("uses the override for the next conversation agent run", () => {
  const overrides = { "conversation-agent-project": CUSTOM_PROJECT_PROMPT };
  const prompt = createConversationAgentSystemPrompt({ promptOverrides: overrides });
  assert.ok(prompt.startsWith("# Custom Conversation Agent"));
  // 运行时日期等系统追加段落保持不变。
  assert.ok(prompt.includes("## Runtime context"));
  assert.ok(!prompt.includes("## Request form lifecycle"));

  const chatPrompt = createConversationAgentSystemPrompt({
    mode: "chat",
    promptOverrides: { "conversation-agent-chat": "# Custom chat policy" },
  });
  assert.ok(chatPrompt.startsWith("# Custom chat policy"));
  assert.ok(chatPrompt.includes("## Runtime context"));
  assert.ok(!chatPrompt.includes("Conversation Agent directives (Chat Mode)"));
});

test("uses the override for the next request agent run", () => {
  assert.equal(
    resolveRequestAgentSystemPrompt({ "request-agent-analysis": CUSTOM_REQUEST_PROMPT }),
    CUSTOM_REQUEST_PROMPT,
  );
  assert.equal(resolveRequestAgentSystemPrompt(), REQUEST_AGENT_PROMPT);
});

test("carries the prompt snapshot into the workflow run config", () => {
  const config = createWorkflowRunConfig(
    {
      userInputBlock: '<user-input>{"user_input":[]}</user-input>',
      workflowThreadId: "workflow:test:form",
      promptOverrides: {
        "request-agent-analysis": CUSTOM_REQUEST_PROMPT,
        "orchestrator-agent-routing": "must be dropped",
      },
    },
    "custom",
  );

  const snapshot = config.configurable[PROMPT_OVERRIDES_RUN_CONFIG_KEY];
  assert.deepEqual(Object.keys(snapshot as Record<string, string>), [
    "request-agent-analysis",
  ]);
  // 图节点通过 run config 读取同一份快照，Request Agent 因而使用新的生效正文。
  const restored = getPromptOverridesFromRunnableConfig({
    configurable: config.configurable,
  });
  assert.equal(
    resolvePromptContent("request-agent-analysis", restored),
    CUSTOM_REQUEST_PROMPT,
  );
});

test("keeps the composed PRD prompt stable when the structure is not customized", () => {
  assert.ok(PRD_DOCUMENT_AGENT_PROMPT.includes(PRD_DOCUMENT_AGENT_STRUCTURE));
  assert.ok(PRD_DOCUMENT_AGENT_PROMPT.includes("You are Document Agent"));
  assert.ok(PRD_DOCUMENT_AGENT_PROMPT.includes("Optional visual blocks:"));

  const customStructure =
    "Required PRD structure:\n1. Problem\n2. Scope\n3. Open questions";
  const resolved = resolvePromptContent("document-agent-prd-structure", {
    "document-agent-prd-structure": customStructure,
  });
  assert.equal(resolved, customStructure);
});
