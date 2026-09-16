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
import { Button, Form, Input, Space, type FormInstance } from "antd";
import { LocalDirectoryBrowserModal } from "./LocalDirectoryBrowserModal";
import { AppModal } from "./AppModal";
import { SectionHeader } from "../ui/SectionHeader";
import { Surface } from "../ui/Surface";

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
    <AppModal
      mask={{ enabled: true, blur: false, closable: true }}
      width={610}
      open={open}
      title={null}
      footer={null}
      closable={false}
      className="project-create-modal"
    >
      <SectionHeader
        title={mode === "create" ? "添加本地项目" : "修改本地路径"}
        description={
          mode === "create"
            ? "关联本地目录，读取项目背景并保存上下文与生成的 PRD"
            : "复制应用生成的上下文和 PRD 到新目录，保留原文件；后续产物保存到新目录"
        }
      />
      <Form form={form} layout="vertical" className="project-form">
        <Surface tone="muted" bordered={false} className="project-form-panel">
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
        </Surface>
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
    </AppModal>
  );
}
