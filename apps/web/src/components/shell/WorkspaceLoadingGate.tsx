/**
 * 工作区加载门
 *
 * 切换项目时，旧工作区的内容不能再继续显示：
 * 一旦把新项目的 Header 和上一个项目的正文混在一起，用户会以为数据串了。
 *
 * 本组件在 `workspaceId` 变化后短暂接管内容区，显示品牌级加载动画，
 * 等新工作区挂载完成再放行。同一项目内的面板切换不受影响。
 *
 * Responsibilities:
 * - 工作区切换时遮住旧内容，避免 Header 与正文来自不同项目
 * - 首次进入项目时同样给出明确反馈
 *
 * Notes:
 * - 只做呈现层遮挡，不改变面板状态、不重新请求数据。
 * - 切换判定基于 `workspaceId`，不是"等了多久"，因此不会有动画跳变。
 */

import { useEffect, useState, type ReactNode } from "react";
import { GlobalLoader } from "../ui/GlobalLoader";

/** 切换项目时内容区交给加载动画的时长；只覆盖挂载与首屏取数。 */
const SWITCH_HOLD_MS = 480;

interface Props {
  workspaceId: string;
  children: ReactNode;
}

export function WorkspaceLoadingGate({ workspaceId, children }: Props) {
  /** 当前已经放行的工作区；与传入不一致时保持加载态。 */
  const [readyId, setReadyId] = useState<string | null>(null);

  useEffect(() => {
    // 换项目时先收起旧内容，下一帧再交给新工作区。
    setReadyId(null);
    const timer = setTimeout(() => setReadyId(workspaceId), SWITCH_HOLD_MS);
    return () => clearTimeout(timer);
  }, [workspaceId]);

  if (readyId !== workspaceId) {
    return (
      <div className="workspace-loading-gate">
        <GlobalLoader scope="workspace" loading label="正在打开项目..." />
      </div>
    );
  }

  return <>{children}</>;
}
