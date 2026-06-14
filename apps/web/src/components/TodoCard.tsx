import { Card, Tag, List } from "antd";
import { CheckCircleOutlined, ClockCircleOutlined, MinusCircleOutlined } from "@ant-design/icons";
import type { TodoItem } from "../types";

interface Props {
  todos: TodoItem[];
}

const STATUS_CONFIG: Record<TodoItem["status"], { icon: React.ReactNode; color: string; label: string }> = {
  pending: { icon: <MinusCircleOutlined />, color: "#8b8676", label: "待开始" },
  in_progress: { icon: <ClockCircleOutlined />, color: "#ed6f5c", label: "进行中" },
  completed: { icon: <CheckCircleOutlined />, color: "#6e7448", label: "完成" },
};

export function TodoCard({ todos }: Props) {
  const completedCount = todos.filter((t) => t.status === "completed").length;

  return (
    <Card
      size="small"
      className="mb-2"
      style={{
        background: 'var(--bone)',
        borderColor: 'var(--line)',
        borderRadius: 12,
        boxShadow: '0 2px 12px rgba(21, 20, 15, 0.05)',
      }}
      title={
        <span style={{ fontFamily: 'var(--sans)', color: 'var(--ink)', fontWeight: 600, fontSize: 14 }}>
          📋 任务列表
          <Tag
            className="ml-2"
            style={{
              fontFamily: 'var(--sans)',
              fontWeight: 600,
              fontSize: 11,
              borderRadius: 6,
              background: 'rgba(110, 116, 72, 0.12)',
              border: '1px solid rgba(110, 116, 72, 0.3)',
              color: 'var(--olive)',
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
                fontFamily: 'var(--body)',
                color: 'var(--ink-soft)',
                opacity: t.status === "completed" ? 0.5 : 1,
                textDecoration: t.status === "completed" ? "line-through" : "none",
                fontWeight: t.status === "in_progress" ? 600 : 400,
                borderBottom: '1px solid var(--line-soft)',
              }}
            >
              <Tag
                icon={cfg.icon}
                className="mr-2"
                style={{
                  fontFamily: 'var(--sans)',
                  fontSize: 11,
                  fontWeight: 500,
                  borderRadius: 6,
                  border: 'none',
                  background: t.status === "in_progress"
                    ? 'rgba(237, 111, 92, 0.1)'
                    : t.status === "completed"
                      ? 'rgba(110, 116, 72, 0.1)'
                      : 'rgba(21, 20, 15, 0.06)',
                  color: cfg.color,
                }}
              >
                {cfg.label}
              </Tag>
              {t.content}
            </List.Item>
          );
        }}
        style={{ background: 'transparent' }}
      />
    </Card>
  );
}
