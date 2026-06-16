import { Layout, Menu, Button, Typography, Empty, Tooltip } from "antd";
import {
  PlusOutlined,
  MessageOutlined,
  MenuFoldOutlined,
  MenuUnfoldOutlined,
  AppstoreOutlined,
} from "@ant-design/icons";
import type { ThreadInfo } from "../types";

const { Sider } = Layout;
const { Text } = Typography;

interface Props {
  threads: ThreadInfo[];
  activeId: string | null;
  collapsed: boolean;
  creating: boolean;
  onSelect: (id: string) => void;
  onNew: () => void | Promise<void>;
  onToggle: () => void;
}

export function Sidebar({
  threads,
  activeId,
  collapsed,
  creating,
  onSelect,
  onNew,
  onToggle,
}: Props) {
  const menuItems = threads.map((t) => ({
    key: t.id,
    icon: <MessageOutlined />,
    label: (
      <div className="min-w-0 py-1">
        <div className="overflow-hidden text-ellipsis whitespace-nowrap">
          {t.title || "新对话"}
        </div>
        <div className="mt-0.5 text-[11px] font-normal text-[var(--ink-faint)]">
          {formatRelativeTime(t.updatedAt)}
        </div>
      </div>
    ),
  }));

  return (
    <Sider
      collapsible
      collapsed={collapsed}
      onCollapse={onToggle}
      trigger={null}
      width={280}
      collapsedWidth={72}
      className={`app-sidebar h-screen !bg-white/90 backdrop-blur ${collapsed ? "is-collapsed" : "is-expanded"}`}
      style={{ position: "relative", zIndex: 2 }}
    >
      <div
        className={
          collapsed
            ? "flex h-[68px] items-center justify-center border-b border-[var(--line-soft)] px-0"
            : "flex h-[68px] items-center gap-3 border-b border-[var(--line-soft)] px-4"
        }
      >
        {!collapsed && (
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[var(--ink)] text-white">
            <AppstoreOutlined />
          </span>
        )}
        {!collapsed && (
          <div className="min-w-0 flex-1">
            <div className="font-[var(--sans)] text-sm font-extrabold text-[var(--ink)]">
              Meta PM Agent
            </div>
            <Text className="text-xs text-[var(--ink-faint)]">本地对话工作区</Text>
          </div>
        )}
        <Tooltip title={collapsed ? "展开侧栏" : "收起侧栏"}>
          <Button
            type="text"
            className="sidebar-toggle"
            icon={collapsed ? <MenuUnfoldOutlined /> : <MenuFoldOutlined />}
            onClick={onToggle}
          />
        </Tooltip>
      </div>

      <div className={collapsed ? "flex justify-center px-0 py-3" : "px-3 py-3"}>
        {collapsed ? (
          <Tooltip title="新建对话" placement="right">
            <Button
              className="sidebar-create"
              type="primary"
              icon={<PlusOutlined />}
              loading={creating}
              disabled={creating}
              onClick={onNew}
            />
          </Tooltip>
        ) : (
          <Button
            type="primary"
            icon={<PlusOutlined />}
            block
            loading={creating}
            disabled={creating}
            onClick={onNew}
          >
            新建对话
          </Button>
        )}
      </div>

      {!collapsed && (
        <div className="px-4 pb-2 pt-1">
          <Text className="font-[var(--sans)] text-[11px] font-bold uppercase tracking-[0.08em] text-[var(--ink-faint)]">
            对话列表
          </Text>
        </div>
      )}

      <div className="scrollbar-none min-h-0 flex-1 overflow-y-auto pb-4">
        {threads.length > 0 ? (
          <Menu
            mode="inline"
            selectedKeys={activeId ? [activeId] : []}
            items={menuItems}
            onClick={({ key }) => onSelect(key)}
            className="!border-e-0"
            style={{ background: "transparent" }}
          />
        ) : (
          !collapsed && (
            <div className="px-4 py-8">
              <Empty
                image={Empty.PRESENTED_IMAGE_SIMPLE}
                description={
                  <span className="text-xs text-[var(--ink-faint)]">
                    暂无历史对话
                  </span>
                }
              />
            </div>
          )
        )}
      </div>
    </Sider>
  );
}

function formatRelativeTime(value: string): string {
  const time = new Date(value).getTime();
  if (Number.isNaN(time)) return "";
  const diff = Date.now() - time;
  const minute = 60 * 1000;
  const hour = 60 * minute;
  const day = 24 * hour;
  if (diff < minute) return "刚刚";
  if (diff < hour) return `${Math.floor(diff / minute)} 分钟前`;
  if (diff < day) return `${Math.floor(diff / hour)} 小时前`;
  return `${Math.floor(diff / day)} 天前`;
}
