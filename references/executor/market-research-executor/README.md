# Market Research Executor

## 概述

Market Research Executor（市场研究执行器）是产品设计知识图谱系统中的研究层 Agent。它负责创建和细化知识图谱中的"依据"和"需求"实体，为下游战略决策提供可溯源的事实和数据支撑。

## 目录结构

```
market-research-executor/
├── executor.json              # Executor 配置文件
├── README.md                  # 本文件
├── prompts/
│   ├── system_prompt_cn.md    # 中文系统提示词
│   └── system_prompt_en.md    # English system prompt
└── skills/                    # 7 个内建技能
    ├── competitor-analysis/   # 竞品分析
    ├── user-personas/         # 用户画像
    ├── market-sizing/         # 市场规模估算
    ├── market-segments/       # 市场细分
    ├── customer-journey-map/  # 客户旅程地图
    ├── sentiment-analysis/    # 情感分析
    └── user-segmentation/     # 用户分群
```

## 快速开始

### 输入

从 ProductDirector Agent 接收任务：

```json
{
  "task_id": "task-001",
  "description": "对支付赛道进行竞品分析和用户画像构建",
  "business_model": {
    "goals": [
      {
        "id": 1,
        "description": "提升平台 GMV 20%",
        "missing_info": [
          {"id": 1, "description": "竞品定价策略", "importance": 0.9},
          {"id": 2, "description": "目标用户画像", "importance": 0.8}
        ]
      }
    ]
  },
  "graph_context": {
    "nodes": [{"id": "G1", "type": "目标", "description": "提升平台 GMV 20%"}],
    "edges": []
  }
}
```

### 输出

以 `<think>` / `<execute>` / `<error>` 三块输出图谱操作指令。详见系统提示词。

## 技能列表

| 序号 | 技能 | 创建实体 | 主要关系 |
|------|------|---------|---------|
| 1 | competitor-analysis | 依据、需求、自定义 | 引用、驱动 |
| 2 | user-personas | 自定义: Persona、需求 | 驱动 |
| 3 | market-sizing | 依据、需求 | 验证、驱动 |
| 4 | market-segments | 需求、依据 | 构成、验证 |
| 5 | customer-journey-map | 需求、依据 | 构成、验证 |
| 6 | sentiment-analysis | 依据、需求 | 验证、驱动 |
| 7 | user-segmentation | 需求、依据 | 驱动、引用 |

## 与知识图谱的关系

本 Executor 操作的实体位于产品设计因果链的研究层：

```
依据 ──引用──→ 决策 ──产生──→ 功能
  │              ▲
  └──验证──→ 需求 ──驱动──┘
```

- **依据** 是证据——"凭什么这么说"
- **需求** 是洞察——"用户需要什么"
- 下游 Executor（Strategy / Discovery / Execution）基于你创建的"依据"和"需求"进行决策和功能设计
- 最终的文档由 Document Agent 从图谱中组装

## 与 Product Strategy Executor 的协作

典型的协作链路：

```
Market Research Executor            Product Strategy Executor
  │                                         │
  ├─ 创建 依据: 竞品A定价分析                 │
  │    └─ 引用 ─────────────────────────→ 决策: 采用订阅制定价
  │                                         │
  ├─ 创建 需求: 中小团队每月支出需可预测        │
  │    └─ 驱动 ─────────────────────────→ 决策: 提供3层定价方案
  │                                         │
  └─ 创建 依据: TAM预估 $2.5B                │
       └─ 验证 ─────────────────────────→ 目标: 第一年获得0.1%市场份额
```

## 版本历史

| 版本 | 日期 | 变更 |
|------|------|------|
| 1.0.0 | 2026-06-21 | 初始版本，含 7 个技能、中英文系统提示词 |
