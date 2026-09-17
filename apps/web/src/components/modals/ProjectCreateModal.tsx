/**
 * 本地项目路径弹窗
 *
 * 负责新建本地项目和修改已关联项目路径的表单界面。
 *
 * Responsibilities:
 * - 保留可手工编辑的绝对路径输入
 * - 通过宿主目录选择器回填绝对路径
 * - 把校验错误显示在对应字段下方
 *
 * Notes:
 * - 目录存在性、可读性与规范化由 API 校验，本组件只做必填校验。
 * - 不改变项目创建与路径更新的提交语义，仅调整展示。
 */

import { useEffect, useState } from "react";
import { Button, Form, Input, Space, type FormInstance } from "antd";
import { CheckOutlined, CloseOutlined, FolderOpenOutlined } from "@ant-design/icons";
import { LocalDirectoryBrowserModal } from "./LocalDirectoryBrowserModal";
import { AppModal } from "./AppModal";

const TEXT = {
  createTitle: "新建本地项目",
  createDescription: "在指定文件夹下创建一个新的项目",
  pathTitle: "修改本地路径",
  pathDescription:
    "复制已生成的上下文与 PRD 到新目录，保留原文件；后续产物保存到新目录",
  nameLabel: "项目名称",
  nameHelp: "给项目起一个名字",
  locationLabel: "项目地址",
  locationHelp: "指定项目在本地的存放位置",
  locationPlaceholder: "例如 D:\\projects\\my-product",
  browse: "浏览",
  browseHint: "点击“浏览”选择文件夹后会自动填入完整路径，也可以直接输入。",
  cancel: "取消",
  create: "创建",
  savePath: "保存路径",
  locationRequired: "请输入项目位置",
} as const;

/** 项目创建和路径修改表单的交互参数。 */
interface ProjectCreateModalProps {
  mode: "create" | "path";
  open: boolean;
  form: FormInstance<{ name: string; location?: string }>;
  /**
   * 上层提交时发现位置为空的标记。
   *
   * 字段级必填错误已由 rules 承担，这里只在弹窗顶部补一行整体说明，
   * 让用户在长表单里也能立刻看到提交被拦下的原因。
   */
  locationHint?: boolean;
  creating: boolean;
  onDirectorySelect: (directoryPath: string) => void;
  onCreate: () => void | Promise<void>;
  onCancel: () => void;
}

/**
 * 创建本地项目弹窗：紧凑表单 + 字段级错误提示。
 */
export function ProjectCreateModal({
  mode,
  open,
  form,
  locationHint = false,
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
      width={480}
      open={open}
      title={null}
      footer={null}
      closable={false}
      className="project-create-modal"
    >
      <div className="project-modal">
        <header className="project-modal-head">
          <h2>{mode === "create" ? TEXT.createTitle : TEXT.pathTitle}</h2>
          <p>
            {mode === "create" ? TEXT.createDescription : TEXT.pathDescription}
          </p>
        </header>

        {locationHint && (
          <p className="project-modal-alert" role="alert">
            {TEXT.locationRequired}
          </p>
        )}

        <Form
          form={form}
          layout="vertical"
          requiredMark={false}
          className="project-modal-form"
        >
          {mode === "create" && (
            <Form.Item
              label={TEXT.nameLabel}
              name="name"
              rules={[{ required: true, message: "请输入项目名称" }]}
            >
              <Input autoFocus placeholder={TEXT.nameHelp} />
            </Form.Item>
          )}

          {/*
           * 地址字段：外层 Form.Item 负责标签与校验展示，字段绑定交给内层
           * noStyle 的 Form.Item。
           *
           * 注意：字段绑定依赖 Form.Item 直接 clone 它的子元素来注入
           * value/onChange。中间不能插入普通 div 或自定义包装组件，否则注入
           * 失效——输入框既拿不到表单值，目录回填也写不进表单。
           */}
          <Form.Item
            label={TEXT.locationLabel}
            extra={TEXT.locationHelp}
            rules={[
              {
                validator: async (_rule, value: string | undefined) => {
                  if (value?.trim()) return;
                  throw new Error(TEXT.locationRequired);
                },
              },
            ]}
          >
            <Space.Compact style={{ width: "100%" }}>
              <Form.Item name="location" noStyle>
                <Input
                  aria-label={TEXT.locationLabel}
                  placeholder={TEXT.locationPlaceholder}
                />
              </Form.Item>
              <Button
                icon={<FolderOpenOutlined />}
                onClick={() => setDirectoryBrowserOpen(true)}
              >
                {TEXT.browse}
              </Button>
            </Space.Compact>
            <p className="project-modal-hint">{TEXT.browseHint}</p>
          </Form.Item>
        </Form>

        <footer className="project-modal-actions">
          <Button icon={<CloseOutlined />} onClick={onCancel}>
            {TEXT.cancel}
          </Button>
          <Button
            type="primary"
            icon={<CheckOutlined />}
            loading={creating}
            onClick={() => void onCreate()}
          >
            {mode === "create" ? TEXT.create : TEXT.savePath}
          </Button>
        </footer>
      </div>

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
