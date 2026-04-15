import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { bridge } from "../lib/bridge";
import { AppSettings, ModelProviderConfig, ModelProviderServiceType } from "../lib/models";
import {
  createBlankProvider,
  getProvidersForServiceType,
  MODEL_PROVIDER_META,
  normalizeProviderSettings,
  parseModelsFromText,
  serializeModelsToText,
  setProvidersForServiceType,
  touchProvider,
} from "../lib/modelProviders";
import {
  BackIcon,
  CloseIcon,
  cx,
  EyeIcon,
  EyeOffIcon,
  Field,
  IconButton,
  PencilIcon,
  RefreshIcon,
  SaveIcon,
  TrashIcon,
} from "../components/modelProviders/ui";

function parseServiceType(value: string | null | undefined): ModelProviderServiceType {
  return value === "claude" || value === "gemini" || value === "openaiCompatible"
    ? value
    : "openaiCompatible";
}

export function ModelProviderEditorPage({ embedded = false }: { embedded?: boolean }) {
  const navigate = useNavigate();
  const params = useParams();
  const [searchParams] = useSearchParams();
  const isNew = !params.providerId;
  const serviceType = parseServiceType(
    isNew ? searchParams.get("serviceType") : params.serviceType
  );
  const providerId = params.providerId ? decodeURIComponent(params.providerId) : null;
  const providersBasePath = "/settings/model-providers";

  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [draft, setDraft] = useState<ModelProviderConfig | null>(null);
  const [modelsDraft, setModelsDraft] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [showApiKey, setShowApiKey] = useState(false);
  const [statusText, setStatusText] = useState<string | null>(null);
  const [errorText, setErrorText] = useState<string | null>(null);

  const providers = useMemo(
    () => (settings ? getProvidersForServiceType(settings, serviceType) : []),
    [serviceType, settings]
  );

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const loadedSettings = normalizeProviderSettings(await bridge.getSettings());
        if (cancelled) return;
        setSettings(loadedSettings);
        if (isNew) {
          const blankProvider = createBlankProvider(serviceType);
          setDraft(blankProvider);
          setModelsDraft(serializeModelsToText(blankProvider.models));
        } else {
          const existingProvider = getProvidersForServiceType(
            loadedSettings,
            serviceType
          ).find((provider) => provider.id === providerId);
          if (!existingProvider) {
            throw new Error("Provider 不存在，可能已经被删除。");
          }
          setDraft(existingProvider);
          setModelsDraft(serializeModelsToText(existingProvider.models));
        }
      } catch (error) {
        if (cancelled) return;
        setErrorText(error instanceof Error ? error.message : "加载 provider 详情失败。");
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [isNew, providerId, serviceType]);

  function goBack() {
    navigate(`${providersBasePath}?serviceType=${serviceType}`);
  }

  function updateDraft(updater: (provider: ModelProviderConfig) => ModelProviderConfig) {
    setDraft((current) => (current ? updater(current) : current));
  }

  async function saveProvider({
    navigateAfterSave,
  }: {
    navigateAfterSave: boolean;
  }) {
    if (!settings || !draft) return null;
    setSaving(true);
    setStatusText(null);
    setErrorText(null);
    try {
      const nextProviders = isNew
        ? [touchProvider(draft), ...providers]
        : providers.map((provider) =>
            provider.id === draft.id ? touchProvider(draft) : provider
          );
      const nextSettings = setProvidersForServiceType(settings, serviceType, nextProviders);
      const saved = normalizeProviderSettings(await bridge.updateSettings(nextSettings));
      setSettings(saved);
      const savedProvider =
        getProvidersForServiceType(saved, serviceType).find((provider) => provider.id === draft.id) ??
        null;
      if (savedProvider) {
        setDraft(savedProvider);
        setModelsDraft(serializeModelsToText(savedProvider.models));
      }
      setStatusText("Provider 配置已保存。");
      if (navigateAfterSave) {
        navigate(`${providersBasePath}?serviceType=${serviceType}`);
      }
      return savedProvider;
    } catch (error) {
      setErrorText(error instanceof Error ? error.message : "保存 provider 失败。");
      return null;
    } finally {
      setSaving(false);
    }
  }

  async function handleRefreshModels() {
    if (!draft) return;
    if (isNew) {
      setErrorText("请先保存 provider，再刷新模型列表。");
      return;
    }
    setRefreshing(true);
    setStatusText(null);
    setErrorText(null);
    try {
      const refreshedProvider = await bridge.refreshProviderModels(serviceType, draft.id);
      setSettings((current) =>
        current
          ? setProvidersForServiceType(
              current,
              serviceType,
              getProvidersForServiceType(current, serviceType).map((provider) =>
                provider.id === refreshedProvider.id ? refreshedProvider : provider
              )
            )
          : current
      );
      setDraft(refreshedProvider);
      setModelsDraft(serializeModelsToText(refreshedProvider.models));
      setStatusText(`已拉取 ${refreshedProvider.models.length} 个模型。`);
    } catch (error) {
      setErrorText(error instanceof Error ? error.message : "刷新模型列表失败。");
    } finally {
      setRefreshing(false);
    }
  }

  async function handleDelete() {
    if (!settings || !draft || isNew) return;
    setDeleting(true);
    setStatusText(null);
    setErrorText(null);
    try {
      const nextSettings = setProvidersForServiceType(
        settings,
        serviceType,
        providers.filter((provider) => provider.id !== draft.id)
      );
      const saved = normalizeProviderSettings(await bridge.updateSettings(nextSettings));
      setSettings(saved);
      navigate(`${providersBasePath}?serviceType=${serviceType}`);
    } catch (error) {
      setErrorText(error instanceof Error ? error.message : "删除 provider 失败。");
    } finally {
      setDeleting(false);
    }
  }

  if (loading) {
    return (
      <div className={cx("flex items-center justify-center", embedded ? "min-h-[320px]" : "h-full bg-[#f7f7f5]")}>
        <div className="rounded-[12px] border border-slate-200 bg-white px-6 py-4 text-sm text-slate-500 shadow-sm">
          正在加载 provider 编辑页...
        </div>
      </div>
    );
  }

  if (!draft) {
    return (
      <div className={cx("flex items-center justify-center", embedded ? "min-h-[320px]" : "h-full bg-[#f7f7f5]")}>
        <div className="rounded-[12px] border border-rose-200 bg-rose-50 px-6 py-4 text-sm text-rose-700 shadow-sm">
          {errorText ?? "Provider 加载失败。"}
        </div>
      </div>
    );
  }

  return (
    <div className={embedded ? "flex flex-col gap-6" : "min-h-full bg-[#f7f7f5]"}>
      <div
        className={
          embedded
            ? "flex flex-col gap-6"
            : "mx-auto flex max-w-[1380px] flex-col gap-6 px-8 py-8"
        }
      >
        <section className="flex flex-wrap items-center gap-4 rounded-[12px] border border-[#eceae4] bg-white/92 px-4 py-4 shadow-[0_10px_26px_rgba(15,23,42,0.05)] backdrop-blur">
          <div className="flex min-w-0 flex-1 items-center gap-3">
            <button
              type="button"
              onClick={goBack}
              className="inline-flex h-11 w-11 items-center justify-center rounded-[12px] border border-slate-200 bg-[#f5f4f1] text-slate-500 transition-all hover:border-slate-300 hover:bg-white hover:text-slate-800"
              title="返回列表"
              aria-label="返回列表"
            >
              <BackIcon />
            </button>
            <div className="flex h-11 w-11 items-center justify-center rounded-[12px] border border-slate-200 bg-[#f5f4f1] text-slate-500">
              <PencilIcon />
            </div>
            <div className="min-w-0">
              <div className="truncate text-lg font-semibold text-slate-950">
                {isNew ? "新增 Provider" : draft.name}
              </div>
              <div className="mt-1 flex flex-wrap items-center gap-2 text-sm text-slate-500">
                <span>{MODEL_PROVIDER_META[serviceType].label}</span>
                <span className="text-slate-300">•</span>
                <span>{isNew ? "新建模式" : "编辑模式"}</span>
              </div>
            </div>
          </div>

          <div className="ml-auto flex flex-wrap items-center gap-2">
            {!isNew ? (
              <IconButton
                title="刷新模型列表"
                onClick={() => void handleRefreshModels()}
                disabled={refreshing}
              >
                <RefreshIcon />
              </IconButton>
            ) : null}
            {!isNew ? (
              <IconButton title="删除 Provider" onClick={() => void handleDelete()} disabled={deleting}>
                <TrashIcon />
              </IconButton>
            ) : null}
            <IconButton title="取消并返回" onClick={goBack}>
              <CloseIcon />
            </IconButton>
            <IconButton
              title={saving ? "保存中..." : "保存并返回"}
              onClick={() => void saveProvider({ navigateAfterSave: true })}
              disabled={saving}
            >
              <SaveIcon />
            </IconButton>
          </div>
        </section>

        <section className="rounded-[12px] border border-[#eceae4] bg-white/96 shadow-[0_18px_42px_rgba(15,23,42,0.05)]">
          <div className="px-6 py-6">
            <div className="space-y-7">
              <div className="grid gap-5 md:grid-cols-2">
                <Field label="Provider Name">
                  <input
                    value={draft.name}
                    onChange={(event) =>
                      updateDraft((provider) =>
                        touchProvider({ ...provider, name: event.target.value })
                      )
                    }
                    className="w-full rounded-[12px] border border-slate-200 bg-[#faf9f7] px-4 py-3 text-sm text-slate-900 outline-none transition-all focus:border-sky-400 focus:bg-white focus:ring-4 focus:ring-sky-100"
                    placeholder="Acme AI Gateway"
                  />
                </Field>
                <Field label="Website URL">
                  <input
                    value={draft.websiteUrl}
                    onChange={(event) =>
                      updateDraft((provider) =>
                        touchProvider({ ...provider, websiteUrl: event.target.value })
                      )
                    }
                    className="w-full rounded-[12px] border border-slate-200 bg-[#faf9f7] px-4 py-3 text-sm text-slate-900 outline-none transition-all focus:border-sky-400 focus:bg-white focus:ring-4 focus:ring-sky-100"
                    placeholder="https://example.com"
                  />
                </Field>
              </div>

              <Field
                label="Base URL"
                hint={
                  serviceType === "openaiCompatible"
                    ? "OpenAI Compatible 通常填写根域名或 /v1 根路径。"
                    : serviceType === "claude"
                      ? "Claude provider 通常填写 Anthropic API 根域名。"
                      : "Gemini provider 通常填写 Google Generative Language API 根域名。"
                }
              >
                <input
                  value={draft.baseUrl}
                  onChange={(event) =>
                    updateDraft((provider) =>
                      touchProvider({ ...provider, baseUrl: event.target.value })
                    )
                  }
                  className="w-full rounded-[12px] border border-slate-200 bg-[#faf9f7] px-4 py-3 text-sm text-slate-900 outline-none transition-all focus:border-sky-400 focus:bg-white focus:ring-4 focus:ring-sky-100"
                  placeholder={MODEL_PROVIDER_META[serviceType].defaultBaseUrl}
                />
              </Field>

              <Field label="API Key" hint="只保存在本地设置中，模型对话页会直接读取这里。">
                <div className="relative">
                  <input
                    type={showApiKey ? "text" : "password"}
                    value={draft.apiKey}
                    onChange={(event) =>
                      updateDraft((provider) =>
                        touchProvider({ ...provider, apiKey: event.target.value })
                      )
                    }
                    className="w-full rounded-[12px] border border-slate-200 bg-[#faf9f7] px-4 py-3 pr-14 text-sm text-slate-900 outline-none transition-all focus:border-sky-400 focus:bg-white focus:ring-4 focus:ring-sky-100"
                    placeholder="sk-..."
                  />
                  <button
                    type="button"
                    title={showApiKey ? "隐藏 API Key" : "显示 API Key"}
                    aria-label={showApiKey ? "隐藏 API Key" : "显示 API Key"}
                    onClick={() => setShowApiKey((value) => !value)}
                    className="absolute right-2 top-1/2 inline-flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-[12px] text-slate-400 transition-all hover:bg-white hover:text-slate-700"
                  >
                    {showApiKey ? <EyeOffIcon /> : <EyeIcon />}
                  </button>
                </div>
              </Field>

              <Field label="Models" hint="每行一个模型，可写成 `model-id` 或 `model-id | Label`。">
                <textarea
                  value={modelsDraft}
                  onChange={(event) => {
                    const nextValue = event.target.value;
                    setModelsDraft(nextValue);
                    updateDraft((provider) =>
                      touchProvider({ ...provider, models: parseModelsFromText(nextValue) })
                    );
                  }}
                  rows={10}
                  className="w-full resize-y rounded-[12px] border border-slate-200 bg-[#faf9f7] px-4 py-3 text-sm leading-7 text-slate-900 outline-none transition-all focus:border-sky-400 focus:bg-white focus:ring-4 focus:ring-sky-100"
                  placeholder={"gpt-4.1 | GPT-4.1\nclaude-sonnet-4-20250514 | Claude Sonnet 4"}
                />
              </Field>

              <Field label="Note">
                <textarea
                  value={draft.note}
                  onChange={(event) =>
                    updateDraft((provider) =>
                      touchProvider({ ...provider, note: event.target.value })
                    )
                  }
                  rows={4}
                  className="w-full resize-y rounded-[12px] border border-slate-200 bg-[#faf9f7] px-4 py-3 text-sm leading-7 text-slate-900 outline-none transition-all focus:border-sky-400 focus:bg-white focus:ring-4 focus:ring-sky-100"
                  placeholder="例如：公司内网代理，主要给轻量问答使用。"
                />
              </Field>
            </div>
          </div>
        </section>

        {(statusText || errorText) && (
          <div
            className={cx(
              "rounded-[12px] border px-5 py-4 text-sm shadow-sm",
              errorText
                ? "border-rose-200 bg-rose-50 text-rose-700"
                : "border-emerald-200 bg-emerald-50 text-emerald-700"
            )}
          >
            {errorText ?? statusText}
          </div>
        )}
      </div>
    </div>
  );
}
