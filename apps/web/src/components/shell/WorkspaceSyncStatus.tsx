/**
 * 工作区同步状态（Header 内联 + 详情浮层）
 *
 * 项目本地同步是工作区级状态，统一放在 Workspace Header 右侧：默认只显示一个
 * 轻量内联状态，正常状态尽量弱化；点击后展开详情浮层，技术路径等只在
 * 「查看详情」之后出现。
 *
 * Responsibilities:
 * - 渲染内联同步状态，并按状态轻重调整可见度
 * - 在浮层中展示整体状态、说明、产物行状态与重新同步入口
 * - 把技术信息（本地路径、产物路径、具体阻碍）收进第二层
 *
 * Notes:
 * - 复用 useWorkspaceLocalStorage，不复制同步逻辑、不改变同步约束。
 * - 契约没有同步时间戳字段，因此不展示「最后同步时间」。
 */

import { useState } from "react";
import { Button, Popover, Spin, Tooltip } from "antd";
import {
  CheckCircleOutlined,
  ExclamationCircleOutlined,
  LoadingOutlined,
  ReloadOutlined,
  SyncOutlined,
} from "@ant-design/icons";
import { useWorkspaceLocalStorage } from "../../hooks/useWorkspaceLocalStorage";
import {
  buildSyncSummary,
  describeEntryStatus,
  type SyncTone,
} from "../../utils/workspace-sync-status";

interface Props {
  workspaceId: string;
  /** 项目名称，用于浮层标题。 */
  workspaceName?: string;
  /** 项目本地根目录；只在详情层展示，并折叠为相对路径。 */
  workspacePath?: string | null;
  /** 刷新依据；变化时重新读取状态。 */
  refreshKey?: string;
  /** 有运行中的任务时不可重新同步。 */
  disabled?: boolean;
}

/** 状态图标：正常用对勾，异常用感叹号，进行中用旋转。 */
function StatusIcon({ tone }: { tone: SyncTone }) {
  if (tone === "synced") return <CheckCircleOutlined />;
  if (tone === "failed") return <ExclamationCircleOutlined />;
  if (tone === "running") return <LoadingOutlined />;
  return <SyncOutlined />;
}

export function WorkspaceSyncStatus({
  workspaceId,
  workspaceName,
  workspacePath,
  refreshKey = "",
  disabled = false,
}: Props) {
  const { status, error, syncing, synchronize } = useWorkspaceLocalStorage(
    workspaceId,
    refreshKey,
    disabled,
  );
  const [detailsOpen, setDetailsOpen] = useState(false);
  const summary = buildSyncSummary({ status, error, syncing, disabled });

  const entries = status
    ? [
        { key: "context", label: "项目上下文", entry: status.context },
        { key: "prd", label: "PRD 文档", entry: status.prd },
      ]
    : [];

  const content = (
    <div className="sync-detail">
      <div className="sync-detail-head">
        <span className="sync-detail-title">{workspaceName || "当前项目"}</span>
        <span className="sync-detail-state" data-tone={summary.tone}>
          <StatusIcon tone={summary.tone} />
          {summary.label}
        </span>
      </div>

      <p className="sync-detail-desc">{summary.description}</p>

      {entries.length > 0 && (
        <ul className="sync-detail-entries">
          {entries.map(({ key, label, entry }) => (
            <li key={key} data-tone={entry.status}>
              <span>{label}</span>
              <em>{describeEntryStatus(entry.status)}</em>
            </li>
          ))}
        </ul>
      )}

      {summary.blockers.length > 0 && (
        <ul className="sync-detail-blockers">
          {summary.blockers.map((blocker) => (
            <li key={blocker}>{blocker}</li>
          ))}
        </ul>
      )}

      {/*
        技术信息默认不展开：完整路径与具体文件不是一级信息。
      */}
      <details className="sync-detail-more">
        <summary>查看详情</summary>
        <dl>
          <div>
            <dt>项目路径</dt>
            <dd>{workspacePath || "尚未关联本地路径"}</dd>
          </div>
          {entries.map(({ key, label, entry }) => (
            <div key={key}>
              <dt>{label}</dt>
              <dd>{entry.path || "尚未生成"}</dd>
            </div>
          ))}
        </dl>
      </details>

      <div className="sync-detail-foot">
        <Tooltip
          title={disabled ? "当前任务结束后可以重新同步" : undefined}
        >
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
    </div>
  );

  return (
    <Popover
      content={content}
      trigger="click"
      placement="bottomRight"
      arrow={false}
      overlayClassName="sync-popover"
      onOpenChange={setDetailsOpen}
    >
      <button
        type="button"
        className="workspace-sync-status"
        data-tone={summary.tone}
        data-open={detailsOpen ? "true" : "false"}
        aria-label={`本地同步状态：${summary.label}`}
      >
        {syncing ? <Spin size="small" indicator={<LoadingOutlined />} /> : <StatusIcon tone={summary.tone} />}
        <span>{summary.label}</span>
      </button>
    </Popover>
  );
}
