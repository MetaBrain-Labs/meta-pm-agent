/**
 * 设置页提示词能力 Hook
 *
 * 在设置弹窗打开时读取当前身份的提示词配置能力，用于决定左侧导航是否显示
 * 「提示词管理」入口。
 *
 * Responsibilities:
 * - 按打开状态请求 /api/prompt-config/access
 * - 暴露能力与加载状态，请求失败时按「无权限」处理
 *
 * Notes:
 * - 该能力仅用于界面显隐；读写权限始终由 API 独立校验
 */

import { useCallback, useEffect, useState } from "react";
import { fetchPromptConfigAccess } from "../api/prompt-config-api";
import type { PromptConfigAccess } from "../types";

/** 读取提示词配置能力；未打开或请求失败时返回 null。 */
export function usePromptConfigAccess(open: boolean) {
  const [access, setAccess] = useState<PromptConfigAccess | null>(null);
  const [loading, setLoading] = useState(false);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      setAccess(await fetchPromptConfigAccess());
    } catch (error) {
      console.error("[prompt-config] Failed to load prompt access:", error);
      setAccess(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!open) return;
    void reload();
  }, [open, reload]);

  return { access, loading };
}
