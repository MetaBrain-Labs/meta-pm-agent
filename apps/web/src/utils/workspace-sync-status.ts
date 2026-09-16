/**
 * 工作区本地同步状态推导
 *
 * 把磁盘同步结果归纳成「一个状态 + 一句说明」，供 Header 的内联状态与详情浮层
 * 共用。状态只描述现有契约里真实存在的信息，不引入新的同步状态模型。
 *
 * Responsibilities:
 * - 由 context / prd 两行产物状态推导整体状态
 * - 生成用户可读的说明与阻碍原因
 * - 提供是否需要详情的判断
 *
 * Notes:
 * - 只做展示映射，不发起请求、不改变同步约束。
 * - 契约没有同步时间戳字段，因此不展示「最后同步时间」。
 */

import type { WorkspaceLocalStorageStatus } from "@repo/shared";

/** 整体同步状态的展示档位。 */
export type SyncTone = "synced" | "pending" | "running" | "failed";

export interface SyncSummary {
  tone: SyncTone;
  /** 状态短标签，用于 Header 内联展示。 */
  label: string;
  /** 一句说明，用于详情浮层。 */
  description: string;
  /** 需要用户处理的具体阻碍；无则为空数组。 */
  blockers: string[];
  /** 是否已拿到真实状态（未拿到时不显示误导性的"已同步"）。 */
  known: boolean;
}

/** 单行产物的状态文案。 */
const ENTRY_LABELS: Record<string, string> = {
  empty: "尚未生成",
  synced: "已同步",
  missing: "待同步",
  conflict: "内容冲突",
  unavailable: "不可用",
};

/** 取得某行产物的展示文案；无数据时返回占位。 */
export function describeEntryStatus(status?: string | null): string {
  if (!status) return "未知";
  return ENTRY_LABELS[status] ?? status;
}

/**
 * 推导整体同步状态。
 *
 * 优先级：失败 > 待同步/冲突 > 进行中 > 已同步。
 * 只要有一行不可用或冲突，整体就按失败处理，避免把问题藏进"已同步"。
 */
export function buildSyncSummary({
  status,
  error,
  syncing,
  disabled,
}: {
  status: WorkspaceLocalStorageStatus | null;
  error: string | null;
  syncing: boolean;
  /** 有运行中的任务时不可重新同步。 */
  disabled: boolean;
}): SyncSummary {
  if (error) {
    return {
      tone: "failed",
      label: "同步失败",
      description: "无法读取本地保存状态。",
      blockers: [error],
      known: true,
    };
  }

  if (!status) {
    return {
      tone: syncing ? "running" : "pending",
      label: syncing ? "同步中" : "读取中",
      description: syncing ? "正在补齐本地副本。" : "正在读取项目目录状态。",
      blockers: [],
      known: false,
    };
  }

  const entries = [status.context, status.prd];
  const failed = entries.filter(
    (entry) => entry.status === "conflict" || entry.status === "unavailable",
  );
  const pending = entries.filter(
    (entry) => entry.status === "missing" || entry.status === "empty",
  );
  const blockers = [
    ...new Set([
      ...failed.map((entry) => entry.message).filter((v): v is string => Boolean(v)),
      ...status.warnings,
    ]),
  ];

  if (failed.length > 0) {
    return {
      tone: "failed",
      label: "同步失败",
      description: "本地副本与已保存数据不一致，需要处理后重新同步。",
      blockers,
      known: true,
    };
  }

  if (pending.length > 0) {
    return {
      tone: "pending",
      label: syncing ? "同步中" : "待同步",
      description: disabled
        ? "本地副本需要同步，当前任务结束后可以重新同步。"
        : "本地副本需要同步，重新同步只补齐缺失文件。",
      blockers,
      known: true,
    };
  }

  return {
    tone: syncing ? "running" : "synced",
    label: syncing ? "同步中" : "已同步",
    description: "项目上下文与 PRD 已保存在项目目录。",
    blockers,
    known: true,
  };
}
