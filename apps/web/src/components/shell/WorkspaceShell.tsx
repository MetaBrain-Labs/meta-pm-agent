/**
 * 工作区外壳
 *
 * 项目内部所有页面共用的外壳：一个常驻的 Workspace Header（面板 Tabs + 操作区）
 * 加上「对话栏 + 工作区面板」两栏。Header 不随面板切换重新挂载，因此高度、
 * padding 与横向位置保持稳定。
 *
 * Responsibilities:
 * - 渲染唯一的 Workspace Header，并承载面板 Tabs 与右侧操作区
 * - 通过 WorkspaceSplit 分配对话栏与工作区面板宽度
 * - 窄视口下把面板改为覆盖层，并把对话栏让给面板
 *
 * Notes:
 * - 面板标识与切换动作由调用方持有，本组件不保存重复的 active 状态。
 * - 不读取路由、不加载面板数据；面板内容以渲染函数注入。
 */

import { useEffect, useState, type ReactNode } from "react";
import { Button, Drawer, Tooltip } from "antd";
import {
  CloseOutlined,
  DoubleLeftOutlined,
  DoubleRightOutlined,
} from "@ant-design/icons";
import { WORKSPACE_PANELS, type WorkspacePanelId } from "./workspace-panels";
import { useConversationSplit, WorkspaceSplit } from "./WorkspaceSplit";

/** 小于该宽度时工作区面板不再并排，改为覆盖层展开。 */
const PANEL_OVERLAY_MEDIA_QUERY = "(max-width: 899px)";

/** 面板渲染函数；参数用于在覆盖层内主动关闭面板。 */
export type WorkspacePanelRenderer = (api: {
  closePanel: () => void;
}) => ReactNode;

interface Props {
  /** 项目名称，显示在 Tabs 左侧作为当前工作区标识。 */
  workspaceName: string;
  activePanel: WorkspacePanelId;
  onPanelChange: (panelId: WorkspacePanelId) => void;
  /** 工作区顶栏右侧操作区；由页面注入刷新等已有动作。 */
  actions?: ReactNode;
  /** 对话栏内容；为空时工作区面板占满剩余空间。 */
  conversation: ReactNode | null;
  /** 工作区面板内容。 */
  panel: WorkspacePanelRenderer;
}

export function WorkspaceShell({
  workspaceName,
  activePanel,
  onPanelChange,
  actions,
  conversation,
  panel,
}: Props) {
  const [isOverlay, setIsOverlay] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);

  useEffect(() => {
    const media = window.matchMedia(PANEL_OVERLAY_MEDIA_QUERY);
    const sync = (matches: boolean) => {
      setIsOverlay(matches);
      if (!matches) setDrawerOpen(false);
    };
    sync(media.matches);
    const handleChange = (event: MediaQueryListEvent) => sync(event.matches);
    media.addEventListener("change", handleChange);
    return () => media.removeEventListener("change", handleChange);
  }, []);

  const hasConversation = conversation !== null;
  const panelAsOverlay = isOverlay && hasConversation;

  return (
    <div
      className="workspace-root"
      data-panel-overlay={panelAsOverlay ? "true" : "false"}
    >
      <WorkspaceSplit
        conversation={panelAsOverlay ? null : conversation}
        panel={
          <WorkspacePanelFrame
            workspaceName={workspaceName}
            activePanel={activePanel}
            onPanelChange={onPanelChange}
            actions={actions}
            toggle={<ConversationToggle />}
          >
            {panel({ closePanel: () => undefined })}
          </WorkspacePanelFrame>
        }
      />

      {panelAsOverlay && (
        <>
          <Drawer
            open={drawerOpen}
            placement="right"
            width="min(560px, 92vw)"
            closable={false}
            styles={{ body: { padding: 0 } }}
            onClose={() => setDrawerOpen(false)}
          >
            <WorkspacePanelFrame
              workspaceName={workspaceName}
              activePanel={activePanel}
              onPanelChange={onPanelChange}
              actions={actions}
              toggle={
                <PanelTrigger
                  label="关闭工作区面板"
                  icon={<CloseOutlined />}
                  onClick={() => setDrawerOpen(false)}
                />
              }
            >
              {panel({ closePanel: () => setDrawerOpen(false) })}
            </WorkspacePanelFrame>
          </Drawer>
          <div className="workspace-panel-fallback">
            <PanelTrigger
              label="打开工作区面板"
              icon={<DoubleLeftOutlined />}
              onClick={() => setDrawerOpen(true)}
            />
          </div>
        </>
      )}
    </div>
  );
}

/**
 * 对话栏收起/展开入口；没有对话栏时不渲染按钮。
 */
function ConversationToggle() {
  const split = useConversationSplit();
  if (!split) return null;

  return split.collapsed ? (
    <PanelTrigger
      label="展开对话栏"
      icon={<DoubleLeftOutlined />}
      onClick={split.toggle}
    />
  ) : (
    <PanelTrigger
      label="收起对话栏"
      icon={<DoubleRightOutlined />}
      onClick={split.toggle}
    />
  );
}

/** 面板开关按钮：图标按钮保留可访问名称与可见焦点。 */
function PanelTrigger({
  label,
  icon,
  onClick,
}: {
  label: string;
  icon?: ReactNode;
  onClick: () => void;
}) {
  return (
    <Tooltip title={label}>
      <Button
        type="text"
        shape="circle"
        aria-label={label}
        icon={icon}
        onClick={onClick}
      />
    </Tooltip>
  );
}

/**
 * 工作区面板外框：顶部常驻 Header（Tabs + 操作区），下方为独立滚动内容区。
 */
function WorkspacePanelFrame({
  workspaceName,
  activePanel,
  onPanelChange,
  actions,
  toggle,
  children,
}: {
  workspaceName: string;
  activePanel: WorkspacePanelId;
  onPanelChange: (panelId: WorkspacePanelId) => void;
  actions?: ReactNode;
  toggle?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="workspace-panel" aria-label="工作区">
      <header className="workspace-panel-header">
        <span className="workspace-panel-name" title={workspaceName}>
          {workspaceName}
        </span>
        <div className="workspace-tabs" role="tablist" aria-label="工作区面板">
          {WORKSPACE_PANELS.map((panel) => {
            const active = panel.id === activePanel;
            return (
              <button
                key={panel.id}
                type="button"
                role="tab"
                id={`workspace-tab-${panel.id}`}
                aria-selected={active}
                aria-controls="workspace-panel-body"
                className="workspace-tab"
                data-active={active ? "true" : "false"}
                onClick={() => onPanelChange(panel.id)}
              >
                {panel.label}
              </button>
            );
          })}
        </div>
        <div className="workspace-panel-actions">
          {actions}
          {toggle}
        </div>
      </header>
      <div
        id="workspace-panel-body"
        role="tabpanel"
        aria-labelledby={`workspace-tab-${activePanel}`}
        className="workspace-panel-body"
      >
        {children}
      </div>
    </section>
  );
}
