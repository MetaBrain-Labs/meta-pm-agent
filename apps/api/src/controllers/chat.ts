/**
 * API 路由组装
 *
 * 创建 `/api` 下的业务路由组，挂载账号、工作区、聊天流、知识图谱和文档生成
 * 相关控制器。具体业务处理保持在各控制器文件内。
 *
 * Responsibilities:
 * - 维护 API 路径到控制器的映射
 * - 保持聊天和文档生成入口在同一 Hono 子路由下
 * - 避免在路由定义中混入业务逻辑
 */

import { Hono } from "hono";
import {
  getAccountHandler,
  listWorkspacesHandler,
  createWorkspaceHandler,
  listChatsHandler,
  listMessagesHandler,
  createChatHandler,
  chatStreamHandler,
  stopChatHandler,
  getWorkspaceKnowledgeGraphHandler,
} from "./chat-controller";
import {
  getDocumentGenerationRunHandler,
  getLatestDocumentGenerationHandler,
  startDocumentGenerationHandler,
  stopDocumentGenerationHandler,
} from "./document-controller";
import {
  createModelProfileHandler,
  deleteModelProfileHandler,
  getConversationModelProfileHandler,
  listModelProfilesHandler,
  selectConversationModelProfileHandler,
  updateModelProfileHandler,
} from "./model-profile-controller";

/**
 * 创建聊天相关的路由组，将路径映射到对应的控制器处理器。
 */
export function createChatRoutes() {
  const routes = new Hono();

  routes.get("/account", getAccountHandler);
  routes.get("/workspaces", listWorkspacesHandler);
  routes.post("/workspaces", createWorkspaceHandler);
  routes.get("/chats", listChatsHandler);
  routes.get("/chats/:id/messages", listMessagesHandler);
  routes.post("/chats", createChatHandler);
  routes.post("/chat", chatStreamHandler);
  routes.post("/chat/stop", stopChatHandler);
  routes.get("/model-profiles", listModelProfilesHandler);
  routes.post("/model-profiles", createModelProfileHandler);
  routes.put("/model-profiles/:id", updateModelProfileHandler);
  routes.delete("/model-profiles/:id", deleteModelProfileHandler);
  routes.get("/chats/:id/model-profile", getConversationModelProfileHandler);
  routes.put("/chats/:id/model-profile", selectConversationModelProfileHandler);
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

  return routes;
}
