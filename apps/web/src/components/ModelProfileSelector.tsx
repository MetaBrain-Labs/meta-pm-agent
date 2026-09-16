/**
 * 工作流模型使用列表选择器
 *
 * 供 Chat Composer 与 Document 页面复用，展示列表模式、模型组成与关键配置。
 *
 * Responsibilities:
 * - 渲染当前工作流选择的模型列表
 * - 在下拉菜单展示每个用途的模型、推理力度和最大输出
 * - 运行态禁用选择并解释切换时机
 */

import { Button, Dropdown, Tag, Tooltip } from "antd";
import { DownOutlined } from "@ant-design/icons";
import type {
  DeepSeekModelConfig,
  ModelTier,
  ModelUsageProfile,
} from "../types";

const TIER_LABELS: Record<ModelTier, string> = {
  reasoning: "强推理",
  standard: "普通",
  fast: "快速",
};

interface ModelProfileSelectorProps {
  profiles: ModelUsageProfile[];
  selectedProfileId: string;
  disabled: boolean;
  onChange: (profileId: string) => void;
}

/** 渲染可切换的模型列表及其配置详情。 */
export function ModelProfileSelector({
  profiles,
  selectedProfileId,
  disabled,
  onChange,
}: ModelProfileSelectorProps) {
  const selected =
    profiles.find((profile) => profile.id === selectedProfileId) ?? profiles[0];
  const button = (
    <Button size="small" type="text" disabled={disabled}>
      <span className="max-w-40 truncate">{getProfileLabel(selected)}</span>
      <DownOutlined />
    </Button>
  );

  return (
    <Tooltip title={disabled ? "运行中不可切换；请等待当前任务暂停或结束" : undefined}>
      <span>
        <Dropdown
          disabled={disabled || profiles.length === 0}
          trigger={["click"]}
          menu={{
            selectedKeys: [selectedProfileId],
            onClick: ({ key }) => onChange(key),
            items: profiles.map((profile) => ({
              key: profile.id,
              label: <ProfileMenuItem profile={profile} />,
            })),
          }}
        >
          {button}
        </Dropdown>
      </span>
    </Tooltip>
  );
}

/**
 * 触发器上显示的名称。
 *
 * 优先展示当前实际使用的模型名（例如「Flash」）；配置里没有具体模型时才回退到
 * 列表名称。列表名可能带有「内置默认模型列表」这类实现导向的描述，不适合作为
 * 输入区的主要文案。
 */
function getProfileLabel(profile?: ModelUsageProfile): string {
  if (!profile) return "模型列表加载中";
  if (profile.config.mode === "universal") {
    return profile.config.model.customName || profile.name;
  }
  // 分类配置下各档位可能是同一模型，此时模型名比列表名更有信息量。
  const names = new Set(
    Object.values(profile.config.models).map((model) => model.customName),
  );
  return names.size === 1 ? [...names][0]! : profile.name;
}

/** 下拉列表中的模式、组成和参数详情。 */
function ProfileMenuItem({ profile }: { profile: ModelUsageProfile }) {
  const entries = profile.config.mode === "universal"
    ? [["全部 Agent", profile.config.model] as const]
    : (Object.entries(profile.config.models) as Array<
        [ModelTier, DeepSeekModelConfig]
      >).map(([tier, model]) => [TIER_LABELS[tier], model] as const);
  return (
    <div className="w-[min(26rem,78vw)] py-1">
      <div className="mb-2 flex items-center gap-2">
        <span className="font-semibold">{profile.name}</span>
        <Tag bordered={false}>{profile.config.mode === "tiered" ? "分类配置" : "通用模型"}</Tag>
      </div>
      <div>
        {entries.map(([label, model]) => (
          <div key={label} className="grid grid-cols-[4.5rem_minmax(0,1fr)] gap-2 border-t border-black/5 py-2 text-xs first:border-t-0">
            <span className="text-gray-500">{label}</span>
            <div className="min-w-0">
              <div className="truncate font-medium">{model.customName}</div>
              <div className="truncate text-gray-500">
                {model.modelId} · {model.reasoningEffort} · {model.maxTokens.toLocaleString()} tokens
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
