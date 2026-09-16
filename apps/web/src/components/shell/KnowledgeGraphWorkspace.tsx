/**
 * 知识图谱工作区（自包含）
 *
 * 「知识图谱」面板在两种情况下打开：有对话栏（由聊天页登记渲染函数，复用会话
 * 已加载的图谱）与没有对话栏（例如从侧栏直接进入交付文档）。后者没有任何组件
 * 会登记渲染函数，面板此前只能显示空态。
 *
 * 本组件让图谱面板自己拥有数据来源，因此不依赖聊天页是否挂载。
 *
 * Responsibilities:
 * - 按工作区读取知识图谱，并把加载/失败状态交给 KnowledgeGraphPanel 呈现
 * - 在没有渲染函数登记时作为图谱面板的兜底实现
 *
 * Notes:
 * - 只读取，不写入图谱；图谱写入仍由 API 在 Executor 完成后负责。
 * - 有聊天页登记时优先使用登记的实现，避免同一面板出现两份数据源。
 */

import { useKnowledgeGraph } from "../../hooks/useKnowledgeGraph";
import { KnowledgeGraphPanel } from "./KnowledgeGraphPanel";

interface Props {
  workspaceId: string;
}

export function KnowledgeGraphWorkspace({ workspaceId }: Props) {
  /*
   * 这里不需要消息驱动的自动刷新：本入口没有正在运行的会话，
   * 图谱变化时由用户通过面板上的刷新按钮重新读取。
   */
  const { data, loading, error, refresh, attempted } = useKnowledgeGraph(
    workspaceId,
    [],
    { loadOnMount: true },
  );

  return (
    <KnowledgeGraphPanel
      workspaceId={workspaceId}
      data={data}
      loading={loading}
      attempted={attempted}
      error={error}
      onRefresh={() => void refresh()}
    />
  );
}
