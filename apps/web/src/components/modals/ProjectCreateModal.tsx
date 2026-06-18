import type { ChangeEvent, RefObject } from "react";
import { Button, Form, Input, Modal, type FormInstance } from "antd";

interface ProjectCreateModalProps {
  open: boolean;
  form: FormInstance<{ name: string; location?: string }>;
  locationHint: boolean;
  creating: boolean;
  directoryInputRef: RefObject<HTMLInputElement | null>;
  onBrowseDirectory: () => void | Promise<void>;
  onDirectoryInputChange: (event: ChangeEvent<HTMLInputElement>) => void;
  onCreate: () => void | Promise<void>;
  onCancel: () => void;
}

/**
 * 创建本地项目的弹窗，封装路径选择和表单展示。
 */
export function ProjectCreateModal({
  open,
  form,
  locationHint,
  creating,
  directoryInputRef,
  onBrowseDirectory,
  onDirectoryInputChange,
  onCreate,
  onCancel,
}: ProjectCreateModalProps) {
  return (
    <Modal
      centered
      width={610}
      open={open}
      title={null}
      footer={null}
      closable={false}
      className="project-create-modal"
      onCancel={onCancel}
      mask={{ blur: true }}
    >
      <div className="project-modal-head">
        <h2>新建本地项目</h2>
        <p>在指定文件夹下创建一个新的项目</p>
      </div>
      <Form form={form} layout="vertical" className="project-form">
        <div className="project-form-panel">
          <Form.Item
            label="项目名称"
            name="name"
            rules={[{ required: true, message: "请输入项目名称" }]}
          >
            <Input autoFocus />
          </Form.Item>
          <div className="project-form-divider" />
          <Form.Item label="项目地址" name="location" className="mb-0">
            <Input
              placeholder="选择后的位置"
              addonAfter={
                <Button type="link" onClick={() => void onBrowseDirectory()}>
                  浏览
                </Button>
              }
            />
          </Form.Item>
          <div className="project-location-note">
            指定项目在本地的存放位置，
            <button type="button" onClick={() => void onBrowseDirectory()}>
              选择后的位置
            </button>
          </div>
        </div>
        {locationHint && (
          <div className="project-form-error">请输入项目位置</div>
        )}
        <div className="project-modal-actions">
          <Button onClick={onCancel}>取消</Button>
          <Button type="primary" loading={creating} onClick={() => void onCreate()}>
            创建
          </Button>
        </div>
      </Form>
      <input
        ref={directoryInputRef}
        type="file"
        className="hidden-file-input"
        onChange={onDirectoryInputChange}
        {...{ webkitdirectory: "", directory: "" }}
      />
    </Modal>
  );
}
