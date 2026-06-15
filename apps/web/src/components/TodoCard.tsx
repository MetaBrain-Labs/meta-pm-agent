import { Card, Tag, List } from "antd";
import { CheckCircleOutlined, ClockCircleOutlined, MinusCircleOutlined } from "@ant-design/icons";
import type { TodoItem } from "../types";

interface Props {
  todos: TodoItem[];
}

const STATUS_CONFIG: Record<TodoItem["status"], { icon: React.ReactNode; color: string; label: string }> = {
  pending: { icon: <MinusCircleOutlined />, color: "var(--ink-faint)", label: "待开始" },
  in_progress: { icon: <ClockCircleOutlined />, color: "var(--primary)", label: "进行中" },
  completed: { icon: <CheckCircleOutlined />, color: "var(--success)", label: "完成" },
};

export function TodoCard({ todos }: Props) {
  const completedCount = todos.filter((t) => t.status === "completed").length;

  return (
    <Card
      size="small"
      className="mb-2"
      style={{
        background: "var(--surface)",
        borderColor: "var(--line-soft)",
        borderRadius: 8,
        boxShadow: "var(--shadow-card)",
      }}
      title={
        <span style={{ fontFamily: "var(--sans)", color: "var(--ink)", fontWeight: 800, fontSize: 14 }}>
          任务列表
          <Tag
            className="ml-2"
            style={{
              fontFamily: "var(--sans)",
              fontWeight: 600,
              fontSize: 11,
              borderRadius: 6,
              background: "var(--success-soft)",
              border: "1px solid rgba(5, 150, 105, 0.22)",
              color: "var(--success)",
            }}
          >
            {completedCount}/{todos.length}
          </Tag>
        </span>
      }
    >
      <List
        size="small"
        dataSource={todos}
        renderItem={(t) => {
          const cfg = STATUS_CONFIG[t.status];
          return (
            <List.Item
              style={{
                fontFamily: "var(--body)",
                color: "var(--ink-soft)",
                opacity: t.status === "completed" ? 0.5 : 1,
                textDecoration: t.status === "completed" ? "line-through" : "none",
                fontWeight: t.status === "in_progress" ? 600 : 400,
                borderBottom: "1px solid var(--line-soft)",
              }}
            >
              <Tag
                icon={cfg.icon}
                className="mr-2"
                style={{
                  fontFamily: "var(--sans)",
                  fontSize: 11,
                  fontWeight: 700,
                  borderRadius: 6,
                  border: "none",
                  background: t.status === "in_progress"
                    ? "var(--primary-soft)"
                    : t.status === "completed"
                      ? "var(--success-soft)"
                      : "var(--line-faint)",
                  color: cfg.color,
                }}
              >
                {cfg.label}
              </Tag>
              {t.content}
            </List.Item>
          );
        }}
        style={{ background: "transparent" }}
      />
    </Card>
  );
}
