/**
 * 本地目录浏览状态 Hook
 *
 * Responsibilities:
 * - 管理目录导航、请求取消及加载错误
 * - 防止快速切换目录时旧响应覆盖当前目录
 *
 * Notes:
 * - 只管理选择器草稿，确认前不修改项目表单。
 */
import { useEffect, useState } from "react";
import type { LocalDirectoryListing } from "@repo/shared";
import { fetchLocalDirectory } from "../api/local-directory-api";
import { mapErrorToChinese } from "../utils/errors";

/** 管理一次目录选择会话中的导航和异步读取状态。 */
export function useLocalDirectoryBrowser(initialPath?: string) {
  // 旧目录选择器可能留下名称；名称不能定位磁盘目录，改从主目录开始。
  const [targetPath, setTargetPath] = useState(
    initialPath && /^(?:[A-Za-z]:[\\/]|\/|\\\\)/.test(initialPath)
      ? initialPath
      : undefined,
  );
  const [pathInput, setPathInput] = useState(initialPath ?? "");
  const [listing, setListing] = useState<LocalDirectoryListing | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    fetchLocalDirectory(targetPath, controller.signal)
      .then((result) => {
        if (controller.signal.aborted) return;
        setListing(result);
        setPathInput(result.currentPath);
      })
      .catch((cause: unknown) => {
        if (controller.signal.aborted) return;
        setError(mapErrorToChinese(cause));
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [targetPath, revision]);

  /** 切换目录时立即禁用确认，避免把前一个目录误写入项目表单。 */
  function navigate(directoryPath?: string) {
    setLoading(true);
    setError(null);
    setTargetPath(directoryPath);
    setRevision((value) => value + 1);
  }

  return { listing, loading, error, pathInput, setPathInput, navigate };
}
