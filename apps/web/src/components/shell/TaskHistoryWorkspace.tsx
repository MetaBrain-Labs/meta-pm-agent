/**
 * 任务历史工作区（自包含）
 *
 * 「任务历史」按会话统计，因此有对话栏时由聊天页登记渲染函数。没有对话栏时
 * （例如从侧栏直接进入交付文档）没有任何组件会登记，面板此前只能显示空白。
 *
 * 本组件在没有会话时给出明确说明，而不是让面板看起来坏掉。
 *
 * Responsibilities:
 * - 无会话时说明任务历史的作用域与进入方式
 * - 有会话时由聊天页登记的实现渲染（本组件不重复加载消息）
 *
 * Notes:
 * - 不请求消息、不持有会话状态；消息来源始终是聊天页。
 */

import { Button, Empty } from "antd";
import { MessageOutlined } from "@ant-design/icons";

interface Props {
  /** 打开项目内最近一次对话；与侧栏「新建对话」使用同一条路径。 */
  onOpenConversation?: () => void;
}

export function TaskHistoryWorkspace({ onOpenConversation }: Props) {
  return (
    <div className="task-history-empty">
      <Empty
        image={Empty.PRESENTED_IMAGE_SIMPLE}
        description="任务历史按对话统计。进入一次对话后，这里会显示该会话的规划与执行过程。"
      />
      {onOpenConversation && (
        <Button
          type="primary"
          icon={<MessageOutlined />}
          onClick={onOpenConversation}
        >
          打开对话
        </Button>
      )}
    </div>
  );
}
