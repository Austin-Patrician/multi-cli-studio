import { useEffect, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { bridge } from "../lib/bridge";
import { AppSettings, ModelProviderServiceType } from "../lib/models";
import {
  getProvidersForServiceType,
  MODEL_PROVIDER_META,
  MODEL_PROVIDER_SERVICE_ORDER,
  normalizeProviderSettings,
  setProvidersForServiceType,
} from "../lib/modelProviders";
import {
  ChatIcon,
  cx,
  PlusIcon,
  ProviderListCard,
  SERVICE_ICONS,
  TopActionButton,
} from "../components/modelProviders/ui";

function parseServiceType(value: string | null): ModelProviderServiceType {
  return value === "claude" || value === "gemini" || value === "openaiCompatible"
    ? value
    : "openaiCompatible";
}

export function ModelProvidersPage({ embedded = false }: { embedded?: boolean }) {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [statusText, setStatusText] = useState<string | null>(null);
  const [errorText, setErrorText] = useState<string | null>(null);
  const activeServiceType = parseServiceType(searchParams.get("serviceType"));
  const providersBasePath = "/settings/model-providers";

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const nextSettings = normalizeProviderSettings(await bridge.getSettings());
        if (cancelled) return;
        setSettings(nextSettings);
      } catch (error) {
        if (cancelled) return;
        setErrorText(error instanceof Error ? error.message : "加载 provider 列表失败。");
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const providers = settings ? getProvidersForServiceType(settings, activeServiceType) : [];

  function switchServiceType(serviceType: ModelProviderServiceType) {
    const nextSearchParams = new URLSearchParams(searchParams);
    nextSearchParams.set("serviceType", serviceType);
    setSearchParams(nextSearchParams, { replace: true });
    setStatusText(null);
    setErrorText(null);
  }

  async function handleEnableProvider(providerId: string) {
    if (!settings) return;
    const currentProviders = getProvidersForServiceType(settings, activeServiceType);
    if (currentProviders.find((provider) => provider.id === providerId)?.enabled) {
      return;
    }

    setStatusText(null);
    setErrorText(null);
    try {
      const nextSettings = setProvidersForServiceType(
        settings,
        activeServiceType,
        currentProviders.map((provider) => ({
          ...provider,
          enabled: provider.id === providerId,
          updatedAt: new Date().toISOString(),
        }))
      );
      const saved = normalizeProviderSettings(await bridge.updateSettings(nextSettings));
      setSettings(saved);
      setStatusText("启用的 provider 已更新。");
    } catch (error) {
      setErrorText(error instanceof Error ? error.message : "更新启用 provider 失败。");
    }
  }

  if (loading) {
    return (
      <div className={cx("flex items-center justify-center", embedded ? "min-h-[280px]" : "h-full bg-[#f7f7f5]")}>
        <div className="rounded-[12px] border border-slate-200 bg-white px-6 py-4 text-sm text-slate-500 shadow-sm">
          正在加载模型管理配置...
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
            : "mx-auto flex max-w-[1540px] flex-col gap-6 px-8 py-8"
        }
      >
        <section className="flex flex-wrap items-center gap-4 rounded-[12px] border border-[#eceae4] bg-white/92 px-4 py-4 shadow-[0_10px_26px_rgba(15,23,42,0.05)] backdrop-blur">
          <div className="flex min-w-0 flex-1 justify-center">
            <div className="flex min-w-0 flex-wrap items-center gap-2 rounded-[12px] bg-[#f5f4f1] p-1.5">
              {MODEL_PROVIDER_SERVICE_ORDER.map((serviceType) => {
                const meta = MODEL_PROVIDER_META[serviceType];
                return (
                  <button
                    key={serviceType}
                    type="button"
                    onClick={() => switchServiceType(serviceType)}
                    className={cx(
                      "inline-flex min-w-[144px] items-center justify-center gap-2 rounded-[12px] border px-5 py-2.5 text-[15px] font-medium transition-all",
                      activeServiceType === serviceType
                        ? "border-white bg-white text-slate-900 shadow-[0_8px_20px_rgba(15,23,42,0.10)]"
                        : "border-transparent bg-transparent text-slate-500 hover:bg-white/70 hover:text-slate-800"
                    )}
                  >
                    <img
                      src={SERVICE_ICONS[serviceType]}
                      alt=""
                      className="h-4.5 w-4.5 object-contain"
                    />
                    <span>{meta.shortLabel}</span>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="ml-auto flex items-center gap-2">
            <Link
              to="/model-chat"
              className="inline-flex h-11 w-11 items-center justify-center rounded-[12px] border border-slate-200 bg-[#f5f4f1] text-slate-500 transition-all hover:border-slate-300 hover:bg-white hover:text-slate-800"
              title="前往模型对话"
              aria-label="前往模型对话"
            >
              <ChatIcon />
            </Link>
            <TopActionButton
              title="新增 Provider"
              onClick={() =>
                navigate(`${providersBasePath}/new?serviceType=${activeServiceType}`)
              }
              highlight
            >
              <PlusIcon />
            </TopActionButton>
          </div>
        </section>

        <section className="rounded-[12px] border border-[#eceae4] bg-white/92 p-6 shadow-[0_14px_32px_rgba(15,23,42,0.04)]">
          <div className="space-y-4">
            {providers.length === 0 ? (
              <div className="rounded-[12px] border border-dashed border-slate-200 bg-[#fbfaf8] px-5 py-10 text-center">
                <div className="text-sm font-semibold text-slate-900">当前服务还没有 provider</div>
                <div className="mt-2 text-sm leading-7 text-slate-500">
                  点击右上角加号，跳转到新增页面创建一个来源。
                </div>
              </div>
            ) : (
              providers.map((provider) => (
                <ProviderListCard
                  key={provider.id}
                  provider={provider}
                  serviceType={activeServiceType}
                  onEdit={() =>
                    navigate(`${providersBasePath}/${activeServiceType}/${encodeURIComponent(provider.id)}`)
                  }
                  onEnable={() => void handleEnableProvider(provider.id)}
                />
              ))
            )}
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
