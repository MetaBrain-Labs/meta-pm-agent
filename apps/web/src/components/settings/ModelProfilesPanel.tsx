/**
 * 模型使用列表设置面板
 *
 * 展示内置默认与本地自定义列表，并提供分类配置/通用模型双 Tab 编辑器。
 *
 * Responsibilities:
 * - 加载与维护本地模型列表
 * - 编辑每个模型的标识、名称、地址和高级参数
 * - 配置 Chat 与 Document 工作流的 Agent 职责映射
 *
 * Notes:
 * - thinking 固定开启；temperature/topP 仅保存展示，不参与思考模式请求
 */

import { useCallback, useEffect, useState } from "react";
import {
  Button,
  Collapse,
  Empty,
  Input,
  InputNumber,
  Modal,
  Popconfirm,
  Select,
  Space,
  Switch,
  Tabs,
  Typography,
  message,
} from "antd";
import {
  DeleteOutlined,
  EditOutlined,
  InfoCircleOutlined,
  LockOutlined,
  PlusOutlined,
} from "@ant-design/icons";
import {
  createModelProfile,
  deleteModelProfile,
  fetchModelProfiles,
  updateModelProfile,
} from "../../api/chat-api";
import type {
  AgentModelGroup,
  DeepSeekModelConfig,
  ModelTier,
  ModelUsageProfile,
} from "../../types";

const TIER_LABELS: Record<ModelTier, string> = {
  reasoning: "强推理模型",
  standard: "普通模型",
  fast: "快速模型",
};
const GROUP_LABELS: Record<AgentModelGroup, string> = {
  conversation: "Conversation",
  "pre-orchestrator": "Pre-Orchestrator",
  request: "Request",
  orchestrator: "Orchestrator",
  planner: "Planner",
  executors: "全部 Executors",
  critique: "Critique",
  document: "Document",
};
const GROUPS = Object.keys(GROUP_LABELS) as AgentModelGroup[];

/** 创建可编辑模型默认值。 */
function createModel(
  modelId: DeepSeekModelConfig["modelId"],
  effort: DeepSeekModelConfig["reasoningEffort"],
  maxTokens: number,
): DeepSeekModelConfig {
  return {
    provider: "deepseek",
    modelId,
    customName: "DeepSeek Flash",
    baseUrl: "https://api.deepseek.com",
    thinking: true,
    temperature: 1,
    topP: 1,
    maxTokens,
    reasoningEffort: effort,
    pricing: {
      cacheHitInputPricePerMillion: 0.04,
      cacheMissInputPricePerMillion: 2,
      outputPricePerMillion: 8,
    },
  };
}

/** 创建新列表的分类配置初值。 */
function createDraftProfile(): ModelUsageProfile {
  return {
    id: "draft",
    name: "新模型使用列表",
    isSystem: false,
    config: {
      mode: "tiered",
      models: {
        reasoning: createModel("deepseek-flash", "max", 65_536),
        standard: createModel("deepseek-flash", "high", 16_384),
        fast: createModel("deepseek-flash", "low", 4_096),
      },
      assignments: {
        conversation: "fast",
        "pre-orchestrator": "fast",
        request: "standard",
        orchestrator: "reasoning",
        planner: "reasoning",
        executors: "standard",
        critique: "reasoning",
        document: "reasoning",
      },
    },
  };
}

