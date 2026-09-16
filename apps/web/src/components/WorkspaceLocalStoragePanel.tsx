/**
 * 工作区本地保存状态面板
 *
 * Responsibilities:
 * - 展示上下文与 PRD 在项目目录中的相对位置、同步状态和重新同步入口
 *
 * Notes:
 * - 本地失败仅展示提示，不影响现有工作流与文档下载。
 * - 磁盘绝对路径只作为 Tooltip 信息，主视觉只展示相对项目目录的短路径。
 */
import { Alert, Button, Spin, Tag, Tooltip } from "antd";
import { FileTextOutlined, ReloadOutlined } from "@ant-design/icons";
import type { LocalStorageEntry } from "@repo/shared";
import { useWorkspaceLocalStorage } from "../hooks/useWorkspaceLocalStorage";
import { Surface } from "./ui/Surface";

/** 面板消费工作区身份、项目展示信息以及页面拥有的运行和刷新状态。 */
interface WorkspaceLocalStoragePanelProps {
  workspaceId: string;
  refreshKey?: string;
  disabled?: boolean;
  /** 当前项目名称，用于面板头部展示 */
  projectName?: string;
  /** 当前项目本地根目录，用于折叠绝对路径前缀 */
  projectPath?: string | null;
}

/** 产物状态对应的中文文案。 */
const STATUS_LABELS: Record<LocalStorageEntry["status"], string> = {
  empty: "未生成",
  synced: "已同步",
  missing: "未生成",
  conflict: "内容冲突",
  unavailable: "不可用",
};

/** 产物状态对应的标签配色：未生成为中性，同步中为处理中，其余按语义着色。 */
const STATUS_COLORS: Record<LocalStorageEntry["status"], string> = {
  empty: "",
  synced: "success",
  missing: "",
  conflict: "warning",
  unavailable: "error",
};

/** 两类产物的展示标题与用途说明。 */
const ARTIFACTS = [
  {
    key: "context",
    label: "项目上下文",
    hint: "产品上下文的本地快照",
  },
  {
    key: "prd",
    label: "PRD 文档",
    hint: "最新一版 PRD 的导出目录",
  },
] as const;

/**
 * 将磁盘绝对路径折叠为项目目录内的相对路径。
 *
 * 优先去掉项目根目录前缀；根目录不一致时截取末尾两段，保证长路径不撑破布局。
 */
function toRelativePath(targetPath: string, rootPath: string): string {
  const target = targetPath.replace(/\\/g, "/").replace(/\/+$/, "");
  const root = rootPath.replace(/\\/g, "/").replace(/\/+$/, "");
  if (root && target.toLowerCase().startsWith(`${root.toLowerCase()}/`)) {
    return target.slice(root.length + 1);
  }
  const segments = target.split("/").filter(Boolean);
  return segments.length > 2 ? `…/${segments.slice(-2).join("/")}` : target;
}

/** 展示项目生成文件的当前真实磁盘状态，并把绝对路径收敛为一行可扫描的相对路径。 */
export function WorkspaceLocalStoragePanel({
  workspaceId,
  refreshKey = "",
  disabled = false,
  projectName,
  projectPath,
}: WorkspaceLocalStoragePanelProps) {
  const { status, error, syncing, synchronize } = useWorkspaceLocalStorage(workspaceId, refreshKey, disabled);
  const warnings = [...new Set([...(status?.warnings ?? []), status?.context.message, status?.prd.message, error].filter((value): value is string => Boolean(value)))];

  /** 查询中显示整体加载态，其余状态由每行产物标签表达。 */
  const loading = !status && !error;

  return (
    <Surface as="section" className="storage-panel" aria-label="当前项目本地数据">
      <header className="storage-panel-head">
        <div className="storage-panel-identity">
          <strong className="storage-panel-name">{projectName || "当前项目"}</strong>
          <div className="storage-panel-dir">
            <span className="storage-panel-dir-label">项目目录</span>
            {projectPath ? (
              <Tooltip title={projectPath}>
                <span className="storage-path">{projectPath}</span>
              </Tooltip>
            ) : (
              <span className="storage-path is-muted">尚未关联本地路径</span>
            )}
          </div>
        </div>
      </header>

      <div className="storage-artifacts">
        {loading ? (
          <div className="storage-loading">
            <Spin size="small" />
            <span>正在读取项目目录…</span>
          </div>
        ) : (
          ARTIFACTS.map((artifact) => (
            <ArtifactRow
              key={artifact.key}
              label={artifact.label}
              hint={artifact.hint}
              entry={status?.[artifact.key] ?? null}
              rootPath={projectPath ?? ""}
              syncing={syncing}
            />
          ))
        )}
      </div>

      {warnings.length > 0 && (
        <div className="storage-warnings">
          <Alert type="warning" showIcon title={warnings.join(" ")} />
        </div>
      )}

      <footer className="storage-panel-foot">
        <span className="storage-panel-note">本地副本是数据库数据的项目目录拷贝，重新同步只补齐缺失文件。</span>
        <Button
          size="small"
          icon={<ReloadOutlined />}
          loading={syncing}
          disabled={disabled}
          onClick={() => void synchronize()}
        >
          重新同步
        </Button>
      </footer>
    </Surface>
  );
}

/** 单行产物：左侧为标题、说明与相对路径，右侧为随同步状态变化的标签。 */
function ArtifactRow({
  label,
  hint,
  entry,
  rootPath,
  syncing,
}: {
  label: string;
  hint: string;
  entry: LocalStorageEntry | null;
  rootPath: string;
  syncing: boolean;
}) {
  const absolutePath = entry?.path ?? null;
  const relativePath = absolutePath ? toRelativePath(absolutePath, rootPath) : null;

  return (
    <div className="storage-artifact">
      <span className="storage-artifact-icon" aria-hidden="true">
        <FileTextOutlined />
      </span>
      <div className="storage-artifact-body">
        <span className="storage-artifact-title">{label}</span>
        {relativePath ? (
          <Tooltip title={absolutePath ?? relativePath}>
            <span className="storage-path">{relativePath}</span>
          </Tooltip>
        ) : (
          <span className="storage-artifact-hint">{hint}</span>
        )}
      </div>
      <ArtifactStatusTag status={entry?.status ?? null} syncing={syncing} />
    </div>
  );
}

/** 产物状态标签：同步中显示 loading，未生成保持中性灰，失败与冲突按语义着色。 */
function ArtifactStatusTag({
  status,
  syncing,
}: {
  status: LocalStorageEntry["status"] | null;
  syncing: boolean;
}) {
  if (syncing || !status) {
    return (
      <Tag className="storage-status-tag" icon={<Spin size="small" />}>
        同步中
      </Tag>
    );
  }
  return (
    <Tag className="storage-status-tag" color={STATUS_COLORS[status]}>
      {STATUS_LABELS[status]}
    </Tag>
  );
}
