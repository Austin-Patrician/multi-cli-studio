import { useCallback, useEffect, useMemo, useState } from "react";
import type { AgentCard, ModelProviderConfig } from "../../../lib/models";
import { bridge } from "../../../lib/bridge";
import type {
  GeminiAuthMode,
  GeminiPreflightCheck,
  GeminiVendorDraft,
  VendorCustomModel,
} from "./types";
import { GEMINI_AUTH_MODES, isValidVendorModelId } from "./types";

const LEGACY_STORAGE_KEY_ALIASES: Record<string, string[]> = {
  "claude-custom-models": [
    "mossx-claude-custom-models",
    "codemoss-claude-custom-models",
  ],
  "codex-custom-models": [
    "mossx-codex-custom-models",
    "codemoss-codex-custom-models",
  ],
  "gemini-custom-models": [
    "mossx-gemini-custom-models",
    "codemoss-gemini-custom-models",
  ],
};

const GEMINI_VENDOR_STORAGE_KEY = "multi-cli-studio:gemini-vendor-settings-v1";

type ExternalTextState = {
  path: string;
  loading: boolean;
  exists: boolean;
  content: string;
  truncated: boolean;
  error: string | null;
};

export type CodexConfigFilesState = {
  config: ExternalTextState;
  auth: ExternalTextState;
  refresh: () => Promise<void>;
};

export type ClaudeConfigFileState = {
  settings: ExternalTextState;
  refresh: () => Promise<void>;
};

type GeminiImportantValues = Omit<GeminiVendorDraft, "enabled" | "envText" | "authMode">;

const DEFAULT_GEMINI_DRAFT: GeminiVendorDraft = {
  enabled: true,
  envText: "",
  authMode: "login_google",
  apiBaseUrl: "",
  geminiApiKey: "",
  googleApiKey: "",
  googleCloudProject: "",
  googleCloudLocation: "",
  googleApplicationCredentials: "",
  model: "",
};

const GEMINI_ENV_KEYS = {
  baseUrl: "GOOGLE_GEMINI_BASE_URL",
  legacyBaseUrl: "GEMINI_BASE_URL",
  geminiApiKey: "GEMINI_API_KEY",
  legacyGeminiApiKey: "GOOGLE_GEMINI_API_KEY",
  googleApiKey: "GOOGLE_API_KEY",
  cloudProject: "GOOGLE_CLOUD_PROJECT",
  cloudProjectLegacy: "GOOGLE_CLOUD_PROJECT_ID",
  cloudLocation: "GOOGLE_CLOUD_LOCATION",
  applicationCredentials: "GOOGLE_APPLICATION_CREDENTIALS",
  model: "GEMINI_MODEL",
} as const;

function defaultExternalTextState(path = ""): ExternalTextState {
  return {
    path,
    loading: false,
    exists: false,
    content: "",
    truncated: false,
    error: null,
  };
}

function parseModels(value: string | null): VendorCustomModel[] {
  if (!value) {
    return [];
  }
  try {
    const raw = JSON.parse(value);
    if (!Array.isArray(raw)) {
      return [];
    }
    const models: VendorCustomModel[] = [];
    for (const item of raw) {
      if (!item || typeof item !== "object") continue;
      const candidate = item as Partial<VendorCustomModel>;
      if (typeof candidate.id !== "string" || !isValidVendorModelId(candidate.id)) {
        continue;
      }
      const id = candidate.id.trim();
      const label =
        typeof candidate.label === "string" && candidate.label.trim()
          ? candidate.label.trim()
          : id;
      const description =
        typeof candidate.description === "string" && candidate.description.trim()
          ? candidate.description.trim()
          : undefined;
      models.push({ id, label, description });
    }
    return models;
  } catch {
    return [];
  }
}

function readPluginModels(storageKey: string): VendorCustomModel[] {
  if (typeof window === "undefined" || !window.localStorage) {
    return [];
  }
  const canonicalRaw = window.localStorage.getItem(storageKey);
  const canonical = parseModels(canonicalRaw);
  if (canonicalRaw !== null) {
    return canonical;
  }

  const legacyKeys = LEGACY_STORAGE_KEY_ALIASES[storageKey] ?? [];
  for (const legacyKey of legacyKeys) {
    const legacyModels = parseModels(window.localStorage.getItem(legacyKey));
    if (legacyModels.length === 0) {
      continue;
    }
    try {
      window.localStorage.setItem(storageKey, JSON.stringify(legacyModels));
      window.dispatchEvent(
        new CustomEvent("localStorageChange", { detail: { key: storageKey } }),
      );
    } catch {
      // ignore migration write failures
    }
    return legacyModels;
  }

  return [];
}

