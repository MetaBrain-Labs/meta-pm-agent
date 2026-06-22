# Marketing Growth Executor

## 概述

Marketing Growth Executor（营销增长执行器）是产品设计知识图谱系统中负责衡量体系与营销增长决策层的 Agent。它创建和细化知识图谱中的"指标"和"决策"实体，建立北极星衡量体系，将产品战略转化为营销增长决策。

## 目录结构

```
marketing-growth-executor/
├── executor.json              # Executor 配置文件
├── README.md                  # 本文件
├── prompts/
│   ├── system_prompt_cn.md    # 中文系统提示词
│   └── system_prompt_en.md    # English system prompt
└── skills/                    # 5 个内建技能（2 类）
    ├── north-star-metric/     # 衡量体系
    ├── value-prop-statements/ #   同上
    ├── positioning-ideas/     # 营销增长决策
    ├── product-name/          #   同上
    └── marketing-ideas/       #   同上
```

## 快速开始

### 输入

```json
{
  "task_id": "task-001",
  "description": "为产品建立北极星衡量体系并制定定位策略",
  "graph_context": {
    "nodes": [
      {"id": "G1", "type": "目标", "description": "提升 GMV 20%"},
      {"id": "N1", "type": "需求", "description": "开发者在寻找快速上线方案"},
      {"id": "E1", "type": "依据", "description": "竞品A定价分析"}
    ],
    "edges": []
  }
}
```

## 技能列表

### 第一类：衡量体系

| 技能 | 创建实体 | 主要关系 |
|------|---------|---------|
| north-star-metric | 指标 | 衡量、构成 |
| value-prop-statements | 需求 | 驱动 |

### 第二类：营销增长决策

| 技能 | 创建实体 | 主要关系 |
|------|---------|---------|
| positioning-ideas | 决策 | 驱动、引用 |
| product-name | 决策 | — |
| marketing-ideas | 决策 | 产生、驱动 |

## 与知识图谱的关系

```
指标 ──衡量──→ 目标
指标 ──衡量──→ 需求
指标 ──构成──→ 子指标（北极星 + 输入指标树）

需求 ──驱动──→ 决策 ──产生──→ 功能（营销增长决策）
```

- **指标** 是衡量体系核心——定义所有目标和需求的可量化成功标准
- **决策** 是增长方向——定位、命名、营销活动的战略选择
- 你是系统中唯一专注于"指标"实体创建的 Executor

## 与其他 Executor 的对比

| 维度 | Strategy | Research | GTM | Discovery | Execution | **Marketing** |
|------|:--:|:--:|:--:|:--:|:--:|:--:|
| 技能 | 12 | 7 | 6 | 13 | 16 | **5** |
| 核心实体 | 目标+决策 | 依据+需求 | 决策+组件 | 需求+功能+依据 | 功能+组件 | **指标+决策** |
| 关系种类 | 7 | 5 | 8 | 7 | 10 | **6** |
| 标志性关系 | 驱动、产生 | 验证、引用 | 驱动、实现 | 满足、验证 | 构成、实现 | **衡量、构成** |

## 版本历史

| 版本 | 日期 | 变更 |
|------|------|------|
| 1.0.0 | 2026-06-21 | 初始版本，含 5 个技能（2 类）、中英文系统提示词 |
