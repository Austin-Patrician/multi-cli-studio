import type {
  AppSettings,
  ModelProviderConfig,
  ModelProviderModel,
  ModelProviderServiceType,
} from "./models";

export const MODEL_PROVIDER_SERVICE_ORDER: ModelProviderServiceType[] = [
  "openaiCompatible",
  "claude",
  "gemini",
];

export const MODEL_PROVIDER_META: Record<
  ModelProviderServiceType,
  {
    label: string;
    shortLabel: string;
    description: string;
    defaultBaseUrl: string;
    defaultWebsiteUrl: string;
    accent: string;
  }
> = {
  openaiCompatible: {
    label: "OpenAI Compatible",
    shortLabel: "OpenAI",
    description: "Chat Completions / Models compatible gateway",
    defaultBaseUrl: "https://api.openai.com",
    defaultWebsiteUrl: "https://platform.openai.com/",
    accent: "from-sky-500/20 via-blue-500/10 to-transparent",
  },
  claude: {
    label: "Claude",
    shortLabel: "Claude",
    description: "Anthropic Messages API provider",
    defaultBaseUrl: "https://api.anthropic.com",
    defaultWebsiteUrl: "https://console.anthropic.com/",
    accent: "from-amber-500/20 via-orange-500/10 to-transparent",
  },
  gemini: {
    label: "Gemini",
    shortLabel: "Gemini",
    description: "Google Gemini generateContent provider",
    defaultBaseUrl: "https://generativelanguage.googleapis.com",
    defaultWebsiteUrl: "https://aistudio.google.com/",
    accent: "from-emerald-500/20 via-teal-500/10 to-transparent",
  },
};

type ProviderSettingsKey =
  | "openaiCompatibleProviders"
  | "claudeProviders"
  | "geminiProviders";

const PROVIDER_SETTINGS_KEY: Record<ModelProviderServiceType, ProviderSettingsKey> = {
  openaiCompatible: "openaiCompatibleProviders",
  claude: "claudeProviders",
  gemini: "geminiProviders",
};

function createId(prefix: string) {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return `${prefix}-${crypto.randomUUID()}`;
  }
  return `${prefix}-${Date.now()}-${Math.floor(Math.random() * 100000)}`;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

export function defaultModelsForServiceType(
  serviceType: ModelProviderServiceType
): ModelProviderModel[] {
  switch (serviceType) {
    case "openaiCompatible":
      return [
        { id: "gpt-4.1", name: "gpt-4.1", label: "GPT-4.1" },
        { id: "gpt-4.1-mini", name: "gpt-4.1-mini", label: "GPT-4.1 Mini" },
      ];
    case "claude":
      return [
        { id: "claude-sonnet-4-20250514", name: "claude-sonnet-4-20250514", label: "Claude Sonnet 4" },
        { id: "claude-3-7-sonnet-20250219", name: "claude-3-7-sonnet-20250219", label: "Claude 3.7 Sonnet" },
      ];
    case "gemini":
      return [
        { id: "gemini-2.5-pro", name: "gemini-2.5-pro", label: "Gemini 2.5 Pro" },
        { id: "gemini-2.5-flash", name: "gemini-2.5-flash", label: "Gemini 2.5 Flash" },
      ];
    default:
      return [];
  }
}

export function normalizeProviderModel(value: unknown): ModelProviderModel | null {
  if (!value || typeof value !== "object") {
    return null;
  }
  const raw = value as Partial<ModelProviderModel>;
  const id = isNonEmptyString(raw.id)
    ? raw.id.trim()
    : isNonEmptyString(raw.name)
      ? raw.name.trim()
      : "";
  if (!id) {
    return null;
  }
  const name = isNonEmptyString(raw.name) ? raw.name.trim() : id;
  return {
    id,
    name,
    label: isNonEmptyString(raw.label) ? raw.label.trim() : null,
  };
}

