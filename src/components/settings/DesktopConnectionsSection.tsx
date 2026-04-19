import { useEffect, useMemo, useState } from "react";
import { CheckCircle2, Link2, LoaderCircle, Plus, Server, Trash2, Wifi, WifiOff } from "lucide-react";
import { bridge } from "../../lib/bridge";
import { useStore } from "../../lib/store";
import type { AppSettings, SshConnectionConfig, SshConnectionTestResult, WorkspaceRef } from "../../lib/models";

function createId(prefix: string) {
  return `${prefix}-${Math.random().toString(36).slice(2, 10)}`;
}

function nowIso() {
  return new Date().toISOString();
}

function createDraft(seed?: Partial<SshConnectionConfig>): SshConnectionConfig {
  const timestamp = nowIso();
  return {
    id: seed?.id ?? createId("ssh"),
    name: seed?.name ?? "",
    host: seed?.host ?? "",
    port: seed?.port ?? 22,
    username: seed?.username ?? "",
    authMode: seed?.authMode ?? "agent",
    identityFile: seed?.identityFile ?? "",
    password: seed?.password ?? "",
    proxyJump: seed?.proxyJump ?? "",
    remoteShell: seed?.remoteShell ?? "bash",
    labels: seed?.labels ?? [],
    createdAt: seed?.createdAt ?? timestamp,
    updatedAt: seed?.updatedAt ?? timestamp,
    lastValidatedAt: seed?.lastValidatedAt ?? null,
    detectedCliPaths: seed?.detectedCliPaths ?? {
      codex: null,
      claude: null,
      gemini: null,
    },
  };
}

function connectionLabel(connection: Pick<SshConnectionConfig, "username" | "host">) {
  return `${connection.username || "user"}@${connection.host || "host"}`;
}

