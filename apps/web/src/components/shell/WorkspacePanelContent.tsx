/**
 * 工作区面板内容
 *
 * 按当前面板渲染只读内容。项目概览与交付文档由页面注入已配置好的组件；知识图谱
 * 在页面没有登记渲染函数时（例如没有对话栏）回退到自包含实现，保证面板始终可用。
 *
 * Responsibilities:
 * - 渲染项目概览与交付文档面板
 * - 渲染知识图谱面板：优先使用页面登记的实现，否则用自包含兜底
 * - 为尚未接入的面板提供明确空态
 *
 * Notes:
 * - 不新增接口调用；面板数据由各自组件负责读取。
 * - 面板为空态时不得暗示尚未实现的能力已经可用。
 */

import type { ReactNode } from "react";
import { SectionHeader } from "../ui/SectionHeader";
import { KnowledgeGraphWorkspace } from "./KnowledgeGraphWorkspace";
import { TaskHistoryWorkspace } from "./TaskHistoryWorkspace";
import type { WorkspacePanelId } from "./workspace-panels";

/** 面板渲染函数；由页面注入已配置的数据与回调。 */
export type PanelRenderer = () => ReactNode;

interface Props {
  panelId: WorkspacePanelId;
  /** 项目概览面板；由页面注入。 */
  overview?: PanelRenderer;
  /** 任务历史面板；由聊天页注入，数据来自当前会话。 */
  tasks?: PanelRenderer;
  /** 知识图谱面板；由聊天页注入，复用会话已加载的图谱。 */
  graph?: PanelRenderer;
  /**
   * 当前工作区 ID；用于在没有登记渲染函数时自建知识图谱面板。
   *
   * 没有对话栏时（例如直接从侧栏进入交付文档）聊天页不会挂载，也就不会有人
   * 登记渲染函数；缺了它图谱面板会显示空态。
   */
  graphWorkspaceId?: string;
  /** 无会话时「打开对话」的去向；与侧栏新建对话同一条路径。 */
  onOpenConversation?: () => void;
  /** 交付文档面板；仅在挂载时构建，避免未打开面板时启动后台任务。 */
  documents?: PanelRenderer;
}

export function WorkspacePanelContent({
  panelId,
  overview,
  tasks,
  graph,
  graphWorkspaceId,
  onOpenConversation,
  documents,
}: Props) {
  /*
   * 注册链路异常时兜底：这里必须确认拿到的是函数。
   * 若上游误把 setState 当回调传，存下来的会是渲染结果而不是渲染函数，
   * 直接调用会抛 `renderPanel is not a function` 并让整个面板白屏。
   */
  const isRenderer = (value: PanelRenderer | null | undefined) =>
    typeof value === "function";

  /**
   * 知识图谱优先用页面登记的实现（它与对话共用同一份图谱数据）；
   * 没有登记时用自包含实现，而不是回退到空态。
   *
   * 两者都包在 .workspace-panel-fill 里：画布需要面板分配出的确定高度，
   * 只靠子元素的 height: 100% 拿不到（见该类的注释）。
   */
  if (panelId === "graph") {
    if (isRenderer(graph)) {
      return <div className="workspace-panel-fill">{graph()}</div>;
    }    if (graphWorkspaceId) {
      return (
        <div className="workspace-panel-fill">
          <KnowledgeGraphWorkspace workspaceId={graphWorkspaceId} />
        </div>
      );
    }
  }

  /**
   * 任务历史按会话统计：没有会话时说明作用域与入口，而不是显示成"面板坏了"。
   */
  if (panelId === "tasks" && !isRenderer(tasks)) {
    return (
      <div className="workspace-panel-fill">
        <TaskHistoryWorkspace onOpenConversation={onOpenConversation} />
      </div>
    );
  }

  const candidate =
    (panelId === "overview" ? overview : null) ??
    (panelId === "tasks" ? tasks : null) ??
    (panelId === "documents" ? documents : null);
  if (isRenderer(candidate)) {
    return <div className="h-full min-h-0">{candidate()}</div>;
  }

  return (
    <div className="workspace-panel-section">
      <SectionHeader
        title="面板暂时不可用"
        description="该面板在此入口下没有可用的数据来源。"
      />
    </div>
  );
}