/** 本地模型列表设置主面板。 */
export function ModelProfilesPanel() {
  const [profiles, setProfiles] = useState<ModelUsageProfile[]>([]);
  const [loading, setLoading] = useState(true);
  const [draft, setDraft] = useState<ModelUsageProfile | null>(null);
  const [saving, setSaving] = useState(false);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      setProfiles((await fetchModelProfiles()).profiles);
    } catch (error) {
      message.error("模型使用列表加载失败，请确认已手动执行建表 SQL");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => void reload(), [reload]);

  const save = async () => {
    if (!draft?.name.trim()) return message.warning("请输入列表名称");
    setSaving(true);
    try {
      const input = { name: draft.name.trim(), config: draft.config };
      if (draft.id === "draft") await createModelProfile(input);
      else await updateModelProfile(draft.id, input);
      setDraft(null);
      await reload();
      window.dispatchEvent(new Event("model-profiles-changed"));
      message.success("模型使用列表已保存");
    } catch {
      message.error("保存失败：请检查名称是否重复及参数范围");
    } finally {
      setSaving(false);
    }
  };

  const remove = async (id: string) => {
    try {
      await deleteModelProfile(id);
      await reload();
      window.dispatchEvent(new Event("model-profiles-changed"));
      message.success("列表已删除，相关会话将自动回退内置默认");
    } catch {
      message.error("删除失败");
    }
  };

  return (
    <div className="profile-list">
      {/*
        API Key 说明是信息性提示，用中性信息条而不是高对比长条。
      */}
      <p className="profile-notice">
        <InfoCircleOutlined aria-hidden="true" />
        API Key 始终从服务端 OPENAI_API_KEY 读取，不会保存或展示在这里。
      </p>

      <div className="profile-list-head">
        <p className="profile-list-desc">
          Chat 产品工作流按会话选择列表；Document 工作流在每次生成前选择列表。
        </p>
        <Button
          type="primary"
          icon={<PlusOutlined />}
          onClick={() => setDraft(createDraftProfile())}
        >
          新建列表
        </Button>
      </div>

      {!loading && profiles.length === 0 ? <Empty /> : null}

      {/*
        列表项用细边框表面承载，标题行为「名称 + 类型标记」，操作在右侧；
        不再使用 Card 套 Tag 套内容的三层结构。
      */}
      {profiles.length > 0 && (
        <ul className="profile-items">
          {profiles.map((profile) => (
            <li key={profile.id} className="profile-item">
              <div className="profile-item-head">
                <span className="profile-item-name">{profile.name}</span>
                <span className="profile-badge" data-tone="muted">
                  {profile.config.mode === "tiered" ? "分类配置" : "通用模型"}
                </span>
                {profile.isSystem && (
                  <span className="profile-badge" data-tone="locked">
                    <LockOutlined aria-hidden="true" />
                    内置
                  </span>
                )}
                {!profile.isSystem && (
                  <div className="profile-item-actions">
                    <Button
                      size="small"
                      type="text"
                      icon={<EditOutlined />}
                      onClick={() => setDraft(structuredClone(profile))}
                    >
                      编辑
                    </Button>
                    <Popconfirm
                      title="删除后相关会话将回退内置默认，确认删除？"
                      okButtonProps={{ danger: true }}
                      onConfirm={() => void remove(profile.id)}
                    >
                      {/* 浏览态用轻量危险文字按钮，确认步骤再强化危险感知。 */}
                      <Button size="small" type="text" danger icon={<DeleteOutlined />}>
                        删除
                      </Button>
                    </Popconfirm>
                  </div>
                )}
              </div>
              <ProfileSummary profile={profile} />
            </li>
          ))}
        </ul>
      )}
      <Modal
        open={Boolean(draft)}
        title={draft?.id === "draft" ? "新建模型使用列表" : "编辑模型使用列表"}
        width={960}
        confirmLoading={saving}
        onOk={() => void save()}
        onCancel={() => setDraft(null)}
        destroyOnHidden
        styles={{
          body: {
            height: "68vh",
            overflowY: "auto",
            paddingRight: 8,
          },
        }}
      >
        {draft ? <ProfileEditor profile={draft} onChange={setDraft} /> : null}
      </Modal>
    </div>
  );
}

/** 渲染列表中的模型组成摘要。 */
function ProfileSummary({ profile }: { profile: ModelUsageProfile }) {
  const entries =
    profile.config.mode === "universal"
      ? [["全部 Agent", profile.config.model] as const]
      : (
          Object.entries(profile.config.models) as Array<
            [ModelTier, DeepSeekModelConfig]
          >
        ).map(([tier, model]) => [TIER_LABELS[tier], model] as const);
  /*
   * 摘要用「次级文字 + 元信息」两级排版，不用一排 Tag：
   * 模型名是这一行里最需要被读到的信息，effort 与上限属于元信息。
   */
  return (
    <dl className="profile-summary">
      {entries.map(([label, model]) => (
        <div key={label}>
          <dt>{label}</dt>
          <dd>
            <span className="profile-summary-model">{model.customName}</span>
            <span className="profile-summary-meta">
              {model.reasoningEffort} · {model.maxTokens.toLocaleString()} tokens
            </span>
          </dd>
        </div>
      ))}
    </dl>
  );
}