export function normalizeProviderConfig(
  serviceType: ModelProviderServiceType,
  value: unknown
): ModelProviderConfig | null {
  if (!value || typeof value !== "object") {
    return null;
  }
  const raw = value as Partial<ModelProviderConfig>;
  const meta = MODEL_PROVIDER_META[serviceType];
  const createdAt = isNonEmptyString(raw.createdAt) ? raw.createdAt : new Date().toISOString();
  const updatedAt = isNonEmptyString(raw.updatedAt) ? raw.updatedAt : createdAt;
  const models = Array.isArray(raw.models)
    ? raw.models.map((item) => normalizeProviderModel(item)).filter(Boolean) as ModelProviderModel[]
    : [];

  return {
    id: isNonEmptyString(raw.id) ? raw.id.trim() : createId(`provider-${serviceType}`),
    serviceType,
    name: isNonEmptyString(raw.name) ? raw.name.trim() : `${meta.shortLabel} Provider`,
    baseUrl: isNonEmptyString(raw.baseUrl) ? raw.baseUrl.trim() : meta.defaultBaseUrl,
    apiKey: typeof raw.apiKey === "string" ? raw.apiKey : "",
    websiteUrl: typeof raw.websiteUrl === "string" ? raw.websiteUrl.trim() : meta.defaultWebsiteUrl,
    note: typeof raw.note === "string" ? raw.note : "",
    enabled: raw.enabled === true,
    models: models.length > 0 ? models : defaultModelsForServiceType(serviceType),
    createdAt,
    updatedAt,
    lastRefreshedAt: isNonEmptyString(raw.lastRefreshedAt) ? raw.lastRefreshedAt : null,
  };
}

export function normalizeProviderList(
  serviceType: ModelProviderServiceType,
  values: unknown
): ModelProviderConfig[] {
  if (!Array.isArray(values)) {
    return [];
  }
  let enabledClaimed = false;
  return values
    .map((item) => normalizeProviderConfig(serviceType, item))
    .filter(Boolean)
    .map((provider) => {
      const nextProvider = provider as ModelProviderConfig;
      if (nextProvider.enabled && !enabledClaimed) {
        enabledClaimed = true;
        return nextProvider;
      }
      if (nextProvider.enabled) {
        return { ...nextProvider, enabled: false };
      }
      return nextProvider;
    });
}

export function normalizeProviderSettings(value: AppSettings): AppSettings {
  return {
    ...value,
    openaiCompatibleProviders: normalizeProviderList(
      "openaiCompatible",
      value.openaiCompatibleProviders
    ),
    claudeProviders: normalizeProviderList("claude", value.claudeProviders),
    geminiProviders: normalizeProviderList("gemini", value.geminiProviders),
  };
}

export function getProvidersForServiceType(
  settings: AppSettings,
  serviceType: ModelProviderServiceType
) {
  return settings[PROVIDER_SETTINGS_KEY[serviceType]];
}

export function setProvidersForServiceType(
  settings: AppSettings,
  serviceType: ModelProviderServiceType,
  providers: ModelProviderConfig[]
): AppSettings {
  return {
    ...settings,
    [PROVIDER_SETTINGS_KEY[serviceType]]: normalizeProviderList(serviceType, providers),
  };
}

export function getEnabledProviderForServiceType(
  settings: AppSettings,
  serviceType: ModelProviderServiceType
) {
  return getProvidersForServiceType(settings, serviceType).find((provider) => provider.enabled) ?? null;
}

export function createBlankProvider(
  serviceType: ModelProviderServiceType
): ModelProviderConfig {
  const meta = MODEL_PROVIDER_META[serviceType];
  const timestamp = new Date().toISOString();
  return {
    id: createId(`provider-${serviceType}`),
    serviceType,
    name: `${meta.shortLabel} Provider`,
    baseUrl: meta.defaultBaseUrl,
    apiKey: "",
    websiteUrl: meta.defaultWebsiteUrl,
    note: "",
    enabled: false,
    models: defaultModelsForServiceType(serviceType),
    createdAt: timestamp,
    updatedAt: timestamp,
    lastRefreshedAt: null,
  };
}

export function parseModelsFromText(value: string): ModelProviderModel[] {
  return value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [rawId, rawLabel] = line.split("|");
      const id = rawId?.trim() ?? "";
      if (!id) {
        return null;
      }
      const label = rawLabel?.trim() ?? "";
      return {
        id,
        name: id,
        label: label || null,
      } satisfies ModelProviderModel;
    })
    .filter(Boolean) as ModelProviderModel[];
}

export function serializeModelsToText(models: ModelProviderModel[]) {
  return models
    .map((model) => (model.label?.trim() ? `${model.id} | ${model.label.trim()}` : model.id))
    .join("\n");
}

export function touchProvider(provider: ModelProviderConfig): ModelProviderConfig {
  return {
    ...provider,
    updatedAt: new Date().toISOString(),
  };
}
