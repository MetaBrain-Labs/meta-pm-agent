/**
 * 本地目录选择 API 客户端
 *
 * Responsibilities:
 * - 请求 API 主机上的单层目录列表并支持取消请求
 *
 * Notes:
 * - 目录路径由 API 返回，不使用浏览器上传接口推测磁盘路径。
 */
import type { LocalDirectoryListing } from "@repo/shared";

/** 加载目录导航数据并将服务端错误转成用户可读异常。 */
export async function fetchLocalDirectory(
  directoryPath?: string,
  signal?: AbortSignal,
): Promise<LocalDirectoryListing> {
  const query = directoryPath === undefined ? "" : `?${new URLSearchParams({ path: directoryPath })}`;
  const response = await fetch(`/api/local-directories${query}`, { signal });
  if (!response.ok) {
    const body = await response.json().catch(() => null) as { error?: string } | null;
    throw new Error(body?.error ?? "无法加载目录，请重试。");
  }
  return response.json() as Promise<LocalDirectoryListing>;
}
