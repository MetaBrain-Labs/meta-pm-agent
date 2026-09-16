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
  /** 任务历史面板；数据来自当前会话，由聊天页注入。 */
  tasks?: PanelRenderer;
  /** 知识图谱面板；数据来自当前工作区，由聊天页注入。 */
  graph?: PanelRenderer;
  /** 交付文档面板；仅在挂载时构建，避免未打开面板时启动后台任务。 */
  documents?: PanelRenderer;
}

export function WorkspacePanelContent({
  panelId,
  overview,
  tasks,
  graph,
  documents,
}: Props) {
  // 未注入实现时保持明确空态，避免渲染出半截面板。
  const candidate =
    (panelId === "overview" ? overview : null) ??
    (panelId === "tasks" ? tasks : null) ??
    (panelId === "graph" ? graph : null) ??
    (panelId === "documents" ? documents : null);
  /*
   * 注册链路异常时兜底：这里必须确认拿到的是函数。
   * 若上游误把 setState 当回调传，存下来的会是渲染结果而不是渲染函数，
   * 直接调用会抛 `renderPanel is not a function` 并让整个面板白屏。
   */
  if (typeof candidate === "function") {
    return <div className="h-full min-h-0">{candidate()}</div>;
  }

  return (
    <div className="workspace-panel-section">
      <SectionHeader
        title="面板暂时不可用"
        description="该面板的渲染函数未正确注册，请刷新页面重试。"
      />
    </div>
  );
}