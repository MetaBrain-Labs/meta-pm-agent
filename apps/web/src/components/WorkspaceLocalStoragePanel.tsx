/**
 * 工作区本地保存状态面板
 *
 * Responsibilities:
 * - 展示上下文与 PRD 的保存位置、同步状态和重新同步入口
 *
 * Notes:
 * - 本地失败仅展示提示，不影响现有工作流与文档下载。
 */
import { Alert, Button, Spin, Tag } from "antd";
import type { LocalStorageEntry } from "@repo/shared";
import { useWorkspaceLocalStorage } from "../hooks/useWorkspaceLocalStorage";

/** 面板消费工作区身份以及页面拥有的运行和刷新状态。 */
interface WorkspaceLocalStoragePanelProps {
  workspaceId: string;
  refreshKey?: string;
  disabled?: boolean;
}

const STATUS_LABELS: Record<LocalStorageEntry["status"], string> = {
  empty: "暂无产物", synced: "已同步", missing: "未保存", conflict: "内容冲突", unavailable: "不可用",
};

/** 展示项目生成文件的当前真实磁盘状态。 */
export function WorkspaceLocalStoragePanel({ workspaceId, refreshKey = "", disabled = false }: WorkspaceLocalStoragePanelProps) {
  const { status, error, syncing, synchronize } = useWorkspaceLocalStorage(workspaceId, refreshKey, disabled);
  const warnings = [...new Set([...(status?.warnings ?? []), status?.context.message, status?.prd.message, error].filter((value): value is string => Boolean(value)))];
  return (
    <section className="my-3 rounded border border-gray-200 bg-white p-3" aria-label="本地保存状态">
      <div className="mb-2 flex items-center justify-between gap-2">
        <span className="text-sm font-medium">本地保存</span>
        <Button size="small" loading={syncing} disabled={disabled} onClick={() => void synchronize()}>重新同步</Button>
      </div>
      {!status && !error && <Spin size="small" />}
      {status && ([ ["上下文", status.context], ["PRD", status.prd] ] as const).map(([label, entry]) => (
        <div key={label} className="mb-2 text-xs">
          <span>{label} </span><Tag color={entry.status === "synced" ? "success" : "default"}>{STATUS_LABELS[entry.status]}</Tag>
          <div className="mt-1 break-all text-gray-500">{entry.path ?? "未设置本地路径"}</div>
        </div>
      ))}
      {warnings.length > 0 && <Alert type="warning" showIcon title={warnings.join(" ")} />}
    </section>
  );
}
