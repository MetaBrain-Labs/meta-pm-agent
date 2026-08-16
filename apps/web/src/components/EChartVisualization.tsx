/**
 * ECharts 文档图表组件
 *
 * 将 Document Agent 生成的 `echarts` fenced code block 中的 JSON option
 * 渲染为 ECharts canvas 图表。组件由 DocumentVisualBlocks 通过动态 import
 * 按需加载，避免聊天页默认打包 ECharts。
 *
 * Responsibilities:
 * - 校验并解析 ECharts option JSON
 * - 初始化/销毁图表实例并响应容器尺寸变化
 * - 在 JSON 非法时回退为原始代码块
 *
 * Notes:
 * - JSON.parse 不会执行函数或脚本，模型输出的 option 无法注入可执行代码。
 */

import { useEffect, useMemo, useRef, type ReactNode } from "react";
import { Alert, Tag, Typography } from "antd";
import * as echarts from "echarts";
import type { EChartsOption } from "echarts";

const { Text } = Typography;

interface ParsedChartOption {
  option: EChartsOption | null;
  error: string | null;
}

/**
 * 渲染单个 ECharts JSON 代码块。
 */
export function EChartVisualization({
  body,
  fallback,
}: {
  body: string;
  fallback: ReactNode;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const parsed = useMemo(() => parseChartOption(body), [body]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container || !parsed.option) return;

    const chart = echarts.init(container);
    chart.setOption(parsed.option);

    const resizeObserver =
      typeof ResizeObserver === "undefined"
        ? null
        : new ResizeObserver(() => chart.resize());
    resizeObserver?.observe(container);

    return () => {
      resizeObserver?.disconnect();
      chart.dispose();
    };
  }, [parsed.option]);

  if (parsed.error || !parsed.option) {
    return (
      <div className="my-3">
        <Alert
          type="warning"
          showIcon
          className="mb-2"
          message="ECharts 图表配置无法解析"
          description={parsed.error ?? "未知解析错误"}
        />
        {fallback}
      </div>
    );
  }

  return (
    <figure className="my-3 rounded-md border border-[var(--line-soft)] bg-white p-3">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <Tag color="blue">ECharts 图表</Tag>
        <Text type="secondary" className="text-xs">
          由 PRD 结构化数据渲染
        </Text>
      </div>
      <div ref={containerRef} className="h-[360px] w-full" />
    </figure>
  );
}

/**
 * 将代码块正文解析为 ECharts option。
 */
function parseChartOption(body: string): ParsedChartOption {
  try {
    const value = JSON.parse(body) as unknown;
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
      throw new Error("ECharts option must be a JSON object.");
    }
    return { option: value as EChartsOption, error: null };
  } catch (error) {
    return {
      option: null,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
