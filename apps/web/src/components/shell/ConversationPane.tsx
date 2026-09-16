/**
 * 对话栏
 *
 * 工作区中的第二栏：顶部显示项目 / 对话名称，中部承载消息与 Agent 过程，底部
 * 固定输入框。组件只负责布局与滚动，不持有消息、不发起请求。
 *
 * Responsibilities:
 * - 渲染对话栏头部（返回、项目名、对话名、工作区面板入口）
 * - 承载可滚动消息区域与消息刻度导航
 * - 把输入区固定在底部，并保留回到最新消息的入口
 *
 * Notes:
 * - 消息渲染、运行状态与表单行为全部由调用方提供，本组件不做业务判断。
 */

import type { ReactNode, RefObject } from "react";
import { Button, FloatButton, Tooltip } from "antd";
import {
  ArrowDownOutlined,
  ArrowLeftOutlined,
  LayoutOutlined,
} from "@ant-design/icons";
import { ChatMessageNavigation } from "../ChatMessageNavigation";
import { useConversationSplit } from "./WorkspaceSplit";
import type { MessageNavigationEntry } from "../../hooks/useMessageNavigation";
import { DEFAULT_CHAT_TITLE } from "../../constants/app";

interface Props {
  workspaceName: string;
  threadTitle: string | null;
  /** 消息滚动容器引用，由调用方用于自动贴底与定位。 */
  scrollRef: RefObject<HTMLDivElement | null>;
  onScroll: () => void;
  messageNavigation: {
    entries: MessageNavigationEntry[];
    activeId: string | null;
    scrollToMessage: (id: string) => void;
  };
  onBack: () => void;
  showScrollToBottom: boolean;
  onScrollToBottom: () => void;
  /** 消息与过程内容。 */
  children: ReactNode;
  /** 底部固定输入区。 */
  composer: ReactNode;
}

export function ConversationPane({
  workspaceName,
  threadTitle,
  scrollRef,
  onScroll,
  messageNavigation,
  onBack,
  showScrollToBottom,
  onScrollToBottom,
  children,
  composer,
}: Props) {
  const split = useConversationSplit();

  return (
    <div className="conversation-pane">
      <header className="conversation-header">
        <Tooltip title="返回项目列表">
          <Button
            type="text"
            shape="circle"
            aria-label="返回项目列表"
            icon={<ArrowLeftOutlined />}
            onClick={onBack}
          />
        </Tooltip>
        <div className="conversation-header-title">
          <span className="conversation-header-project" title={workspaceName}>
            {workspaceName}
          </span>
          <span className="conversation-header-divider" aria-hidden="true">
            /
          </span>
          <span
            className="conversation-header-thread"
            title={threadTitle ?? DEFAULT_CHAT_TITLE}
          >
            {threadTitle ?? DEFAULT_CHAT_TITLE}
          </span>
        </div>
        <Tooltip title="收起对话栏">
          <Button
            type="text"
            shape="circle"
            aria-label="收起对话栏"
            icon={<LayoutOutlined />}
            onClick={() => split?.toggle()}
          />
        </Tooltip>
      </header>

      <div className="conversation-body">
        <div
          ref={scrollRef}
          onScroll={onScroll}
          className="conversation-scroll scrollbar-none"
        >
          {children}
        </div>
        <ChatMessageNavigation
          entries={messageNavigation.entries}
          activeId={messageNavigation.activeId}
          onNavigate={messageNavigation.scrollToMessage}
        />
        <FloatButton
          icon={
            <ArrowDownOutlined
              style={{ color: "var(--ds-color-on-primary)" }}
            />
          }
          className={`scroll-to-bottom w-8! h-8! ${showScrollToBottom ? "is-visible" : ""}`}
          onClick={onScrollToBottom}
        />
      </div>

      <div className="conversation-composer-dock">{composer}</div>
    </div>
  );
}
