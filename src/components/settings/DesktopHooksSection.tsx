import { useCallback, useEffect, useMemo, useState } from "react";
import { Braces, Plus, RefreshCw, Rows3, Save, Trash2, Webhook } from "lucide-react";
import { bridge } from "../../lib/bridge";
import type { WorkspaceRef } from "../../lib/models";

type HooksCliId = "codex" | "claude" | "gemini";
type HooksScope = "user" | "project";

type HookCommand = {
  type?: string;
  command?: string;
  timeout?: number;
  timeoutMs?: number;
  async?: boolean;
};

type HookRule = {
  matcher?: string;
  hooks?: HookCommand[];
};

type HooksDocument = {
  hooks?: Record<string, HookRule[]>;
  [key: string]: unknown;
};

type HookDraft = {
  event: string;
  matcher: string;
  command: string;
  timeout: string;
  async: boolean;
};

type HooksFileState = {
  path: string;
  exists: boolean;
  content: string;
  truncated: boolean;
  loading: boolean;
  saving: boolean;
  error: string | null;
  notice: string | null;
};

type HooksTarget = {
  cliId: HooksCliId;
  label: string;
  scope: HooksScope;
  path: string;
  configPath?: string | null;
  description: string;
};

type DesktopHooksSectionProps = {
  activeWorkspace: WorkspaceRef | null;
  workspaces: WorkspaceRef[];
};

const CODEX_HOOK_EVENTS = [
  "SessionStart",
  "PreToolUse",
  "PermissionRequest",
  "PostToolUse",
  "UserPromptSubmit",
  "Stop",
] as const;

const CLAUDE_HOOK_EVENTS = [
  "SessionStart",
  "PreToolUse",
  "PostToolUse",
  "Notification",
  "UserPromptSubmit",
  "Stop",
  "SubagentStop",
  "PreCompact",
] as const;

const GEMINI_HOOK_EVENTS = [
  "SessionStart",
  "SessionEnd",
  "BeforeAgent",
  "AfterAgent",
  "BeforeModel",
  "AfterModel",
  "BeforeToolSelection",
  "BeforeTool",
  "AfterTool",
  "PreCompress",
  "Notification",
] as const;

const CODEX_MATCHER_IGNORED_EVENTS = new Set(["UserPromptSubmit", "Stop"]);

function hookEventsForCli(cliId: HooksCliId) {
  if (cliId === "codex") return CODEX_HOOK_EVENTS;
  if (cliId === "gemini") return GEMINI_HOOK_EVENTS;
  return CLAUDE_HOOK_EVENTS;
}

function normalizeHookEventForCli(event: string, cliId: HooksCliId) {
  const events = hookEventsForCli(cliId);
  return events.includes(event as never) ? event : events[0];
}

const emptyFileState: HooksFileState = {
  path: "",
  exists: false,
  content: "",
  truncated: false,
  loading: true,
  saving: false,
  error: null,
  notice: null,
};

function cx(...values: Array<string | false | null | undefined>) {
  return values.filter(Boolean).join(" ");
}

function dirname(path: string) {
  const index = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
  return index >= 0 ? path.slice(0, index) : "";
}

function joinPath(...parts: string[]) {
  const filtered = parts.filter(Boolean);
  if (filtered.length === 0) return "";
  return filtered
    .map((part, index) => {
      if (index === 0) return part.replace(/[\\/]+$/g, "");
      return part.replace(/^[\\/]+|[\\/]+$/g, "");
    })
    .join("\\");
}

function parseHooksDocument(content: string): HooksDocument {
  if (!content.trim()) return { hooks: {} };
  const value = JSON.parse(content) as unknown;
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Hooks 配置必须是 JSON object。");
  }
  return value as HooksDocument;
}

function normalizeHooksDocument(document: HooksDocument): HooksDocument {
  const hooks = document.hooks;
  if (!hooks || typeof hooks !== "object" || Array.isArray(hooks)) {
    return { ...document, hooks: {} };
  }
  return document;
}

