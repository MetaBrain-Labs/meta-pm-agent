/**
 * 工作区面板定义
 *
 * 描述右侧工作区可切换的只读面板标识与展示文案，供工作区顶栏 Tabs 和面板占位
 * 内容共用。
 *
 * Responsibilities:
 * - 定义面板 ID、标签和说明文案的唯一来源
 * - 提供按 ID 查询面板定义的辅助函数
 *
 * Notes:
 * - 只描述展示结构，不加载数据、不读取业务状态，也不新增业务含义。
 */

/** 右侧工作区当前可切换的面板标识。 */
export type WorkspacePanelId =
  | "overview"
  | "tasks"
  | "graph"
  | "documents";

/** 单个工作区面板的展示定义。 */
export interface WorkspacePanelDefinition {
  id: WorkspacePanelId;
  label: string;
  /** 占位态说明；接入真实数据后由对应组件替换。 */
  description: string;
  /** 后续阶段在该面板中提供的内容范围。 */
  scope: string;
}

/** 工作区面板顺序与文案，保持与参考信息架构一致。 */
export const WORKSPACE_PANELS: readonly WorkspacePanelDefinition[] = [
  {
    id: "overview",
    label: "项目概览",
    description: "项目名称、本地路径、知识图谱规模与最近更新的只读汇总。",
    scope: "将复用现有项目信息、图谱统计与当前会话消息，不新增后端接口。",
  },
  {
    id: "tasks",
    label: "任务历史",
    description: "当前会话各轮请求摘要、初始与补充 DAG、Executor 结果和 Critique。",
    scope: "将复用现有会话消息与 Planner 任务数据，明确标注数据范围为当前会话。",
  },
  {
    id: "graph",
    label: "知识图谱",
    description: "共享 G6 画布、实体与关系类型筛选、节点与关系详情。",
    scope: "将复用共享 KnowledgeGraphView，保留原有类型配色、方向与密集图保护。",
  },
  {
    id: "documents",
    label: "交付文档",
    description: "最新 PRD 任务、各轮草稿、评分结果、证据阻断与产物下载。",
    scope: "复用现有文档工作台，可继续通过 /documents/:workspaceId 直接访问。",
  },
] as const;

/** 按面板 ID 读取定义，未知 ID 回退到第一个面板。 */
export function getWorkspacePanel(
  panelId: WorkspacePanelId,
): WorkspacePanelDefinition {
  return (
    WORKSPACE_PANELS.find((panel) => panel.id === panelId) ??
    WORKSPACE_PANELS[0]!
  );
}
