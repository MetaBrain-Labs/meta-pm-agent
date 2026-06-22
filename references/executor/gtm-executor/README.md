# Go-to-Market Executor

## 概述

Go-to-Market Executor（上市策略执行器）是产品设计知识图谱系统中负责 GTM 与增长策略层的 Agent。它创建和细化知识图谱中的"决策"和"组件"实体，将上游战略转化为可落地的上市动作和增长机制。

## 目录结构

```
gtm-executor/
├── executor.json              # Executor 配置文件
├── README.md                  # 本文件
├── prompts/
│   ├── system_prompt_cn.md    # 中文系统提示词
│   └── system_prompt_en.md    # English system prompt
└── skills/                    # 6 个内建技能
    ├── gtm-strategy/          # 上市策略
    ├── beachhead-segment/     # 滩头阵地细分
    ├── ideal-customer-profile/# 理想客户画像
    ├── gtm-motions/           # GTM 动作
    ├── growth-loops/          # 增长飞轮
    └── competitive-battlecard/# 竞品对抗卡
```

## 快速开始

### 输入

从 ProductDirector Agent 接收任务：

```json
{
  "task_id": "task-001",
  "description": "为新产品制定完整 GTM 策略",
  "graph_context": {
    "nodes": [
      {"id": "G1", "type": "目标", "description": "首年获得 1000 付费用户"},
      {"id": "N1", "type": "需求", "description": "早期用户聚集于独立开发者社区"}
    ],
    "edges": []
  }
}
```

### 输出

以 `<think>` / `<execute>` / `<error>` 三块输出图谱操作指令。详见系统提示词。

## 技能列表

| 序号 | 技能 | 创建实体 | 主要关系 |
|------|------|---------|---------|
| 1 | gtm-strategy | 决策、组件、指标、依据 | 驱动、产生、实现、衡量、验证 |
| 2 | beachhead-segment | 需求 | 驱动、构成 |
| 3 | ideal-customer-profile | 需求、依据 | 驱动、引用 |
| 4 | gtm-motions | 组件 | 实现、产生 |
| 5 | growth-loops | 决策、指标、组件 | 衡量、实现 |
| 6 | competitive-battlecard | 依据、决策 | 引用 |

## 与知识图谱的关系

本 Executor 操作实体位于产品设计因果链的 GTM 策略层：

```
需求 ──驱动──→ 决策 ──产生──→ 功能
                  │
                  └──实现──→ 组件（渠道/消息/里程碑/增长飞轮）
```

- **决策** 是 GTM 的核心——"选择什么渠道、用什么信息、定什么节奏"
- **组件** 是落地的——具体的 GTM 动作、渠道配置、里程碑定义
- 你承接上游 Product Strategy Executor 的"目标"和 Market Research Executor 的"需求"
- 你的"决策"和"组件"为下游 Product Execution Executor 提供执行依据

## 与上下游的协作

```
Market Research Executor          GTM Executor                Product Execution Executor
  │                                   │                              │
  ├─ 依据: 竞品定价分析                 │                              │
  ├─ 需求: 用户聚集于独立开发者社区       │                              │
  │    └─ 驱动 ────────────────────→ 决策: PH+内容双渠道 ──产生──→ 功能: 产品发布页面
  │    └─ 驱动 ────────────────────→ 决策: UGC飞轮 ──实现──→      组件: 分享激励机制
  │                                   │                              │
  │                                   └─ 指标: 月分享率 ──衡量──→ 目标: 首年1000用户
```

## 版本历史

| 版本 | 日期 | 变更 |
|------|------|------|
| 1.0.0 | 2026-06-21 | 初始版本，含 6 个技能、中英文系统提示词 |