function writePluginModels(storageKey: string, models: VendorCustomModel[]) {
  if (typeof window === "undefined" || !window.localStorage) {
    return;
  }
  try {
    window.localStorage.setItem(storageKey, JSON.stringify(models));
    window.dispatchEvent(
      new CustomEvent("localStorageChange", { detail: { key: storageKey } }),
    );
  } catch {
    // ignore localStorage write failures
  }
}

export function usePluginModels(storageKey: string) {
  const [models, setModels] = useState<VendorCustomModel[]>(() =>
    readPluginModels(storageKey),
  );

  useEffect(() => {
    const handleStorageChange = (event: StorageEvent) => {
      if (event.key === storageKey) {
        setModels(readPluginModels(storageKey));
      }
    };
    const handleCustomChange = (event: Event) => {
      const detail = (event as CustomEvent<{ key?: string }>).detail;
      if (detail?.key === storageKey) {
        setModels(readPluginModels(storageKey));
      }
    };

    window.addEventListener("storage", handleStorageChange);
    window.addEventListener("localStorageChange", handleCustomChange);
    return () => {
      window.removeEventListener("storage", handleStorageChange);
      window.removeEventListener("localStorageChange", handleCustomChange);
    };
  }, [storageKey]);

  const updateModels = useCallback(
    (nextModels: VendorCustomModel[]) => {
      setModels(nextModels);
      writePluginModels(storageKey, nextModels);
    },
    [storageKey],
  );

  return {
    models,
    updateModels,
  };
}

