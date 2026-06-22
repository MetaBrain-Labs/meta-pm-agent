# Product Strategy Executor

## 概述

Product Strategy Executor（产品战略执行器）是产品设计知识图谱系统中的战略层 Agent。它负责创建和细化知识图谱中的"目标"和"决策"实体，建立产品设计的顶层因果链路。

## 目录结构

```
product-strategy-executor/
├── executor.json              # Executor 配置文件
├── README.md                  # 本文件
├── prompts/
│   ├── system_prompt_cn.md    # 中文系统提示词
│   └── system_prompt_en.md    # English system prompt
└── skills/                    # 12 个内建技能
    ├── product-vision/        # 产品愿景
    ├── product-strategy/      # 产品战略画布
    ├── business-model/        # 商业模式画布
    ├── lean-canvas/           # 精益画布
    ├── startup-canvas/        # 初创企业画布
    ├── ansoff-matrix/         # 安索夫增长矩阵
    ├── swot-analysis/         # SWOT 分析
    ├── porters-five-forces/   # 波特五力分析
    ├── pestle-analysis/       # PESTLE 宏观环境分析
    ├── value-proposition/     # 价值主张设计
    ├── pricing-strategy/      # 定价策略
    └── monetization-strategy/ # 盈利模式策略
```

## 快速开始

### 输入

从 ProductDirector Agent 接收任务：

```json
{
  "task_id": "task-001",
  "description": "为新产品制定战略规划",
  "business_model": {
    "goals": [
      {
        "id": 1,
        "description": "提升平台 GMV 20%",
        "constraints": ["预算不超过 50 万"],
        "missing_info": [
          {"id": 1, "description": "目标市场细分情况", "importance": 0.8}
        ]
      }
    ]
  },
  "graph_context": {
    "nodes": [],
    "edges": []
  }
}
```

### 输出

以 `<think>` / `<execute>` / `<error>` 三块输出图谱操作指令。详见系统提示词。

## 技能列表

| 序号 | 技能 | 创建实体 | 主要关系 |
|------|------|---------|---------|
| 1 | product-vision | 目标 | 构成 |
| 2 | product-strategy | 决策 | 驱动、产生 |
| 3 | business-model | 决策、需求 | 引用、驱动 |
| 4 | lean-canvas | 决策、需求、依据 | 引用、驱动 |
| 5 | startup-canvas | 决策、需求 | 驱动、产生 |
| 6 | ansoff-matrix | 决策 | 产生 |
| 7 | swot-analysis | 依据 | 引用、验证 |
| 8 | porters-five-forces | 依据 | 引用 |
| 9 | pestle-analysis | 依据 | 验证、限制 |
| 10 | value-proposition | 需求 | 驱动 |
| 11 | pricing-strategy | 决策 | 驱动、衡量 |
| 12 | monetization-strategy | 决策 | 驱动 |

## 与知识图谱的关系

本 Executor 操作的实体位于产品设计因果链的顶层：

```
目标 → 驱动 → 需求 → 驱动 → 决策 → 产生 → 功能 → 实现 → 组件
  ▲                                    │
  └────────── 影响 ─────────────────────┘
```

- **目标** 是起点——"为什么要做"
- **决策** 是核心产出——"选择什么方案"
- 每个决策都可以被下游 Executor（Discovery / Execution / Shipping）继续细化
- 最终的文档由 Document Agent 从图谱中组装

## 版本历史

| 版本 | 日期 | 变更 |
|------|------|------|
| 1.0.0 | 2026-06-21 | 初始版本，含 12 个技能、中英文系统提示词 |
