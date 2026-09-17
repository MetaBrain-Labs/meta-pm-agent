/**
 * 应用设置弹窗
 *
 * 组合当前工作区信息、本地模型使用列表和提示词管理三个设置页，并在存在未保存
 * 提示词修改时拦截切换页签与关闭弹窗。
 *
 * Responsibilities:
 * - 维护设置侧栏导航与当前页标题
 * - 按服务端能力决定「提示词管理」入口是否可见
 * - 渲染只读基础信息、模型列表管理面板和提示词管理面板
 *
 * Notes:
 * - 只在弹窗打开时查询提示词能力，避免无谓请求
 */

import { useCallback, useEffect, useState } from "react";
import { App } from "antd";
import { AppModal } from "./AppModal";
import { SectionHeader } from "../ui/SectionHeader";
import { ModelProfilesPanel } from "../settings/ModelProfilesPanel";
import { PromptConfigPanel } from "../settings/PromptConfigPanel";
import { usePromptConfigAccess } from "../../hooks/usePromptConfigAccess";

/** 设置弹窗可展示的设置页标识；由外壳状态与弹窗导航共同使用。 */
export type ConfigTab = "workspace" | "models" | "prompts";

const TAB_TITLES: Record<ConfigTab, string> = {
  workspace: "当前工作区",
  models: "模型使用列表",
  prompts: "提示词管理",
};

interface ConfigModalProps {
  open: boolean;
  activeTab: ConfigTab;
  showWorkspace: boolean;
  workspaceRows: Array<[string, string]>;
  /** 提示词配置所属工作区；为空时提示先打开项目。 */
  workspaceId: string | null;
  onTabChange: (tab: ConfigTab) => void;
  onClose: () => void;
}

/** 展示工作区信息、模型使用列表与提示词管理的本地设置弹窗。 */
export function ConfigModal({
  open,
  activeTab,
  showWorkspace,
  workspaceRows,
  workspaceId,
  onTabChange,
  onClose,
}: ConfigModalProps) {
  const { modal } = App.useApp();
  const { access } = usePromptConfigAccess(open);
  const [promptDirty, setPromptDirty] = useState(false);
  /**
   * 每次打开弹窗时重建提示词面板，丢弃上一次的未保存草稿并重新读取服务端状态。
   */
  const [sessionKey, setSessionKey] = useState(0);

  useEffect(() => {
    if (open) setSessionKey((previous) => previous + 1);
  }, [open]);

  const canReadPrompts = access?.canRead === true;
  const title = TAB_TITLES[activeTab];

  /** 存在未保存修改时先确认，再执行设置页导航或关闭。 */
  const guardUnsaved = useCallback(
    (action: () => void, content: string) => {
      if (!promptDirty) {
        action();
        return;
      }
      modal.confirm({
        title: "提示词尚未保存",
        content,
        okText: "放弃修改",
        cancelText: "继续编辑",
        onOk: action,
      });
    },
    [modal, promptDirty],
  );

  const handleTabChange = (tab: ConfigTab) => {
    if (tab === activeTab) return;
    guardUnsaved(
      () => {
        setPromptDirty(false);
        onTabChange(tab);
      },
      "离开「提示词管理」后，当前未保存的内容会丢失。",
    );
  };

  const handleClose = () => {
    guardUnsaved(() => {
      setPromptDirty(false);
      onClose();
    }, "关闭设置后，当前未保存的提示词内容会丢失。");
  };

  return (
    <AppModal
      mask={{ enabled: true, blur: false, closable: true }}
      width={1080}
      open={open}
      onCancel={handleClose}
      className="info-modal"
      footer={null}
      closable={false}
      styles={{
        body: { maxHeight: "82vh", overflow: "auto" },
      }}
    >
      <div className="settings-modal-body">
        <aside className="settings-modal-nav">
          <button
            type="button"
            className={activeTab === "workspace" ? "is-active" : ""}
            onClick={() => handleTabChange("workspace")}
            hidden={!showWorkspace}
          >
            工作区信息
          </button>
          <button
            type="button"
            className={activeTab === "models" ? "is-active" : ""}
            onClick={() => handleTabChange("models")}
          >
            模型使用列表
          </button>
          {/* 无 prompt:read 能力时不进入提示词管理页，与 API 校验保持一致。 */}
          {canReadPrompts ? (
            <button
              type="button"
              className={activeTab === "prompts" ? "is-active" : ""}
              onClick={() => handleTabChange("prompts")}
            >
              提示词管理
            </button>
          ) : null}
        </aside>
        <section className="settings-modal-content">
          <SectionHeader title={title} level={3} />
          {activeTab === "prompts" ? (
            <PromptConfigPanel
              key={`prompts-${sessionKey}`}
              workspaceId={workspaceId}
              onDirtyChange={setPromptDirty}
            />
          ) : activeTab === "models" ? (
            <ModelProfilesPanel />
          ) : (
            <div className="info-modal-body">
              {workspaceRows.map(([label, value]) => (
                <div key={label} className="info-row">
                  <span>{label}</span>
                  <strong>{value}</strong>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
    </AppModal>
  );
}
