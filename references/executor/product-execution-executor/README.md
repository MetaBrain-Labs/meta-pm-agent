# Product Execution Executor

## 概述

Product Execution Executor（产品执行执行器）是产品设计知识图谱系统中负责执行细化层的 Agent。它承接上游 Product Discovery Executor 创建的已验证"功能"节点，将其逐层拆细为子功能和"组件"（技术规范、测试场景、干系人关系等），建立实现层级的完整图谱结构。它是唯一能将功能节点 status 从 `validated` 推进到 `detailed` 的 Executor。

## 目录结构

```
product-execution-executor/
├── executor.json              # Executor 配置文件
├── README.md                  # 本文件
├── prompts/
│   ├── system_prompt_cn.md    # 中文系统提示词
│   └── system_prompt_en.md    # English system prompt
└── skills/                    # 16 个内建技能（5 类）
    ├── create-prd/              # 功能拆细（核心）
    ├── user-stories/            # 用户故事拆解
    ├── job-stories/             # Job Story 拆解
    ├── wwas/                    # 实际交付记录
    ├── sprint-plan/             # 规划与路线图
    ├── brainstorm-okrs/         # OKR 脑暴
    ├── outcome-roadmap/         # 结果导向路线图
    ├── prioritization-frameworks/# 优先级框架
    ├── test-scenarios/          # 质量保障
    ├── strategy-red-team/       # 红队挑战
    ├── pre-mortem/              # 事前验尸
    ├── stakeholder-map/         # 协作与记录
    ├── summarize-meeting/       # 会议纪要
    ├── release-notes/           # 交付支持
    ├── retro/                   # 回顾总结
    └── dummy-dataset/           # 模拟数据集
```

## 快速开始

### 输入

从 ProductDirector Agent 接收任务：

```json
{
  "task_id": "task-001",
  "description": "将已通过的"一键复购模块"功能拆细为可实现的子功能和组件",
  "graph_context": {
    "nodes": [
      {"id": "F1", "type": "功能", "description": "一键复购模块", "extra": {"status": "validated"}},
      {"id": "D1", "type": "决策", "description": "构建复购快捷入口"},
      {"id": "N1", "type": "需求", "description": "用户需快速找到历史订单"}
    ],
    "edges": [
      {"relation": "产生", "from_node_id": "D1", "to_node_id": "F1"}
    ]
  }
}
```

### 输出

以 `<think>` / `<execute>` / `<error>` 三块输出图谱操作指令。详见系统提示词。

## 技能列表

### 第一类：功能拆细（核心）

| 技能 | 创建实体 | 主要关系 |
|------|---------|---------|
| create-prd | 子功能、组件 | 构成、实现、限制、影响 |
| user-stories | 子功能、需求 | 构成、满足 |
| job-stories | 子功能、需求 | 构成、满足 |
| wwas | 依据、组件 | 验证、实现 |

### 第二类：规划与路线图

| 技能 | 操作类型 | 主要关系 |
|------|---------|---------|
| sprint-plan | 标注（修改 extra） | 构成 |
| brainstorm-okrs | 目标、指标 | 构成、衡量 |
| outcome-roadmap | 决策 | 产生 |
| prioritization-frameworks | 标注（修改 extra） | 构成 |

### 第三类：质量保障

| 技能 | 创建实体 | 主要关系 |
|------|---------|---------|
| test-scenarios | 组件（测试场景） | 限制 |
| strategy-red-team | 依据 | 验证 |
| pre-mortem | 依据 | 限制 |

### 第四类：协作与记录

| 技能 | 创建实体 | 主要关系 |
|------|---------|---------|
| stakeholder-map | 自定义: Stakeholder | 自定义 |
| summarize-meeting | 依据、需求 | 引用、验证、驱动 |

### 第五类：交付支持

| 技能 | 创建实体 | 主要关系 |
|------|---------|---------|
| release-notes | 依据 | 引用 |
| retro | 依据、需求 | 验证、限制 |
| dummy-dataset | 组件 | 实现 |

## 与知识图谱的关系

本 Executor 操作实体位于产品设计因果链的执行细化层：

```
决策 ──产生──→ 功能 ──构成──→ 子功能 ──构成──→ 子子功能
                │                  │
                ├──实现──→ 组件     ├──实现──→ 组件
                ├──限制──→ 组件     └──限制──→ 组件
                └──影响──→ 目标
```

- **构成** 是你最核心的关系——通过它构建功能树
- **组件** 是拆细的终点——每个底层功能都有对应的实现方案或约束
- 你是覆盖关系类型最多的 Executor（10 种），因为拆细需要建立最多的连接

## 功能生命周期推进

```
Product Discovery Executor
  └─ status: candidate ──→ status: validated (验证通过)
         │
         ▼
Product Execution Executor ← 你在这里
  ├─ create-prd: 拆细为子功能 + 组件
  ├─ test-scenarios: 添加验收约束
  ├─ sprint-plan: 分配迭代
  │
  └─ status: detailed ← 拆细完成
         │
         ▼
AI Shipping Executor
  └─ 补充技术组件和发布文档
```

## 与上下游的协作

```
Product Discovery Executor    Product Execution Executor          AI Shipping Executor
  │                                   │                                │
  ├─ 功能: 一键复购 (validated)         │                                │
  │                                   │                                │
  │    └─ 产生 ──────────────────→ 拆细为:                              │
  │                            ├─ 子功能: 订单推荐 ──实现──→ 组件: 推荐引擎API
  │                            ├─ 子功能: 复购确认UI ──实现──→ 组件: UI规范
  │                            │                 └─限制──→ 组件: 测试场景
  │                            └─ 子功能: 一键支付  ──实现──→ 组件: 支付封装
  │                                   │                                │
  │                              status: detailed ──────────────────→ 补全技术组件
```

## 版本历史

| 版本 | 日期 | 变更 |
|------|------|------|
| 1.0.0 | 2026-06-21 | 初始版本，含 16 个技能（5 类）、中英文系统提示词 |
