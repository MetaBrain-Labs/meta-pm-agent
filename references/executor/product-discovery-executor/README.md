# Product Discovery Executor

## 概述

Product Discovery Executor（产品探索执行器）是产品设计知识图谱系统中负责发现与验证层的 Agent。它创建和细化知识图谱中的"需求"、"功能"和"依据"实体，将模糊的用户意图转化为可验证的功能假设，通过持续的发现活动降低产品设计不确定性。

## 目录结构

```
product-discovery-executor/
├── executor.json              # Executor 配置文件
├── README.md                  # 本文件
├── prompts/
│   ├── system_prompt_cn.md    # 中文系统提示词
│   └── system_prompt_en.md    # English system prompt
└── skills/                    # 13 个内建技能（4 类）
    ├── brainstorm-ideas-existing/       # 创意脑暴（现有产品）
    ├── brainstorm-ideas-new/            # 创意脑暴（新产品）
    ├── brainstorm-experiments-existing/ # 实验设计（现有产品）
    ├── brainstorm-experiments-new/      # 实验设计（新产品）
    ├── identify-assumptions-existing/   # 假设识别（现有产品）
    ├── identify-assumptions-new/        # 假设识别（新产品）
    ├── prioritize-assumptions/          # 假设优先级排序
    ├── prioritize-features/             # 功能优先级排序
    ├── opportunity-solution-tree/       # 机会-解决方案树
    ├── interview-script/                # 访谈提纲
    ├── summarize-interview/             # 访谈纪要
    ├── metrics-dashboard/               # 指标看板
    └── analyze-feature-requests/        # 功能请求分析
```

## 快速开始

### 输入

从 ProductDirector Agent 接收任务：

```json
{
  "task_id": "task-001",
  "description": "针对提升复购率的目标构建 OST",
  "graph_context": {
    "nodes": [
      {"id": "G1", "type": "目标", "description": "提升复购率至 35%"},
      {"id": "D1", "type": "决策", "description": "构建复购快捷入口"},
      {"id": "N1", "type": "需求", "description": "用户需快速找到历史订单"}
    ],
    "edges": [
      {"relation": "驱动", "from_node_id": "N1", "to_node_id": "D1"}
    ]
  }
}
```

### 输出

以 `<think>` / `<execute>` / `<error>` 三块输出图谱操作指令。详见系统提示词。

## 技能列表

### 第一类：创意脑暴

| 技能 | 创建实体 | 主要关系 |
|------|---------|---------|
| brainstorm-ideas-existing | 功能（候选） | 产生、满足 |
| brainstorm-ideas-new | 功能（候选） | 产生、满足 |
| brainstorm-experiments-existing | 依据 | 验证 |
| brainstorm-experiments-new | 依据 | 验证 |

### 第二类：假设与优先级

| 技能 | 创建/修改 | 主要关系 |
|------|---------|---------|
| identify-assumptions-existing | 依据 | 验证 |
| identify-assumptions-new | 依据 | 验证 |
| prioritize-assumptions | 修改已有依据 | 构成 |
| prioritize-features | 修改已有功能 | 构成 |

### 第三类：结构分析

| 技能 | 创建实体 | 主要关系 |
|------|---------|---------|
| opportunity-solution-tree | 需求、功能、依据 | 满足、验证、构成 |
| interview-script | 依据 | 验证 |
| summarize-interview | 依据、需求 | 验证、引用、驱动 |

### 第四类：运营支持

| 技能 | 创建实体 | 主要关系 |
|------|---------|---------|
| metrics-dashboard | 指标 | 衡量 |
| analyze-feature-requests | 需求、功能 | 驱动、满足 |

## 与知识图谱的关系

本 Executor 操作实体位于产品设计因果链的发现与验证层：

```
需求 ──驱动──→ 决策 ──产生──→ 功能
  ▲                              │
  └──────── 满足 ────────────────┘

依据 ──验证──→ 需求/决策/功能
```

- **功能** 是核心产出——从需求中映射出的产品能力假设
- **依据** 是验证器——通过实验、访谈等发现活动持续检验假设
- **需求** 是发现——OST 构建过程中挖掘的新用户机会
- 你是第一个系统性地创建"功能"节点的 Executor，后续由 Product Execution Executor 拆细

## 候选功能的生命周期

```
Product Discovery Executor
  └─ 创建 Feature (status: candidate)
         │
         ▼
     用户反馈 / 实验验证
         │
         ▼
     status: validated  ← (由 Discovery 或其他 Executor 更新)
         │
         ▼
  Product Execution Executor
    └─ 拆细为子功能/组件
          │
          ▼
      status: detailed
```

## 与上下游的协作

```
Market Research Executor      Product Discovery Executor     Product Execution Executor
  │                                   │                           │
  ├─ 需求: 快速结账                    │                           │
  │    └─ 驱动 → 决策: 接入支付SDK      │                           │
  │            └─ 产生 ───────────→ 功能: 一键支付(候选)              │
  │                         └─ 满足 → 需求: 快速结账                │
  │                                   │                           │
  │                                   ├─ 依据: 支付AB测试            │
  │                                   │    └─ 验证 → 功能: 一键支付   │
  │                                   │                           │
  │                                   └─ 功能已验证 ────────────→ 拆细为子功能+组件
```

## 版本历史

| 版本 | 日期 | 变更 |
|------|------|------|
| 1.0.0 | 2026-06-21 | 初始版本，含 13 个技能、中英文系统提示词 |
