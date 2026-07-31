/**
 * Chat 模型使用列表选择器
 *
 * 在两个响应式 Composer 中复用，展示列表模式、模型组成与完整配置详情。
 *
 * Responsibilities:
 * - 渲染当前会话模型列表
 * - 在下拉菜单展示每个用途的参数和价格
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
      <span className="max-w-40 truncate">{selected?.name ?? "模型列表加载中"}</span>
      <DownOutlined />
    </Button>
  );

  return (
    <Tooltip title={disabled ? "运行中不可切换；请在 HITL、完成或其他非运行状态切换" : undefined}>
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
