/**
 * 工作区面板内容
 *
 * 按当前面板渲染只读内容。项目概览与交付文档由页面注入已配置好的组件，其余
 * 面板在对应阶段接入真实数据前显示明确的空态，不虚构统计、日志或分享能力。
 *
 * Responsibilities:
 * - 渲染项目概览与交付文档面板
 * - 为任务历史、知识图谱提供空态说明
 *
 * Notes:
 * - 不新增接口调用；面板数据由各自组件负责读取。
 * - 面板为空态时不得暗示尚未实现的能力已经可用。
 */

import type { ReactNode } from "react";
import { SectionHeader } from "../ui/SectionHeader";
import type { WorkspacePanelId } from "./workspace-panels";

/** 面板渲染函数；由页面注入已配置的数据与回调。 */
export type PanelRenderer = () => ReactNode;

interface Props {
  panelId: WorkspacePanelId;
  /** 项目概览面板；由页面注入。 */
  overview?: PanelRenderer;
  /** 交付文档面板；仅在挂载时构建，避免未打开面板时启动后台任务。 */
  documents?: PanelRenderer;
}

/** 尚未接入真实数据的面板空态标题。 */
const EMPTY_TITLES: Record<"tasks" | "graph", string> = {
  tasks: "任务历史面板尚未接入",
  graph: "知识图谱面板尚未接入",
};

export function WorkspacePanelContent({
  panelId,
  overview,
  documents,
}: Props) {
  // 未注入实现时保持明确空态，避免渲染出半截面板。
  const renderPanel =
    (panelId === "overview" ? overview : null) ??
    (panelId === "documents" ? documents : null);
  if (renderPanel) {
    return <div className="h-full min-h-0">{renderPanel()}</div>;
  }

  if (panelId === "overview" || panelId === "documents") {
    return (
      <div className="workspace-panel-section">
        <SectionHeader
          title="面板尚未接入"
          description="该面板将在后续阶段接入现有数据，本轮只完成了外壳与导航。"
        />
      </div>
    );
  }

  const tasksOrGraph: "tasks" | "graph" = panelId;

  return (
    <div className="workspace-panel-section">
      <SectionHeader
        title={EMPTY_TITLES[tasksOrGraph]}
        description="该面板将在后续阶段接入现有数据，本轮只完成了外壳与导航。"
      />
      <p className="workspace-panel-note">
        当前对话中的 Agent 过程、知识图谱更新与问题表单仍保留在对话栏中，不受
        本次布局调整影响。
      </p>
    </div>
  );
}