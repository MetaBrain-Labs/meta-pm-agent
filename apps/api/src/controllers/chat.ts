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
  routes.get("/workspaces/:workspaceId/knowledge-graph", getWorkspaceKnowledgeGraphHandler);

  return routes;
}
