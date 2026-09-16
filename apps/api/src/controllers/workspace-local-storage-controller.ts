/**
 * 工作区本地存储 HTTP 边界
 *
 * Responsibilities:
 * - 校验工作区所有权并提供状态查询与重新同步
 *
 * Notes:
 * - 重新同步不覆盖不同内容，不允许在工作区任务运行期间执行。
 */
import { Hono } from "hono";
import { assertWorkspaceHasNoActiveRuns, requireActiveWorkspace, WorkspaceServiceError } from "../services/workspace-service";
import { getWorkspaceLocalStorageStatus, synchronizeWorkspaceLocalStorage } from "../services/workspace-local-storage-service";

/** 挂载本地存储状态及无覆盖补同步路由。 */
export function createWorkspaceLocalStorageRoutes() {
  const routes = new Hono();
  routes.use("/*", async (c, next) => {
    c.header("Cache-Control", "no-store");
    await next();
  });
  routes.get("/:id/local-storage", async (c) => {
    try {
      const workspace = await requireActiveWorkspace(c.req.param("id"));
      return c.json(await getWorkspaceLocalStorageStatus(workspace));
    } catch (error) {
      if (error instanceof WorkspaceServiceError) return c.json({ error: error.message }, error.statusCode);
      console.error("[local-storage] Status query failed:", error);
      return c.json({ error: "暂时无法查询本地同步状态，请稍后重试。" }, 500);
    }
  });
  routes.post("/:id/local-storage/sync", async (c) => {
    try {
      const id = c.req.param("id");
      const workspace = await requireActiveWorkspace(id);
      await assertWorkspaceHasNoActiveRuns(id, "重新同步本地产物");
      return c.json(await synchronizeWorkspaceLocalStorage(workspace));
    } catch (error) {
      if (error instanceof WorkspaceServiceError) return c.json({ error: error.message }, error.statusCode);
      console.error("[local-storage] Synchronization failed:", error);
      return c.json({ error: "暂时无法加载已保存产物，请稍后重新同步。" }, 500);
    }
  });
  return routes;
}
