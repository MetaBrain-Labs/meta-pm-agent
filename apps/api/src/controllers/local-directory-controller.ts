/**
 * 本地目录浏览 HTTP 控制器
 *
 * Responsibilities:
 * - 提供只读目录列表接口并返回可展示的路径错误
 *
 * Notes:
 * - 由应用统一的本地来源校验保护，不提供文件下载或写入接口。
 */
import { Hono } from "hono";
import { browseLocalDirectory, LocalDirectoryError } from "../services/local-directory-service";

/** 创建目录选择器路由，独立于数据库和 Agent 执行。 */
export function createLocalDirectoryRoutes() {
  const routes = new Hono();
  routes.get("/", async (c) => {
    const requested = c.req.query("path");
    if (requested !== undefined && (requested.length === 0 || requested.length > 2048)) {
      return c.json({ error: "目录路径长度必须在 1 到 2048 个字符之间。" }, 400);
    }
    c.header("Cache-Control", "no-store");
    try {
      return c.json(await browseLocalDirectory(requested));
    } catch (error) {
      if (error instanceof LocalDirectoryError) {
        return c.json({ error: error.message }, error.statusCode);
      }
      return c.json({ error: "目录浏览暂不可用，请重试。" }, 500);
    }
  });
  return routes;
}