function extractDrafts(document: HooksDocument): HookDraft[] {
  const hooks = normalizeHooksDocument(document).hooks ?? {};
  return Object.entries(hooks).flatMap(([event, rules]) => {
    if (!Array.isArray(rules)) return [];
    return rules.flatMap((rule) => {
      const commands = Array.isArray(rule?.hooks) ? rule.hooks : [];
      return commands.map((hook) => ({
        event,
        matcher: typeof rule.matcher === "string" ? rule.matcher : "",
        command: typeof hook.command === "string" ? hook.command : "",
        timeout:
          typeof hook.timeoutMs === "number"
            ? String(hook.timeoutMs)
            : typeof hook.timeout === "number"
              ? String(hook.timeout)
              : "",
        async: hook.async === true,
      }));
    });
  });
}

function buildHooksDocument(base: HooksDocument, drafts: HookDraft[]): HooksDocument {
  const nextHooks: Record<string, HookRule[]> = {};

  for (const draft of drafts) {
    const event = draft.event.trim();
    const command = draft.command.trim();
    if (!event || !command) continue;
    const hook: HookCommand = { type: "command", command };
    const timeout = Number(draft.timeout);
    if (Number.isFinite(timeout) && timeout > 0) {
      hook.timeout = timeout;
    }
    if (draft.async) {
      hook.async = true;
    }
    const rule: HookRule = { hooks: [hook] };
    if (draft.matcher.trim()) {
      rule.matcher = draft.matcher.trim();
    }
    nextHooks[event] = [...(nextHooks[event] ?? []), rule];
  }

  return { ...base, hooks: nextHooks };
}

function summarizeDraft(draft: HookDraft) {
  const pieces = [draft.event];
  if (draft.matcher.trim()) pieces.push(draft.matcher.trim());
  if (draft.async) pieces.push("async");
  return pieces.join(" · ");
}

function makeDefaultDraft(): HookDraft {
  return {
    event: "PostToolUse",
    matcher: "",
    command: "",
    timeout: "",
    async: false,
  };
}

function timeoutPlaceholderForCli(cliId: HooksCliId) {
  if (cliId === "gemini") return "Optional: milliseconds";
  if (cliId === "codex") return "Optional: seconds";
  return "Optional: seconds, follows Claude Code";
}

function enableCodexHooksFeatureFlag(content: string) {
  const flagPattern = /(codex_hooks\s*=\s*)false/i;
  if (flagPattern.test(content)) {
    return content.replace(flagPattern, "$1true");
  }
  if (/codex_hooks\s*=\s*true/i.test(content)) {
    return content;
  }

  const trimmed = content.trimEnd();
  const prefix = trimmed.length > 0 ? `${trimmed}\n\n` : "";
  return `${prefix}[features]\ncodex_hooks = true\n`;
}

async function ensureCodexHooksEnabled(target: HooksTarget) {
  if (target.cliId !== "codex" || !target.configPath) return;
  const result = await bridge.readExternalAbsoluteFile(target.configPath);
  const nextContent = enableCodexHooksFeatureFlag(result.exists ? result.content : "");
  if (!result.exists || result.content !== nextContent) {
    await bridge.writeExternalAbsoluteFile(target.configPath, nextContent);
  }
}

