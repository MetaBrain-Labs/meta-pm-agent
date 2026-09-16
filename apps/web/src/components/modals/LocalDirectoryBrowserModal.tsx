/**
 * 本地目录选择弹窗
 *
 * Responsibilities:
 * - 展示磁盘、父目录和单层子目录导航
 * - 仅在用户确认时提交已加载目录的绝对路径
 *
 * Notes:
 * - 关闭后销毁浏览草稿及请求；允许选择没有子目录的文件夹。
 */
import { Alert, Button, Empty, Input, Modal, Spin } from "antd";
import { ArrowUpOutlined, FolderOutlined, HomeOutlined, RightOutlined } from "@ant-design/icons";
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
      width={720}
      centered
      onCancel={onCancel}
      footer={[
        <Button key="cancel" onClick={onCancel}>取消</Button>,
        <Button
          key="select"
          type="primary"
          disabled={!selectable}
          onClick={() => {
            if (selectable && browser.listing) onSelect(browser.listing.currentPath);
          }}
        >选择此文件夹</Button>,
      ]}
    >
      <p className="mb-3 text-sm text-gray-500">浏览本地服务所在电脑的文件夹，点击文件夹进入后确认选择。</p>
      <div className="mb-3 flex flex-wrap gap-2">
        <Button icon={<HomeOutlined />} onClick={() => browser.navigate()}>主目录</Button>
        {browser.listing?.roots.filter((root) => root.name !== "主目录").map((root) => (
          <Button key={root.path} onClick={() => browser.navigate(root.path)}>{root.name}</Button>
        ))}
      </div>
      <div className="mb-3 flex gap-2">
        <Button
          icon={<ArrowUpOutlined />}
          disabled={browser.loading || !browser.listing?.parentPath}
          onClick={() => {
            if (browser.listing?.parentPath) browser.navigate(browser.listing.parentPath);
          }}
        >上一级</Button>
        <Input
          aria-label="目录绝对路径"
          value={browser.pathInput}
          onChange={(event) => browser.setPathInput(event.target.value)}
          onPressEnter={() => browser.navigate(browser.pathInput.trim() || undefined)}
          placeholder="输入绝对路径可直接跳转"
        />
        <Button onClick={() => browser.navigate(browser.pathInput.trim() || undefined)}>前往</Button>
      </div>
      <div className="mb-2 break-all text-sm text-gray-500">
        当前目录：{browser.loading ? "加载中…" : browser.error ? "未能加载" : browser.listing?.currentPath}
      </div>
      <div className="h-72 overflow-y-auto rounded-lg border border-gray-200 p-2">
        {browser.loading ? (
          <div className="flex h-full items-center justify-center"><Spin tip="正在读取文件夹"><div className="h-12 w-32" /></Spin></div>
        ) : browser.error ? (
          <Alert
            type="error"
            showIcon
            title={browser.error}
            action={<Button size="small" onClick={() => browser.navigate(browser.pathInput.trim() || undefined)}>重试</Button>}
          />
        ) : browser.listing?.directories.length === 0 ? (
          <div className="flex h-full items-center justify-center"><Empty description="没有子文件夹，可直接选择当前目录" /></div>
        ) : (
          browser.listing?.directories.map((directory) => (
            <button
              key={directory.path}
              type="button"
              className="flex w-full cursor-pointer items-center gap-3 rounded-md px-3 py-2 text-left hover:bg-gray-100 focus-visible:outline-2 focus-visible:outline-blue-500"
              onClick={() => browser.navigate(directory.path)}
            >
              <FolderOutlined className="text-amber-500" />
              <span className="min-w-0 flex-1 break-all">{directory.name}</span>
              <RightOutlined className="text-gray-400" />
            </button>
          ))
        )}
      </div>
    </Modal>
  );
}
