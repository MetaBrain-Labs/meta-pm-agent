/**
 * 应用设置弹窗
 *
 * 组合当前工作区信息与本地模型使用列表设置。
 *
 * Responsibilities:
 * - 维护设置侧栏导航
 * - 渲染只读基础信息和模型列表管理面板
 */

import { Modal } from "antd";
import { ModelProfilesPanel } from "../settings/ModelProfilesPanel";

type ConfigTab = "workspace" | "models";

interface ConfigModalProps {
  open: boolean;
  activeTab: ConfigTab;
  showWorkspace: boolean;
  workspaceRows: Array<[string, string]>;
  onTabChange: (tab: ConfigTab) => void;
  onClose: () => void;
}

/** 展示当前工作区和模型使用列表的本地设置弹窗。 */
export function ConfigModal({
  open,
  activeTab,
  showWorkspace,
  workspaceRows,
  onTabChange,
  onClose,
}: ConfigModalProps) {
  const title = activeTab === "workspace" ? "当前工作区" : "模型使用列表";

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
    </Modal>
  );
}
