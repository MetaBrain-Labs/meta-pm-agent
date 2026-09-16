/**
 * 工作区面板内容
 *
 * 按当前面板渲染只读内容。项目概览只展示上层已经持有的项目信息，其余面板在
 * 对应阶段接入真实数据前显示明确的空态，不虚构统计、日志或分享能力。
 *
 * Responsibilities:
 * - 渲染项目概览的名称、本地路径、会话数量和本地保存状态入口
 * - 为任务历史、知识图谱、交付文档提供空态说明
 * - 在交付文档面板挂载现有文档工作台
 *
 * Notes:
 * - 不新增接口调用；本地保存状态复用既有 WorkspaceLocalStoragePanel。
 * - 面板为空态时不得暗示尚未实现的能力已经可用。
 */

import type { ReactNode } from "react";
import { SectionHeader } from "../ui/SectionHeader";
import { WorkspaceLocalStoragePanel } from "../WorkspaceLocalStoragePanel";
import type { WorkspacePanelId } from "./workspace-panels";

interface Props {
  panelId: WorkspacePanelId;
  workspaceId: string | null;
  workspaceName: string;
  workspacePath?: string | null;
  threadCount: number;
  /** 交付文档面板内容；仅在挂载时构建，避免未打开面板时启动后台任务。 */
  documents?: () => ReactNode;
}

/** 各占位面板的空态标题。 */
const EMPTY_TITLES: Record<Exclude<WorkspacePanelId, "overview">, string> = {
  tasks: "任务历史面板尚未接入",
  graph: "知识图谱面板尚未接入",
  documents: "暂无交付文档工作台",
};

export function WorkspacePanelContent({
  panelId,
  workspaceId,
  workspaceName,
  workspacePath,
  threadCount,
  documents,
}: Props) {
  if (panelId === "documents" && documents) {
    return <div className="h-full min-h-0">{documents()}</div>;
  }

  if (panelId === "overview") {
    return (
      <div className="workspace-panel-section">
        <SectionHeader
          title={workspaceName}
          description={
            workspaceId
              ? "当前项目的只读概览，数据来自本机保存的项目记录。"
              : "尚未关联本地项目。"
          }
        />

        <dl className="workspace-facts">
          <div className="workspace-fact">
            <dt>本地路径</dt>
            <dd className={workspacePath ? "" : "is-muted"}>
              {workspacePath ?? "未关联本地路径"}
            </dd>
          </div>
          <div className="workspace-fact">
            <dt>对话数量</dt>
            <dd>{threadCount}</dd>
          </div>
        </dl>

        {workspaceId ? (
          <WorkspaceLocalStoragePanel
            workspaceId={workspaceId}
            refreshKey={workspacePath ?? ""}
            projectName={workspaceName}
            projectPath={workspacePath}
          />
        ) : (
          <p className="workspace-panel-note">
            从一个本地项目进入后，这里会显示产品上下文与 PRD 的保存状态。
          </p>
        )}
      </div>
    );
  }

  return (
    <div className="workspace-panel-section">
      <SectionHeader
        title={EMPTY_TITLES[panelId]}
        description="该面板将在后续阶段接入现有数据，本轮只完成外壳与导航。"
      />
      <p className="workspace-panel-note">
        当前对话中的 Agent 过程、知识图谱更新与问题表单仍保留在对话栏中，不受
        本次布局调整影响。
      </p>
    </div>
  );
}
