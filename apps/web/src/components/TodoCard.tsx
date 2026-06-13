import { Card, Tag, List } from "antd";
import { CheckCircleOutlined, ClockCircleOutlined, MinusCircleOutlined } from "@ant-design/icons";
import type { TodoItem } from "../types";

interface Props {
  todos: TodoItem[];
}

const STATUS_CONFIG: Record<TodoItem["status"], { icon: React.ReactNode; color: string }> = {
  pending: { icon: <MinusCircleOutlined />, color: "default" },
  in_progress: { icon: <ClockCircleOutlined />, color: "processing" },
  completed: { icon: <CheckCircleOutlined />, color: "success" },
};

export function TodoCard({ todos }: Props) {
  const completedCount = todos.filter((t) => t.status === "completed").length;

  return (
    <Card
      size="small"
      title={
        <span>
          📋 任务列表
          <Tag color="success" style={{ marginLeft: 8 }}>{completedCount}/{todos.length}</Tag>
        </span>
      }
      style={{ marginBottom: 8 }}
    >
      <List
        size="small"
        dataSource={todos}
        renderItem={(t) => {
          const cfg = STATUS_CONFIG[t.status];
          return (
            <List.Item
              style={{
                opacity: t.status === "completed" ? 0.5 : 1,
                textDecoration: t.status === "completed" ? "line-through" : "none",
                fontWeight: t.status === "in_progress" ? 500 : "normal",
                color: t.status === "in_progress" ? "#1677ff" : undefined,
              }}
            >
              <Tag icon={cfg.icon} color={cfg.color} style={{ marginRight: 8 }}>
                {t.status === "completed" ? "完成" : t.status === "in_progress" ? "进行中" : "待开始"}
              </Tag>
              {t.content}
            </List.Item>
          );
        }}
      />
    </Card>
  );
}
