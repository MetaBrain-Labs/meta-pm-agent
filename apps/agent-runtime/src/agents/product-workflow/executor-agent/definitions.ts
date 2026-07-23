/**
 * Executor Agent 职责定义注册表
 *
 * 集中管理十个 Executor Agent 的静态职责配置，并导出稳定的类型守卫与查找函数。
 *
 * Responsibilities:
 * - 定义全部 Executor Agent 的领域、图谱权限和技能
 * - 导出 ExecutorAgentDefinition 与 ExecutorAgentType
 * - 提供类型判断和配置查找
 */

type ExecutorFocusLayer =
  | "Goal"
  | "Requirement"
  | "Evidence"
  | "Decision"
  | "Feature"
  | "Component"
  | "Metric"
  | "Custom";

interface ExecutorAgentProfile {
  agentType: string;
  name: string;
  displayName: string;
  domain: string;
  focusLayer: ExecutorFocusLayer;
  graphRole: string;
  skillSource: string;
  referencePath: string;
  allowedEntityTypes: readonly ExecutorFocusLayer[];
  allowedRelationTypes: readonly string[];
  skills: readonly string[];
  executionGuidelines: readonly string[];
}

/** Executor Agent 的固定职责定义，顺序体现默认图谱细化链路。 */
export const EXECUTOR_DEFINITIONS = [
  {
    agentType: "executor-product-strategy",
    name: "Product Strategy Executor",
    displayName: "Product Strategy Executor",
    domain: "product-strategy",
    focusLayer: "Goal",
    graphRole: "Create and refine Goal, Decision, Requirement, and Evidence entities, establishing the top-level product causal chain.",
    skillSource: "pm-skills/pm-product-strategy/",
    referencePath: "references/executor/product-strategy-executor",
    allowedEntityTypes: ["Goal", "Decision", "Requirement", "Evidence"],
    allowedRelationTypes: ["Composes", "Drives", "Produces", "References", "Validates"],
    skills: [
      "product-vision",
      "product-strategy",
      "business-model",
      "lean-canvas",
      "startup-canvas",
      "ansoff-matrix",
      "swot-analysis",
      "porters-five-forces",
      "pestle-analysis",
      "value-proposition",
      "pricing-strategy",
      "monetization-strategy",
    ],
    executionGuidelines: [
      "Convert top-level business intent into traceable Goal nodes, and split them into sub-goals with Composes relations.",
      "Convert strategy, business model, pricing, monetization, and growth-path choices into Decision nodes.",
      "Convert SWOT, Five Forces, PESTLE, and similar findings into Evidence nodes, and support Decision nodes with References or Validates relations.",
      "Every Decision must be embedded into the goal-to-feature causal chain with Drives, Produces, or References relations.",
      "Never use Drives between two Decision nodes or from Goal directly to Requirement. Use References for decision dependencies and preserve Goal --Drives--> Decision --Produces--> Requirement.",
    ],
  },
  {
    agentType: "executor-market-research",
    name: "Market Research Executor",
    displayName: "Market Research Executor",
    domain: "market-research",
    focusLayer: "Evidence",
    graphRole: "Create and refine Evidence, Requirement, Metric, and Custom research entities to support decisions with factual context.",
    skillSource: "pm-skills/pm-market-research/",
    referencePath: "references/executor/market-research-executor",
    allowedEntityTypes: ["Evidence", "Requirement", "Metric", "Custom"],
    allowedRelationTypes: ["Validates", "References", "Drives", "Composes", "Measures"],
    skills: [
      "competitor-analysis",
      "user-personas",
      "market-sizing",
      "market-segments",
      "customer-journey-map",
      "sentiment-analysis",
      "user-segmentation",
    ],
    executionGuidelines: [
      "Split competitor, market sizing, sentiment, and user-segment findings into independent Evidence nodes.",
      "Extract personas, market segments, and journey pain points into Requirement nodes.",
      "Use Evidence --Validates--> Requirement or Decision for concrete support, and Evidence --References--> Goal only for broader context.",
      "Use Custom nodes for persona details when needed, but connect them to Requirement or Evidence nodes.",
    ],
  },
  {
    agentType: "executor-gtm",
    name: "Go-to-Market Executor",
    displayName: "Go-to-Market Executor",
    domain: "go-to-market",
    focusLayer: "Decision",
    graphRole: "Create and refine Decision, Component, Requirement, Metric, and Evidence entities, translating strategy into go-to-market actions.",
    skillSource: "pm-skills/pm-go-to-market/",
    referencePath: "references/executor/gtm-executor",
    allowedEntityTypes: ["Decision", "Component", "Requirement", "Metric", "Evidence"],
    allowedRelationTypes: ["Drives", "Produces", "Implements", "Constrains", "Measures", "References"],
    skills: [
      "gtm-strategy",
      "beachhead-segment",
      "ideal-customer-profile",
      "gtm-motions",
      "growth-loops",
      "competitive-battlecard",
    ],
    executionGuidelines: [
      "Convert channel, launch cadence, growth flywheel, and milestone choices into Decision nodes.",
      "Convert ICP, beachhead, and customer constraints into Requirement nodes that drive GTM Decision nodes.",
      "Convert GTM motions, channel actions, and messaging strategy into Component nodes.",
      "Use Metric nodes to measure growth loops and GTM actions; do not output standalone marketing documents.",
    ],
  },
  {
    agentType: "executor-product-discovery",
    name: "Product Discovery Executor",
    displayName: "Product Discovery Executor",
    domain: "product-discovery",
    focusLayer: "Requirement",
    graphRole: "Create and refine Requirement, Feature, Evidence, and Metric entities, translating ambiguous intent into testable feature hypotheses.",
    skillSource: "pm-skills/pm-product-discovery/",
    referencePath: "references/executor/product-discovery-executor",
    allowedEntityTypes: ["Requirement", "Feature", "Evidence", "Metric"],
    allowedRelationTypes: ["Drives", "Satisfies", "Composes", "Validates", "References", "Measures"],
    skills: [
      "brainstorm-ideas-existing",
      "brainstorm-ideas-new",
      "brainstorm-experiments-existing",
      "brainstorm-experiments-new",
      "identify-assumptions-existing",
      "identify-assumptions-new",
      "prioritize-assumptions",
      "prioritize-features",
      "opportunity-solution-tree",
      "interview-script",
      "summarize-interview",
      "metrics-dashboard",
      "analyze-feature-requests",
    ],
    executionGuidelines: [
      "Convert opportunities, JTBD, user feedback, and journey pain points into Requirement nodes.",
      "Convert solution ideas and candidate approaches into Feature nodes, and connect them to Requirement nodes with Satisfies relations.",
      "Convert interviews, experiments, and hypothesis analysis into Evidence nodes, and connect them to validation targets with Validates relations.",
      "Use Composes to hierarchically split Requirement or Feature nodes while preserving priority and uncertainty.",
    ],
  },
  {
    agentType: "executor-product-execution",
    name: "Product Execution Executor",
    displayName: "Product Execution Executor",
    domain: "product-execution",
    focusLayer: "Feature",
    graphRole: "Break Feature nodes into sub-features and Components, establishing an implementation hierarchy in the graph.",
    skillSource: "pm-skills/pm-execution/",
    referencePath: "references/executor/product-execution-executor",
    allowedEntityTypes: [
      "Feature",
      "Component",
      "Requirement",
      "Metric",
      "Evidence",
      "Goal",
      "Decision",
      "Custom",
    ],
    allowedRelationTypes: [
      "Composes",
      "Satisfies",
      "Implements",
      "Constrains",
      "Measures",
      "Validates",
      "References",
      "Drives",
      "Produces",
      "Custom",
    ],
    skills: [
      "create-prd",
      "user-stories",
      "job-stories",
      "wwas",
      "sprint-plan",
      "brainstorm-okrs",
      "outcome-roadmap",
      "prioritization-frameworks",
      "test-scenarios",
      "strategy-red-team",
      "pre-mortem",
      "stakeholder-map",
      "summarize-meeting",
      "release-notes",
      "retro",
      "dummy-dataset",
    ],
    executionGuidelines: [
      "Translate PRDs, user stories, job stories, and roadmap content into Feature, Requirement, Decision, or Component nodes.",
      "Use Composes to break down Feature nodes, and connect implementation Component nodes with Implements relations.",
      "Convert acceptance scenarios, risks, retrospectives, and meeting conclusions into Evidence nodes or Component constraints.",
      "Produce graph deltas only; do not generate PRD, release-note, or meeting-minutes document bodies.",
    ],
  },
  {
    agentType: "executor-marketing-growth",
    name: "Marketing Growth Executor",
    displayName: "Marketing Growth Executor",
    domain: "marketing-growth",
    focusLayer: "Metric",
    graphRole: "Create and refine Metric, Decision, and Requirement entities, establishing measurement systems and marketing-growth decision chains.",
    skillSource: "pm-skills/pm-marketing-growth/",
    referencePath: "references/executor/marketing-growth-executor",
    allowedEntityTypes: ["Metric", "Decision", "Requirement"],
    allowedRelationTypes: ["Measures", "Composes", "Drives", "Produces"],
    skills: [
      "north-star-metric",
      "value-prop-statements",
      "positioning-ideas",
      "product-name",
      "marketing-ideas",
    ],
    executionGuidelines: [
      "Convert north-star metrics, input metrics, and growth KPIs into Metric nodes, and connect them to Goal or Requirement nodes with Measures relations.",
      "Convert value propositions, positioning, and marketing ideas into Decision nodes.",
      "Extract Requirement nodes behind value propositions; connect an existing Goal to each growth Decision with Drives, then connect the Decision to its Requirement with Produces.",
      "Do not output finished marketing copy; only record traceable Metric, Decision, and Requirement nodes.",
    ],
  },
  {
    agentType: "executor-data-analytics",
    name: "Data Analytics Executor",
    displayName: "Data Analytics Executor",
    domain: "data-analytics",
    focusLayer: "Evidence",
    graphRole: "Create and refine Metric, Evidence, and Component entities, injecting quantitative analysis results into the knowledge graph.",
    skillSource: "pm-skills/pm-data-analytics/",
    referencePath: "references/executor/data-analytics-executor",
    allowedEntityTypes: ["Evidence", "Metric", "Component"],
    allowedRelationTypes: ["Validates", "Measures", "Implements"],
    skills: ["ab-test-analysis", "cohort-analysis", "sql-queries"],
    executionGuidelines: [
      "Convert A/B test, retention, segmentation, and adoption-trend findings into Evidence nodes.",
      "Convert newly discovered or monitored indicators into Metric nodes, and connect them to goals or requirements with Measures relations.",
      "Convert reusable SQL query definitions into Component nodes, and connect them to the measured Feature with Implements relations.",
      "When data is insufficient, write the gap to open_questions or risks instead of fabricating statistical conclusions.",
    ],
  },
  {
    agentType: "executor-ai-shipping",
    name: "AI Shipping Executor",
    displayName: "AI Shipping Executor",
    domain: "ai-shipping",
    focusLayer: "Component",
    graphRole: "Create and refine Component and Evidence entities, filling in technical specifications, constraints, and implementation gaps.",
    skillSource: "pm-skills/pm-ai-shipping/",
    referencePath: "references/executor/ai-shipping-executor",
    allowedEntityTypes: ["Component", "Evidence"],
    allowedRelationTypes: [
      "Implements",
      "Constrains",
      "Validates",
      "References",
      "Composes",
      "Custom",
    ],
    skills: ["shipping-artifacts", "intended-vs-implemented"],
    executionGuidelines: [
      "Convert architecture, permissions, APIs, variables, workflows, and test-coverage requirements into Component nodes.",
      "Use Component --Implements--> Feature only for feature implementation. Express Component dependencies with References or Custom, and decomposition with parent Component --Composes--> child Component.",
      "Convert expected-versus-actual implementation gaps into Evidence nodes, and connect them to relevant Feature or Component nodes with Validates relations.",
      "When technical facts are unclear, record them as risks or open questions.",
    ],
  },
  {
    agentType: "executor-toolkit",
    name: "Toolkit Executor",
    displayName: "Toolkit Executor",
    domain: "toolkit",
    focusLayer: "Custom",
    graphRole: "Handle auxiliary and compliance artifacts by creating Custom entities and a small number of Component constraint nodes.",
    skillSource: "pm-skills/pm-toolkit/",
    referencePath: "references/executor/toolkit-executor",
    allowedEntityTypes: ["Component", "Custom"],
    allowedRelationTypes: ["Constrains", "Custom", "References"],
    skills: ["privacy-policy", "draft-nda", "grammar-check", "review-resume"],
    executionGuidelines: [
      "Keep each update compact: create at most 4 combined Component and Custom nodes and at most 6 relations unless the assigned task explicitly requires more.",
      "Convert privacy and compliance constraints into Component nodes, and connect them to relevant Feature nodes with Constrains relations.",
      "Convert auxiliary content such as NDAs or talent evaluations into Custom nodes, and use Custom or References relations to explain context.",
      "For grammar-review tasks, improve existing node description quality only; do not create unrelated main-flow nodes.",
      "Keep auxiliary content loosely coupled from the main product-design chain.",
    ],
  },
  {
    agentType: "executor-interface-craft",
    name: "Interface Craft Executor",
    displayName: "Interface Craft Executor",
    domain: "interface-craft",
    focusLayer: "Component",
    graphRole: "Review UI-related Component nodes, fill in craft constraints, and record evidence for anti-pattern detection.",
    skillSource: "references/impeccable/",
    referencePath: "references/executor/interface-craft-executor",
    allowedEntityTypes: ["Component", "Evidence"],
    allowedRelationTypes: ["Constrains", "Implements", "Validates"],
    skills: [
      "shape",
      "layout",
      "craft",
      "bolder",
      "quieter",
      "animate",
      "delight",
      "colorize",
      "audit",
      "harden",
      "polish",
      "critique",
      "codex",
    ],
    executionGuidelines: [
      "Convert layout, interaction, design-token, motion, robustness, and visual standards into UI Component nodes.",
      "Convert accessibility, performance, theming, anti-pattern, and design-review findings into Evidence nodes.",
      "Connect UI Component nodes with Constrains, Implements, or Validates relations; do not create main-flow Goal, Requirement, or Decision nodes.",
      "Handle only interface quality and craft; do not output platform adaptation notes or standalone UI audit documents.",
    ],
  },
] as const satisfies readonly ExecutorAgentProfile[];

export type ExecutorAgentDefinition = (typeof EXECUTOR_DEFINITIONS)[number];

/**
 * 可被 Planner 分配任务的 Executor Agent 类型。
 */
export type ExecutorAgentType = ExecutorAgentDefinition["agentType"];

/**
 * 判断给定 Agent 类型是否属于 10 个 Executor Agent。
 */
export function isExecutorAgentType(value: string): value is ExecutorAgentType {
  return EXECUTOR_DEFINITIONS.some((item) => item.agentType === value);
}

/**
 * 获取 Executor Agent 的职责定义。
 */
export function getExecutorDefinition(
  agentType: ExecutorAgentType,
): ExecutorAgentDefinition {
  return EXECUTOR_DEFINITIONS.find((item) => item.agentType === agentType)!;
}

/**
 * 将所有 Executor Agent 类型拼成提示词可读的枚举文本。
 */
export function formatExecutorAgentTypeList(): string {
  return EXECUTOR_DEFINITIONS.map((item) => item.agentType).join(", ");
}
