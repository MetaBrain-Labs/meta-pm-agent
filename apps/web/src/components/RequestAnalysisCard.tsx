/**
 * Request Agent 分析卡片
 *
 * 展示 Request Agent 对用户输入的业务建模、缺失信息、问答和闲聊分类结果。
 * 历史恢复和实时流式完成后共用同一展示结构。
 *
 * Responsibilities:
 * - 解析 request-analysis tagged block
 * - 渲染业务模型、约束和缺失信息
 * - 保持结构化分析卡片默认折叠
 */

import { useState, type ReactNode } from "react";
import { Collapse, Empty, List, Progress, Space, Tag, Typography } from "antd";
import {
  ApartmentOutlined,
  CaretRightOutlined,
  MessageOutlined,
  QuestionCircleOutlined,
} from "@ant-design/icons";
import type { RequestAnalysis } from "../types";

interface Props {
  raw?: string;
  analysis?: RequestAnalysis;
}

/**
 * 展示 Request Agent 的结构化分析结果，默认折叠明细。
 */
export function RequestAnalysisCard({ raw, analysis }: Props) {
  const [open, setOpen] = useState(false);
  const data = analysis ?? parseRequestAnalysisBlock(raw ?? "");
  if (!data) return null;

  return (
    <Collapse
      className="mb-2"
      defaultActiveKey={[]}
      expandIcon={({ isActive }) => (
        <CaretRightOutlined rotate={isActive ? 90 : 0} />
      )}
      items={[
        {
          key: "1",
          label: (
            <div
              className="flex items-center gap-2"
              onClick={() => setOpen(!open)}
            >
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
          ),
          children: (
            <>
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
                        <div className="mb-3 flex flex-wrap items-center gap-2">
                          <Tag color="blue">业务序号：{item.index}</Tag>
                          <Tag>
                            覆盖请求：
                            {item.covered_user_input_indexes.join(", ")}
                          </Tag>
                        </div>

                        <FieldBlock label="序号">
                          <Typography.Text>{item.index}</Typography.Text>
                        </FieldBlock>

                        <FieldBlock label="用户目标">
                          <Typography.Paragraph
                            style={{
                              marginBottom: 0,
                              color: "var(--ink-soft)",
                              fontFamily: "var(--body)",
                              fontSize: 14,
                              lineHeight: 1.65,
                            }}
                          >
                            {item.user_goal}
                          </Typography.Paragraph>
                        </FieldBlock>

                        <FieldBlock label="目标约束">
                          <Typography.Text
                            className="mb-2 block"
                            style={{
                              color: "var(--ink-faint)",
                              fontSize: 12,
                              lineHeight: 1.5,
                            }}
                          >
                            来源于用户输入，而非 Agent 自行生成，例如用户输入中
                            “若 X，则 Y”里的 X。
                          </Typography.Text>
                          {item.goal_constraints.length > 0 ? (
                            <Space size={6} wrap>
                              {item.goal_constraints.map(
                                (constraint, index) => (
                                  <Tag key={index}>{constraint}</Tag>
                                ),
                              )}
                            </Space>
                          ) : (
                            <Typography.Text type="secondary">
                              无明确目标约束
                            </Typography.Text>
                          )}
                        </FieldBlock>

                        <FieldBlock label="欠缺信息">
                          <Typography.Text
                            className="mb-2 block"
                            style={{
                              color: "var(--ink-faint)",
                              fontSize: 12,
                              lineHeight: 1.5,
                            }}
                          >
                            由 Request Agent
                            提出它认为具有价值的缺失项；重要程度为 0-1
                            之间的数值，越高表示越重要，衡量该问题能多大程度减少关于用户真实目标的不确定性。
                          </Typography.Text>
                          {item.missing_information.length > 0 ? (
                            <List
                              size="small"
                              dataSource={item.missing_information}
                              renderItem={(missing) => (
                                <List.Item
                                  style={{
                                    paddingLeft: 0,
                                    paddingRight: 0,
                                    borderBottom: "1px solid var(--line-soft)",
                                  }}
                                >
                                  <div className="w-full">
                                    <div className="mb-1 flex items-start gap-2">
                                      <QuestionCircleOutlined
                                        style={{
                                          color: "var(--warning)",
                                          marginTop: 3,
                                        }}
                                      />
                                      <div className="min-w-0 flex-1">
                                        <div className="mb-1 flex flex-wrap gap-2">
                                          <Tag>序号：{missing.index}</Tag>
                                          <Tag color="gold">
                                            重要程度：
                                            {formatImportance(
                                              missing.importance,
                                            )}
                                          </Tag>
                                        </div>
                                        <Typography.Text>
                                          描述：{missing.description}
                                        </Typography.Text>
                                        <Progress
                                          percent={Math.round(
                                            missing.importance * 100,
                                          )}
                                          size="small"
                                          showInfo
                                        />
                                      </div>
                                    </div>
                                  </div>
                                </List.Item>
                              )}
                            />
                          ) : (
                            <Typography.Text type="secondary">
                              暂无欠缺信息
                            </Typography.Text>
                          )}
                        </FieldBlock>

                        <FieldBlock label="覆盖的用户请求序号列表">
                          {item.covered_user_input_indexes.length > 0 ? (
                            <Space size={6} wrap>
                              {item.covered_user_input_indexes.map((index) => (
                                <Tag key={index}>{index}</Tag>
                              ))}
                            </Space>
                          ) : (
                            <Typography.Text type="secondary">
                              暂无覆盖请求
                            </Typography.Text>
                          )}
                        </FieldBlock>
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
            </>
          ),
        },
      ]}
    />
  );
}

/**
 * 渲染业务模型中的单个字段块，保证结构化内容有稳定视觉层级。
 */
function FieldBlock({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <div className="mb-3 rounded-md border border-[var(--line-soft)] bg-white px-3 py-2">
      <Typography.Text
        strong
        className="mb-1 block"
        style={{
          color: "var(--ink)",
          fontFamily: "var(--sans)",
          fontSize: 13,
        }}
      >
        {label}
      </Typography.Text>
      {children}
    </div>
  );
}

/**
 * 将重要程度规范化为 0-1 的展示文本。
 */
function formatImportance(value: number): string {
  if (!Number.isFinite(value)) return "-";
  return Math.max(0, Math.min(1, value)).toFixed(2);
}

/**
 * 从 Request Agent 原始 block 中恢复结构化分析结果。
 */
function parseRequestAnalysisBlock(raw: string): RequestAnalysis | null {
  const jsonText = extractJson(raw);
  if (!jsonText) return null;

  try {
    const data = JSON.parse(jsonText) as RequestAnalysis;

    // 展示层只做轻量兜底，严格契约校验由 runtime/API 负责。
    if (!Array.isArray(data.business_model)) return null;
    if (!Array.isArray(data.questions)) return null;
    if (!Array.isArray(data.chitchat)) return null;
    return data;
  } catch {
    return null;
  }
}

/**
 * 从 tagged block 或 JSON 文本中提取 JSON 片段。
 */
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
