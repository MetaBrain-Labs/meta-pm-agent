/**
 * 本地目录选择弹窗
 *
 * Responsibilities:
 * - 展示磁盘、父目录和单层子目录导航
 * - 仅在用户确认时提交已加载目录的绝对路径
 *
 * Notes:
 * - 关闭后销毁浏览草稿及请求；允许选择没有子目录的文件夹。
 * - 只调整展示层：导航、加载与确认逻辑保持原有行为。
 */
import { Alert, Button, Empty, Input, Modal } from "antd";
import { GlobalLoader } from "../ui/GlobalLoader";
import {
  ArrowRightOutlined,
  ArrowUpOutlined,
  CheckOutlined,
  CloseOutlined,
  FolderOutlined,
  HomeOutlined,
  HddOutlined,
  ReloadOutlined,
  RightOutlined,
} from "@ant-design/icons";
import { useLocalDirectoryBrowser } from "../../hooks/useLocalDirectoryBrowser";

/** 一次目录选择会话的入口参数。 */
interface LocalDirectoryBrowserModalProps {
  open: boolean;
  initialPath?: string;
  onSelect: (directoryPath: string) => void;
  onCancel: () => void;
}

/** 按打开状态挂载选择会话，重新打开时从最新项目路径开始。 */
export function LocalDirectoryBrowserModal(props: LocalDirectoryBrowserModalProps) {
  return props.open ? <DirectoryBrowserSession {...props} /> : null;
}

/** 展示当前目录并提供确定、取消及错误恢复操作。 */
function DirectoryBrowserSession({ initialPath, onSelect, onCancel }: LocalDirectoryBrowserModalProps) {
  const browser = useLocalDirectoryBrowser(initialPath);
  const selectable = !!browser.listing && !browser.loading && !browser.error;

  return (
    <Modal
      open
      title="选择项目文件夹"
      width={640}
      centered
      className="local-directory-modal"
      onCancel={onCancel}
      footer={[
        <Button key="cancel" icon={<CloseOutlined />} onClick={onCancel}>
          取消
        </Button>,
        <Button
          key="select"
          type="primary"
          icon={<CheckOutlined />}
          disabled={!selectable}
          onClick={() => {
            if (selectable && browser.listing) onSelect(browser.listing.currentPath);
          }}
        >
          选择此文件夹
        </Button>,
      ]}
    >
      <div className="local-directory">
        <p className="local-directory-note">
          浏览本机文件夹，进入目标目录后点击“选择此文件夹”。
        </p>

        <div className="local-directory-roots">
          <Button
            size="small"
            icon={<HomeOutlined />}
            onClick={() => browser.navigate()}
          >
            主目录
          </Button>
          {browser.listing?.roots
            .filter((root) => root.name !== "主目录")
            .map((root) => (
              <Button
                key={root.path}
                size="small"
                icon={<HddOutlined />}
                onClick={() => browser.navigate(root.path)}
              >
                {root.name}
              </Button>
            ))}
        </div>

        <div className="local-directory-bar">
          <Button
            shape="circle"
            icon={<ArrowUpOutlined />}
            aria-label="上一级"
            disabled={browser.loading || !browser.listing?.parentPath}
            onClick={() => {
              if (browser.listing?.parentPath) browser.navigate(browser.listing.parentPath);
            }}
          />
          <Input
            aria-label="目录绝对路径"
            value={browser.pathInput}
            onChange={(event) => browser.setPathInput(event.target.value)}
            onPressEnter={() => browser.navigate(browser.pathInput.trim() || undefined)}
            placeholder="输入绝对路径可直接跳转"
          />
          <Button
            icon={<ArrowRightOutlined />}
            onClick={() => browser.navigate(browser.pathInput.trim() || undefined)}
          >
            前往
          </Button>
        </div>

        <div className="local-directory-current">
          <span className="local-directory-current-label">当前目录</span>
          <span className="local-directory-current-path">
            {browser.loading
              ? "加载中…"
              : browser.error
                ? "未能加载"
                : browser.listing?.currentPath}
          </span>
        </div>

        <div className="local-directory-list scrollbar-none-thin">
          {browser.loading ? (
            /*
              目录列表读取：Modal 已打开，只有列表区域在等待，属于局部加载；
              Header 与关闭入口保持可用。
            */
            <div className="local-directory-center">
              <GlobalLoader
                scope="section"
                loading
                label="正在读取目录..."
              />
            </div>
          ) : browser.error ? (
            <Alert
              type="error"
              showIcon
              title={browser.error}
              action={
                <Button
                  size="small"
                  icon={<ReloadOutlined />}
                  onClick={() => browser.navigate(browser.pathInput.trim() || undefined)}
                >
                  重试
                </Button>
              }
            />
          ) : browser.listing?.directories.length === 0 ? (
            <div className="local-directory-center">
              <Empty description="没有子文件夹，可直接选择当前目录" />
            </div>
          ) : (
            browser.listing?.directories.map((directory) => (
              <button
                key={directory.path}
                type="button"
                className="local-directory-row"
                onClick={() => browser.navigate(directory.path)}
              >
                <FolderOutlined aria-hidden="true" />
                <span className="local-directory-row-name">{directory.name}</span>
                <RightOutlined aria-hidden="true" className="local-directory-row-arrow" />
              </button>
            ))
          )}
        </div>
      </div>
    </Modal>
  );
}
