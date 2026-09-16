/**
 * 共享弹窗视觉外壳
 *
 * Responsibilities:
 * - 为需要自定义内容的弹窗统一居中默认值和轻量遮罩。
 * - 兼容 Ant Design 6 的对象及回调式语义样式。
 *
 * Notes:
 * - 完整透传原生 Modal 参数，不接管开关、表单、关闭回调或销毁策略。
 */
import { Modal, type ModalProps } from "antd";
import { DESIGN_TOKENS } from "../../theme/design-tokens";

/** 提供统一视觉默认值，调用方仍可以覆盖所有原生弹窗配置。 */
export function AppModal({ styles, centered = true, ...props }: ModalProps) {
  const mergedStyles: ModalProps["styles"] = (info) => {
    const overrides = typeof styles === "function" ? styles(info) : styles;
    return {
      ...overrides,
      mask: {
        background: DESIGN_TOKENS.color.mask,
        backdropFilter: "none",
        ...overrides?.mask,
      },
    };
  };
  return <Modal {...props} centered={centered} styles={mergedStyles} />;
}
