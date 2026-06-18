import { Button, Modal } from "antd";

interface ConfigModalProps {
  open: boolean;
  activeTab: "account" | "workspace";
  showWorkspace: boolean;
  accountRows: Array<[string, string]>;
  workspaceRows: Array<[string, string]>;
  onTabChange: (tab: "account" | "workspace") => void;
  onClose: () => void;
}

/**
 * 展示账号和工作区配置详情的通用弹窗。
 */
export function ConfigModal({
  open,
  activeTab,
  showWorkspace,
  accountRows,
  workspaceRows,
  onTabChange,
  onClose,
}: ConfigModalProps) {
  const title = activeTab === "account" ? "账号信息" : "工作区信息";
  const rows = activeTab === "account" ? accountRows : workspaceRows;

  return (
    <Modal
      centered
      width={680}
      open={open}
      title="配置"
      footer={<Button onClick={onClose}>退出</Button>}
      onCancel={onClose}
      className="info-modal"
      mask={{ blur: true }}
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
        </aside>
        <section className="settings-modal-content">
          <h3>{title}</h3>
          <div className="info-modal-body">
            {rows.map(([label, value]) => (
              <div key={label} className="info-row">
                <span>{label}</span>
                <strong>{value}</strong>
              </div>
            ))}
          </div>
        </section>
      </div>
    </Modal>
  );
}
