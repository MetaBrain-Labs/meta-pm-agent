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
      <div style={{ overflow: "hidden", textOverflow: "ellipsis" }}>
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
      style={{
        background: "#fff",
        borderRight: "1px solid #f0f0f0",
        height: "100vh",
      }}
    >
      <div className="sidebar-header">
        {!collapsed && <Text strong>对话列表</Text>}
        <Button
          type="text"
          icon={collapsed ? <MenuUnfoldOutlined /> : <MenuFoldOutlined />}
          onClick={onToggle}
        />
      </div>

      {!collapsed && (
        <div style={{ padding: "0 12px 8px" }}>
          <Button
            type="primary"
            icon={<PlusOutlined />}
            block
            onClick={onNew}
          >
            新建对话
          </Button>
        </div>
      )}

      <Menu
        mode="inline"
        selectedKeys={activeId ? [activeId] : []}
        items={menuItems}
        onClick={({ key }) => onSelect(key)}
        style={{ borderInlineEnd: "none" }}
      />
    </Sider>
  );
}
