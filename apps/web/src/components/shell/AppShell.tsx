/**
 * 应用外壳
 *
 * 提供全局唯一的侧边栏 + 内容区骨架，负责侧栏宽度变量、响应式折叠判定和
 * 窄屏下侧栏覆盖层的挂载位置。
 *
 * Responsibilities:
 * - 渲染全局侧边栏与内容区，并暴露停靠 / 覆盖两种侧栏模式
 * - 依据视口宽度自动收起侧栏，并在窄屏改用覆盖层展开
 * - 在侧栏底部提供收起、展开或关闭入口，保持导航行本身语义单一
 *
 * Notes:
 * - 只处理布局与展示状态，不读取路由、不发起请求、不承载页面业务逻辑。
 */

import { useEffect, useState, type ReactNode } from "react";
import { Drawer } from "antd";
import { DESIGN_TOKENS } from "../../theme/design-tokens";

interface Props {
  /** 全局侧边栏内容；宽度与滚动由外壳统一管理。 */
  sidebar: ReactNode;
  /** 侧栏固定底部内容，通常是用户与账户入口。 */
  sidebarFooter?: ReactNode;
  /** 侧栏是否处于收起状态。 */
  collapsed: boolean;
  /** 用户主动切换收起状态的回调。 */
  onCollapsedChange: (collapsed: boolean) => void;
  /** 主内容区。 */
  children: ReactNode;
}

/** 小于该宽度时侧栏不再参与分栏，改用覆盖层展开。 */
const OVERLAY_MEDIA_QUERY = "(max-width: 899px)";

/** 小于该宽度时自动收起侧栏，避免内容区被挤压。 */
const AUTO_COLLAPSE_MEDIA_QUERY = "(max-width: 1279px)";

export function AppShell({
  sidebar,
  sidebarFooter,
  collapsed,
  onCollapsedChange,
  children,
}: Props) {
  const [isOverlay, setIsOverlay] = useState(false);
  const [overlayOpen, setOverlayOpen] = useState(false);

  useEffect(() => {
    const autoCollapse = window.matchMedia(AUTO_COLLAPSE_MEDIA_QUERY);
    const overlay = window.matchMedia(OVERLAY_MEDIA_QUERY);

    setIsOverlay(overlay.matches);
    if (autoCollapse.matches) onCollapsedChange(true);

    // 回到窄视口时重新收起；宽视口不自动展开，尊重用户的手动选择。
    const handleAutoCollapse = (event: MediaQueryListEvent) => {
      if (event.matches) onCollapsedChange(true);
    };
    const handleOverlayChange = (event: MediaQueryListEvent) => {
      setIsOverlay(event.matches);
      if (event.matches) onCollapsedChange(true);
      else setOverlayOpen(false);
    };

    autoCollapse.addEventListener("change", handleAutoCollapse);
    overlay.addEventListener("change", handleOverlayChange);
    return () => {
      autoCollapse.removeEventListener("change", handleAutoCollapse);
      overlay.removeEventListener("change", handleOverlayChange);
    };
  }, [onCollapsedChange]);

  /** 停靠态切换折叠；覆盖态由侧栏底部按钮关闭抽屉。 */
  const handleToggle = () => {
    onCollapsedChange(!collapsed);
  };

  return (
    <div
      className="app-shell"
      data-overlay={isOverlay ? "true" : "false"}
      data-sidebar-collapsed={collapsed ? "true" : "false"}
    >
      {isOverlay ? (
        <Drawer
          open={overlayOpen}
          placement="left"
          width={DESIGN_TOKENS.layout.sidebar}
          closable={false}
          styles={{ body: { padding: 0 } }}
          onClose={() => setOverlayOpen(false)}
        >
          <div className="app-sidebar is-overlay" data-collapsed="false">
            <div className="app-sidebar-scroll">{sidebar}</div>
            <SidebarFoot
              footer={sidebarFooter}
              toggle={
                <SidebarToggle
                  overlay
                  collapsed={false}
                  onToggle={() => setOverlayOpen(false)}
                />
              }
            />
          </div>
        </Drawer>
      ) : (
        <div
          className="app-sidebar"
          data-collapsed={collapsed ? "true" : "false"}
        >
          <div className="app-sidebar-scroll">{sidebar}</div>
          <SidebarFoot
            footer={sidebarFooter}
            toggle={
              <SidebarToggle collapsed={collapsed} onToggle={handleToggle} />
            }
          />
        </div>
      )}

      <div className="app-shell-main">{children}</div>
    </div>
  );
}

/**
 * 侧栏固定底部行：账户入口在左，收起/关闭按钮贴右，两者都不随内容滚动。
 */
function SidebarFoot({
  footer,
  toggle,
}: {
  footer?: ReactNode;
  toggle: ReactNode;
}) {
  return (
    <div className="app-sidebar-foot">
      {footer}
      {toggle}
    </div>
  );
}

/**
 * 侧栏底部按钮：停靠态切换收起，覆盖态关闭抽屉；带可见焦点与可访问名称。
 */
function SidebarToggle({
  collapsed,
  overlay = false,
  onToggle,
}: {
  collapsed: boolean;
  overlay?: boolean;
  onToggle: () => void;
}) {
  const label = overlay ? "关闭侧边栏" : collapsed ? "展开侧边栏" : "收起侧边栏";
  return (
    <button
      type="button"
      className="app-sidebar-toggle"
      aria-label={label}
      aria-expanded={overlay ? false : !collapsed}
      onClick={onToggle}
    >
      <span className="app-sidebar-toggle-glyph" aria-hidden="true">
        {overlay ? "×" : collapsed ? "›" : "‹"}
      </span>
    </button>
  );
}
