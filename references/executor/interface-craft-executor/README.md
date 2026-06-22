# Interface Craft Executor

## 概述

Interface Craft Executor（界面工艺执行器）是产品设计知识图谱系统中负责 UI 实现质量层的 Agent——位于产品设计因果链的侧翼。它对图谱中 UI 相关的"组件"节点进行质量审视、工艺补全和反模式检测，是唯一具备 AI 代码反模式检测能力的 Executor。

## 目录结构

```
interface-craft-executor/
├── executor.json              # Executor 配置文件
├── README.md                  # 本文件
├── prompts/
│   ├── system_prompt_cn.md    # 中文系统提示词
│   └── system_prompt_en.md    # English system prompt
└── skills/                    # 13 个内建技能（4 类）
    ├── shape/                 # 设计规划
    ├── layout/                #   同上
    ├── craft/                 # 视觉实现
    ├── bolder/                #   同上
    ├── quieter/               #   同上
    ├── animate/               #   同上
    ├── delight/               #   同上
    ├── colorize/              #   同上
    ├── audit/                 # 质量保障
    ├── harden/                #   同上
    ├── polish/                #   同上
    ├── critique/              #   同上
    └── codex/                 # 反模式检测
```

## 快速开始

### 输入

```json
{
  "task_id": "task-001",
  "description": "对"一键复购模块"的前端实现进行完整质量审查",
  "graph_context": {
    "nodes": [
      {"id": "F1", "type": "功能", "description": "一键复购模块"},
      {"id": "C1", "type": "组件", "description": "复购入口 UI 规范"}
    ],
    "edges": [{"relation": "实现", "from_node_id": "C1", "to_node_id": "F1"}]
  },
  "code_sources": ["/src/pages/reorder/"]
}
```

## 技能列表

### 第一类：设计规划

| 技能 | 创建实体 | 主要关系 | 需要 CODE_SOURCES |
|------|---------|---------|:--:|
| shape | 组件、依据 | 限制、引用 | 否 |
| layout | 组件、依据 | 限制、引用 | 否 |

### 第二类：视觉实现

| 技能 | 创建实体 | 主要关系 | 需要 CODE_SOURCES |
|------|---------|---------|:--:|
| craft | 组件、依据 | 实现、限制 | 是 |
| bolder | 依据 | MODIFY_NODE | 是 |
| quieter | 依据 | MODIFY_NODE | 是 |
| animate | 组件 | 实现 | 否 |
| delight | 组件 | 实现 | 否 |
| colorize | 组件、依据 | 实现 | 否 |

### 第三类：质量保障

| 技能 | 创建实体 | 主要关系 | 需要 CODE_SOURCES |
|------|---------|---------|:--:|
| audit | 依据 | 验证 | 是 |
| harden | 组件、依据 | 限制、验证 | 否 |
| polish | 依据 | 验证 + MODIFY_NODE | 是 |
| critique | 依据 | 验证 | 是 |

### 第四类：反模式检测

| 技能 | 创建实体 | 主要关系 | 需要 CODE_SOURCES |
|------|---------|---------|:--:|
| codex | 依据 | 验证 | 是 |

## 与知识图谱的关系

本 Executor 位于产品设计因果链的侧翼，不创建主链路实体：

```
正向（UI 规范注入）：
  功能 ──限制──→ 组件: 设计令牌 / 交互规范 / 布局规则 / 鲁棒性约束

反向（质量审视）：
  依据: 审计 / 反模式 / 评审 ──验证──→ 组件
```

- **不创建目标/需求/决策/功能**：仅围绕已有组件进行质量注入
- **13 项 AI 反模式检测**：侧边条纹边框、毛玻璃默认、梯度文字、hero-metric 模板等
- **5 维度审计评分**：A11y / Performance / Theming / Markup / Correctness（各 0-4 分）

## 十个 Executor 完备对比

| 维度 | Strategy | Research | GTM | Discovery | Execution | Marketing | Analytics | Shipping | Toolkit | **Interface** |
|------|:--:|:--:|:--:|:--:|:--:|:--:|:--:|:--:|:--:|:--:|
| 技能 | 12 | 7 | 6 | 13 | 16 | 5 | 3 | 2 | 4 | **13** |
| 核心实体 | 目标+决策 | 依据+需求 | 决策+组件 | 需求+功能+依据 | 功能+组件 | 指标+决策 | 依据+指标+组件 | 组件+依据 | 组件+自定义 | **组件+依据** |
| 关系 | 7 | 5 | 8 | 7 | 10 | 6 | 5 | 3 | 2 | **4** |
| 外部依赖 | — | web search | web search | web search | — | — | 数据文件 | 代码目录 | — | **代码+设计文件** |
| 主链路 | 是(起点) | 是 | 是 | 是 | 是 | 是 | 是 | 是(终点) | 部分 | **辅助(侧翼)** |
| 特殊性 | 战略起点 | 事实基础 | 策略枢纽 | 功能映射 | 拆细 | 衡量体系 | 数据验证 | 质量守门员 | 超链外工具 | **UI质量+反模式** |

## 版本历史

| 版本 | 日期 | 变更 |
|------|------|------|
| 1.0.0 | 2026-06-21 | 初始版本，含 13 个技能（4 类）、中英文系统提示词；技能源自 impeccable v3.7.1 |
