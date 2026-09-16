/**
 * 工作区知识图谱数据
 *
 * 图谱属于工作区而不是会话，因此加载、缓存与刷新集中在这一个 Hook 里。对话输入
 * 区的图谱弹窗与项目面板的「知识图谱」Tab 共用同一份数据，避免两处各自请求、
 * 出现互相不一致的版本。
 *
 * Responsibilities:
 * - 按工作区读取产品知识图谱
 * - 每次 Executor 结果落库后自动刷新一次
 * - 支持 `loadOnMount`：图谱面板作为主入口时立即读取，其余入口保持惰性
 *
 * Notes:
 * - 只做读取，不修改图谱；写入仍由 API 在 Executor 完成后负责。
 * - 默认不主动加载：对话弹窗按需触发，避免打开对话就请求图谱。
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  fetchProductKnowledgeGraph,
  type WorkspaceKnowledgeGraphData,
} from "../api/chat-api";
import { mapErrorToChinese } from "../utils/errors";

/** 弹窗与面板共用的图谱状态。 */
export interface KnowledgeGraphState {
  data: WorkspaceKnowledgeGraphData | null;
  loading: boolean;
  /** 读取失败的用户可读原因；成功时为 null。 */
  error: string | null;
  /** 手动重新读取图谱。 */
  refresh: () => Promise<void>;
  /**
   * 是否已为当前工作区尝试过读取。
   *
   * 图谱面板据此在首次打开时自动补一次请求：懒加载入口（对话弹窗）不会主动
   * 加载，面板打开时必须自己补上，否则会显示"没有数据"。
   */
  attempted: boolean;
}

interface Options {
  /** 工作区确定后是否立即读取一次；默认 false，保持进入工作区不请求。 */
  loadOnMount?: boolean;
}

export function useKnowledgeGraph(
  workspaceId: string | null,
  messages: { executorResults?: Array<{ task_id: string }> }[],
  options: Options = {},
): KnowledgeGraphState {
  const { loadOnMount = false } = options;
  const [data, setData] = useState<WorkspaceKnowledgeGraphData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [attempted, setAttempted] = useState(false);

  // 每个 Executor 结果流入前端时，API 已完成对应图谱归档，此时刷新缓存。
  const executorResultKey = useMemo(
    () =>
      messages
        .flatMap((message) => message.executorResults ?? [])
        .map((result) => result.task_id)
        .sort()
        .join("|"),
    [messages],
  );

  // 工作区切换时清理缓存与读取标记，避免把上一个项目的图谱沿用过来。
  useEffect(() => {
    setData(null);
    setError(null);
    setAttempted(false);
  }, [workspaceId]);

  /** 读取一次图谱并记录已尝试，供自动与手动两个入口共用。 */
  const load = useCallback(async () => {
    if (!workspaceId) return;
    setLoading(true);
    setAttempted(true);
    setError(null);
    try {
      setData(await fetchProductKnowledgeGraph(workspaceId));
    } catch (cause) {
      console.error("[kg] Failed to load knowledge graph:", cause);
      setData(null);
      // 把失败原因暴露给界面：否则面板会永远停在"正在读取"。
      setError(mapErrorToChinese(cause));
    } finally {
      setLoading(false);
    }
  }, [workspaceId]);

  // 需要立即加载的入口（图谱面板）在工作区确定后读取一次。
  useEffect(() => {
    if (!loadOnMount || !workspaceId) return;
    void load();
  }, [load, loadOnMount, workspaceId]);

  useEffect(() => {
    if (!workspaceId || !executorResultKey) return;

    let cancelled = false;
    setLoading(true);
    setAttempted(true);
    fetchProductKnowledgeGraph(workspaceId)
      .then((next) => {
        if (cancelled) return;
        setData(next);
        setError(null);
      })
      .catch((cause) => {
        if (cancelled) return;
        console.error("[kg] Failed to refresh knowledge graph:", cause);
        setError(mapErrorToChinese(cause));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [executorResultKey, workspaceId]);

  /** 手动刷新：即使没有 Executor 结果也会重新读取；与自动加载共用同一实现。 */
  const refresh = load;

  return { data, loading, error, refresh, attempted };
}
