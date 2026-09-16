/**
 * 工作区本地保存状态（项目列表页的轻量区块）
 *
 * 项目列表页只保留两个产物行的状态，不展示项目路径、Product Context 路径、
 * PRD 路径或数据库拷贝说明——这些属于技术细节，进入 Header 状态浮层的详情层。
 *
 * Responsibilities:
 * - 展示项目上下文与 PRD 的保存状态，并给出重新同步入口
 *
 * Notes:
 * - 本地失败仅展示提示，不影响现有工作流与文档下载。
 * - 状态来自现有契约，不新增产物状态模型。
 */
import { Button, Tooltip } from "antd";
import { ReloadOutlined } from "@ant-design/icons";
import type { LocalStorageEntry } from "@repo/shared";
import { useWorkspaceLocalStorage } from "../hooks/useWorkspaceLocalStorage";
import { describeEntryStatus } from "../utils/workspace-sync-status";

/** 面板消费工作区身份与页面拥有的运行状态。 */
interface WorkspaceLocalStoragePanelProps {
  workspaceId: string;
  refreshKey?: string;
  disabled?: boolean;
}

/** 两类产物的展示标题。 */
const ARTIFACTS = [
  { key: "context", label: "项目上下文" },
  { key: "prd", label: "PRD 文档" },
] as const;

/**
 * 单行产物的状态点。
 *
 * 用「圆点 + 文字」表达，不使用彩色 Tag，避免每项都成为强视觉元素。
 */
function StatusDot({ status }: { status: LocalStorageEntry["status"] | null }) {
  const tone =
    status === "synced"
      ? "done"
      : status === "conflict" || status === "unavailable"
        ? "failed"
        : "idle";
  return (
    <span className="storage-status" data-tone={tone}>
      <i aria-hidden="true" />
      {describeEntryStatus(status)}
    </span>
  );
}

/** 展示项目生成文件的当前真实磁盘状态。 */
export function WorkspaceLocalStoragePanel({
  workspaceId,
  refreshKey = "",
  disabled = false,
}: WorkspaceLocalStoragePanelProps) {
  const { status, error, syncing, synchronize } = useWorkspaceLocalStorage(
    workspaceId,
    refreshKey,
    disabled,
  );

  const loading = !status && !error;

  return (
    <section className="storage-panel" aria-label="本地保存状态">
      <ul className="storage-list">
        {loading ? (
          <li className="storage-item is-muted">正在读取项目目录…</li>
        ) : error ? (
          <li className="storage-item is-error">{error}</li>
        ) : (
          ARTIFACTS.map((artifact) => (
            <li key={artifact.key} className="storage-item">
              <span className="storage-item-label">{artifact.label}</span>
              <StatusDot status={status?.[artifact.key]?.status ?? null} />
            </li>
          ))
        )}
      </ul>

      <div className="storage-panel-foot">
        <Tooltip title={disabled ? "当前任务结束后可以重新同步" : "重新同步只补齐缺失文件"}>
          <span>
            <Button
              size="small"
              icon={<ReloadOutlined />}
              loading={syncing}
              disabled={disabled}
              onClick={() => void synchronize()}
            >
              重新同步
            </Button>
          </span>
        </Tooltip>
      </div>
    </section>
  );
}
