/**
 * 文档证据阻断 Resolver SubAgent
 *
 * 构造只读、无工具权限的 Resolver SubAgent，并通过 Orchestrator 专用模式调用。
 * Resolver 复用 Planner 模型组，避免引入新的模型配置项。
 *
 * Responsibilities:
 * - 创建 document-evidence-resolver DeepAgents SubAgent
 * - 解析 SubAgent 结构化输出并执行确定性覆盖率校验
 * - 暴露 Orchestrator evidence-resolution 模式的流式入口
 *
 * Notes:
 * - 不向 Resolver 暴露知识图谱写工具；写入发生在后续 supplement DAG。
 */

import type { SubAgent } from "deepagents";
import { createDeepAgentToolAllowlistMiddleware } from "../../../common/deep-agent-tool-policy";
import { createChatModel } from "../../../common/model";
import {
  createModelSummarySnapshot,
  resolveAgentModelSelection,
} from "../../../common/model-profile";
import { resolveJsonOutput, runAgent } from "../../../common/run-agent";
import { parseJsonObject } from "../../../../utils/json";
import type { ProductWorkflowStreamEvent } from "../../types";
import { resolveToolMessageContent } from "../planner-subagent/agent";
import {
  DOCUMENT_EVIDENCE_ORCHESTRATOR_PROMPT,
  createDocumentEvidenceResolutionPayload,
  createDocumentEvidenceResolverPrompt,
} from "./prompt";
import {
  DocumentEvidenceResolutionSchema,
  createFallbackDocumentEvidenceResolution,
  normalizeDocumentEvidenceResolution,
  type DocumentEvidenceResolution,
  type DocumentEvidenceResolutionInput,
} from "./result";

/**
 * 创建零工具权限的证据问题生成 SubAgent。
 */
export function createDocumentEvidenceResolverSubagent(
  input: DocumentEvidenceResolutionInput,
): SubAgent {
  return {
    name: "document-evidence-resolver",
    description:
      "Generates required questions that cover every persisted PRD evidence blocker and suggests supplement executor domains. Returns JSON matching DocumentEvidenceResolutionSchema.",
    systemPrompt: createDocumentEvidenceResolverPrompt(input),
    model: createChatModel(
      {
        enableThinking: true,
        responseFormat: "json_object",
        temperature: 0,
        maxTokens: 16_384,
        timeout: 120_000,
      },
      resolveAgentModelSelection(input.modelProfile, "planner"),
    ),
    tools: [],
    middleware: [
      createDeepAgentToolAllowlistMiddleware({
        agentName: "orchestrator-document-evidence-resolver-subagent",
        allowedToolNames: [],
      }),
    ],
  };
}

/**
 * 通过只注册 Resolver SubAgent 的 Orchestrator 模式生成必填问题。
 */
export async function* streamOrchestratorEvidenceResolution(
  input: DocumentEvidenceResolutionInput,
): AsyncGenerator<
  ProductWorkflowStreamEvent,
  DocumentEvidenceResolution,
  void
> {
  let subagentResult: unknown;
  const selection = resolveAgentModelSelection(input.modelProfile, "planner");
  const stream = runAgent({
    agentType: "orchestrator" as any,
    agentLabel: "Orchestrator Agent",
    name: "orchestrator-evidence-resolution",
    systemPrompt: DOCUMENT_EVIDENCE_ORCHESTRATOR_PROMPT,
    modelOptions: {
      enableThinking: true,
      responseFormat: "json_object",
      temperature: 0,
      maxTokens: 16_384,
    },
    modelProfile: input.modelProfile,
    modelGroup: "orchestrator",
    modelSummary: {
      current: createModelSummarySnapshot(
        resolveAgentModelSelection(input.modelProfile, "orchestrator"),
      ),
      delegatedSubagent: createModelSummarySnapshot(selection),
    },
    subagents: [createDocumentEvidenceResolverSubagent(input)],
    subagentModelGroups: { "document-evidence-resolver": "planner" },
    requiredSubagentType: "document-evidence-resolver",
    payload: {
      mode: "evidence-resolution",
      evidence_resolution_payload:
        createDocumentEvidenceResolutionPayload(input),
    },
    resolveOutput: (context) =>
      resolveJsonOutput(context, DocumentEvidenceResolutionSchema),
    fallback: () => createFallbackDocumentEvidenceResolution(input),
    signal: input.signal,
  });

  try {
    let next = await stream.next();
    while (!next.done) {
      const event = next.value;
      if (
        event.type === "subagent-result" &&
        event.subagentType === "document-evidence-resolver"
      ) {
        subagentResult = event.result;
      }
      yield event as ProductWorkflowStreamEvent;
      next = await stream.next();
    }

    const candidate = parseResolverCandidate(subagentResult ?? next.value);
    return normalizeDocumentEvidenceResolution(candidate, input);
  } catch (error) {
    if (
      error instanceof Error &&
      error.message.includes("required-subagent-not-invoked")
    ) {
      return createFallbackDocumentEvidenceResolution(input);
    }
    throw error;
  }
}

/**
 * 将 task ToolMessage 或顶层结构化结果转为可校验对象。
 */
function parseResolverCandidate(value: unknown): unknown {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    if ("questions" in value) return value;
  }
  const content = resolveToolMessageContent(value);
  return content ? parseJsonObject(content) : null;
}