async function resolveHooksTarget(cliId: HooksCliId, scope: HooksScope, activeWorkspace: WorkspaceRef | null): Promise<HooksTarget> {
  if (cliId === "codex") {
    if (scope === "project") {
      const root = activeWorkspace?.rootPath ?? "";
      return {
        cliId,
        label: "Codex",
        scope,
        path: root ? joinPath(root, ".codex", "hooks.json") : "",
        configPath: root ? joinPath(root, ".codex", "config.toml") : null,
        description: "项目级 Codex Hooks，随当前 workspace 生效。",
      };
    }

    const configPath = await bridge.getCodexConfigPath();
    const baseDir = configPath ? dirname(configPath) : "";
    return {
      cliId,
      label: "Codex",
      scope,
      path: baseDir ? joinPath(baseDir, "hooks.json") : "",
      configPath,
      description: "用户级 Codex Hooks，交给 Codex CLI 在生命周期内执行。",
    };
  }

  if (cliId === "gemini") {
    if (scope === "project") {
      const root = activeWorkspace?.rootPath ?? "";
      return {
        cliId,
        label: "Gemini CLI",
        scope,
        path: root ? joinPath(root, ".gemini", "settings.json") : "",
        configPath: null,
        description: "项目级 Gemini CLI settings.json 中的 hooks 字段。",
      };
    }

    const settingsPath = await bridge.getGeminiSettingsPath();
    return {
      cliId,
      label: "Gemini CLI",
      scope,
      path: settingsPath ?? "",
      configPath: null,
      description: "用户级 Gemini CLI settings.json 中的 hooks 字段。",
    };
  }

  if (scope === "project") {
    const root = activeWorkspace?.rootPath ?? "";
    return {
      cliId,
      label: "Claude Code",
      scope,
      path: root ? joinPath(root, ".claude", "settings.json") : "",
      configPath: null,
      description: "项目级 Claude Code settings.json 中的 hooks 字段。",
    };
  }

  const settingsPath = await bridge.getClaudeSettingsPath();
  return {
    cliId,
    label: "Claude Code",
    scope,
    path: settingsPath ?? "",
    configPath: null,
    description: "用户级 Claude Code settings.json 中的 hooks 字段。",
  };
}

