import { Layout, Menu, Button, Typography } from "antd";
import {
  PlusOutlined,
  MessageOutlined,
  MenuFoldOutlined,
  MenuUnfoldOutlined,
} from "@ant-design/icons";
import type { ThreadInfo } from "../types";

const { Sider } = Layout;
const { Text } = Typography;

interface Props {
  threads: ThreadInfo[];
  activeId: string | null;
  collapsed: boolean;
  onSelect: (id: string) => void;
  onNew: () => void;
  onToggle: () => void;
}

export function Sidebar({
  threads,
  activeId,
  collapsed,
  onSelect,
  onNew,
  onToggle,
}: Props) {
  const menuItems = threads.map((t) => ({
    key: t.id,
    icon: <MessageOutlined />,
    label: (
      <div className="overflow-hidden text-ellipsis">
        {t.title || "新对话"}
      </div>
    ),
  }));

  return (
    <Sider
      collapsible
      collapsed={collapsed}
      onCollapse={onToggle}
      trigger={null}
      width={260}
      className="!bg-[var(--paper)] h-screen"
      style={{ position: 'relative', zIndex: 2, borderRight: '1px solid var(--line)', borderRightStyle: 'dashed' }}
    >
      <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--line-soft)]">
        {!collapsed && (
          <Text strong style={{ fontFamily: "'Inter Tight', sans-serif", color: 'var(--ink-mute)', fontSize: 11, fontWeight: 600, letterSpacing: '0.16em', textTransform: 'uppercase' }}>
            对话列表
          </Text>
        )}
        <Button
          type="text"
          icon={collapsed ? <MenuUnfoldOutlined /> : <MenuFoldOutlined />}
          onClick={onToggle}
        />
      </div>

      {!collapsed && (
        <div className="px-3 pt-2.5 pb-1">
          <Button
            type="primary"
            icon={<PlusOutlined />}
            block
            onClick={onNew}
            style={{ fontFamily: "'Inter Tight', sans-serif", fontWeight: 500, fontSize: 13, borderRadius: 10 }}
          >
            新建对话
          </Button>
        </div>
      )}

      {/* dotted rule divider */}
      {!collapsed && (
        <div className="mx-4 my-2" style={{ borderTop: '1px dashed var(--line)', height: 0 }} />
      )}

      <Menu
        mode="inline"
        selectedKeys={activeId ? [activeId] : []}
        items={menuItems}
        onClick={({ key }) => onSelect(key)}
        className="!border-e-0"
        style={{ background: 'transparent' }}
      />
    </Sider>
  );
}
