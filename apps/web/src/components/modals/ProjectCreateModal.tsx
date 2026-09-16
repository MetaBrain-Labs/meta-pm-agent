/**
 * 本地项目路径弹窗
 *
 * 负责添加本地项目和修改已关联项目路径的表单界面。
 *
 * Responsibilities:
 * - 保留可手工编辑的绝对路径输入
 * - 通过本地服务目录选择器回填绝对路径
 *
 * Notes:
 * - 目录存在性、可读性与规范化由 API 校验。
 */

import { useEffect, useState } from "react";
import { Button, Form, Input, Modal, Space, type FormInstance } from "antd";
import { LocalDirectoryBrowserModal } from "./LocalDirectoryBrowserModal";

/** 项目创建和路径修改表单的交互参数。 */
interface ProjectCreateModalProps {
  mode: "create" | "path";
  open: boolean;
  form: FormInstance<{ name: string; location?: string }>;
  locationHint: boolean;
  creating: boolean;
  onDirectorySelect: (directoryPath: string) => void;
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
  onDirectorySelect,
  onCreate,
  onCancel,
}: ProjectCreateModalProps) {
  const [directoryBrowserOpen, setDirectoryBrowserOpen] = useState(false);
  useEffect(() => {
    if (!open) setDirectoryBrowserOpen(false);
  }, [open]);
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

          <Form.Item label="项目地址" htmlFor="project-location" className="mb-0">
            <Space.Compact style={{ width: "100%" }}>
              {/* 字段直接绑定输入框，使目录回填和手工编辑同步到表单。 */}
              <Form.Item name="location" noStyle>
                <Input
                  id="project-location"
                  placeholder="请输入 API 机器可访问的绝对目录路径"
                />
              </Form.Item>
              <Button
                className="w-[30%]"
                type="primary"
                onClick={() => setDirectoryBrowserOpen(true)}
              >
                浏览
              </Button>
            </Space.Compact>
          </Form.Item>

          <div className="project-location-note">
            点击“浏览”选择文件夹后将自动填写完整路径，也可以直接输入路径。
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
      <LocalDirectoryBrowserModal
        open={open && directoryBrowserOpen}
        initialPath={form.getFieldValue("location")}
        onSelect={(directoryPath) => {
          onDirectorySelect(directoryPath);
          setDirectoryBrowserOpen(false);
        }}
        onCancel={() => setDirectoryBrowserOpen(false)}
      />
    </Modal>
  );
}
