/**
 * 工作区本地同步状态 Hook
 *
 * Responsibilities:
 * - 在工作区或产物变化后刷新真实磁盘状态
 * - 首次使用补导出缺失副本，并处理手动重新同步
 *
 * Notes:
 * - 不将同步状态保存在 localStorage，旧请求不得更新新的工作区。
 */
import { useCallback, useEffect, useRef, useState } from "react";
import type { WorkspaceLocalStorageStatus } from "@repo/shared";
import { fetchWorkspaceLocalStorage, synchronizeWorkspaceLocalStorage } from "../api/workspace-local-storage-api";

/** 管理当前工作区的磁盘同步状态与补同步操作。 */
export function useWorkspaceLocalStorage(workspaceId: string, refreshKey: string, disabled: boolean) {
  const [status, setStatus] = useState<WorkspaceLocalStorageStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);
  const generation = useRef(0);

  useEffect(() => {
    const current = ++generation.current;
    let cancelled = false;
    setStatus(null);
    setError(null);
    setSyncing(false);
    // 未选中工作区时保持空状态，避免向后端请求无效路径。
    if (!workspaceId) return;
    const load = async () => {
      let next = await fetchWorkspaceLocalStorage(workspaceId);
      if (cancelled) return;
      setStatus(next);
      // 第一次接入时补导出缺失副本；冲突内容始终留给用户处理。
      if (!disabled && (next.context.status === "missing" || next.prd.status === "missing")) {
        next = await synchronizeWorkspaceLocalStorage(workspaceId);
        if (!cancelled && generation.current === current) setStatus(next);
      }
    };
    void load().catch((failure) => {
      if (!cancelled) setError(failure instanceof Error ? failure.message : "本地同步状态暂不可用。");
    });
    return () => { cancelled = true; generation.current++; };
  }, [workspaceId, refreshKey, disabled]);

  /** 用户处理权限或文件冲突后重新尝试，两类产物分别展示结果。 */
  const synchronize = useCallback(async () => {
    if (syncing || disabled) return;
    const current = generation.current;
    setSyncing(true);
    setError(null);
    try {
      const next = await synchronizeWorkspaceLocalStorage(workspaceId);
      if (generation.current === current) setStatus(next);
    } catch (failure) {
      if (generation.current === current) setError(failure instanceof Error ? failure.message : "本地同步失败，请稍后重试。");
    } finally { if (generation.current === current) setSyncing(false); }
  }, [workspaceId, syncing, disabled]);
  return { status, error, syncing, synchronize };
}
