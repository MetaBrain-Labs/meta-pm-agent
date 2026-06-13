import { useState } from "react";
import { Card, Typography } from "antd";
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
      style={{
        marginBottom: 8,
        borderLeft: "3px solid #f0a0c0",
        background: "linear-gradient(135deg, #fff5f9 0%, #fdf2f8 100%)",
      }}
      title={
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span className="plum-blossom" aria-hidden>❀</span>
          <span style={{ fontWeight: 600, fontSize: 13, color: "#8b5e7a" }}>
            {title ?? "压缩内容"}
          </span>
        </div>
      }
      extra={
        <span
          onClick={() => setExpanded(!expanded)}
          style={{
            cursor: "pointer",
            color: "#b07a9e",
            fontSize: 12,
            display: "flex",
            alignItems: "center",
            gap: 4,
          }}
        >
          {expanded ? "收起" : "展开"}
          {expanded ? <CaretDownOutlined /> : <CaretRightOutlined />}
        </span>
      }
    >
      {expanded ? (
        <div
          style={{
            maxHeight: 400,
            overflowY: "auto",
            background: "#faf5f8",
            border: "1px solid #f0d0e0",
            borderRadius: 6,
            padding: "10px 14px",
          }}
        >
          <pre
            style={{
              margin: 0,
              fontSize: 12,
              fontFamily: "'SF Mono', 'Fira Code', 'Fira Mono', monospace",
              whiteSpace: "pre-wrap",
              wordBreak: "break-word",
              color: "#5c3d4e",
              lineHeight: 1.55,
            }}
          >
            {raw}
          </pre>
        </div>
      ) : (
        <Text
          type="secondary"
          style={{ fontSize: 12, color: "#b08ca0" }}
        >
          {raw.slice(0, 200)}
          {raw.length > 200 ? "…" : ""}
        </Text>
      )}
    </Card>
  );
}
