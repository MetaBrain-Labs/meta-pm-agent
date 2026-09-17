/**
 * 提示词管理设置面板
 *
 * 展示当前工作区白名单内的可配置提示词，并提供「查看 / 修改 / 恢复默认」三类动作。
 * 面板只根据服务端返回的能力决定按钮显隐与只读状态，真正的权限判定仍在 API 侧。
 *
 * Responsibilities:
 * - 读取工作区提示词列表与当前身份能力
 * - 编辑并保存单条提示词，保存失败时保留当前编辑内容
 * - 二次确认后恢复内置默认（删除 override）
 * - 向上层同步未保存状态，供切换页签与关闭弹窗时拦截
 *
 * Notes:
 * - 提示词内容按原样保留换行与空格，使用等宽字体与固定高度编辑器
 * - 不使用 localStorage 缓存提示词内容；数据源始终是 API
 */

import { useCallback, useEffect, useState } from "react";
import { App, Button, Empty, Input, Spin } from "antd";
import { InfoCircleOutlined } from "@ant-design/icons";
import {
  fetchWorkspacePrompts,
  resetWorkspacePrompt,
  saveWorkspacePrompt,
} from "../../api/prompt-config-api";
import type {
  PromptCategory,
  PromptConfigAccess,
  PromptSummary,
} from "../../types";
import { mapErrorToChinese } from "../../utils/errors";

const CATEGORY_LABELS: Record<PromptCategory, string> = {
  conversation: "对话",
  analysis: "分析",
  document: "文档",
};

/** 提示词编辑器高度：固定高度保证超长提示词只在编辑器内部滚动。 */
const EDITOR_HEIGHT = 300;

interface PromptConfigPanelProps {
  /** 当前工作区；为空时提示先创建工作区。 */
  workspaceId: string | null;
  /** 未保存状态回调，用于拦截页签切换与关闭弹窗。 */
  onDirtyChange: (dirty: boolean) => void;
}

