# Data Analytics Executor

## 概述

Data Analytics Executor（数据分析执行器）是产品设计知识图谱系统中负责定量分析验证层的 Agent。它基于真实数据产出"依据"实体，验证或推翻图谱中的假设；为"指标"定义可复用的数据查询"组件"——将数据提炼为可溯源的产品设计证据。

## 目录结构

```
data-analytics-executor/
├── executor.json              # Executor 配置文件
├── README.md                  # 本文件
├── prompts/
│   ├── system_prompt_cn.md    # 中文系统提示词
│   └── system_prompt_en.md    # English system prompt
└── skills/                    # 3 个内建技能
    ├── ab-test-analysis/      # A/B 测试分析
    ├── cohort-analysis/       # 群组分析
    └── sql-queries/           # SQL 查询
```

## 快速开始

### 输入

```json
{
  "task_id": "task-001",
  "description": "分析新注册流程 A/B 测试结果",
  "graph_context": {
    "nodes": [
      {"id": "D1", "type": "决策", "description": "采用新注册流程"},
      {"id": "M1", "type": "指标", "description": "注册转化率"}
    ],
    "edges": []
  },
  "data_sources": ["ab_test_signup.csv"]
}
```

## 技能列表

| 技能 | 创建实体 | 主要关系 |
|------|---------|---------|
| ab-test-analysis | 依据 | 验证 |
| cohort-analysis | 依据、指标 | 验证、衡量 |
| sql-queries | 组件 | 实现 |

## 与知识图谱的关系

本 Executor 操作实体位于产品设计因果链的定量验证层：

```
依据 ──验证──→ 决策    (A/B 测试结论验证决策方向)
依据 ──验证──→ 指标    (留存分析验证指标趋势)
依据 ──验证──→ 需求    (功能采纳度验证需求真实性)

组件 ──实现──→ 指标    (SQL 查询产出指标数据)
```

- **依据** 是核心产出——用真实数据支持的结论
- **组件** 是数据管道——让指标可被持续追踪的查询定义
- 你是系统中唯一依赖外部真实数据（DATA_SOURCES）的 Executor

## 七个 Executor 完备对比

| 维度 | Strategy | Research | GTM | Discovery | Execution | Marketing | **Analytics** |
|------|:--:|:--:|:--:|:--:|:--:|:--:|:--:|
| 技能 | 12 | 7 | 6 | 13 | 16 | 5 | **3** |
| 核心实体 | 目标+决策 | 依据+需求 | 决策+组件 | 需求+功能+依据 | 功能+组件 | 指标+决策 | **依据+指标+组件** |
| 关系种类 | 7 | 5 | 8 | 7 | 10 | 6 | **5** |
| 标志性关系 | 驱动、产生 | 验证、引用 | 驱动、实现 | 满足、验证 | 构成、实现 | 衡量、构成 | **验证、实现** |
| 外部依赖 | — | web search | web search | web search | — | — | **数据文件** |

## 版本历史

| 版本 | 日期 | 变更 |
|------|------|------|
| 1.0.0 | 2026-06-21 | 初始版本，含 3 个技能、中英文系统提示词 |
