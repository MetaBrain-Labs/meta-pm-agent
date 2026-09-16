/**
 * 知识图谱工作区
 *
 * 图谱画布本身就是工作区：画布铺满剩余空间，筛选与详情作为浮动面板叠在画布上，
 * 而不是把画布塞进卡片里。
 *
 * Responsibilities:
 * - 把工作区图谱交给共享 KnowledgeGraphView 渲染（不重写数据与 G6 逻辑）
 * - 顶部显示实体类型 / 关系类型数量与全屏
 * - 左上浮动面板做类型筛选，可折叠
 * - 右侧浮动 Inspector 显示节点或关系详情，点击空白关闭
 *
 * Notes:
 * - 只改展示层：节点/关系模型、图谱接口与图谱更新逻辑都不变。
 * - 筛选只作用于展示副本，关系两端都可见时才保留。
 * - 类型清单来自项目真实 schema（NODE/RELATION 常量表），不写死示例。
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
  CaretRightOutlined,
  CloseOutlined,
  DownloadOutlined,
  ExpandOutlined,
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
  const rootRef = useRef<HTMLDivElement>(null);
  const [selectedNode, setSelectedNode] =
    useState<KnowledgeGraphNodeData | null>(null);
  const [selectedRelation, setSelectedRelation] =
    useState<KnowledgeGraphRelationData | null>(null);
  const [hiddenNodeTypes, setHiddenNodeTypes] = useState<Set<string>>(new Set());
  const [hiddenRelationTypes, setHiddenRelationTypes] = useState<Set<string>>(
    new Set(),
  );
  const [filterOpen, setFilterOpen] = useState(true);
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

  // 全屏切换后几何大改，等布局稳定再让图谱重新适配。
  useEffect(() => {
    const frame = requestAnimationFrame(() => graphRef.current?.fitView());
    return () => cancelAnimationFrame(frame);
  }, [isFullscreen, filterOpen]);

  // 换工作区时清空筛选与选中，避免把上一个项目的条件带过来。
  useEffect(() => {
    setHiddenNodeTypes(new Set());
    setHiddenRelationTypes(new Set());
    setSelectedNode(null);
    setSelectedRelation(null);
  }, [workspaceId]);

  /** 项目真实 schema 中的类型清单，按类型名排序保证稳定。 */
  const nodeTypes = useMemo(
    () => [...new Set(nodes.map((node) => node.type))].sort(),
    [nodes],
  );
  const relationTypes = useMemo(
    () => [...new Set(relations.map((relation) => relation.type))].sort(),
    [relations],
  );

  const filteredNodes = useMemo(
    () => nodes.filter((node) => !hiddenNodeTypes.has(node.type)),
    [hiddenNodeTypes, nodes],
  );
  const visibleNodeIds = useMemo(
    () => new Set(filteredNodes.map((node) => node.id)),
    [filteredNodes],
  );
  /** 关系两端都必须可见，且关系类型未被隐藏。 */
  const filteredRelations = useMemo(
    () =>
      relations.filter(
        (relation) =>
          !hiddenRelationTypes.has(relation.type) &&
          visibleNodeIds.has(relation.source) &&
          visibleNodeIds.has(relation.target),
      ),
    [hiddenRelationTypes, relations, visibleNodeIds],
  );

  const toggleNodeType = useCallback((type: string) => {
    setHiddenNodeTypes((current) => toggleInSet(current, type));
    setSelectedNode(null);
  }, []);
  const toggleRelationType = useCallback((type: string) => {
    setHiddenRelationTypes((current) => toggleInSet(current, type));
    setSelectedRelation(null);
  }, []);

  const hiddenCount =
    nodes.length - filteredNodes.length + (relations.length - filteredRelations.length);
  const hasFilter = hiddenNodeTypes.size > 0 || hiddenRelationTypes.size > 0;

  const handleResetFilter = useCallback(() => {
    setHiddenNodeTypes(new Set());
    setHiddenRelationTypes(new Set());
  }, []);

  /** 节点与关系互斥选中：Inspector 同一时间只呈现一个对象。 */
  const handleNodeSelect = useCallback((node: KnowledgeGraphNodeData | null) => {
    setSelectedNode(node);
    if (node) setSelectedRelation(null);
  }, []);
  const handleRelationSelect = useCallback(
    (relation: KnowledgeGraphRelationData | null) => {
      setSelectedRelation(relation);
      if (relation) setSelectedNode(null);
    },
    [],
  );

  const handleToggleFullscreen = useCallback(() => {
    const root = rootRef.current;
    if (!root) return;
    if (document.fullscreenElement) {
      void document.exitFullscreen().catch(() => undefined);
      return;
    }
    void root.requestFullscreen().catch(() => {
      void messageApi.warning("当前环境不支持全屏");
    });
  }, [messageApi]);

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

  const hasGraph = nodes.length > 0;

  return (
    <div className="kg-workspace" ref={rootRef}>
      {contextHolder}

      {/* 顶栏：类型数量 + 全屏。轻量一条，不抢画布空间。 */}
      <header className="kg-topbar">
        <span className="kg-topbar-title">知识图谱</span>
        <span className="kg-topbar-metrics">
          <Metric label="实体类型" value={nodeTypes.length} />
          <Metric label="关系类型" value={relationTypes.length} />
          <span className="kg-topbar-sep" aria-hidden="true" />
          <Metric label="实体" value={nodes.length} />
          <Metric label="关系" value={relations.length} />
          {hiddenCount > 0 && (
            <em className="kg-topbar-hidden">已隐藏 {hiddenCount}</em>
          )}
        </span>
        <div className="kg-topbar-actions">
          {hasFilter && (
            <Button type="link" size="small" onClick={handleResetFilter}>
              重置筛选
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
          <Tooltip title="下载图谱图片">
            <Button
              type="text"
              shape="circle"
              aria-label="下载图谱图片"
              icon={<CameraOutlined />}
              disabled={!hasGraph}
              onClick={() => void handleDownloadImage()}
            />
          </Tooltip>
          <Tooltip title="下载 Markdown">
            <Button
              type="text"
              shape="circle"
              aria-label="下载 Markdown"
              icon={<DownloadOutlined />}
              disabled={!hasGraph}
              onClick={handleDownloadMarkdown}
            />
          </Tooltip>
          <Tooltip title={isFullscreen ? "退出全屏" : "全屏"}>
            <Button
              type="text"
              shape="circle"
              aria-label={isFullscreen ? "退出全屏" : "全屏"}
              icon={
                isFullscreen ? <FullscreenExitOutlined /> : <FullscreenOutlined />
              }
              disabled={!hasGraph}
              onClick={handleToggleFullscreen}
            />
          </Tooltip>
        </div>
      </header>

      {/* 画布区：铺满剩余空间，浮动面板叠在上面。 */}
      <div className="kg-canvas-area">
        {error ? (
          <div className="kg-canvas-center">
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
        ) : !hasGraph && (loading || !attempted) ? (
          <div className="kg-canvas-center">
            <Spin />
            <span>正在读取知识图谱…</span>
          </div>
        ) : !hasGraph ? (
          <div className="kg-canvas-center">
            <Empty description="当前项目还没有知识图谱数据，完成一次任务后会自动写入。" />
          </div>
        ) : (
          <KnowledgeGraphView
            ref={graphRef}
            nodes={filteredNodes}
            relations={filteredRelations}
            onNodeSelect={handleNodeSelect}
            onRelationSelect={handleRelationSelect}
            className="h-full"
          />
        )}

        {/* 浮动筛选面板：可折叠，不做 Drawer。 */}
        {hasGraph && (
          <div className="kg-float kg-filter" data-collapsed={filterOpen ? "false" : "true"}>
            <button
              type="button"
              className="kg-float-head"
              aria-expanded={filterOpen}
              onClick={() => setFilterOpen((open) => !open)}
            >
              <CaretRightOutlined
                className="kg-float-caret"
                data-open={filterOpen ? "true" : "false"}
                aria-hidden="true"
              />
              <span>图谱筛选</span>
              {hasFilter && <em>已筛</em>}
            </button>

            {filterOpen && (
              <div className="kg-float-body scrollbar-none-thin">
                <h4>实体类型</h4>
                <ul>
                  {nodeTypes.map((type) => {
                    const hidden = hiddenNodeTypes.has(type);
                    const color = getKnowledgeGraphNodeColor(type);
                    return (
                      <li key={type}>
                        <button
                          type="button"
                          className="kg-type-row"
                          data-hidden={hidden ? "true" : "false"}
                          title={`点击${hidden ? "显示" : "隐藏"} ${NODE_TYPE_LABELS[type] ?? type}`}
                          onClick={() => toggleNodeType(type)}
                        >
                          <span
                            className="kg-type-dot"
                            style={{
                              color,
                              borderColor: color,
                              background: `${color}18`,
                            }}
                            aria-hidden="true"
                          >
                            {NODE_TYPE_ICONS[type] ?? NODE_TYPE_ICONS.Custom}
                          </span>
                          <span className="kg-type-label">
                            {NODE_TYPE_LABELS[type] ?? type}
                          </span>
                          <em>
                            {nodes.filter((node) => node.type === type).length}
                          </em>
                        </button>
                      </li>
                    );
                  })}
                </ul>

                {relationTypes.length > 0 && (
                  <>
                    <h4>关系类型</h4>
                    <ul>
                      {relationTypes.map((type) => {
                        const hidden = hiddenRelationTypes.has(type);
                        return (
                          <li key={type}>
                            <button
                              type="button"
                              className="kg-type-row"
                              data-hidden={hidden ? "true" : "false"}
                              title={`点击${hidden ? "显示" : "隐藏"} ${RELATION_TYPE_LABELS[type] ?? type}`}
                              onClick={() => toggleRelationType(type)}
                            >
                              <span
                                className="kg-type-line"
                                style={{
                                  borderColor: getKnowledgeGraphRelationColor(type),
                                }}
                                aria-hidden="true"
                              />
                              <span className="kg-type-label">
                                {RELATION_TYPE_LABELS[type] ?? type}
                              </span>
                              <em>
                                {
                                  relations.filter(
                                    (relation) => relation.type === type,
                                  ).length
                                }
                              </em>
                            </button>
                          </li>
                        );
                      })}
                    </ul>
                  </>
                )}

                <p className="kg-float-hint">
                  拖拽平移 · 滚轮缩放 · 点击节点或关系查看详情
                </p>
              </div>
            )}
          </div>
        )}

        {/* 浮动 Inspector：节点或关系详情，点击空白关闭。 */}
        {hasGraph && (selectedNode || selectedRelation) && (
          <aside className="kg-float kg-inspector scrollbar-none-thin">
            <header className="kg-inspector-head">
              <h4>{selectedNode ? "节点详情" : "关系详情"}</h4>
              <Button
                type="text"
                size="small"
                aria-label="关闭详情"
                icon={<CloseOutlined />}
                onClick={() => {
                  setSelectedNode(null);
                  setSelectedRelation(null);
                }}
              />
            </header>
            {selectedNode ? (
              <NodeDetail node={selectedNode} />
            ) : selectedRelation ? (
              <RelationDetail
                relation={selectedRelation}
                nodes={nodes}
                onSelectNode={(nodeId) => {
                  const node = nodes.find((item) => item.id === nodeId);
                  if (node) handleNodeSelect(node);
                }}
              />
            ) : null}
          </aside>
        )}

        {/* 全屏时需要显式入口退出，浏览器 Esc 之外也能操作。 */}
        {isFullscreen && (
          <Tooltip title="退出全屏">
            <Button
              className="kg-fullscreen-exit"
              type="text"
              shape="circle"
              aria-label="退出全屏"
              icon={<ExpandOutlined />}
              onClick={handleToggleFullscreen}
            />
          </Tooltip>
        )}
      </div>
    </div>
  );
}

/** 顶栏的一项计数。 */
function Metric({ label, value }: { label: string; value: number }) {
  return (
    <span className="kg-topbar-metric">
      {label}
      <em>{value}</em>
    </span>
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
    <dl className="kg-detail">
      {rows.map(([label, value]) => (
        <div key={label} className="kg-detail-row">
          <dt>{label}</dt>
          <dd>{value}</dd>
        </div>
      ))}
    </dl>
  );
}

/** 关系详情：源实体、目标实体、关系类型与描述。 */
function RelationDetail({
  relation,
  nodes,
  onSelectNode,
}: {
  relation: KnowledgeGraphRelationData;
  nodes: KnowledgeGraphNodeData[];
  onSelectNode: (nodeId: string) => void;
}) {
  const source = nodes.find((node) => node.id === relation.source);
  const target = nodes.find((node) => node.id === relation.target);

  return (
    <dl className="kg-detail">
      <div className="kg-detail-row">
        <dt>源实体</dt>
        <dd>
          <NodeRef node={source} fallback={relation.source} onSelect={onSelectNode} />
        </dd>
      </div>
      <div className="kg-detail-row">
        <dt>目标实体</dt>
        <dd>
          <NodeRef node={target} fallback={relation.target} onSelect={onSelectNode} />
        </dd>
      </div>
      <div className="kg-detail-row">
        <dt>关系类型</dt>
        <dd>
          <span className="kg-relation-type">
            <span
              className="kg-type-line"
              style={{ borderColor: getKnowledgeGraphRelationColor(relation.type) }}
              aria-hidden="true"
            />
            {RELATION_TYPE_LABELS[relation.type] ?? relation.type}
          </span>
        </dd>
      </div>
      {relation.description && (
        <div className="kg-detail-row">
          <dt>关系描述</dt>
          <dd>{relation.description}</dd>
        </div>
      )}
      {relation.source_task_id && (
        <div className="kg-detail-row">
          <dt>来源任务</dt>
          <dd>{relation.source_task_id}</dd>
        </div>
      )}
    </dl>
  );
}

/** 关系端点：可点击跳转到该节点的详情。 */
function NodeRef({
  node,
  fallback,
  onSelect,
}: {
  node?: KnowledgeGraphNodeData;
  fallback: string;
  onSelect: (nodeId: string) => void;
}) {
  if (!node) return <span title={fallback}>{formatDisplayId(fallback)}</span>;
  return (
    <button
      type="button"
      className="kg-node-ref"
      title={node.name}
      onClick={() => onSelect(node.id)}
    >
      {node.name}
    </button>
  );
}

/** 在集合里切换某个成员。 */
function toggleInSet(current: Set<string>, value: string): Set<string> {
  const next = new Set(current);
  if (next.has(value)) next.delete(value);
  else next.add(value);
  return next;
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
