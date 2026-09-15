/**
 * 本地项目路径弹窗
 *
 * 负责添加本地项目和修改已关联项目路径的表单界面。
 *
 * Responsibilities:
 * - 保留可手工编辑的绝对路径输入
 * - 在浏览器可用时调用目录选择能力
 *
 * Notes:
 * - 目录存在性、可读性与规范化由 API 校验。
 */

import type { ChangeEvent, RefObject } from "react";
import { Button, Form, Input, Modal, Space, type FormInstance } from "antd";

interface ProjectCreateModalProps {
  mode: "create" | "path";
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
  mode,
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
      mask={{ enabled: true, blur: true, closable: true }}
      centered
      width={610}
      open={open}
      title={null}
      footer={null}
      closable={false}
      className="project-create-modal"
      styles={{
        mask: {
          backdropFilter: "blur(8px)",
          background: "rgba(0,0,0,0.3)",
        },
      }}
    >
      <div className="project-modal-head">
        <h2>{mode === "create" ? "添加本地项目" : "修改本地路径"}</h2>
        <p>
          {mode === "create"
            ? "关联 API 所在机器上的已有本地目录"
            : "更新关联路径，不会移动或修改任何本地文件"}
        </p>
      </div>
      <Form form={form} layout="vertical" className="project-form">
        <div className="project-form-panel">
          <Form.Item
            label="项目名称"
            name="name"
            rules={[{ required: true, message: "请输入项目名称" }]}
            hidden={mode === "path"}
          >
            <Input autoFocus />
          </Form.Item>
          <div className="project-form-divider" />

          <Form.Item label="项目地址" name="location" className="mb-0">
            <Space.Compact style={{ width: "100%" }}>
              <Input placeholder="请输入 API 机器可访问的绝对目录路径" />
              <Button
                className="w-[30%]"
                type="primary"
                onClick={onBrowseDirectory}
              >
                浏览
              </Button>
            </Space.Compact>
          </Form.Item>

          <div className="project-location-note">
            浏览器可能只返回目录名称，请确认并手工填写 API 机器上的绝对路径。
            <button type="button" onClick={() => void onBrowseDirectory()}>
              重新选择
            </button>
          </div>
        </div>
        {locationHint && (
          <div className="project-form-error">请输入项目位置</div>
        )}
        <div className="project-modal-actions">
          <Button onClick={onCancel}>取消</Button>
          <Button
            type="primary"
            loading={creating}
            onClick={() => void onCreate()}
          >
            {mode === "create" ? "添加" : "保存路径"}
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
