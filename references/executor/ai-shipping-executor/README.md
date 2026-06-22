# AI Shipping Executor

## 概述

AI Shipping Executor（AI 交付执行器）是产品设计知识图谱系统中负责技术规范与安全审计层的 Agent——产品设计因果链的最后一道质量防线。它补全实现层图谱中遗漏的技术规范组件，并通过预期 vs 实现的比对审计发现设计意图与代码实现之间的差异。

## 目录结构

```
ai-shipping-executor/
├── executor.json              # Executor 配置文件
├── README.md                  # 本文件
├── prompts/
│   ├── system_prompt_cn.md    # 中文系统提示词
│   └── system_prompt_en.md    # English system prompt
└── skills/                    # 2 个内建技能
    ├── shipping-artifacts/    # 交付制品（技术规范补全）
    └── intended-vs-implemented/# 预期 vs 实现审计
```

## 快速开始

### 输入

```json
{
  "task_id": "task-001",
  "description": "补全产品功能的技术规范组件并进行预期vs实现审计",
  "graph_context": {
    "nodes": [
      {"id": "F1", "type": "功能", "description": "一键复购：用户点击即可重购上月商品"},
      {"id": "C1", "type": "组件", "description": "Stripe Checkout API 封装"}
    ],
    "edges": [{"relation": "实现", "from_node_id": "C1", "to_node_id": "F1"}]
  },
  "code_sources": ["/src/payment/"]
}
```

## 技能列表

| 技能 | 创建实体 | 主要关系 | 方向 |
|------|---------|---------|------|
| shipping-artifacts | 组件、依据 | 限制、实现、验证 | 正向：图谱→补充规范 |
| intended-vs-implemented | 依据 | 验证 | 反向：代码→验证图谱 |

## 与知识图谱的关系

```
正向（技术规范补全）：
  功能 ──限制──→ 组件: 权限角色定义
  功能 ──限制──→ 组件: 环境变量清单
  功能 ──实现──→ 组件: 接口规范

反向（预期 vs 实现审计）：
  依据: 差异发现 ──验证──→ 功能
  依据: 差异发现 ──验证──→ 组件
```

## 差异严重程度分类

| 分类 | 条件 | severity |
|------|------|---------|
| boundary-crossing | 跨越信任/数据/金钱/租户边界 | critical |
| non-boundary-crossing | 差异存在但不跨越上述边界 | warning |
| undocumented-but-enforced | 代码有约束但未文档化 | low |
| cosmetic | 纯描述差异，无安全/数据影响 | info |

## 八个 Executor 完备对比

| 维度 | Strategy | Research | GTM | Discovery | Execution | Marketing | Analytics | **Shipping** |
|------|:--:|:--:|:--:|:--:|:--:|:--:|:--:|:--:|
| 技能 | 12 | 7 | 6 | 13 | 16 | 5 | 3 | **2** |
| 核心实体 | 目标+决策 | 依据+需求 | 决策+组件 | 需求+功能+依据 | 功能+组件 | 指标+决策 | 依据+指标+组件 | **组件+依据** |
| 关系 | 7 | 5 | 8 | 7 | 10 | 6 | 5 | **3** |
| 标志性 | 驱动、产生 | 验证、引用 | 驱动、实现 | 满足、验证 | 构成、实现 | 衡量、构成 | 验证、实现 | **限制、验证** |
| 外部依赖 | — | web search | web search | web search | — | — | 数据文件 | **代码目录** |
| 特殊性 | 战略起点 | 事实基础 | 策略枢纽 | 功能映射 | 拆细 | 衡量体系 | 数据验证 | **质量守门员** |

## 版本历史

| 版本 | 日期 | 变更 |
|------|------|------|
| 1.0.0 | 2026-06-21 | 初始版本，含 2 个技能、中英文系统提示词 |