export function DesktopHooksSection({ activeWorkspace, workspaces }: DesktopHooksSectionProps) {
  const [cliId, setCliId] = useState<HooksCliId>("codex");
  const [scope, setScope] = useState<HooksScope>("user");
  const [selectedWorkspaceId, setSelectedWorkspaceId] = useState(() => activeWorkspace?.id ?? workspaces[0]?.id ?? "");
  const [target, setTarget] = useState<HooksTarget | null>(null);
  const [fileState, setFileState] = useState<HooksFileState>(emptyFileState);
  const [drafts, setDrafts] = useState<HookDraft[]>([]);
  const [rawMode, setRawMode] = useState(false);
  const [rawContent, setRawContent] = useState("");

  const selectedWorkspace = workspaces.find((workspace) => workspace.id === selectedWorkspaceId) ?? activeWorkspace ?? workspaces[0] ?? null;
  const canUseProjectScope = Boolean(selectedWorkspace?.rootPath);
  const hookEvents = hookEventsForCli(cliId);

  const hooksSummary = useMemo(() => {
    const eventCount = new Set(drafts.map((draft) => draft.event.trim()).filter(Boolean)).size;
    return { eventCount, commandCount: drafts.filter((draft) => draft.command.trim()).length };
  }, [drafts]);

  const refresh = useCallback(async () => {
    setFileState((current) => ({ ...current, loading: true, error: null, notice: null }));
    try {
      const nextTarget = await resolveHooksTarget(cliId, scope, selectedWorkspace);
      setTarget(nextTarget);

      if (!nextTarget.path) {
        setFileState({
          ...emptyFileState,
          loading: false,
          error: scope === "project" ? "当前没有可用项目，无法解析项目级 Hooks 路径。" : "无法解析 CLI Hooks 配置路径。",
        });
        setDrafts([]);
        setRawContent("");
        return;
      }

      const result = await bridge.readExternalAbsoluteFile(nextTarget.path);
      const content = result.exists ? result.content : "";
      const document = parseHooksDocument(content);
      const nextDrafts = extractDrafts(document);
      setFileState({
        path: nextTarget.path,
        exists: result.exists,
        content,
        truncated: result.truncated,
        loading: false,
        saving: false,
        error: null,
        notice: result.exists ? null : "配置文件还不存在，保存后会自动创建。",
      });
      setRawContent(JSON.stringify(normalizeHooksDocument(document), null, 2));
      setDrafts(nextDrafts.length > 0 ? nextDrafts : []);
    } catch (error) {
      setFileState((current) => ({
        ...current,
        loading: false,
        saving: false,
        error: error instanceof Error ? error.message : String(error),
      }));
      setDrafts([]);
    }
  }, [cliId, scope, selectedWorkspace]);

  useEffect(() => {
    if (selectedWorkspaceId && workspaces.some((workspace) => workspace.id === selectedWorkspaceId)) {
      return;
    }
    setSelectedWorkspaceId(activeWorkspace?.id ?? workspaces[0]?.id ?? "");
  }, [activeWorkspace?.id, selectedWorkspaceId, workspaces]);

  useEffect(() => {
    if (scope === "project" && !canUseProjectScope) {
      setScope("user");
      return;
    }
    void refresh();
  }, [canUseProjectScope, refresh, scope]);

  useEffect(() => {
    setDrafts((current) =>
      current.map((draft) => ({
        ...draft,
        event: normalizeHookEventForCli(draft.event, cliId),
      }))
    );
  }, [cliId]);

  async function save() {
    if (!target?.path || fileState.saving) return;
    setFileState((current) => ({ ...current, saving: true, error: null, notice: null }));
    try {
      const base = parseHooksDocument(fileState.content);
      const nextDocument = rawMode
        ? normalizeHooksDocument(parseHooksDocument(rawContent))
        : buildHooksDocument(base, drafts);
      const nextContent = `${JSON.stringify(nextDocument, null, 2)}\n`;
      await bridge.writeExternalAbsoluteFile(target.path, nextContent);
      await ensureCodexHooksEnabled(target);
      setFileState({
        path: target.path,
        exists: true,
        content: nextContent,
        truncated: false,
        loading: false,
        saving: false,
        error: null,
        notice:
          target.cliId === "codex"
            ? "已保存 Hooks 配置，并确保 Codex codex_hooks feature flag 开启；新的 CLI 会话会读取最新配置。"
            : "已保存 Hooks 配置；新的 CLI 会话会读取最新配置。",
      });
      setRawContent(nextContent);
      setDrafts(extractDrafts(nextDocument));
    } catch (error) {
      setFileState((current) => ({
        ...current,
        saving: false,
        error: error instanceof Error ? error.message : String(error),
      }));
    }
  }

  function updateDraft(index: number, patch: Partial<HookDraft>) {
    setDrafts((current) => current.map((draft, draftIndex) => (draftIndex === index ? { ...draft, ...patch } : draft)));
  }

  function deleteDraft(index: number) {
    setDrafts((current) => current.filter((_, draftIndex) => draftIndex !== index));
  }

  const statusLabel = fileState.loading ? "读取中" : fileState.exists ? "已存在" : "待创建";
  const scopeLabel = scope === "project" ? "项目级" : "用户级";
  const targetWorkspaceLabel =
    scope === "project"
      ? selectedWorkspace
        ? `${selectedWorkspace.name} · ${selectedWorkspace.rootPath}`
        : "未选择项目"
      : target?.label ?? "当前 CLI";
  const editorSurfaceClassName = [
    "dcc-hooks-surface",
    "dcc-hooks-editor-surface",
    rawMode ? "dcc-hooks-editor-surface-raw" : drafts.length === 0 ? "dcc-hooks-editor-surface-empty" : "dcc-hooks-editor-surface-list",
  ].join(" ");

  return (
    <section className="settings-section dcc-hooks-section">
      <div className="dcc-projects-hero">
        <div className="dcc-projects-hero-copy">
          <div className="settings-section-title">Hooks</div>
          <div className="settings-section-subtitle">
            统一管理 Codex、Claude Code、Gemini CLI 的 hooks 配置，运行时仍由各自 CLI 接管。
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            className="dcc-action-button secondary dcc-hooks-icon-button"
            onClick={() => void refresh()}
            disabled={fileState.loading}
            aria-label="刷新 Hooks 配置"
            title="刷新 Hooks 配置"
          >
            <RefreshCw size={14} />
          </button>
        </div>
      </div>

      <section className="dcc-hooks-surface dcc-hooks-target-surface">
        <div className="dcc-hooks-surface-head">
          <div>
            <div className="dcc-panel-title">配置目标</div>
            <div className="dcc-card-description">先确定 CLI 和作用域，再编辑当前目标下的 hooks 内容。</div>
          </div>
          <div className="dcc-hooks-summary-strip">
            <div className="dcc-hooks-summary-item">
              <span>CLI</span>
              <strong>{target?.label ?? "Codex"}</strong>
            </div>
            <div className="dcc-hooks-summary-item">
              <span>级别</span>
              <strong>{scopeLabel}</strong>
            </div>
            <div className="dcc-hooks-summary-item">
              <span>状态</span>
              <strong>{statusLabel}</strong>
            </div>
          </div>
        </div>

        <div className="dcc-hooks-target-grid">
          <label>
            <span>CLI</span>
            <select value={cliId} onChange={(event) => setCliId(event.target.value as HooksCliId)} className="settings-select">
              <option value="codex">Codex</option>
              <option value="claude">Claude Code</option>
              <option value="gemini">Gemini CLI</option>
            </select>
          </label>
          <label>
            <span>配置级别</span>
            <select value={scope} onChange={(event) => setScope(event.target.value as HooksScope)} className="settings-select">
              <option value="user">用户级</option>
              <option value="project" disabled={workspaces.length === 0}>项目级</option>
            </select>
          </label>
          {scope === "project" ? (
            <label className="dcc-hooks-target-project">
              <span>项目</span>
              <select
                value={selectedWorkspace?.id ?? ""}
                onChange={(event) => setSelectedWorkspaceId(event.target.value)}
                className="settings-select"
                disabled={workspaces.length === 0}
              >
                {workspaces.length === 0 ? <option value="">暂无项目</option> : null}
                {workspaces.map((workspace) => (
                  <option value={workspace.id} key={workspace.id}>
                    {workspace.name} — {workspace.rootPath}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
        </div>

        <div className="dcc-hooks-target-meta">
          <div className="dcc-hooks-meta-item">
            <span>配置文件</span>
            <strong>{target?.path || "未解析"}</strong>
          </div>
          <div className="dcc-hooks-meta-item">
            <span>当前目标</span>
            <strong>{targetWorkspaceLabel}</strong>
          </div>
          <div className="dcc-hooks-meta-item">
            <span>Hooks 概览</span>
            <strong>{hooksSummary.eventCount} 个事件 / {hooksSummary.commandCount} 条命令</strong>
          </div>
          {target?.configPath ? (
            <div className="dcc-hooks-meta-item">
              <span>Feature Flag</span>
              <strong>{target.configPath}</strong>
            </div>
          ) : null}
        </div>

        {target?.description ? <div className="settings-help dcc-hooks-target-help">{target.description}</div> : null}
      </section>

      {fileState.error ? <div className="settings-inline-error">{fileState.error}</div> : null}
      {fileState.truncated ? <div className="settings-inline-error">文件过大已被截断，暂不建议在这里保存。</div> : null}

      <section className={editorSurfaceClassName}>
        <div className="dcc-hooks-surface-head">
          <div>
            <div className="dcc-panel-title">Hooks 详情</div>
            <div className="dcc-card-description">保持结构统一。目标区负责定位，详情区负责编辑和预览。</div>
          </div>
          <div className="dcc-hooks-toolbar">
            <button
              type="button"
              className="dcc-action-button secondary dcc-hooks-icon-button"
              onClick={() => setDrafts((current) => [...current, makeDefaultDraft()])}
              aria-label="添加 Hook"
              title="添加 Hook"
            >
              <Plus size={14} />
            </button>
            <button
              type="button"
              className="dcc-action-button secondary dcc-hooks-icon-button"
              onClick={() => setRawMode((current) => !current)}
              aria-label={rawMode ? "切换到表单编辑" : "切换到 JSON 编辑"}
              title={rawMode ? "切换到表单编辑" : "切换到 JSON 编辑"}
            >
              {rawMode ? <Rows3 size={14} /> : <Braces size={14} />}
            </button>
            <button
              type="button"
              className="dcc-action-button dcc-hooks-icon-button dcc-hooks-toolbar-save"
              onClick={() => void save()}
              disabled={!target?.path || fileState.saving}
              aria-label={fileState.saving ? "保存中" : "保存 Hooks 配置"}
              title={fileState.saving ? "保存中" : "保存 Hooks 配置"}
            >
              <Save size={14} />
            </button>
          </div>
        </div>

        {rawMode ? (
          <label className="dcc-hooks-command-field">
            <span>JSON</span>
            <textarea
              className="settings-prompt-textarea dcc-hooks-raw-editor"
              value={rawContent}
              onChange={(event) => setRawContent(event.target.value)}
              spellCheck={false}
            />
          </label>
        ) : drafts.length === 0 ? (
          <div className="dcc-empty-state dcc-hooks-empty">
            <Webhook size={24} />
            <div className="dcc-card-title">还没有 Hooks</div>
            <div className="dcc-card-description">添加一条 Hook 后保存，CLI 会在后续会话生命周期中读取并执行。</div>
          </div>
        ) : (
          <div className="dcc-hooks-list">
            {drafts.map((draft, index) => {
              const matcherIgnored = cliId === "codex" && CODEX_MATCHER_IGNORED_EVENTS.has(draft.event);
              return (
                <article className="dcc-hooks-card" key={`${draft.event}-${index}`}>
                  <div className="dcc-hooks-card-head">
                    <div>
                      <div className="dcc-panel-title">{summarizeDraft(draft)}</div>
                      <div className="dcc-card-description">命令由 {target?.label ?? "CLI"} 在对应事件触发时执行。</div>
                    </div>
                    <button
                      type="button"
                      className="dcc-action-button danger dcc-hooks-icon-button"
                      onClick={() => deleteDraft(index)}
                      aria-label="删除 Hook"
                      title="删除 Hook"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>

                  <div className="dcc-hooks-form-grid">
                    <label>
                      <span>事件</span>
                      <select value={draft.event} onChange={(event) => updateDraft(index, { event: event.target.value })} className="settings-select">
                        {hookEvents.map((eventName) => (
                          <option value={eventName} key={eventName}>{eventName}</option>
                        ))}
                      </select>
                    </label>
                    <label>
                      <span>Matcher</span>
                      <input
                        className="dcc-search-input"
                        value={draft.matcher}
                        onChange={(event) => updateDraft(index, { matcher: event.target.value })}
                        placeholder={matcherIgnored ? "Codex 会忽略此事件的 matcher" : "可选：工具名 / 正则 / *"}
                        disabled={matcherIgnored}
                      />
                    </label>
                    <label>
                      <span>Timeout</span>
                      <input
                        className="dcc-search-input"
                        value={draft.timeout}
                        onChange={(event) => updateDraft(index, { timeout: event.target.value })}
                        placeholder={timeoutPlaceholderForCli(cliId)}
                      />
                    </label>
                    <label className="dcc-hooks-checkbox">
                      <input type="checkbox" checked={draft.async} onChange={(event) => updateDraft(index, { async: event.target.checked })} />
                      后台异步执行
                    </label>
                  </div>
                  <label className="dcc-hooks-command-field">
                    <span>Command</span>
                    <textarea className="settings-prompt-textarea" value={draft.command} onChange={(event) => updateDraft(index, { command: event.target.value })} placeholder="例如：npm test 或 pwsh -File .codex/hooks/check.ps1" />
                  </label>
                </article>
              );
            })}
          </div>
        )}
      </section>
    </section>
  );
}
