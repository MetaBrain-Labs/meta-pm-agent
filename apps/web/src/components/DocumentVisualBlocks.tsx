/**
 * 文档可视化块渲染器
 *
 * 将 PRD Markdown 中的可视化 fenced code block 渲染为图表或静态原型：
 * - echarts：ECharts option JSON -> canvas 图表（组件按需拆包加载）
 * - prototype/wireframe：受限 JSON DSL -> Ant Design 静态线框图
 * - html：静态 HTML -> 禁用脚本的沙箱 iframe
 *
 * Responsibilities:
 * - 解析模型产出的 JSON/HTML，并在解析失败时优雅降级为原始代码块
 * - 使用 Ant Design 组件以较少代码绘制常见线框元素
 * - 保证不执行模型输出中的任意脚本，不使用 dangerouslySetInnerHTML
 *
 * Notes:
 * - echarts 依赖通过动态 import 拆包，聊天页不会默认加载图表包。
 * - 可视化块默认只在文档预览场景启用，普通聊天 Markdown 不启用。
 */

import { lazy, Suspense, useMemo, type ReactNode } from "react";
import {
  Alert,
  Button,
  Card,
  Checkbox,
  Divider,
  Input,
  List,
  Select,
  Spin,
  Statistic,
  Steps,
  Table,
  Tabs,
  Tag,
  Typography,
} from "antd";

const { Text } = Typography;

const EChartVisualization = lazy(async () => {
  const module = await import("./EChartVisualization");
  return { default: module.EChartVisualization };
});

/**
 * 文档 Markdown 支持的可视化代码块语言。
 */
const VISUAL_BLOCK_LANGUAGES = new Set([
  "echarts",
  "prototype",
  "wireframe",
  "html",
]);

/**
 * 判断一个 fenced code block 是否应作为文档可视化内容渲染。
 */
export function isDocumentVisualLanguage(
  language: string | null,
): language is string {
  return language !== null && VISUAL_BLOCK_LANGUAGES.has(language);
}

/**
 * 可视化代码块分发组件。
 */
export function DocumentVisualBlock({
  language,
  body,
  fallback,
}: {
  language: string;
  body: string;
  fallback: ReactNode;
}) {
  if (language === "echarts") {
    return (
      <Suspense
        fallback={
          <div className="my-3 flex h-[360px] items-center justify-center rounded-md border border-[var(--line-soft)] bg-white">
            <Spin size="small" />
          </div>
        }
      >
        <EChartVisualization body={body} fallback={fallback} />
      </Suspense>
    );
  }

  if (language === "prototype" || language === "wireframe") {
    return <PrototypeVisualization body={body} fallback={fallback} />;
  }

  if (language === "html") {
    return <HtmlPrototypeVisualization body={body} fallback={fallback} />;
  }

  return <>{fallback}</>;
}

/**
 * 展示可视化块解析失败原因，并回退为原始代码块。
 */
function VisualizationError({
  title,
  detail,
  fallback,
}: {
  title: string;
  detail: string;
  fallback: ReactNode;
}) {
  return (
    <div className="my-3">
      <Alert
        type="warning"
        showIcon
        className="mb-2"
        message={title}
        description={detail}
      />
      {fallback}
    </div>
  );
}

/**
 * 静态 HTML 原型预览。
 *
 * iframe 使用空 sandbox，禁止脚本、表单提交和同源访问，仅展示静态结构。
 */
function HtmlPrototypeVisualization({
  body,
  fallback,
}: {
  body: string;
  fallback: ReactNode;
}) {
  const html = body.trim();
  if (!html) return <>{fallback}</>;

  return (
    <figure className="my-3 rounded-md border border-[var(--line-soft)] bg-white p-3">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <Tag color="purple">HTML 原型</Tag>
        <Text type="secondary" className="text-xs">
          沙箱预览已禁用脚本，仅展示静态结构
        </Text>
      </div>
      <iframe
        title="HTML 原型预览"
        sandbox=""
        srcDoc={html}
        className="h-[420px] w-full rounded border border-[var(--line-soft)] bg-white"
      />
    </figure>
  );
}

/**
 * 原型 JSON DSL 中的单个页面/区块节点。
 */
