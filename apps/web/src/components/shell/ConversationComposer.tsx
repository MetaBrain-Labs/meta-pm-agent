/**
 * 对话输入区
 *
 * 渲染固定在对话栏底部的输入框、联网搜索开关、知识图谱入口、模型选择和
 * 发送/停止操作。组件只收集输入，不负责请求序列化、SSE 订阅或消息持久化。
 *
 * Responsibilities:
 * - 受控展示输入文本并支持 Enter 发送、Shift+Enter 换行
 * - 透传联网搜索、知识图谱、模型选择和停止操作
 * - 在运行中把发送按钮替换为停止按钮
 *
 * Notes:
 * - 用户输入草稿由调用方持有，本组件不缓存文本。
 * - 提交动作统一走 onSubmit 回调，避免与重试等命令混淆。
 */

import type { FormEvent, KeyboardEvent } from "react";
import { Button, Input, Tooltip } from "antd";
import {
  ApartmentOutlined,
  PartitionOutlined,
  SearchOutlined,
  SendOutlined,
  StopOutlined,
} from "@ant-design/icons";
import { ModelProfileSelector } from "../ModelProfileSelector";
import type { ModelUsageProfile } from "../../types";

const { TextArea } = Input;

interface Props {
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
  isLoading: boolean;
  disabledReason?: string | null;
  webSearchEnabled: boolean;
  onToggleWebSearch: () => void;
  knowledgeGraphEnabled: boolean;
  knowledgeGraphLoading: boolean;
  knowledgeGraphHint: string;
  onOpenKnowledgeGraph: () => void;
  onOpenLangGraph: () => void;
  modelProfiles: ModelUsageProfile[];
  selectedModelProfileId: string;
  onModelProfileChange: (profileId: string) => void;
  onStop: () => void;
}

export function ConversationComposer({
  value,
  onChange,
  onSubmit,
  isLoading,
  disabledReason,
  webSearchEnabled,
  onToggleWebSearch,
  knowledgeGraphEnabled,
  knowledgeGraphLoading,
  knowledgeGraphHint,
  onOpenKnowledgeGraph,
  onOpenLangGraph,
  modelProfiles,
  selectedModelProfileId,
  onModelProfileChange,
  onStop,
}: Props) {
  const disabled = isLoading || Boolean(disabledReason);

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    onSubmit();
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      onSubmit();
    }
  };

  return (
    <form onSubmit={handleSubmit} className="chat-composer">
      <TextArea
        value={value}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={handleKeyDown}
        rows={1}
        placeholder={disabledReason || "输入消息"}
        disabled={disabled}
        autoSize={{ minRows: 2, maxRows: 7 }}
      />

      <div className="chat-composer-bar">
        <Tooltip title={webSearchEnabled ? "联网搜索已开启" : "开启联网搜索"}>
          <Button
            type={webSearchEnabled ? "primary" : "text"}
            shape="circle"
            icon={<SearchOutlined />}
            aria-label="联网搜索"
            aria-pressed={webSearchEnabled}
            disabled={disabled}
            onClick={onToggleWebSearch}
          />
        </Tooltip>
        <Tooltip title={knowledgeGraphHint}>
          <Button
            type="text"
            shape="circle"
            icon={<ApartmentOutlined />}
            aria-label="查看知识图谱"
            disabled={!knowledgeGraphEnabled}
            loading={knowledgeGraphLoading}
            onClick={onOpenKnowledgeGraph}
          />
        </Tooltip>
        <ModelProfileSelector
          profiles={modelProfiles}
          selectedProfileId={selectedModelProfileId}
          disabled={isLoading}
          onChange={onModelProfileChange}
        />
        <Tooltip title="查看运行架构">
          <Button
            type="text"
            shape="circle"
            icon={<PartitionOutlined />}
            aria-label="查看运行架构"
            onClick={onOpenLangGraph}
          />
        </Tooltip>
        <div className="chat-composer-actions">
          {isLoading ? (
            <Tooltip title="停止生成">
              <Button
                type="primary"
                shape="circle"
                danger
                icon={<StopOutlined />}
                aria-label="停止生成"
                onClick={onStop}
              />
            </Tooltip>
          ) : (
            <Tooltip title="发送">
              <Button
                type="primary"
                shape="circle"
                htmlType="submit"
                icon={<SendOutlined />}
                aria-label="发送"
                disabled={!value.trim() || Boolean(disabledReason)}
              />
            </Tooltip>
          )}
        </div>
      </div>
    </form>
  );
}
