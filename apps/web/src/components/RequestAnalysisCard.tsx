import { Card, Empty, List, Progress, Space, Tag, Typography } from "antd";
import {
  ApartmentOutlined,
  MessageOutlined,
  QuestionCircleOutlined,
} from "@ant-design/icons";
import type { RequestAnalysis } from "../types";

interface Props {
  raw?: string;
  analysis?: RequestAnalysis;
}

export function RequestAnalysisCard({ raw, analysis }: Props) {
  // 流式事件会直接传入解析后的对象；历史消息恢复时可能只有 tagged block，
  // 因此保留一个轻量 fallback 解析器。
  const data = analysis ?? parseRequestAnalysisBlock(raw ?? "");
  if (!data) return null;

  return (
    <Card
      size="small"
      className="mb-2"
      style={{
        background: "var(--surface)",
        borderColor: "var(--line-soft)",
        borderRadius: 8,
        borderLeft: "3px solid var(--success)",
        boxShadow: "var(--shadow-card)",
      }}
      title={
        <div className="flex items-center gap-2">
          <ApartmentOutlined style={{ color: "var(--success)" }} />
          <span
            style={{
              fontFamily: "var(--sans)",
              color: "var(--ink)",
              fontWeight: 800,
              fontSize: 14,
            }}
          >
            Request Agent 分析
          </span>
          <Tag
            style={{
              fontFamily: "var(--sans)",
              fontWeight: 700,
              fontSize: 11,
              borderRadius: 6,
              border: "none",
              background: "var(--success-soft)",
              color: "var(--success)",
            }}
          >
            {data.business_model.length} 条业务
          </Tag>
        </div>
      }
    >
      {data.business_model.length === 0 ? (
        <Empty
          image={Empty.PRESENTED_IMAGE_SIMPLE}
          description="暂无业务模型"
        />
      ) : (
        <List
          size="small"
          dataSource={data.business_model}
          renderItem={(item) => (
            <List.Item
              style={{
                alignItems: "flex-start",
                borderBottom: "1px solid var(--line-soft)",
                paddingLeft: 0,
                paddingRight: 0,
              }}
            >
              <div className="min-w-0 flex-1">
                <Space size={6} wrap className="mb-1">
                  <Tag color="blue">业务 {item.index}</Tag>
                  <Tag>覆盖 {item.covered_user_input_indexes.join(", ")}</Tag>
                </Space>
                <Typography.Paragraph
                  style={{
                    marginBottom: 8,
                    color: "var(--ink-soft)",
                    fontFamily: "var(--body)",
                    fontSize: 14,
                    lineHeight: 1.65,
                  }}
                >
                  {item.user_goal}
                </Typography.Paragraph>

                {item.goal_constraints.length > 0 && (
                  <div className="mb-2">
                    <Typography.Text strong>目标约束：</Typography.Text>
                    <Space size={6} wrap className="ml-1">
                      {item.goal_constraints.map((constraint, index) => (
                        <Tag key={index}>{constraint}</Tag>
                      ))}
                    </Space>
                  </div>
                )}

                {item.missing_information.length > 0 && (
                  <List
                    size="small"
                    dataSource={item.missing_information}
                    renderItem={(missing) => (
                      <List.Item
                        style={{
                          paddingLeft: 0,
                          paddingRight: 0,
                          borderBottom: "none",
                        }}
                      >
                        <div className="w-full">
                          <div className="mb-1 flex items-start gap-2">
                            <QuestionCircleOutlined
                              style={{ color: "var(--warning)", marginTop: 3 }}
                            />
                            <span className="min-w-0 flex-1">
                              {missing.index}. {missing.description}
                            </span>
                          </div>
                          <Progress
                            percent={Math.round(missing.importance * 100)}
                            size="small"
                            showInfo
                          />
                        </div>
                      </List.Item>
                    )}
                  />
                )}
              </div>
            </List.Item>
          )}
        />
      )}

      {(data.questions.length > 0 || data.chitchat.length > 0) && (
        <Space size={6} wrap className="mt-2">
          {data.questions.length > 0 && (
            <Tag icon={<QuestionCircleOutlined />} color="gold">
              问答：{data.questions.join(", ")}
            </Tag>
          )}
          {data.chitchat.length > 0 && (
            <Tag icon={<MessageOutlined />}>
              闲聊：{data.chitchat.join(", ")}
            </Tag>
          )}
        </Space>
      )}
    </Card>
  );
}

function parseRequestAnalysisBlock(raw: string): RequestAnalysis | null {
  const jsonText = extractJson(raw);
  if (!jsonText) return null;

  try {
    const data = JSON.parse(jsonText) as RequestAnalysis;

    // 这里是展示层 fallback，不承担契约校验职责；严格校验已经在 runtime/API 完成。
    if (!Array.isArray(data.business_model)) return null;
    if (!Array.isArray(data.questions)) return null;
    if (!Array.isArray(data.chitchat)) return null;
    return data;
  } catch {
    return null;
  }
}

function extractJson(raw: string): string | null {
  const trimmed = raw.trim();
  const openMatch = /<request-analysis\b[^>]*>/i.exec(trimmed);
  if (openMatch) {
    const start = openMatch.index + openMatch[0].length;
    const end = trimmed.indexOf("</request-analysis>", start);
    if (end === -1) return null;
    return trimmed.slice(start, end).trim();
  }

  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) return null;
  return trimmed.slice(start, end + 1);
}