interface PrototypeNode {
  type?: string;
  text?: string;
  title?: string;
  subtitle?: string;
  description?: string;
  level?: "title" | "body" | "caption";
  tone?: "info" | "success" | "warning" | "error";
  variant?: "primary" | "default" | "danger" | "link";
  block?: boolean;
  label?: string;
  placeholder?: string;
  checked?: boolean;
  value?: string | number;
  suffix?: string;
  items?: string[];
  columns?: string[];
  rows?: string[][];
  options?: Array<string | { label?: string; value?: string }>;
  blocks?: PrototypeNode[];
  tabs?: PrototypeTab[];
  steps?: string[];
  current?: number;
}

interface PrototypeTab {
  label?: string;
  blocks?: PrototypeNode[];
}

/**
 * 原型 JSON DSL 的根结构。
 */
interface PrototypeDefinition {
  title?: string;
  description?: string;
  layout?: "mobile" | "desktop";
  blocks?: PrototypeNode[];
}

interface ParsedPrototype {
  definition: PrototypeDefinition | null;
  error: string | null;
}

/**
 * 将模型输出的 JSON 线框定义渲染为 Ant Design 静态原型。
 */
function PrototypeVisualization({
  body,
  fallback,
}: {
  body: string;
  fallback: ReactNode;
}) {
  const parsed = useMemo(() => parsePrototypeDefinition(body), [body]);

  if (parsed.error || !parsed.definition) {
    return (
      <VisualizationError
        title="原型 JSON 无法解析"
        detail={parsed.error ?? "未知解析错误"}
        fallback={fallback}
      />
    );
  }

  const definition = parsed.definition;
  const layout = definition.layout === "mobile" ? "mobile" : "desktop";
  const blocks = definition.blocks ?? [];

  return (
    <figure
      className={`my-3 rounded-md border border-[var(--line-soft)] bg-white p-4 ${
        layout === "mobile" ? "mx-auto w-full max-w-[400px]" : "w-full"
      }`}
    >
      {(definition.title || definition.description) && (
        <div className="mb-3 flex items-start justify-between gap-3 border-b border-[var(--line-soft)] pb-2">
          <div className="min-w-0">
            <Text strong className="block text-base leading-snug">
              {definition.title ?? "界面原型"}
            </Text>
            {definition.description && (
              <Text type="secondary" className="mt-0.5 block text-xs leading-5">
                {definition.description}
              </Text>
            )}
          </div>
          <Tag className="shrink-0" color="geekblue">
            {layout === "mobile" ? "移动端" : "桌面端"}
          </Tag>
        </div>
      )}
      <div className="flex flex-col gap-2.5">
        {blocks.map((node, index) => (
          <PrototypeNodeView key={`${node.type ?? "block"}-${index}`} node={node} />
        ))}
      </div>
    </figure>
  );
}

/**
 * 渲染单个原型节点。
 */
