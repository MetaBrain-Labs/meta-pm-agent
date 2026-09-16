/**
 * 知识图谱面板
 *
 * 项目面板的「知识图谱」入口：复用共享画布展示当前工作区图谱，并提供类型筛选、
 * 节点详情、全屏与导出。图谱不再挂在交付文档面板里。
 *
 * Responsibilities:
 * - 把工作区图谱交给共享 KnowledgeGraphView 渲染
 * - 提供节点类型筛选、关系类型图例与选中节点详情
 * - 提供全屏、PNG 导出与 Markdown 导出
 *
 * Notes:
 * - 筛选只作用于展示副本，关系两端都可见时才保留，不写回业务图谱。
 * - 不新增接口：图谱数据由页面已有的同一次请求提供。
 */

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { Button, Empty, Spin, Tooltip, message } from "antd";
import {
  CameraOutlined,
  CloseOutlined,
  DownloadOutlined,
  FullscreenExitOutlined,
  FullscreenOutlined,
  ReloadOutlined,
} from "@ant-design/icons";
import type {
  KnowledgeGraphNodeData,
  KnowledgeGraphRelationData,
  WorkspaceKnowledgeGraphData,
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
import { formatDisplayId } from "../../utils/display-id";

interface Props {
  workspaceId: string;
  data: WorkspaceKnowledgeGraphData | null;
  /** 是否正在读取图谱。 */
  loading: boolean;
  /** 是否已尝试读取；未尝试前不显示"没有数据"。 */
  attempted: boolean;
  /** 读取失败原因；有值时显示错误与重试，而不是一直转圈。 */
  error?: string | null;
  /** 重新读取图谱。 */
  onRefresh?: () => void;
}

export function KnowledgeGraphPanel({
  workspaceId,
  data,
  loading,
  attempted,
  error = null,
  onRefresh,
}: Props) {
  const graphRef = useRef<KnowledgeGraphViewHandle>(null);
  const [selectedNode, setSelectedNode] =
    useState<KnowledgeGraphNodeData | null>(null);
  const [hiddenTypes, setHiddenTypes] = useState<Set<string>>(new Set());
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [messageApi, contextHolder] = message.useMessage();

  const nodes = data?.nodes ?? [];
  const relations = data?.relations ?? [];

  // 使用浏览器全屏状态同步按钮，覆盖用户按 Esc 退出的情况。
  useEffect(() => {
    const syncFullscreen = () =>
      setIsFullscreen(Boolean(document.fullscreenElement));
    document.addEventListener("fullscreenchange", syncFullscreen);
    return () => document.removeEventListener("fullscreenchange", syncFullscreen);
  }, []);

  // 换工作区时清空筛选与选中，避免把上一个项目的筛选条件带过来。
  useEffect(() => {
    setHiddenTypes(new Set());
    setSelectedNode(null);
  }, [workspaceId]);

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
  // 关系两端都必须可见，否则会出现指向不存在节点的边。
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
      void messageApi.warning("图谱尚未渲染完成");
      return;
    }
    if (isFullscreen) graphRef.current.exitFullscreen();
    else graphRef.current.requestFullscreen();
  }, [isFullscreen, messageApi]);

  const handleDownloadImage = useCallback(async () => {
    try {
      if (!graphRef.current) throw new Error("graph-not-ready");
      downloadUrl(
        await graphRef.current.toDataURL(),
        `product-knowledge-graph-${workspaceId}.png`,
      );
      void messageApi.success("知识图谱图片已下载");
    } catch {
      void messageApi.error("下载图片失败，请重试");
    }
  }, [messageApi, workspaceId]);

  const handleDownloadMarkdown = useCallback(() => {
    const markdown = data?.markdown ?? "";
    if (!markdown.trim()) {
      void messageApi.warning("暂无可下载的 Markdown 内容");
      return;
    }
    try {
      downloadUrl(
        URL.createObjectURL(
          new Blob([markdown], { type: "text/markdown;charset=utf-8" }),
        ),
        `product-knowledge-graph-${workspaceId}.md`,
        true,
      );
      void messageApi.success("知识图谱 Markdown 已下载");
    } catch {
      void messageApi.error("下载失败，请重试");
    }
  }, [data?.markdown, messageApi, workspaceId]);

  const hiddenCount = nodes.length - filteredNodes.length;

  return (
    <div className="kg-panel">
      {contextHolder}

      {/* 工具栏：规模与操作，筛选状态可见可撤销。 */}
      <header className="kg-panel-toolbar">
        <div className="kg-panel-toolbar-info">
          <strong>知识图谱</strong>
          <span>
            {nodes.length} 节点 · {relations.length} 关系
            {hiddenCount > 0 && ` · 已隐藏 ${hiddenCount}`}
            {data?.version ? ` · v${data.version}` : ""}
          </span>
        </div>
        <div className="kg-panel-toolbar-actions">
          {hiddenTypes.size > 0 && (
            <Button
              type="link"
              size="small"
              onClick={() => setHiddenTypes(new Set())}
            >
              全部显示
            </Button>
          )}
          {onRefresh && (
            <Tooltip title="重新读取图谱">
              <Button
                type="text"
                shape="circle"
                aria-label="重新读取图谱"
                icon={<ReloadOutlined />}
                loading={loading}
                onClick={onRefresh}
              />
            </Tooltip>
          )}
          <Tooltip title={isFullscreen ? "退出全屏" : "全屏查看"}>
            <Button
              type="text"
              shape="circle"
              aria-label={isFullscreen ? "退出全屏" : "全屏查看"}
              icon={
                isFullscreen ? <FullscreenExitOutlined /> : <FullscreenOutlined />
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
              onClick={() => void handleDownloadImage()}
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
        </div>
      </header>

      {error ? (
        // 失败必须显式呈现：只转圈会让用户以为一直在加载。
        <div className="kg-panel-center">
          <Empty
            image={Empty.PRESENTED_IMAGE_SIMPLE}
            description={`知识图谱读取失败：${error}`}
          />
          {onRefresh && (
            <Button onClick={onRefresh} loading={loading}>
              重试
            </Button>
          )}
        </div>
      ) : nodes.length === 0 && (loading || !attempted) ? (
        // 尚未拿到结果时显示加载态，避免把"还没读"误报成"没有数据"。
        <div className="kg-panel-center">
          <Spin />
          <span>正在读取知识图谱…</span>
        </div>
      ) : nodes.length === 0 ? (
        <div className="kg-panel-center">
          <Empty description="当前项目还没有知识图谱数据，完成一次任务后会自动写入。" />
        </div>
      ) : (
        <div className="kg-panel-body">
          {/* 筛选：点击类型名切换显示；隐藏项保留在原位，便于恢复。 */}
          <aside className="kg-panel-filter scrollbar-none-thin">
            <h4>实体类型</h4>
            <ul>
              {availableTypes.map((type) => {
                const hidden = hiddenTypes.has(type);
                const color = getKnowledgeGraphNodeColor(type);
                const count = nodes.filter((node) => node.type === type).length;
                return (
                  <li key={type}>
                    <button
                      type="button"
                      className="kg-panel-filter-row"
                      data-hidden={hidden ? "true" : "false"}
                      title={`点击${hidden ? "显示" : "隐藏"} ${NODE_TYPE_LABELS[type] ?? type}`}
                      onClick={() => toggleType(type)}
                    >
                      <span
                        className="kg-panel-filter-dot"
                        style={{ color, borderColor: color, background: `${color}18` }}
                        aria-hidden="true"
                      >
                        {NODE_TYPE_ICONS[type] ?? NODE_TYPE_ICONS.Custom}
                      </span>
                      <span className="kg-panel-filter-label">
                        {NODE_TYPE_LABELS[type] ?? type}
                      </span>
                      <em>{count}</em>
                    </button>
                  </li>
                );
              })}
            </ul>

            {availableRelationTypes.length > 0 && (
              <>
                <h4>关系类型</h4>
                <ul>
                  {availableRelationTypes.map((type) => (
                    <li key={type} className="kg-panel-legend-row">
                      <span
                        className="kg-panel-legend-line"
                        style={{ borderColor: getKnowledgeGraphRelationColor(type) }}
                        aria-hidden="true"
                      />
                      <span className="kg-panel-filter-label">
                        {RELATION_TYPE_LABELS[type] ?? type}
                      </span>
                      <em>
                        {
                          filteredRelations.filter(
                            (relation) => relation.type === type,
                          ).length
                        }
                      </em>
                    </li>
                  ))}
                </ul>
              </>
            )}

            <p className="kg-panel-hint">
              拖拽平移 · 滚轮缩放 · 点击节点聚焦 · 悬停节点或边查看说明
            </p>
          </aside>

          {/* 画布自己裁剪，不溢出到工具栏或详情。 */}
          <div className="kg-panel-canvas">
            <KnowledgeGraphView
              ref={graphRef}
              nodes={filteredNodes}
              relations={filteredRelations}
              onNodeSelect={setSelectedNode}
              className="h-full"
            />
          </div>

          <aside className="kg-panel-inspector scrollbar-none-thin">
            {selectedNode ? (
              <>
                <header className="kg-panel-inspector-head">
                  <h4>节点详情</h4>
                  <Button
                    type="text"
                    size="small"
                    aria-label="关闭节点详情"
                    icon={<CloseOutlined />}
                    onClick={() => setSelectedNode(null)}
                  />
                </header>
                <NodeDetail node={selectedNode} />
              </>
            ) : (
              <p className="kg-panel-hint">
                点击画布中的节点后，这里显示该节点信息。
              </p>
            )}
          </aside>
        </div>
      )}
    </div>
  );
}

/** 节点详情字段；ID 使用统一短展示。 */
function NodeDetail({ node }: { node: KnowledgeGraphNodeData }) {
  const rows: Array<[string, ReactNode]> = [
    ["ID", <span title={node.id}>{formatDisplayId(node.id)}</span>],
    ["名称", node.name],
    ["类型", NODE_TYPE_LABELS[node.type] ?? node.type],
  ];
  if (node.description) rows.push(["描述", node.description]);
  if (node.status) {
    rows.push([
      "状态",
      node.status === "confirmed"
        ? "已确认"
        : node.status === "deprecated"
          ? "已废弃"
          : "待确认",
    ]);
  }
  if (node.source_task_id) rows.push(["来源任务", node.source_task_id]);

  return (
    <dl className="kg-panel-detail">
      {rows.map(([label, value]) => (
        <div key={label} className="kg-panel-detail-row">
          <dt>{label}</dt>
          <dd>{value}</dd>
        </div>
      ))}
    </dl>
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