/** 编辑列表名称、模式、模型和高级职责映射。 */
function ProfileEditor({
  profile,
  onChange,
}: {
  profile: ModelUsageProfile;
  onChange: (profile: ModelUsageProfile) => void;
}) {
  const setConfig = (config: ModelUsageProfile["config"]) =>
    onChange({ ...profile, config });
  const changeMode = (mode: string) => {
    if (mode === profile.config.mode) return;
    if (mode === "universal") {
      const model =
        profile.config.mode === "tiered"
          ? profile.config.models.reasoning
          : profile.config.model;
      setConfig({ mode: "universal", model });
    } else {
      const model =
        profile.config.mode === "universal"
          ? profile.config.model
          : profile.config.models.reasoning;
      const fresh = createDraftProfile().config;
      if (fresh.mode === "tiered")
        setConfig({
          ...fresh,
          models: {
            reasoning: model,
            standard: structuredClone(model),
            fast: structuredClone(model),
          },
        });
    }
  };
  return (
    <div className="flex flex-col gap-4 pt-2">
      <label className="flex flex-col gap-1">
        <Typography.Text strong>列表名称</Typography.Text>
        <Input
          value={profile.name}
          maxLength={80}
          onChange={(event) =>
            onChange({ ...profile, name: event.target.value })
          }
        />
      </label>
      <Tabs
        activeKey={profile.config.mode}
        onChange={changeMode}
        items={[
          {
            key: "tiered",
            label: "分类配置",
            children:
              profile.config.mode === "tiered" ? (
                <TieredEditor config={profile.config} onChange={setConfig} />
              ) : null,
          },
          {
            key: "universal",
            label: "通用模型",
            children:
              profile.config.mode === "universal" ? (
                <ModelEditor
                  model={profile.config.model}
                  onChange={(model) => setConfig({ mode: "universal", model })}
                />
              ) : null,
          },
        ]}
      />
    </div>
  );
}

/** 分类模式三个必填用途及高级职责映射。 */
function TieredEditor({
  config,
  onChange,
}: {
  config: Extract<ModelUsageProfile["config"], { mode: "tiered" }>;
  onChange: (config: ModelUsageProfile["config"]) => void;
}) {
  return (
    <div className="profile-tier-list">
      {/* 档位用「标题 + 细分隔线」分区，不再一层 Card 套一层表单。 */}
      {(Object.keys(TIER_LABELS) as ModelTier[]).map((tier) => (
        <section key={tier} className="profile-tier">
          <h4>{TIER_LABELS[tier]}</h4>
          <ModelEditor
            model={config.models[tier]}
            onChange={(model) =>
              onChange({
                ...config,
                models: { ...config.models, [tier]: model },
              })
            }
          />
        </section>
      ))}
      <Collapse
        items={[
          {
            key: "mapping",
            label: "高级设置：Agent 职责映射",
            children: (
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                {GROUPS.map((group) => (
                  <label
                    key={group}
                    className="flex items-center justify-between gap-3"
                  >
                    <span>{GROUP_LABELS[group]}</span>
                    <Select
                      value={config.assignments[group]}
                      className="w-40"
                      options={(Object.keys(TIER_LABELS) as ModelTier[]).map(
                        (tier) => ({ value: tier, label: TIER_LABELS[tier] }),
                      )}
                      onChange={(tier) =>
                        onChange({
                          ...config,
                          assignments: { ...config.assignments, [group]: tier },
                        })
                      }
                    />
                  </label>
                ))}
              </div>
            ),
          },
        ]}
      />
    </div>
  );
}