function siblingPath(path: string, fileName: string) {
  const normalized = path.replace(/\\/g, "/");
  const index = normalized.lastIndexOf("/");
  if (index < 0) {
    return fileName;
  }
  const sibling = `${normalized.slice(0, index + 1)}${fileName}`;
  return path.includes("\\") ? sibling.replace(/\//g, "\\") : sibling;
}

export function useCodexConfigFiles(): CodexConfigFilesState {
  const [config, setConfig] = useState<ExternalTextState>(defaultExternalTextState());
  const [auth, setAuth] = useState<ExternalTextState>(defaultExternalTextState());

  const refresh = useCallback(async () => {
    setConfig((current) => ({ ...current, loading: true, error: null }));
    setAuth((current) => ({ ...current, loading: true, error: null }));

    try {
      const configPath = await bridge.getCodexConfigPath();
      if (!configPath) {
        const unavailable = {
          exists: false,
          content: "",
          truncated: false,
          error: "当前运行时无法解析 Codex 全局配置路径。",
          loading: false,
        };
        setConfig({ path: "", ...unavailable });
        setAuth({ path: "", ...unavailable });
        return;
      }

      const authPath = siblingPath(configPath, "auth.json");
      const [configResult, authResult] = await Promise.allSettled([
        bridge.readExternalAbsoluteFile(configPath),
        bridge.readExternalAbsoluteFile(authPath),
      ]);

      if (configResult.status === "fulfilled") {
        setConfig({
          path: configPath,
          loading: false,
          exists: configResult.value.exists,
          content: configResult.value.content,
          truncated: configResult.value.truncated,
          error: null,
        });
      } else {
        setConfig({
          path: configPath,
          loading: false,
          exists: false,
          content: "",
          truncated: false,
          error:
            configResult.reason instanceof Error
              ? configResult.reason.message
              : String(configResult.reason),
        });
      }

      if (authResult.status === "fulfilled") {
        setAuth({
          path: authPath,
          loading: false,
          exists: authResult.value.exists,
          content: authResult.value.content,
          truncated: authResult.value.truncated,
          error: null,
        });
      } else {
        setAuth({
          path: authPath,
          loading: false,
          exists: false,
          content: "",
          truncated: false,
          error:
            authResult.reason instanceof Error
              ? authResult.reason.message
              : String(authResult.reason),
        });
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setConfig((current) => ({ ...current, loading: false, error: message }));
      setAuth((current) => ({ ...current, loading: false, error: message }));
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return { config, auth, refresh };
}

export function useClaudeConfigFile(): ClaudeConfigFileState {
  const [settings, setSettings] = useState<ExternalTextState>(defaultExternalTextState());

  const refresh = useCallback(async () => {
    setSettings((current) => ({ ...current, loading: true, error: null }));

    try {
      const settingsPath = await bridge.getClaudeSettingsPath();
      if (!settingsPath) {
        setSettings({
          path: "",
          loading: false,
          exists: false,
          content: "",
          truncated: false,
          error: "当前运行时无法解析 Claude 配置路径。",
        });
        return;
      }

      const result = await bridge.readExternalAbsoluteFile(settingsPath);
      setSettings({
        path: settingsPath,
        loading: false,
        exists: result.exists,
        content: result.content,
        truncated: result.truncated,
        error: null,
      });
    } catch (error) {
      setSettings((current) => ({
        ...current,
        loading: false,
        error: error instanceof Error ? error.message : String(error),
      }));
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return { settings, refresh };
}

function envMapToText(env: Record<string, string>) {
  return Object.entries(env)
    .map(([key, value]) => [key.trim(), value] as const)
    .filter(([key]) => key.length > 0)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `${key}=${value}`)
    .join("\n");
}

function parseEnvText(envText: string): Record<string, string> {
  const env: Record<string, string> = {};
  for (const rawLine of envText.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) {
      continue;
    }
    const index = line.indexOf("=");
    if (index <= 0) {
      continue;
    }
    const key = line.slice(0, index).trim();
    const value = line.slice(index + 1).trim();
    if (!key) {
      continue;
    }
    env[key] = value;
  }
  return env;
}

function findEnvValue(env: Record<string, string>, keys: string[]) {
  for (const key of keys) {
    const value = env[key];
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }
  return "";
}

function extractGeminiImportantValues(env: Record<string, string>): GeminiImportantValues {
  return {
    apiBaseUrl: findEnvValue(env, [GEMINI_ENV_KEYS.baseUrl, GEMINI_ENV_KEYS.legacyBaseUrl]),
    geminiApiKey: findEnvValue(env, [
      GEMINI_ENV_KEYS.geminiApiKey,
      GEMINI_ENV_KEYS.legacyGeminiApiKey,
    ]),
    googleApiKey: findEnvValue(env, [GEMINI_ENV_KEYS.googleApiKey]),
    googleCloudProject: findEnvValue(env, [
      GEMINI_ENV_KEYS.cloudProject,
      GEMINI_ENV_KEYS.cloudProjectLegacy,
    ]),
    googleCloudLocation: findEnvValue(env, [GEMINI_ENV_KEYS.cloudLocation]),
    googleApplicationCredentials: findEnvValue(env, [
      GEMINI_ENV_KEYS.applicationCredentials,
    ]),
    model: findEnvValue(env, [GEMINI_ENV_KEYS.model]),
  };
}

function inferGeminiAuthMode(values: GeminiImportantValues): GeminiAuthMode {
  if (values.apiBaseUrl.trim()) return "custom";
  if (values.geminiApiKey.trim()) return "gemini_api_key";
  if (values.googleApiKey.trim()) return "vertex_api_key";
  if (values.googleApplicationCredentials.trim()) return "vertex_service_account";
  if (values.googleCloudProject.trim() || values.googleCloudLocation.trim()) {
    return "vertex_adc";
  }
  return "login_google";
}

function normalizeGeminiAuthMode(
  mode: string | null | undefined,
  fallbackValues: GeminiImportantValues,
): GeminiAuthMode {
  if (mode && GEMINI_AUTH_MODES.includes(mode as GeminiAuthMode)) {
    return mode as GeminiAuthMode;
  }
  return inferGeminiAuthMode(fallbackValues);
}

function syncGeminiEnvText(draft: GeminiVendorDraft) {
  const env = parseEnvText(draft.envText);
  const assignOrDelete = (key: string, value: string) => {
    const normalized = value.trim();
    if (!normalized) {
      delete env[key];
      return;
    }
    env[key] = normalized;
  };

  assignOrDelete(GEMINI_ENV_KEYS.baseUrl, draft.apiBaseUrl);
  delete env[GEMINI_ENV_KEYS.legacyBaseUrl];
  assignOrDelete(GEMINI_ENV_KEYS.geminiApiKey, draft.geminiApiKey);
  delete env[GEMINI_ENV_KEYS.legacyGeminiApiKey];
  assignOrDelete(GEMINI_ENV_KEYS.googleApiKey, draft.googleApiKey);
  assignOrDelete(GEMINI_ENV_KEYS.cloudProject, draft.googleCloudProject);
  delete env[GEMINI_ENV_KEYS.cloudProjectLegacy];
  assignOrDelete(GEMINI_ENV_KEYS.cloudLocation, draft.googleCloudLocation);
  assignOrDelete(
    GEMINI_ENV_KEYS.applicationCredentials,
    draft.googleApplicationCredentials,
  );
  assignOrDelete(GEMINI_ENV_KEYS.model, draft.model);

  return envMapToText(env);
}

function patchGeminiAuthMode(
  draft: GeminiVendorDraft,
  mode: GeminiAuthMode,
): GeminiVendorDraft {
  const next = { ...draft, authMode: mode };
  if (mode === "login_google") {
    next.apiBaseUrl = "";
    next.geminiApiKey = "";
    next.googleApiKey = "";
    next.googleCloudProject = "";
    next.googleCloudLocation = "";
    next.googleApplicationCredentials = "";
  } else if (mode === "custom") {
    next.googleApiKey = "";
    next.googleCloudProject = "";
    next.googleCloudLocation = "";
    next.googleApplicationCredentials = "";
  } else if (mode === "gemini_api_key") {
    next.apiBaseUrl = "";
    next.googleApiKey = "";
    next.googleCloudProject = "";
    next.googleCloudLocation = "";
    next.googleApplicationCredentials = "";
  } else if (mode === "vertex_api_key") {
    next.apiBaseUrl = "";
    next.geminiApiKey = "";
    next.googleApplicationCredentials = "";
  } else if (mode === "vertex_service_account") {
    next.apiBaseUrl = "";
    next.geminiApiKey = "";
    next.googleApiKey = "";
  } else {
    next.apiBaseUrl = "";
    next.geminiApiKey = "";
    next.googleApiKey = "";
    next.googleApplicationCredentials = "";
  }
  next.envText = syncGeminiEnvText(next);
  return next;
}

function readGeminiDraft() {
  if (typeof window === "undefined" || !window.localStorage) {
    return DEFAULT_GEMINI_DRAFT;
  }
  const raw = window.localStorage.getItem(GEMINI_VENDOR_STORAGE_KEY);
  if (!raw) {
    return DEFAULT_GEMINI_DRAFT;
  }
  try {
    const parsed = JSON.parse(raw) as Partial<GeminiVendorDraft>;
    const envText = typeof parsed.envText === "string" ? parsed.envText : "";
    const envMap = parseEnvText(envText);
    const importantValues = extractGeminiImportantValues(envMap);
    return {
      enabled: parsed.enabled !== false,
      envText: envMapToText(envMap),
      authMode: normalizeGeminiAuthMode(parsed.authMode, importantValues),
      ...importantValues,
    } satisfies GeminiVendorDraft;
  } catch {
    return DEFAULT_GEMINI_DRAFT;
  }
}

function writeGeminiDraft(draft: GeminiVendorDraft) {
  if (typeof window === "undefined" || !window.localStorage) {
    return;
  }
  window.localStorage.setItem(GEMINI_VENDOR_STORAGE_KEY, JSON.stringify(draft));
}

function buildGeminiPreflightChecks(
  runtime: AgentCard | null,
  draft: GeminiVendorDraft,
  providers: ModelProviderConfig[],
): GeminiPreflightCheck[] {
  const isVertexMode =
    draft.authMode === "vertex_adc" ||
    draft.authMode === "vertex_service_account" ||
    draft.authMode === "vertex_api_key";
  const hasAuthCredential =
    draft.authMode === "login_google" ||
    (draft.authMode === "custom" &&
      Boolean(draft.apiBaseUrl.trim() && draft.geminiApiKey.trim())) ||
    (draft.authMode === "gemini_api_key" && Boolean(draft.geminiApiKey.trim())) ||
    (draft.authMode === "vertex_api_key" &&
      Boolean(draft.googleApiKey.trim() && draft.googleCloudProject.trim())) ||
    (draft.authMode === "vertex_service_account" &&
      Boolean(
        draft.googleApplicationCredentials.trim() &&
          draft.googleCloudProject.trim(),
      )) ||
    (draft.authMode === "vertex_adc" && Boolean(draft.googleCloudProject.trim()));

  return [
    {
      id: "runtime",
      label: "CLI 运行时",
      message: runtime?.runtime.installed
        ? runtime.runtime.version?.trim() || "Gemini CLI 已安装"
        : "未检测到 Gemini CLI",
      status: runtime?.runtime.installed ? "pass" : "fail",
    },
    {
      id: "auth-mode",
      label: "认证模式",
      message:
        draft.authMode === "login_google"
          ? "使用 Gemini CLI 默认 Google 登录"
          : draft.authMode === "custom"
            ? "自定义 Gemini 兼容网关"
            : isVertexMode
              ? "使用 Vertex AI 认证"
              : "使用 API Key 认证",
      status: "pass",
    },
    {
      id: "auth-config",
      label: "认证字段",
      message: hasAuthCredential ? "关键认证字段已填写" : "关键认证字段尚未填写完整",
      status: hasAuthCredential ? "pass" : "fail",
    },
    {
      id: "provider",
      label: "启用 Provider",
      message:
        providers.find((provider) => provider.enabled)?.name ??
        "当前没有启用 Gemini provider",
      status: providers.some((provider) => provider.enabled) ? "pass" : "fail",
    },
  ];
}

export function useGeminiVendorDraft(
  runtime: AgentCard | null,
  providers: ModelProviderConfig[],
) {
  const [draft, setDraft] = useState<GeminiVendorDraft>(() => readGeminiDraft());
  const [showKey, setShowKey] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [savingEnv, setSavingEnv] = useState(false);
  const [savingConfig, setSavingConfig] = useState(false);
  const [preflightLoading, setPreflightLoading] = useState(false);

  const preflightChecks = useMemo(
    () => buildGeminiPreflightChecks(runtime, draft, providers),
    [draft, providers, runtime],
  );

  const persist = useCallback(async (nextDraft: GeminiVendorDraft) => {
    writeGeminiDraft(nextDraft);
    setSavedAt(Date.now());
  }, []);

  const refreshPreflight = useCallback(async () => {
    setPreflightLoading(true);
    await Promise.resolve();
    setPreflightLoading(false);
  }, []);

  const handleDraftEnvTextChange = useCallback((value: string) => {
    setDraft((current) => ({ ...current, envText: value }));
  }, []);

  const handleSaveEnv = useCallback(async () => {
    setSavingEnv(true);
    setError(null);
    try {
      const envMap = parseEnvText(draft.envText);
      const importantValues = extractGeminiImportantValues(envMap);
      const nextDraft = {
        ...draft,
        envText: envMapToText(envMap),
        ...importantValues,
        authMode: normalizeGeminiAuthMode(draft.authMode, importantValues),
      } satisfies GeminiVendorDraft;
      setDraft(nextDraft);
      await persist(nextDraft);
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : String(saveError));
    } finally {
      setSavingEnv(false);
    }
  }, [draft, persist]);

  const handleGeminiAuthModeChange = useCallback((mode: GeminiAuthMode) => {
    setDraft((current) => patchGeminiAuthMode(current, mode));
  }, []);

  const handleGeminiFieldChange = useCallback(
    (field: keyof GeminiImportantValues, value: string) => {
      setDraft((current) => {
        const nextDraft = {
          ...current,
          [field]: value,
        } as GeminiVendorDraft;
        nextDraft.envText = syncGeminiEnvText(nextDraft);
        return nextDraft;
      });
    },
    [],
  );

  const handleSaveConfig = useCallback(async () => {
    setSavingConfig(true);
    setError(null);
    try {
      const nextDraft = {
        ...draft,
        envText: syncGeminiEnvText(draft),
      } satisfies GeminiVendorDraft;
      setDraft(nextDraft);
      await persist(nextDraft);
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : String(saveError));
    } finally {
      setSavingConfig(false);
    }
  }, [draft, persist]);

  return {
    draft,
    preflightChecks,
    preflightLoading,
    savingEnv,
    savingConfig,
    showKey,
    error,
    savedAt,
    setShowKey,
    refreshPreflight,
    handleDraftEnvTextChange,
    handleSaveEnv,
    handleGeminiAuthModeChange,
    handleGeminiFieldChange,
    handleSaveConfig,
  };
}