function PrototypeNodeView({ node }: { node: PrototypeNode }) {
  const text = node.text ?? node.title ?? "";
  const label = node.label ?? node.title ?? "";

  switch (node.type) {
    case "header":
      return (
        <div className="flex items-start justify-between gap-3 border-b border-[var(--line-soft)] pb-2">
          <div className="min-w-0">
            <Text strong className="block text-base leading-snug">
              {text}
            </Text>
            {node.subtitle && (
              <Text type="secondary" className="mt-0.5 block text-xs leading-5">
                {node.subtitle}
              </Text>
            )}
          </div>
          {node.description && (
            <Tag className="shrink-0">{node.description}</Tag>
          )}
        </div>
      );

    case "text":
      if (node.level === "caption") {
        return <Text type="secondary">{text}</Text>;
      }
      return (
        <Text className={node.level === "title" ? "font-semibold" : undefined}>
          {text}
        </Text>
      );

    case "button":
      return (
        <Button
          type={
            node.variant === "primary" || node.variant === "danger"
              ? "primary"
              : node.variant === "link"
                ? "link"
                : "default"
          }
          danger={node.variant === "danger"}
          block={node.block === true}
        >
          {text || "按钮"}
        </Button>
      );

    case "input":
      return (
        <div className="flex flex-col gap-1">
          {label && <Text className="text-xs">{label}</Text>}
          <Input readOnly placeholder={node.placeholder} />
        </div>
      );

    case "select":
      return (
        <div className="flex flex-col gap-1">
          {label && <Text className="text-xs">{label}</Text>}
          <Select
            className="w-full"
            disabled
            placeholder={node.placeholder}
            options={(node.options ?? []).map((option) =>
              typeof option === "string"
                ? { label: option, value: option }
                : {
                    label: option.label ?? option.value ?? "",
                    value: option.value ?? option.label ?? "",
                  },
            )}
          />
        </div>
      );

    case "checkbox":
      return (
        <Checkbox disabled checked={node.checked === true}>
          {text}
        </Checkbox>
      );

    case "list":
      return (
        <List
          size="small"
          bordered
          dataSource={node.items ?? []}
          renderItem={(item) => (
            <List.Item className="!px-3 !py-1.5 text-sm">{item}</List.Item>
          )}
        />
      );

    case "table":
      return (
        <PrototypeTable
          columns={node.columns ?? []}
          rows={node.rows ?? []}
          title={node.title}
        />
      );

    case "alert":
      return (
        <Alert
          type={node.tone ?? "info"}
          showIcon
          message={text}
          description={node.description}
        />
      );

    case "card":
      return (
        <Card size="small" title={node.title}>
          <div className="flex flex-col gap-2.5">
            {(node.blocks ?? []).map((child, index) => (
              <PrototypeNodeView
                key={`${child.type ?? "block"}-${index}`}
                node={child}
              />
            ))}
          </div>
        </Card>
      );

    case "tabs":
      return (
        <Tabs
          size="small"
          items={(node.tabs ?? []).map((tab, index) => ({
            key: `prototype-tab-${index}`,
            label: tab.label ?? `标签 ${index + 1}`,
            children: (
              <div className="flex flex-col gap-2.5">
                {(tab.blocks ?? []).map((child, childIndex) => (
                  <PrototypeNodeView
                    key={`${child.type ?? "block"}-${childIndex}`}
                    node={child}
                  />
                ))}
              </div>
            ),
          }))}
        />
      );

    case "divider":
      return (
        <Divider className="!my-1" orientation="left" plain>
          {text}
        </Divider>
      );

    case "steps":
      return (
        <Steps
          size="small"
          current={
            typeof node.current === "number" && Number.isFinite(node.current)
              ? node.current
              : 0
          }
          items={(node.steps ?? []).map((step) => ({ title: step }))}
        />
      );

    case "stat":
      return (
        <Statistic
          title={label}
          value={node.value ?? "TBD"}
          suffix={node.suffix}
        />
      );

    default:
      return (
        <Alert
          type="warning"
          showIcon
          message={`未知原型块类型：${node.type || "未指定"}`}
        />
      );
  }
}

/**
 * 将原型 DSL 的二维数组转换为 Ant Design Table 数据源。
 */
function PrototypeTable({
  columns,
  rows,
  title,
}: {
  columns: string[];
  rows: string[][];
  title?: string;
}) {
  const columnDefinitions = columns.map((columnTitle, index) => ({
    title: columnTitle,
    dataIndex: `prototype-col-${index}`,
    key: `prototype-col-${index}`,
  }));
  const dataSource = rows.map((cells, rowIndex) => {
    const record: Record<string, string> = {
      __key: `prototype-row-${rowIndex}`,
    };
    columns.forEach((_columnTitle, columnIndex) => {
      record[`prototype-col-${columnIndex}`] = cells[columnIndex] ?? "";
    });
    return record;
  });

  return (
    <div className="overflow-hidden rounded border border-[var(--line-soft)]">
      {title && (
        <div className="border-b border-[var(--line-soft)] bg-[var(--surface-muted)] px-3 py-2">
          <Text strong className="text-sm">
            {title}
          </Text>
        </div>
      )}
      <Table
        size="small"
        rowKey="__key"
        columns={columnDefinitions}
        dataSource={dataSource}
        pagination={false}
      />
    </div>
  );
}

/**
 * 解析模型产出的原型 JSON；结构不合法时返回可读错误。
 */
function parsePrototypeDefinition(body: string): ParsedPrototype {
  try {
    const value = JSON.parse(body) as unknown;
    if (!isRecord(value)) {
      throw new Error("Prototype root must be a JSON object.");
    }
    const definition = value as PrototypeDefinition;
    if (
      definition.blocks !== undefined &&
      (!Array.isArray(definition.blocks) ||
        definition.blocks.some((block) => !isRecord(block)))
    ) {
      throw new Error("Prototype blocks must be an array of JSON objects.");
    }
    return { definition, error: null };
  } catch (error) {
    return {
      definition: null,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * 判断未知 JSON 值是否为普通对象。
 */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
