import { useState } from "react";
import { Card, Typography, Flex } from "antd";
import { CaretDownOutlined, CaretRightOutlined } from "@ant-design/icons";

const { Text } = Typography;

interface Props {
  raw: string;
  title?: string;
}

export function CompressedCard({ raw, title }: Props) {
  const [expanded, setExpanded] = useState(true);

  return (
    <Card
      size="small"
      className="mb-2"
      style={{
        background: 'var(--bone)',
        borderColor: 'var(--line)',
        borderLeft: '3px solid var(--coral)',
        borderRadius: 12,
        boxShadow: '0 2px 12px rgba(21, 20, 15, 0.05)',
      }}
      title={
        <Flex align="center" gap={8}>
          <span
            className="inline-flex items-center justify-center w-[22px] h-[22px] rounded-full text-white text-[13px] leading-none"
            style={{
              background: 'var(--coral)',
              fontFamily: 'var(--serif)',
              fontStyle: 'italic',
              fontSize: 13,
            }}
          >
            +
          </span>
          <span
            className="font-semibold text-[13px]"
            style={{
              fontFamily: 'var(--sans)',
              color: 'var(--ink)',
              letterSpacing: '-0.005em',
            }}
          >
            {title ?? "压缩内容"}
          </span>
        </Flex>
      }
      extra={
        <Flex
          align="center"
          gap={4}
          className="cursor-pointer text-xs"
          style={{ color: 'var(--ink-faint)', fontFamily: 'var(--sans)' }}
          onClick={() => setExpanded(!expanded)}
        >
          {expanded ? "收起" : "展开"}
          {expanded ? <CaretDownOutlined /> : <CaretRightOutlined />}
        </Flex>
      }
    >
      {expanded ? (
        <div
          className="max-h-[400px] overflow-y-auto rounded-md p-2.5"
          style={{
            background: 'var(--paper)',
            border: '1px solid var(--line-soft)',
          }}
        >
          <pre
            className="m-0 text-xs whitespace-pre-wrap wrap-break-word leading-relaxed"
            style={{
              fontFamily: 'var(--mono)',
              color: 'var(--ink-soft)',
              fontSize: 12,
            }}
          >
            {raw}
          </pre>
        </div>
      ) : (
        <Text
          className="text-xs"
          style={{ color: 'var(--ink-faint)', fontFamily: 'var(--body)' }}
        >
          {raw.slice(0, 200)}
          {raw.length > 200 ? "…" : ""}
        </Text>
      )}
    </Card>
  );
}
