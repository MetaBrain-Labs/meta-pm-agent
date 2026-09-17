/**
 * API 路由组装
 *
 * 创建 `/api` 下的业务路由组，挂载本地工作区、聊天流、知识图谱和文档生成
 * 相关控制器。具体业务处理保持在各控制器文件内。
 *
 * Responsibilities:
 * - 维护 API 路径到控制器的映射
 * - 保持聊天、文档生成、模型列表与提示词配置入口在同一 Hono 子路由下
 * - 避免在路由定义中混入业务逻辑
 */

import { Hono } from "hono";
import {
  chatStreamHandler,
  createChatHandler,
  createWorkspaceHandler,
  deleteChatHandler,
  deleteWorkspaceHandler,
  getWorkspaceKnowledgeGraphHandler,
  listChatsHandler,
  listMessagesHandler,
  listWorkspacesHandler,
  stopChatHandler,
  updateChatHandler,
  updateWorkspaceHandler,
} from "./chat-controller";
import {
  createDocumentEvidenceResolutionHandler,
  getDocumentGenerationRunHandler,
  getLatestDocumentGenerationHandler,
  startDocumentGenerationHandler,
  resumeDocumentGenerationHandler,
  stopDocumentGenerationHandler,
} from "./document-controller";
import {
  createModelProfileHandler,
  deleteModelProfileHandler,
  getConversationModelProfileHandler,
  listModelProfilesHandler,
  selectConversationModelProfileHandler,
  selectDefaultModelProfileHandler,
  updateModelProfileHandler,
} from "./model-profile-controller";
import {
  getPromptConfigAccessHandler,
  listWorkspacePromptsHandler,
  resetWorkspacePromptHandler,
  saveWorkspacePromptHandler,
} from "./prompt-config-controller";

/**
 * 创建聊天相关的路由组，将路径映射到对应的控制器处理器。
 */
export function createChatRoutes() {
  const routes = new Hono();

  routes.get("/workspaces", listWorkspacesHandler);
  routes.post("/workspaces", createWorkspaceHandler);
  routes.patch("/workspaces/:id", updateWorkspaceHandler);
  routes.delete("/workspaces/:id", deleteWorkspaceHandler);
  routes.get("/chats", listChatsHandler);
  routes.get("/chats/:id/messages", listMessagesHandler);
  routes.post("/chats", createChatHandler);
  routes.patch("/chats/:id", updateChatHandler);
  routes.delete("/chats/:id", deleteChatHandler);
  routes.post("/chat", chatStreamHandler);
  routes.post("/chat/stop", stopChatHandler);
  routes.get("/model-profiles", listModelProfilesHandler);
  routes.post("/model-profiles", createModelProfileHandler);
  // 静态路径必须先于 /model-profiles/:id 注册，避免 "default" 被当作列表 id。
  routes.put("/model-profiles/default", selectDefaultModelProfileHandler);
  routes.put("/model-profiles/:id", updateModelProfileHandler);
  routes.delete("/model-profiles/:id", deleteModelProfileHandler);
  routes.get("/chats/:id/model-profile", getConversationModelProfileHandler);
  routes.put("/chats/:id/model-profile", selectConversationModelProfileHandler);
  routes.get("/prompt-config/access", getPromptConfigAccessHandler);
  routes.get("/workspaces/:workspaceId/prompts", listWorkspacePromptsHandler);
  routes.put("/workspaces/:workspaceId/prompts/:promptId", saveWorkspacePromptHandler);
  routes.delete(
    "/workspaces/:workspaceId/prompts/:promptId",
    resetWorkspacePromptHandler,
  );
  routes.get("/workspaces/:workspaceId/knowledge-graph", getWorkspaceKnowledgeGraphHandler);
  routes.get(
    "/workspaces/:workspaceId/document-generation/latest",
    getLatestDocumentGenerationHandler,
  );
  routes.post(
    "/workspaces/:workspaceId/document-generation",
    startDocumentGenerationHandler,
  );
  routes.get("/document-generation/:runId", getDocumentGenerationRunHandler);
  routes.post(
    "/document-generation/:runId/stop",
    stopDocumentGenerationHandler,
  );
  routes.post(
    "/document-generation/:runId/resume",
    resumeDocumentGenerationHandler,
  );
  routes.post(
    "/document-generation/:runId/evidence-resolution",
    createDocumentEvidenceResolutionHandler,
  );

  return routes;
}
