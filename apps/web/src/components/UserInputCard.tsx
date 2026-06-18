import { useState } from "react";
import { Button, Card, Tag, List } from "antd";
import {
  DownOutlined,
  FileTextOutlined,
  MessageOutlined,
  PlusCircleOutlined,
  QuestionCircleOutlined,
  RightOutlined,
  SendOutlined,
} from "@ant-design/icons";
import type { UserInputItem } from "../types";
import { parseUserInputBlock } from "../utils/user-input";

interface Props {
  raw: string;
}

const TYPE_CONFIG: Record<
  UserInputItem["type"],
  { color: string; background: string; icon: React.ReactNode }
> = {
  请求: {
    color: "var(--primary)",
    background: "var(--primary-soft)",
    icon: <SendOutlined />,
  },
  补充: {
    color: "var(--success)",
    background: "var(--success-soft)",
    icon: <PlusCircleOutlined />,
  },
  提问: {
    color: "var(--warning)",
    background: "rgba(217, 119, 6, 0.12)",
    icon: <QuestionCircleOutlined />,
  },
  陈述: {
    color: "var(--ink-mute)",
    background: "var(--line-faint)",
    icon: <MessageOutlined />,
  },
};

/**
 * 展示 Conversation Agent 整理后的用户输入，默认折叠明细。
 */
export function UserInputCard({ raw }: Props) {
  const [open, setOpen] = useState(false);
  const items = parseUserInputBlock(raw);
  if (!items) return null;

  return (
    <Card
      size="small"
      className="mb-2"
      style={{
        background: "var(--surface)",
        borderColor: "var(--line-soft)",
        borderRadius: 8,
        borderLeft: "3px solid var(--primary)",
        boxShadow: "var(--shadow-card)",
      }}
      title={
        <div className="flex items-center gap-2">
          <FileTextOutlined style={{ color: "var(--primary)" }} />
          <span
            style={{
              fontFamily: "var(--sans)",
              color: "var(--ink)",
              fontWeight: 800,
              fontSize: 14,
            }}
          >
            用户输入整理
          </span>
          <Tag
            style={{
              fontFamily: "var(--sans)",
              fontWeight: 700,
              fontSize: 11,
              borderRadius: 6,
              border: "none",
              background: "var(--primary-soft)",
              color: "var(--primary)",
            }}
          >
            {items.length} 条
          </Tag>
        </div>
      }
      extra={
        <Button
          type="text"
          size="small"
          icon={open ? <DownOutlined /> : <RightOutlined />}
          onClick={() => setOpen(!open)}
        />
      }
    >
      {open && (
        <List
          size="small"
          dataSource={items}
          renderItem={(item) => {
            const config = TYPE_CONFIG[item.type];
            return (
              <List.Item
                style={{
                  alignItems: "flex-start",
                  borderBottom: "1px solid var(--line-soft)",
                  gap: 10,
                  paddingLeft: 0,
                  paddingRight: 0,
                }}
              >
                <span
                  className="mt-1 flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-[11px]"
                  style={{
                    background: "var(--surface-muted)",
                    color: "var(--ink-faint)",
                    fontFamily: "var(--sans)",
                    fontWeight: 800,
                  }}
                >
                  {item.index}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="mb-1">
                    <Tag
                      icon={config.icon}
                      style={{
                        marginInlineEnd: 0,
                        border: "none",
                        borderRadius: 6,
                        background: config.background,
                        color: config.color,
                        fontFamily: "var(--sans)",
                        fontSize: 11,
                        fontWeight: 700,
                      }}
                    >
                      {item.type}
                    </Tag>
                  </div>
                  <div
                    className="wrap-break-word"
                    style={{
                      color: "var(--ink-soft)",
                      fontFamily: "var(--body)",
                      fontSize: 14,
                      lineHeight: 1.65,
                    }}
                  >
                    {item.content}
                  </div>
                </div>
              </List.Item>
            );
          }}
        />
      )}
    </Card>
  );
}