/** 单模型基础字段与高级参数编辑器。 */
function ModelEditor({
  model,
  onChange,
}: {
  model: DeepSeekModelConfig;
  onChange: (model: DeepSeekModelConfig) => void;
}) {
  const patch = (value: Partial<DeepSeekModelConfig>) =>
    onChange({ ...model, ...value });
  const numberField = (
    value: number,
    key: keyof DeepSeekModelConfig,
    min: number,
    max: number,
  ) => (
    <InputNumber
      className="w-32"
      value={value}
      min={min}
      max={max}
      onChange={(next) => typeof next === "number" && patch({ [key]: next })}
    />
  );
  return (
    <div className="flex flex-col gap-3">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <label className="flex flex-col gap-1.5">
          模型类型
          <Select
            className="w-full"
            value={model.modelId}
            options={[{ value: "deepseek-flash", label: "DeepSeek Flash" }]}
            onChange={(modelId) => patch({ modelId })}
          />
        </label>
        <label className="flex flex-col gap-1.5">
          自定义名称
          <Input
            value={model.customName}
            maxLength={64}
            onChange={(event) => patch({ customName: event.target.value })}
          />
        </label>
      </div>
      <label className="flex flex-col gap-1.5">
        Base URL
        <Input
          value={model.baseUrl}
          onChange={(event) => patch({ baseUrl: event.target.value })}
        />
      </label>
      <Collapse
        items={[
          {
            key: "advanced",
            label: "高级设置",
            children: (
              <div className="flex flex-col gap-3">
                {/* 这是说明而非告警：用中性信息条，不用整块 warning 底色。 */}
                <p className="profile-notice">
                  <InfoCircleOutlined aria-hidden="true" />
                  思考模式固定开启；DeepSeek 思考模式会忽略 temperature 和
                  topP，因此两项当前仅保存和展示。
                </p>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  <label className="flex min-h-14 items-center justify-between gap-4 rounded-md border border-black/10 px-3">
                    thinking
                    <Switch checked disabled />
                  </label>
                  <label className="flex min-h-14 items-center justify-between gap-4 rounded-md border border-black/10 px-3">
                    temperature
                    {numberField(model.temperature, "temperature", 0, 2)}
                  </label>
                  <label className="flex min-h-14 items-center justify-between gap-4 rounded-md border border-black/10 px-3">
                    topP{numberField(model.topP, "topP", 0, 1)}
                  </label>
                  <label className="flex min-h-14 items-center justify-between gap-4 rounded-md border border-black/10 px-3">
                    maxTokens
                    {numberField(model.maxTokens, "maxTokens", 1, 393216)}
                  </label>
                  <label className="flex min-h-14 items-center justify-between gap-4 rounded-md border border-black/10 px-3">
                    reasoning effort
                    <Select
                      className="w-32"
                      value={model.reasoningEffort}
                      options={(["low", "high", "max"] as const).map(
                        (value) => ({ value, label: value }),
                      )}
                      onChange={(reasoningEffort) => patch({ reasoningEffort })}
                    />
                  </label>
                </div>
                <Typography.Text strong>
                  人民币 / 百万 Token（高峰价估算快照，实际账单以服务商为准）
                </Typography.Text>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                  <label className="flex min-h-14 items-center justify-between gap-4 rounded-md border border-black/10 px-3">
                    缓存命中输入
                    <InputNumber
                      className="w-32"
                      min={0}
                      value={model.pricing.cacheHitInputPricePerMillion}
                      onChange={(value) =>
                        typeof value === "number" &&
                        patch({
                          pricing: {
                            ...model.pricing,
                            cacheHitInputPricePerMillion: value,
                          },
                        })
                      }
                    />
                  </label>
                  <label className="flex min-h-14 items-center justify-between gap-4 rounded-md border border-black/10 px-3">
                    缓存未命中输入
                    <InputNumber
                      className="w-32"
                      min={0}
                      value={model.pricing.cacheMissInputPricePerMillion}
                      onChange={(value) =>
                        typeof value === "number" &&
                        patch({
                          pricing: {
                            ...model.pricing,
                            cacheMissInputPricePerMillion: value,
                          },
                        })
                      }
                    />
                  </label>
                  <label className="flex min-h-14 items-center justify-between gap-4 rounded-md border border-black/10 px-3">
                    输出
                    <InputNumber
                      className="w-32"
                      min={0}
                      value={model.pricing.outputPricePerMillion}
                      onChange={(value) =>
                        typeof value === "number" &&
                        patch({
                          pricing: {
                            ...model.pricing,
                            outputPricePerMillion: value,
                          },
                        })
                      }
                    />
                  </label>
                </div>
              </div>
            ),
          },
        ]}
      />
    </div>
  );
}