/** 设置页提示词管理主面板。 */
export function PromptConfigPanel({
  workspaceId,
  onDirtyChange,
}: PromptConfigPanelProps) {
  const { modal, message } = App.useApp();
  const [prompts, setPrompts] = useState<PromptSummary[]>([]);
  const [access, setAccess] = useState<PromptConfigAccess | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draft, setDraft] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [resetting, setResetting] = useState(false);

  const selected = prompts.find((prompt) => prompt.id === selectedId) ?? null;
  const canWrite = Boolean(access?.canWrite) && Boolean(selected?.editable);
  const canReset = Boolean(access?.canReset) && Boolean(selected?.resettable);
  const dirty = Boolean(
    selected && draft !== null && draft !== selected.content,
  );
  const busy = saving || resetting;

  useEffect(() => {
    onDirtyChange(dirty);
  }, [dirty, onDirtyChange]);

  useEffect(() => {
    if (!workspaceId) {
      setPrompts([]);
      setAccess(null);
      setLoadError(null);
      setLoading(false);
      return;
    }

    let cancelled = false;
    setLoading(true);
    fetchWorkspacePrompts(workspaceId)
      .then((data) => {
        if (cancelled) return;
        setPrompts(data.prompts);
        setAccess(data.access);
        setLoadError(null);
        setSelectedId((previous) =>
          previous && data.prompts.some((prompt) => prompt.id === previous)
            ? previous
            : (data.prompts[0]?.id ?? null),
        );
      })
      .catch((error) => {
        if (cancelled) return;
        setPrompts([]);
        setAccess(null);
        setLoadError(mapErrorToChinese(error));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [workspaceId]);

  // 切换选中项或服务端内容变化后，编辑器回到当前生效正文。
  useEffect(() => {
    setDraft(selected?.content ?? null);
  }, [selected?.id, selected?.content]);

  /** 切换提示词；存在未保存修改时先确认。 */
  const handleSelect = useCallback(
    (promptId: string) => {
      if (promptId === selectedId) return;
      if (!dirty) {
        setSelectedId(promptId);
        return;
      }
      modal.confirm({
        title: "放弃未保存的修改？",
        content: "切换提示词后，当前未保存的内容会丢失。",
        okText: "放弃修改",
        cancelText: "继续编辑",
        onOk: () => setSelectedId(promptId),
      });
    },
    [dirty, modal, selectedId],
  );

  const handleDiscard = useCallback(() => {
    setDraft(selected?.content ?? null);
  }, [selected?.content]);

  /** 保存当前编辑内容；失败时保留编辑内容并提示原因。 */
  const handleSave = useCallback(async () => {
    if (!workspaceId || !selected || draft === null) return;
    if (!dirty || busy) return;

    setSaving(true);
    try {
      const saved = await saveWorkspacePrompt(workspaceId, selected.id, draft);
      setPrompts((previous) =>
        previous.map((prompt) => (prompt.id === saved.id ? saved : prompt)),
      );
      message.success("提示词已保存，后续新的 Agent 运行将使用自定义内容。");
    } catch (error) {
      message.error(mapErrorToChinese(error));
    } finally {
      setSaving(false);
    }
  }, [busy, dirty, draft, message, selected, workspaceId]);

  /** 二次确认后恢复内置默认：删除 override 而不是复制默认正文。 */
  const handleReset = useCallback(() => {
    if (!workspaceId || !selected) return;
    if (!canReset || busy || !selected.customized) return;

    modal.confirm({
      title: "恢复默认提示词",
      content:
        "确定恢复默认提示词吗？当前自定义内容将被清除，并恢复为程序内置版本。",
      okText: "恢复默认",
      cancelText: "取消",
      onOk: () => {
        setResetting(true);
        return resetWorkspacePrompt(workspaceId, selected.id)
          .then((restored) => {
            setPrompts((previous) =>
              previous.map((prompt) =>
                prompt.id === restored.id ? restored : prompt,
              ),
            );
            message.success("已恢复程序内置默认提示词。");
          })
          .catch((error) => {
            message.error(mapErrorToChinese(error));
          })
          .finally(() => {
            setResetting(false);
          });
      },
    });
  }, [busy, canReset, message, modal, selected, workspaceId]);

  if (!workspaceId) {
    return (
      <Empty description="请先在工作区列表中打开一个项目，再配置提示词。" />
    );
  }

  if (loading) {
    return (
      <div className="flex h-[420px] items-center justify-center">
        <Spin />
      </div>
    );
  }

  if (loadError || prompts.length === 0) {
    return (
      <Empty
        description={
          loadError ?? "当前没有可配置的提示词，请确认已执行建表 SQL。"
        }
      />
    );
  }

  return (
    <div className="flex h-[480px] min-h-0 gap-5">
      {/* 左列：提示词清单；只表达名称与当前状态，详情在右列。 */}
      <ul className="profile-items w-[236px] shrink-0 overflow-y-auto pr-1">
        {prompts.map((prompt) => {
          const active = prompt.id === selectedId;
          return (
            <li key={prompt.id}>
              <button
                type="button"
                onClick={() => handleSelect(prompt.id)}
                aria-current={active}
                className={`flex w-full flex-col gap-1 rounded-md px-2.5 py-2 text-left transition-colors ${
                  active
                    ? "bg-[var(--ds-color-active)] text-[var(--ink)]"
                    : "text-[var(--ink-mute)] hover:bg-[var(--ds-color-hover)]"
                }`}
              >
                <span className="text-[13px] font-medium leading-5">
                  {prompt.name}
                </span>
                <span className="line-clamp-2 text-[11px] leading-4 text-[var(--ink-faint)]">
                  {prompt.description}
                </span>
                <span className="flex items-center gap-1.5">
                  <span className="profile-badge" data-tone="muted">
                    {CATEGORY_LABELS[prompt.category]}
                  </span>
                  <PromptStatusBadge prompt={prompt} />
                </span>
              </button>
            </li>
          );
        })}
      </ul>

      {/* 右列：详情与编辑器。 */}
      <section className="flex min-w-0 flex-1 flex-col gap-3">
        {selected ? (
          <>
            <header className="flex flex-col gap-1.5">
              <div className="flex flex-wrap items-center gap-2">
                <h4 className="m-0 text-[14px] font-semibold text-[var(--ink)]">
                  {selected.name}
                </h4>
                <span className="profile-badge" data-tone="muted">
                  {CATEGORY_LABELS[selected.category]}
                </span>
                <PromptStatusBadge prompt={selected} />
                {dirty ? (
                  <span className="profile-badge" data-tone="muted">
                    未保存
                  </span>
                ) : null}
                {!canWrite ? (
                  <span className="profile-badge" data-tone="locked">
                    只读
                  </span>
                ) : null}
              </div>
              <p className="profile-list-desc">{selected.description}</p>
            </header>

            {selected.requiredTokens.length > 0 ? (
              <p className="profile-notice">
                <InfoCircleOutlined aria-hidden="true" />
                <span>
                  保存内容必须保留必要标记：
                  {selected.requiredTokens.map((token) => (
                    <code
                      key={token}
                      className="mx-1 font-mono text-[var(--ds-font-size-caption)]"
                    >
                      {token}
                    </code>
                  ))}
                </span>
              </p>
            ) : null}

            {selected.storedOverrideIgnored ? (
              <p className="profile-notice">
                <InfoCircleOutlined aria-hidden="true" />
                已保存的自定义内容未通过校验，运行时会回退内置默认。请重新保存或恢复默认。
              </p>
            ) : null}

            <Input.TextArea
              value={draft ?? ""}
              onChange={(event) => setDraft(event.target.value)}
              readOnly={!canWrite}
              spellCheck={false}
              aria-label={`${selected.name} 提示词内容`}
              style={{
                height: EDITOR_HEIGHT,
                resize: "none",
                fontFamily: "var(--ds-font-mono)",
                fontSize: "var(--ds-font-size-control)",
                lineHeight: 1.7,
              }}
            />

            <div className="flex flex-wrap items-center gap-2">
              {!canWrite ? (
                <span className="profile-list-desc">
                  当前身份只能查看提示词内容。如需修改，请由服务端配置提示词配置权限。
                </span>
              ) : null}
              <div className="ml-auto flex items-center gap-2">
                {canWrite ? (
                  <Button
                    size="small"
                    disabled={!dirty || busy}
                    onClick={handleDiscard}
                  >
                    取消
                  </Button>
                ) : null}
                {canWrite ? (
                  <Button
                    size="small"
                    type="primary"
                    loading={saving}
                    disabled={!dirty || busy}
                    onClick={() => void handleSave()}
                  >
                    保存修改
                  </Button>
                ) : null}
                {canReset ? (
                  <Button
                    size="small"
                    loading={resetting}
                    disabled={!selected.customized || busy}
                    onClick={handleReset}
                  >
                    恢复默认
                  </Button>
                ) : null}
              </div>
            </div>
          </>
        ) : (
          <Empty description="请选择左侧的一条提示词。" />
        )}
      </section>
    </div>
  );
}

/** 统一的提示词状态标记：默认 / 已自定义 / 已保存但被忽略。 */
function PromptStatusBadge({ prompt }: { prompt: PromptSummary }) {
  if (prompt.customized) {
    return (
      <span className="profile-badge" data-tone="muted">
        已自定义
      </span>
    );
  }
  return (
    <span className="profile-badge" data-tone="locked">
      默认
    </span>
  );
}
