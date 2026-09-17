/**
 * 知识图谱弹窗
 *
 * 为共享知识图谱画布提供节点筛选、图例、详情、全屏与下载操作。
 * G6 数据转换和实例生命周期由 KnowledgeGraphView 统一维护。
 *
 * Responsibilities:
 * - 管理节点类型筛选和选中节点详情
 * - 提供全屏、PNG 与 Markdown 下载
 * - 将筛选后的图谱数据交给共享画布
 */

import { formatDisplayId } from "../../utils/display-id";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FC,
} from "react";
import { Button, Modal, Space, Tooltip, message } from "antd";
import {
  CameraOutlined,
  CloseOutlined,
  DownloadOutlined,
  EyeOutlined,
  FullscreenExitOutlined,
  FullscreenOutlined,
} from "@ant-design/icons";
import type {
  KnowledgeGraphNodeData,
  KnowledgeGraphRelationData,
} from "../../api/chat-api";
import {
  KnowledgeGraphView,
  NODE_TYPE_ICONS,
  NODE_TYPE_LABELS,
  RELATION_TYPE_LABELS,
  getKnowledgeGraphNodeColor,
  getKnowledgeGraphRelationColor,
  type KnowledgeGraphViewHandle,
} from "../KnowledgeGraphView";

interface Props {
  open: boolean;
  nodes: KnowledgeGraphNodeData[];
  relations: KnowledgeGraphRelationData[];
  markdown: string;
  workspaceId: string;
  onClose: () => void;
}