function normalizeLabels(value: string) {
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function cliDetectionLabel(path: string | null | undefined) {
  return path ? "已安装" : "未检测到";
}

function didConnectionRuntimeInputsChange(
  previous: SshConnectionConfig | null,
  next: Pick<
    SshConnectionConfig,
    "host" | "port" | "username" | "authMode" | "identityFile" | "password" | "proxyJump" | "remoteShell"
  >
) {
  if (!previous) return false;
  return (
    previous.host !== next.host ||
    previous.port !== next.port ||
    previous.username !== next.username ||
    previous.authMode !== next.authMode ||
    previous.identityFile !== next.identityFile ||
    previous.password !== next.password ||
    previous.proxyJump !== next.proxyJump ||
    previous.remoteShell !== next.remoteShell
  );
}

export function DesktopConnectionsSection({ settings }: { settings: AppSettings | null }) {
  const addRemoteWorkspace = useStore((state) => state.addRemoteWorkspace);
  const workspaces = useStore((state) => state.workspaces);
  const connections = settings?.sshConnections ?? [];
  const [selectedId, setSelectedId] = useState<string | null>(connections[0]?.id ?? null);
  const [draft, setDraft] = useState<SshConnectionConfig>(() => createDraft(connections[0]));
  const [labelsInput, setLabelsInput] = useState((connections[0]?.labels ?? []).join(", "));
  const [workspaceName, setWorkspaceName] = useState("");
  const [remotePath, setRemotePath] = useState("");
  const [busyAction, setBusyAction] = useState<"save" | "test" | "delete" | "workspace" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<SshConnectionTestResult | null>(null);

  const selectedConnection = useMemo(
    () => connections.find((item) => item.id === selectedId) ?? null,
    [connections, selectedId]
  );
  const remoteWorkspacesByConnection = useMemo(() => {
    const grouped = new Map<string, WorkspaceRef[]>();
    for (const workspace of workspaces) {
      if (workspace.locationKind !== "ssh" || !workspace.connectionId) continue;
      const existing = grouped.get(workspace.connectionId) ?? [];
      existing.push(workspace);
      grouped.set(workspace.connectionId, existing);
    }
    return grouped;
  }, [workspaces]);
  const selectedRemoteWorkspaces = useMemo(
    () => (selectedId ? remoteWorkspacesByConnection.get(selectedId) ?? [] : []),
    [remoteWorkspacesByConnection, selectedId]
  );

  useEffect(() => {
    if (!connections.length) {
      return;
    }

    const nextSelected = connections.find((item) => item.id === selectedId) ?? null;
    if (!nextSelected) {
      if (selectedId && selectedId === draft.id) {
        return;
      }
      const fallback = connections[0] ?? null;
      if (!fallback) return;
      setSelectedId(fallback.id);
      setDraft(createDraft(fallback));
      setLabelsInput(fallback.labels.join(", "));
      return;
    }
    setSelectedId(nextSelected.id);
    setDraft(createDraft(nextSelected));
    setLabelsInput(nextSelected.labels.join(", "));
  }, [connections, draft.id, selectedId]);

  function handleSelect(connection: SshConnectionConfig) {
    setSelectedId(connection.id);
    setDraft(createDraft(connection));
    setLabelsInput(connection.labels.join(", "));
    setWorkspaceName("");
    setRemotePath("");
    setTestResult(null);
    setError(null);
  }

  function handleCreateNew() {
    const nextDraft = createDraft();
    setSelectedId(nextDraft.id);
    setDraft(nextDraft);
    setLabelsInput("");
    setWorkspaceName("");
    setRemotePath("");
    setTestResult(null);
    setError(null);
  }

  async function persistDraft() {
    if (!settings) {
      throw new Error("设置尚未加载完成。");
    }
    if (!draft.name.trim() || !draft.host.trim() || !draft.username.trim()) {
      throw new Error("请至少填写名称、主机和用户名。");
    }
    if (draft.authMode === "identityFile" && !draft.identityFile.trim()) {
      throw new Error("使用密钥文件模式时需要填写 Identity file。");
    }
    if (draft.authMode === "password" && !draft.password) {
      throw new Error("使用密码模式时需要填写密码。");
    }

    const timestamp = nowIso();
    const previous = connections.find((item) => item.id === draft.id) ?? null;
    const nextDraft: SshConnectionConfig = {
      ...draft,
      name: draft.name.trim(),
      host: draft.host.trim(),
      username: draft.username.trim(),
      identityFile: draft.identityFile.trim(),
      password: draft.password,
      proxyJump: draft.proxyJump.trim(),
      remoteShell: draft.remoteShell.trim() || "bash",
      labels: normalizeLabels(labelsInput),
      port: Number.isFinite(draft.port) ? Math.max(1, Math.round(draft.port)) : 22,
      updatedAt: timestamp,
      createdAt: draft.createdAt || timestamp,
    };
    if (didConnectionRuntimeInputsChange(previous, nextDraft)) {
      nextDraft.lastValidatedAt = null;
      nextDraft.detectedCliPaths = {
        codex: null,
        claude: null,
        gemini: null,
      };
    }

    const nextConnections = connections.some((item) => item.id === nextDraft.id)
      ? connections.map((item) => (item.id === nextDraft.id ? nextDraft : item))
      : [nextDraft, ...connections];
    const updated = await bridge.updateSettings({
      ...settings,
      sshConnections: nextConnections,
    });
    useStore.setState({ settings: updated });
    setSelectedId(nextDraft.id);
    setDraft(nextDraft);
    setLabelsInput(nextDraft.labels.join(", "));
    return nextDraft;
  }

  async function handleSave() {
    setBusyAction("save");
    setError(null);
    try {
      await persistDraft();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : String(saveError));
    } finally {
      setBusyAction(null);
    }
  }

  async function handleDelete() {
    if (!settings || !selectedId) return;
    setBusyAction("delete");
    setError(null);
    try {
      const updated = await bridge.updateSettings({
        ...settings,
        sshConnections: connections.filter((item) => item.id !== selectedId),
      });
      useStore.setState({ settings: updated });
      handleCreateNew();
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : String(deleteError));
    } finally {
      setBusyAction(null);
    }
  }

  async function handleTest() {
    setBusyAction("test");
    setError(null);
    setTestResult(null);
    try {
      const saved = await persistDraft();
      const result = await bridge.testSshConnection(saved);
      setTestResult(result);
      const latestSettings = useStore.getState().settings;
      if (latestSettings) {
        const validatedAt = nowIso();
        const nextConnection: SshConnectionConfig = {
          ...saved,
          lastValidatedAt: validatedAt,
          detectedCliPaths: result.detectedCliPaths,
        };
        const updated = await bridge.updateSettings({
          ...latestSettings,
          sshConnections: latestSettings.sshConnections.some((item) => item.id === nextConnection.id)
            ? latestSettings.sshConnections.map((item) => (item.id === nextConnection.id ? nextConnection : item))
            : [nextConnection, ...latestSettings.sshConnections],
        });
        useStore.setState({ settings: updated });
        setDraft(nextConnection);
        setLabelsInput(nextConnection.labels.join(", "));
      }
    } catch (testError) {
      setError(testError instanceof Error ? testError.message : String(testError));
    } finally {
      setBusyAction(null);
    }
  }

  async function handleCreateWorkspace() {
    setBusyAction("workspace");
    setError(null);
    try {
      const saved = await persistDraft();
      if (!remotePath.trim()) {
        throw new Error("请输入远程工作区路径。");
      }
      addRemoteWorkspace({
        name: workspaceName.trim() || undefined,
        remotePath: remotePath.trim(),
        connectionId: saved.id,
        locationLabel: connectionLabel(saved),
      });
      setWorkspaceName("");
      setRemotePath("");
    } catch (workspaceError) {
      setError(workspaceError instanceof Error ? workspaceError.message : String(workspaceError));
    } finally {
      setBusyAction(null);
    }
  }

  return (
    <section className="settings-section">
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="settings-section-title">连接</div>
          <div className="settings-section-subtitle">
            在应用内维护 SSH 连接，并基于连接创建独立的远程工作区。
          </div>
        </div>
        <button
          type="button"
          className="dcc-action-button"
          onClick={handleCreateNew}
        >
          <Plus size={14} />
          新建连接
        </button>
      </div>

      <div className="mt-6 grid gap-4 xl:grid-cols-[320px_minmax(0,1fr)]">
        <div className="rounded-[20px] border border-slate-200 bg-white p-3 shadow-[0_18px_48px_rgba(15,23,42,0.06)]">
          <div className="mb-3 flex items-center justify-between">
            <div className="text-sm font-semibold text-slate-900">已保存连接</div>
            <span className="rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-medium text-slate-600">
              {connections.length} 个
            </span>
          </div>
          <div className="flex flex-col gap-2">
            {connections.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-slate-200 px-4 py-5 text-sm text-slate-500">
                还没有 SSH 连接。先在右侧填写一条连接并保存。
              </div>
            ) : (
              connections.map((connection) => {
                const active = connection.id === selectedId;
                const linkedWorkspaces = remoteWorkspacesByConnection.get(connection.id) ?? [];
                return (
                  <button
                    key={connection.id}
                    type="button"
                    onClick={() => handleSelect(connection)}
                    className={`rounded-2xl border px-4 py-3 text-left transition ${
                      active
                        ? "border-sky-200 bg-sky-50 shadow-[inset_0_0_0_1px_rgba(125,211,252,0.35)]"
                        : "border-slate-200 bg-slate-50 hover:border-slate-300 hover:bg-white"
                    }`}
                  >
                    <div className="flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <div className="truncate text-sm font-semibold text-slate-900">{connection.name}</div>
                          {linkedWorkspaces.length > 0 ? (
                            <span className="inline-flex shrink-0 items-center rounded-full border border-slate-200 bg-white/85 px-1.5 py-0.5 text-[10px] font-semibold text-slate-500">
                              {linkedWorkspaces.length} 个工作区
                            </span>
                          ) : null}
                        </div>
                        <div className="truncate text-xs text-slate-500">{connectionLabel(connection)}</div>
                      </div>
                      {connection.lastValidatedAt ? (
                        <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-500" />
                      ) : (
                        <Server className="h-4 w-4 shrink-0 text-slate-400" />
                      )}
                    </div>
                  </button>
                );
              })
            )}
          </div>
        </div>

        <div className="rounded-[20px] border border-slate-200 bg-white p-5 shadow-[0_18px_48px_rgba(15,23,42,0.06)]">
          <div className="grid gap-4 md:grid-cols-2">
            <label className="flex flex-col gap-2 text-sm text-slate-700">
              <span>连接名称</span>
              <input
                className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 outline-none transition focus:border-sky-300 focus:bg-white"
                value={draft.name}
                onChange={(event) => setDraft((current) => ({ ...current, name: event.target.value }))}
                placeholder="例如：prod-shanghai"
              />
            </label>
            <label className="flex flex-col gap-2 text-sm text-slate-700">
              <span>主机</span>
              <input
                className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 outline-none transition focus:border-sky-300 focus:bg-white"
                value={draft.host}
                onChange={(event) => setDraft((current) => ({ ...current, host: event.target.value }))}
                placeholder="server.example.com"
              />
            </label>
            <label className="flex flex-col gap-2 text-sm text-slate-700">
              <span>用户名</span>
              <input
                className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 outline-none transition focus:border-sky-300 focus:bg-white"
                value={draft.username}
                onChange={(event) => setDraft((current) => ({ ...current, username: event.target.value }))}
                placeholder="ubuntu"
              />
            </label>
            <label className="flex flex-col gap-2 text-sm text-slate-700">
              <span>端口</span>
              <input
                className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 outline-none transition focus:border-sky-300 focus:bg-white"
                value={draft.port}
                onChange={(event) =>
                  setDraft((current) => ({ ...current, port: Number.parseInt(event.target.value || "22", 10) || 22 }))
                }
                inputMode="numeric"
              />
            </label>
            <label className="flex flex-col gap-2 text-sm text-slate-700">
              <span>认证方式</span>
              <select
                className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 outline-none transition focus:border-sky-300 focus:bg-white"
                value={draft.authMode}
                onChange={(event) =>
                  setDraft((current) => ({
                    ...current,
                    authMode: event.target.value as SshConnectionConfig["authMode"],
                  }))
                }
              >
                <option value="agent">SSH Agent</option>
                <option value="identityFile">Identity file</option>
                <option value="password">Password</option>
              </select>
              <span className="text-xs leading-5 text-slate-500">
                SSH Agent 适合本机已有密钥，Identity file 适合指定私钥文件，Password 适合直接用服务器账号密码登录。
              </span>
            </label>
            <label className="flex flex-col gap-2 text-sm text-slate-700">
              <span>远程 Shell</span>
              <input
                className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 outline-none transition focus:border-sky-300 focus:bg-white"
                value={draft.remoteShell}
                onChange={(event) => setDraft((current) => ({ ...current, remoteShell: event.target.value }))}
                placeholder="bash"
              />
            </label>
            {draft.authMode === "identityFile" ? (
              <label className="md:col-span-2 flex flex-col gap-2 text-sm text-slate-700">
                <span>Identity file</span>
                <input
                  className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 outline-none transition focus:border-sky-300 focus:bg-white"
                  value={draft.identityFile}
                  onChange={(event) => setDraft((current) => ({ ...current, identityFile: event.target.value }))}
                  placeholder="~/.ssh/id_ed25519"
                />
              </label>
            ) : null}
            {draft.authMode === "password" ? (
              <label className="md:col-span-2 flex flex-col gap-2 text-sm text-slate-700">
                <span>密码</span>
                <input
                  type="password"
                  className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 outline-none transition focus:border-sky-300 focus:bg-white"
                  value={draft.password}
                  onChange={(event) => setDraft((current) => ({ ...current, password: event.target.value }))}
                  placeholder="输入服务器账号密码"
                />
              </label>
            ) : null}
            <label className="md:col-span-2 flex flex-col gap-2 text-sm text-slate-700">
              <span>ProxyJump</span>
              <input
                className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 outline-none transition focus:border-sky-300 focus:bg-white"
                value={draft.proxyJump}
                onChange={(event) => setDraft((current) => ({ ...current, proxyJump: event.target.value }))}
                placeholder="bastion.example.com"
              />
            </label>
            <label className="md:col-span-2 flex flex-col gap-2 text-sm text-slate-700">
              <span>标签</span>
              <input
                className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 outline-none transition focus:border-sky-300 focus:bg-white"
                value={labelsInput}
                onChange={(event) => setLabelsInput(event.target.value)}
                placeholder="prod, shanghai"
              />
            </label>
          </div>

          <div className="mt-5 flex flex-wrap gap-2">
            <button
              type="button"
              className="dcc-action-button"
              onClick={() => void handleSave()}
              disabled={busyAction !== null}
            >
              {busyAction === "save" ? <LoaderCircle size={14} className="animate-spin" /> : <Link2 size={14} />}
              保存连接
            </button>
            <button
              type="button"
              className="dcc-action-button secondary"
              onClick={() => void handleTest()}
              disabled={busyAction !== null}
            >
              {busyAction === "test" ? <LoaderCircle size={14} className="animate-spin" /> : <Wifi size={14} />}
              测试连接
            </button>
            {selectedConnection ? (
              <button
                type="button"
                className="dcc-action-button secondary"
                onClick={() => void handleDelete()}
                disabled={busyAction !== null}
              >
                {busyAction === "delete" ? <LoaderCircle size={14} className="animate-spin" /> : <Trash2 size={14} />}
                删除
              </button>
            ) : null}
          </div>

          {error ? (
            <div className="mt-4 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
              {error}
            </div>
          ) : null}

          {testResult ? (
            <div className="mt-5 rounded-[18px] border border-slate-200 bg-slate-50 p-4">
              <div className="mb-3 flex items-center justify-between">
                <div className="text-sm font-semibold text-slate-900">连接检测结果</div>
                <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-medium ${
                  testResult.reachable && testResult.authOk ? "bg-emerald-100 text-emerald-700" : "bg-rose-100 text-rose-700"
                }`}>
                  {testResult.reachable && testResult.authOk ? <Wifi size={12} /> : <WifiOff size={12} />}
                  {testResult.reachable && testResult.authOk ? "可连接" : "失败"}
                </span>
              </div>
              <div className="grid gap-2 text-sm text-slate-600 md:grid-cols-2">
                <div>平台：{testResult.platform ?? "未知"}</div>
                <div>Shell：{testResult.shell ?? "未知"}</div>
                <div>Python3：{testResult.pythonOk ? "已检测" : "未检测到"}</div>
                <div>认证：{testResult.authOk ? "通过" : "失败"}</div>
                <div>Codex：{cliDetectionLabel(testResult.detectedCliPaths.codex)}</div>
                <div>Claude：{cliDetectionLabel(testResult.detectedCliPaths.claude)}</div>
                <div className="md:col-span-2">Gemini：{cliDetectionLabel(testResult.detectedCliPaths.gemini)}</div>
              </div>
              {testResult.errors.length > 0 ? (
                <div className="mt-3 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-700">
                  {testResult.errors.join("；")}
                </div>
              ) : null}
            </div>
          ) : null}

          <div className="mt-6 rounded-[18px] border border-slate-200 bg-slate-50 p-4">
            <div className="text-sm font-semibold text-slate-900">创建远程工作区</div>
            <div className="mt-1 text-sm text-slate-500">
              保存连接后，把某个远程目录作为独立工作区挂进应用。
            </div>
            <div className="mt-4 grid gap-3 md:grid-cols-[minmax(0,1fr)_220px]">
              <input
                className="rounded-xl border border-slate-200 bg-white px-3 py-2.5 outline-none transition focus:border-sky-300"
                value={remotePath}
                onChange={(event) => setRemotePath(event.target.value)}
                placeholder="/srv/app"
              />
              <input
                className="rounded-xl border border-slate-200 bg-white px-3 py-2.5 outline-none transition focus:border-sky-300"
                value={workspaceName}
                onChange={(event) => setWorkspaceName(event.target.value)}
                placeholder="工作区名称，可选"
              />
            </div>
            <div className="mt-3">
              <button
                type="button"
                className="dcc-action-button secondary"
                onClick={() => void handleCreateWorkspace()}
                disabled={busyAction !== null}
              >
                {busyAction === "workspace" ? <LoaderCircle size={14} className="animate-spin" /> : <Server size={14} />}
                添加远程工作区
              </button>
            </div>
          </div>

          <div className="mt-4 rounded-[18px] border border-slate-200 bg-white p-4">
            <div className="flex items-center justify-between gap-3">
              <div>
                <div className="text-sm font-semibold text-slate-900">关联远程工作区</div>
                <div className="mt-1 text-sm text-slate-500">
                  按当前连接聚合展示，方便确认一条 SSH 连接下已经挂载了哪些目录。
                </div>
              </div>
              <span className="inline-flex items-center rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-medium text-slate-600">
                {selectedRemoteWorkspaces.length} 个
              </span>
            </div>

            {selectedRemoteWorkspaces.length > 0 ? (
              <div className="mt-4 space-y-2">
                {selectedRemoteWorkspaces.map((workspace) => (
                  <div
                    key={workspace.id}
                    className="flex items-start justify-between gap-3 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3"
                  >
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="truncate text-sm font-semibold text-slate-900">{workspace.name}</span>
                        <span className="inline-flex shrink-0 items-center rounded-full bg-emerald-100 px-1.5 py-0.5 text-[10px] font-semibold tracking-[0.08em] text-emerald-700">
                          SSH
                        </span>
                      </div>
                      <div className="mt-1 truncate text-xs text-slate-500">
                        {workspace.locationLabel ? `${workspace.locationLabel} · ` : null}
                        {workspace.remotePath ?? workspace.rootPath}
                      </div>
                    </div>
                    <div className="shrink-0 rounded-full bg-white px-2 py-1 text-[10px] font-medium text-slate-500">
                      {workspace.branch || "workspace"}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="mt-4 rounded-2xl border border-dashed border-slate-200 px-4 py-5 text-sm text-slate-500">
                当前连接还没有关联远程工作区。上方保存连接后，可以直接创建并挂载远程目录。
              </div>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
