/**
 * 应用设置弹窗
 *
 * 组合账号信息、工作区信息与账号模型使用列表设置。
 *
 * Responsibilities:
 * - 维护设置侧栏导航
 * - 渲染只读基础信息和模型列表管理面板
 */

import { Modal } from "antd";
import { ModelProfilesPanel } from "../settings/ModelProfilesPanel";

type ConfigTab = "account" | "workspace" | "models";

interface ConfigModalProps {
  open: boolean;
  activeTab: ConfigTab;
  showWorkspace: boolean;
  accountRows: Array<[string, string]>;
  workspaceRows: Array<[string, string]>;
  onTabChange: (tab: ConfigTab) => void;
  onClose: () => void;
}

/** 展示账号、工作区和模型使用列表的通用设置弹窗。 */
export function ConfigModal({
  open,
  activeTab,
  showWorkspace,
  accountRows,
  workspaceRows,
  onTabChange,
  onClose,
}: ConfigModalProps) {
  const title =
    activeTab === "account"
      ? "账号信息"
      : activeTab === "workspace"
        ? "工作区信息"
        : "模型使用列表";
  const rows = activeTab === "account" ? accountRows : workspaceRows;

  return (
    <Modal
      centered
      mask={{ enabled: true, blur: true, closable: true }}
      width={1080}
      open={open}
      onCancel={onClose}
      className="info-modal"
      footer={null}
      closable={false}
      styles={{
        mask: {
          backdropFilter: "blur(8px)",
          background: "rgba(0,0,0,0.3)",
        },
        body: { maxHeight: "82vh", overflow: "auto" },
      }}
    >
      <div className="settings-modal-body">
        <aside className="settings-modal-nav">
          <button
            type="button"
            className={activeTab === "account" ? "is-active" : ""}
            onClick={() => onTabChange("account")}
          >
            账号信息
          </button>
          <button
            type="button"
            className={activeTab === "workspace" ? "is-active" : ""}
            onClick={() => onTabChange("workspace")}
            hidden={!showWorkspace}
          >
            工作区信息
          </button>
          <button
            type="button"
            className={activeTab === "models" ? "is-active" : ""}
            onClick={() => onTabChange("models")}
          >
            模型使用列表
          </button>
        </aside>
        <section className="settings-modal-content">
          <h3>{title}</h3>
          {activeTab === "models" ? (
            <ModelProfilesPanel />
          ) : (
            <div className="info-modal-body">
              {rows.map(([label, value]) => (
                <div key={label} className="info-row">
                  <span>{label}</span>
                  <strong>{value}</strong>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
    </Modal>
  );
}
