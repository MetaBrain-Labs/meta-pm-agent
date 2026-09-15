/**
 * 单行文本编辑弹窗
 *
 * 为工作区和会话重命名提供统一、受控的输入界面。
 *
 * Responsibilities:
 * - 展示受控单行文本输入
 * - 在有效值存在时提交保存动作
 *
 * Notes:
 * - 数据持久化和错误展示由应用外壳负责。
 */

import { Input, Modal } from "antd";

interface TextValueModalProps {
  open: boolean;
  title: string;
  label: string;
  value: string;
  saving: boolean;
  onChange: (value: string) => void;
  onSave: () => void | Promise<void>;
  onCancel: () => void;
}

/** 展示工作区或会话重命名输入框。 */
export function TextValueModal({
  open,
  title,
  label,
  value,
  saving,
  onChange,
  onSave,
  onCancel,
}: TextValueModalProps) {
  return (
    <Modal
      open={open}
      centered
      title={title}
      okText="保存"
      cancelText="取消"
      confirmLoading={saving}
      okButtonProps={{ disabled: !value.trim() }}
      onOk={() => void onSave()}
      onCancel={onCancel}
    >
      <label className="flex flex-col gap-2">
        <span>{label}</span>
        <Input
          autoFocus
          maxLength={80}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          onPressEnter={() => value.trim() && void onSave()}
        />
      </label>
    </Modal>
  );
}