/** 产品知识图谱查看弹窗。 */
export const KnowledgeGraphModal: FC<Props> = ({
  open,
  nodes,
  relations,
  markdown,
  workspaceId,
  onClose,
}) => {
  const graphRef = useRef<KnowledgeGraphViewHandle>(null);
  const [selectedNode, setSelectedNode] =
    useState<KnowledgeGraphNodeData | null>(null);
  const [hiddenTypes, setHiddenTypes] = useState<Set<string>>(new Set());
  const [isFullscreen, setIsFullscreen] = useState(false);

  useEffect(() => {
    if (open) {
      setHiddenTypes(new Set());
      setSelectedNode(null);
    }
  }, [open]);

  // 使用浏览器全屏状态同步按钮，覆盖用户按 Esc 退出的情况。
  useEffect(() => {
    const syncFullscreen = () =>
      setIsFullscreen(Boolean(document.fullscreenElement));
    document.addEventListener("fullscreenchange", syncFullscreen);
    return () =>
      document.removeEventListener("fullscreenchange", syncFullscreen);
  }, []);

  const availableTypes = useMemo(
    () => [...new Set(nodes.map((node) => node.type))].sort(),
    [nodes],
  );
  const filteredNodes = useMemo(
    () => nodes.filter((node) => !hiddenTypes.has(node.type)),
    [hiddenTypes, nodes],
  );
  const visibleNodeIds = useMemo(
    () => new Set(filteredNodes.map((node) => node.id)),
    [filteredNodes],
  );
  const filteredRelations = useMemo(
    () =>
      relations.filter(
        (relation) =>
          visibleNodeIds.has(relation.source) &&
          visibleNodeIds.has(relation.target),
      ),
    [relations, visibleNodeIds],
  );
  const availableRelationTypes = useMemo(
    () => [...new Set(filteredRelations.map((item) => item.type))].sort(),
    [filteredRelations],
  );

  const toggleType = useCallback((type: string) => {
    setHiddenTypes((current) => {
      const next = new Set(current);
      if (next.has(type)) next.delete(type);
      else next.add(type);
      return next;
    });
    setSelectedNode(null);
  }, []);

  const handleToggleFullscreen = useCallback(() => {
    if (!graphRef.current) {
      void message.warning("图谱尚未渲染完成");
      return;
    }
    if (isFullscreen) graphRef.current.exitFullscreen();
    else graphRef.current.requestFullscreen();
  }, [isFullscreen]);

  const handleDownloadMarkdown = useCallback(() => {
    try {
      downloadUrl(
        URL.createObjectURL(
          new Blob([markdown], { type: "text/markdown;charset=utf-8" }),
        ),
        `product-knowledge-graph-${workspaceId}.md`,
        true,
      );
      void message.success("知识图谱 Markdown 已下载");
    } catch {
      void message.error("下载失败，请重试");
    }
  }, [markdown, workspaceId]);

  const handleDownloadGraph = useCallback(async () => {
    try {
      if (!graphRef.current) throw new Error("graph-not-ready");
      downloadUrl(
        await graphRef.current.toDataURL(),
        `product-knowledge-graph-${workspaceId}.png`,
      );
      void message.success("知识图谱图片已下载");
    } catch {
      void message.error("下载图片失败，请重试");
    }
  }, [workspaceId]);

  return (
    <Modal
      centered
      mask={{ enabled: true, blur: true, closable: true }}
      width="90vw"
      style={{ maxWidth: 1400 }}
      open={open}
      onCancel={onClose}
      footer={null}
      closable={false}
      styles={{
        mask: { backdropFilter: "blur(8px)", background: "rgba(0,0,0,0.3)" },
        body: {
          padding: 0,
          height: "calc(85vh - 56px)",
          overflow: "hidden",
        },
        header: { padding: "12px 20px" },
      }}
      title={
        <div className="flex w-full items-center justify-between pr-8">
          <Space>
            <span className="text-base font-semibold text-[var(--ink-base)]">
              知识图谱
            </span>
            <span className="text-xs text-[var(--ink-soft)]">
              全量 {nodes.length} 节点 · {relations.length} 关系
              {hiddenTypes.size > 0 && (
                <span className="ml-1 text-[var(--ink-accent,#1677ff)]">
                  （显示 {filteredNodes.length} / {filteredRelations.length}）
                </span>
              )}
            </span>
          </Space>
          <Space>
            {hiddenTypes.size > 0 && (
              <Button
                type="link"
                size="small"
                icon={<EyeOutlined />}
                onClick={() => setHiddenTypes(new Set())}
              >
                全部显示
              </Button>
            )}
            <Tooltip title={isFullscreen ? "退出全屏" : "全屏查看"}>
              <Button
                type="text"
                shape="circle"
                aria-label={isFullscreen ? "退出全屏" : "全屏查看"}
                icon={
                  isFullscreen ? (
                    <FullscreenExitOutlined />
                  ) : (
                    <FullscreenOutlined />
                  )
                }
                onClick={handleToggleFullscreen}
              />
            </Tooltip>
            <Tooltip title="下载图谱图片">
              <Button
                type="text"
                shape="circle"
                aria-label="下载图谱图片"
                icon={<CameraOutlined />}
                onClick={handleDownloadGraph}
              />
            </Tooltip>
            <Tooltip title="下载 Markdown">
              <Button
                type="text"
                shape="circle"
                aria-label="下载 Markdown"
                icon={<DownloadOutlined />}
                onClick={handleDownloadMarkdown}
              />
            </Tooltip>
          </Space>
        </div>
      }
    >
      <div className="relative h-full bg-white">
        <KnowledgeGraphView
          ref={graphRef}
          active={open}
          nodes={filteredNodes}
          relations={filteredRelations}
          onNodeSelect={setSelectedNode}
          className="h-full"
        />

        {nodes.length > 0 && (
          <aside
            className={`absolute inset-y-0 left-0 z-10 overflow-y-auto overflow-x-hidden bg-white/95 p-3 shadow-sm transition-[width] ${
              selectedNode ? "w-80" : "w-56"
            }`}
          >
            <div className="mb-2 text-xs font-semibold text-[var(--ink-soft)]">
              节点类型（点击筛选）
            </div>
            {availableTypes.map((type) => {
              const hidden = hiddenTypes.has(type);
              const color = getKnowledgeGraphNodeColor(type);
              return (
                <button
                  key={type}
                  type="button"
                  title={`点击${hidden ? "显示" : "隐藏"} ${
                    NODE_TYPE_LABELS[type] ?? type
                  }`}
                  className={`mb-1 flex w-full items-center gap-2 rounded px-1.5 py-1 text-left text-xs hover:bg-gray-100 ${
                    hidden ? "opacity-40 line-through" : ""
                  }`}
                  onClick={() => toggleType(type)}
                >
                  <span
                    className="inline-flex size-[18px] shrink-0 items-center justify-center rounded-full border text-[11px] font-bold"
                    style={{
                      color,
                      borderColor: color,
                      background: `${color}18`,
                    }}
                  >
                    {NODE_TYPE_ICONS[type] ?? NODE_TYPE_ICONS.Custom}
                  </span>
                  <span>{NODE_TYPE_LABELS[type] ?? type}</span>
                  <span className="ml-auto text-[var(--ink-soft)]">
                    {nodes.filter((node) => node.type === type).length}
                  </span>
                </button>
              );
            })}

            {availableRelationTypes.length > 0 && (
              <>
                <div className="mb-2 mt-4 text-xs font-semibold text-[var(--ink-soft)]">
                  关系类型
                </div>
                {availableRelationTypes.map((type) => (
                  <div
                    key={type}
                    className="mb-1 flex items-center gap-2 text-xs"
                  >
                    <span
                      className="w-6 shrink-0 border-t-2"
                      style={{
                        borderColor: getKnowledgeGraphRelationColor(type),
                      }}
                    />
                    <span>{RELATION_TYPE_LABELS[type] ?? type}</span>
                    <span className="ml-auto text-[var(--ink-soft)]">
                      {
                        filteredRelations.filter(
                          (relation) => relation.type === type,
                        ).length
                      }
                    </span>
                  </div>
                ))}
              </>
            )}

            <div className="mb-2 mt-4 text-xs font-semibold text-[var(--ink-soft)]">
              交互
            </div>
            <div className="text-xs leading-5 text-[var(--ink-soft)]">
              拖拽平移 · 滚轮缩放
              <br />
              点击节点聚焦并查看详情
              <br />
              Hover 节点或边查看说明
            </div>

            {selectedNode && (
              <section className="mt-4 rounded-lg bg-gray-100 p-3 text-xs">
                <div className="mb-2 flex items-center justify-between">
                  <span className="font-semibold">节点详情</span>
                  <Button
                    type="text"
                    size="small"
                    shape="circle"
                    aria-label="关闭节点详情"
                    icon={<CloseOutlined />}
                    onClick={() => setSelectedNode(null)}
                  />
                </div>
                <Detail label="ID" value={selectedNode.id} />
                <Detail label="名称" value={selectedNode.name} />
                <Detail
                  label="类型"
                  value={NODE_TYPE_LABELS[selectedNode.type] ?? selectedNode.type}
                />
                {selectedNode.description && (
                  <Detail label="描述" value={selectedNode.description} />
                )}
                {selectedNode.status && (
                  <Detail label="状态" value={selectedNode.status} />
                )}
                {selectedNode.source_task_id && (
                  <Detail label="来源任务" value={selectedNode.source_task_id} />
                )}
              </section>
            )}
          </aside>
        )}
      </div>
    </Modal>
  );
};

/** 渲染节点详情字段。 */
function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div className="mb-2 last:mb-0">
      <div className="text-[var(--ink-soft)]">{label}</div>
      <div title={label === "ID" ? value : undefined}
        className={`wrap-anywhere font-medium text-[var(--ink-base)] ${label === "名称" || label === "描述" ? "font-reading-compact" : ""}`}>
        {label === "ID" ? formatDisplayId(value) : value}
      </div>
    </div>
  );
}

/** 通过临时链接触发浏览器下载。 */
function downloadUrl(url: string, fileName: string, revoke = false) {
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  if (revoke) URL.revokeObjectURL(url);
}
