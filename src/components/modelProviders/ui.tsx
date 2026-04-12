import type { ReactNode } from "react";
import type { ModelProviderConfig, ModelProviderServiceType } from "../../lib/models";
import { MODEL_PROVIDER_META } from "../../lib/modelProviders";
import openaiIcon from "../../media/svg/openai.svg";
import claudeIcon from "../../media/svg/claude-color.svg";
import geminiIcon from "../../media/svg/gemini-color.svg";

export const SERVICE_ICONS: Record<ModelProviderServiceType, string> = {
  openaiCompatible: openaiIcon,
  claude: claudeIcon,
  gemini: geminiIcon,
};

export function cx(...values: Array<string | false | null | undefined>) {
  return values.filter(Boolean).join(" ");
}

export function providerInitials(name: string) {
  const tokens = name
    .split(/\s+/)
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, 2);
  if (tokens.length === 0) return "PR";
  return tokens.map((item) => item[0]?.toUpperCase() ?? "").join("");
}

export function maskSecret(value: string) {
  if (!value.trim()) return "未填写";
  if (value.length <= 8) return "••••••••";
  return `${value.slice(0, 4)}••••${value.slice(-4)}`;
}

export function relativeTime(value?: string | null) {
  if (!value) return "未刷新";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "未刷新";
  return `${date.toLocaleDateString("zh-CN")} ${date.toLocaleTimeString("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
  })}`;
}

export function Button({
  children,
  onClick,
  tone = "default",
  disabled = false,
  type = "button",
}: {
  children: ReactNode;
  onClick?: () => void;
  tone?: "default" | "primary" | "danger";
  disabled?: boolean;
  type?: "button" | "submit";
}) {
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      className={cx(
        "inline-flex items-center justify-center rounded-[12px] border px-4 py-2 text-[13px] font-semibold transition-all disabled:cursor-not-allowed disabled:opacity-45",
        tone === "default" &&
          "border-slate-200 bg-white text-slate-700 hover:border-slate-300 hover:bg-slate-50",
        tone === "primary" &&
          "border-sky-500 bg-sky-500 text-white shadow-[0_10px_28px_rgba(14,165,233,0.22)] hover:bg-sky-600",
        tone === "danger" &&
          "border-rose-200 bg-rose-50 text-rose-700 hover:border-rose-300 hover:bg-rose-100"
      )}
    >
      {children}
    </button>
  );
}

export function TopActionButton({
  children,
  title,
  onClick,
  disabled = false,
  highlight = false,
}: {
  children: ReactNode;
  title: string;
  onClick?: () => void;
  disabled?: boolean;
  highlight?: boolean;
}) {
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      onClick={onClick}
      disabled={disabled}
      className={cx(
        "inline-flex h-11 w-11 items-center justify-center rounded-[12px] border transition-all disabled:cursor-not-allowed disabled:opacity-45",
        highlight
          ? "border-orange-200 bg-orange-500 text-white shadow-[0_12px_24px_rgba(249,115,22,0.28)] hover:bg-orange-600"
          : "border-slate-200 bg-[#f5f4f1] text-slate-500 hover:border-slate-300 hover:bg-white hover:text-slate-800"
      )}
    >
      {children}
    </button>
  );
}

export function IconButton({
  children,
  onClick,
  title,
  disabled = false,
}: {
  children: ReactNode;
  onClick: () => void;
  title: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      aria-label={title}
      disabled={disabled}
      className="inline-flex h-9 w-9 items-center justify-center rounded-[12px] border border-slate-200 bg-white text-slate-500 transition-all hover:border-slate-300 hover:bg-slate-50 hover:text-slate-800 disabled:cursor-not-allowed disabled:opacity-45"
    >
      {children}
    </button>
  );
}

export function SectionLabel({ children }: { children: ReactNode }) {
  return (
    <div className="mb-2 text-[11px] font-bold uppercase tracking-[0.18em] text-slate-400">
      {children}
    </div>
  );
}

export function Field({
  label,
  children,
  hint,
}: {
  label: string;
  children: ReactNode;
  hint?: string;
}) {
  return (
    <label className="block">
      <SectionLabel>{label}</SectionLabel>
      {children}
      {hint ? <div className="mt-2 text-xs leading-6 text-slate-500">{hint}</div> : null}
    </label>
  );
}

export function DragHandleIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" className="h-4 w-4">
      <circle cx="9" cy="7.5" r="1.2" fill="currentColor" />
      <circle cx="15" cy="7.5" r="1.2" fill="currentColor" />
      <circle cx="9" cy="12" r="1.2" fill="currentColor" />
      <circle cx="15" cy="12" r="1.2" fill="currentColor" />
      <circle cx="9" cy="16.5" r="1.2" fill="currentColor" />
      <circle cx="15" cy="16.5" r="1.2" fill="currentColor" />
    </svg>
  );
}

export function PlusIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" className="h-4.5 w-4.5">
      <path d="M12 5v14M5 12h14" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

export function RefreshIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" className="h-4.5 w-4.5">
      <path d="M20 11a8 8 0 10-2.3 5.6M20 11V5m0 6h-6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function SaveIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" className="h-4.5 w-4.5">
      <path d="M5 5.5A1.5 1.5 0 016.5 4h8.9l3.6 3.6V18.5A1.5 1.5 0 0117.5 20h-11A1.5 1.5 0 015 18.5v-13z" stroke="currentColor" strokeWidth="1.6" />
      <path d="M8 4.5V9h7V5M8.5 20v-6.5h7V20" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function EyeIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" className="h-4.5 w-4.5">
      <path
        d="M2.8 12s3.3-6 9.2-6 9.2 6 9.2 6-3.3 6-9.2 6-9.2-6-9.2-6z"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx="12" cy="12" r="3" stroke="currentColor" strokeWidth="1.7" />
    </svg>
  );
}

export function EyeOffIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" className="h-4.5 w-4.5">
      <path
        d="M3 3l18 18"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
      />
      <path
        d="M10.6 6.4A10.2 10.2 0 0112 6c5.9 0 9.2 6 9.2 6a16.9 16.9 0 01-3.1 3.8M6.4 10.6A17.6 17.6 0 002.8 12s3.3 6 9.2 6c.5 0 1 0 1.4-.1"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M14.1 14.1A3 3 0 019.9 9.9"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function CloseIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" className="h-4.5 w-4.5">
      <path
        d="M7 7l10 10M17 7L7 17"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
    </svg>
  );
}

export function ChatIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" className="h-4.5 w-4.5">
      <path d="M7 8h10M7 12h6m8 8-3.5-2.2H6a3 3 0 01-3-3V7a3 3 0 013-3h12a3 3 0 013 3v10a3 3 0 01-1 2.2z" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function DuplicateIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" className="h-4 w-4">
      <rect x="8" y="8" width="10" height="10" rx="2" stroke="currentColor" strokeWidth="1.6" />
      <path d="M6 14H5a2 2 0 01-2-2V5a2 2 0 012-2h7a2 2 0 012 2v1" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

export function TrashIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" className="h-4 w-4">
      <path d="M5 7h14M10 11v6M14 11v6M9 4h6l1 3H8l1-3z" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M7 7l.8 11a2 2 0 002 1.9h2.4a2 2 0 002-1.9L17 7" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
    </svg>
  );
}

export function ChevronRightIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" className="h-4 w-4">
      <path d="M10 7l5 5-5 5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function PencilIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" className="h-4 w-4">
      <path d="M16.8 4.8a2.2 2.2 0 113.1 3.1L8.7 19.1 4 20l.9-4.7L16.8 4.8z" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function CheckIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" className="h-4 w-4">
      <path
        d="M5.5 12.5l4.2 4.2L18.5 8"
        stroke="currentColor"
        strokeWidth="1.9"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function EnableIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" className="h-4 w-4">
      <path
        d="M12 4v7"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
      <path
        d="M7.1 6.9a7 7 0 109.8 0"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function BackIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" className="h-4 w-4">
      <path d="M15 18l-6-6 6-6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function ProviderListCard({
  provider,
  serviceType,
  onEdit,
  onEnable,
}: {
  provider: ModelProviderConfig;
  serviceType: ModelProviderServiceType;
  onEdit: () => void;
  onEnable: () => void;
}) {
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onEdit}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onEdit();
        }
      }}
      className={cx(
        "group w-full rounded-[12px] border px-5 py-5 text-left transition-all",
        provider.enabled
          ? "border-sky-300 bg-[linear-gradient(180deg,#f8fbff_0%,#eef6ff_100%)] shadow-[0_0_0_3px_rgba(96,165,250,0.10),0_18px_46px_rgba(59,130,246,0.10)]"
          : "border-slate-200 bg-white hover:border-slate-300 hover:bg-[#fcfcfb]"
      )}
    >
      <div className="flex items-center gap-4">
        <div
          className={cx(
            "inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-[12px]",
            provider.enabled ? "bg-sky-100 text-sky-500" : "bg-slate-50 text-slate-300"
          )}
        >
          <DragHandleIcon />
        </div>
        <div
          className={cx(
            "flex h-10 w-10 shrink-0 items-center justify-center rounded-[12px] border text-sm font-semibold",
            provider.enabled
              ? "border-sky-200 bg-white text-slate-700"
              : "border-slate-200 bg-slate-50 text-slate-500"
          )}
        >
          {providerInitials(provider.name)}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-center gap-2">
            <div className="truncate text-[15px] font-semibold text-slate-900">
              {provider.name}
            </div>
            {provider.enabled ? (
              <span className="rounded-[12px] bg-emerald-50 px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.16em] text-emerald-700">
                Enabled
              </span>
            ) : null}
          </div>
          <div className="mt-1 truncate text-[15px] text-sky-500">
            {provider.baseUrl || MODEL_PROVIDER_META[serviceType].defaultBaseUrl}
          </div>
        </div>
        <div className="hidden min-w-[250px] items-center justify-end gap-6 lg:flex">
          <div className="text-right">
            <div className="text-[10px] font-bold uppercase tracking-[0.16em] text-slate-400">
              Models
            </div>
            <div className="mt-1 text-sm font-semibold text-slate-900">
              {provider.models.length}
            </div>
          </div>
          <div className="text-right">
            <div className="text-[10px] font-bold uppercase tracking-[0.16em] text-slate-400">
              Key
            </div>
            <div className="mt-1 text-sm font-semibold text-slate-700">
              {maskSecret(provider.apiKey)}
            </div>
          </div>
          <div className="text-right">
            <div className="text-[10px] font-bold uppercase tracking-[0.16em] text-slate-400">
              Refresh
            </div>
            <div className="mt-1 text-xs font-semibold text-slate-600">
              {relativeTime(provider.lastRefreshedAt)}
            </div>
          </div>
        </div>
        <div className="ml-auto flex shrink-0 items-center gap-2">
          <button
            type="button"
            title="Edit provider"
            aria-label="Edit provider"
            onClick={(event) => {
              event.stopPropagation();
              onEdit();
            }}
            className="inline-flex h-9 w-9 items-center justify-center rounded-[12px] bg-white text-slate-600 ring-1 ring-inset ring-slate-200 transition-colors hover:bg-slate-50"
          >
            <PencilIcon />
          </button>
          <button
            type="button"
            title={provider.enabled ? "Using provider" : "Enable provider"}
            aria-label={provider.enabled ? "Using provider" : "Enable provider"}
            onClick={(event) => {
              event.stopPropagation();
              onEnable();
            }}
            className={cx(
              "inline-flex h-9 w-9 items-center justify-center rounded-[12px] transition-colors",
              provider.enabled
                ? "bg-slate-900 text-white"
                : "bg-slate-100 text-slate-600 hover:bg-slate-200"
            )}
          >
            {provider.enabled ? <CheckIcon /> : <EnableIcon />}
          </button>
          <div
            className={cx(
              "inline-flex h-9 w-9 items-center justify-center rounded-[12px]",
              provider.enabled ? "bg-sky-100 text-sky-600" : "bg-slate-50 text-slate-300"
            )}
          >
            <ChevronRightIcon />
          </div>
        </div>
      </div>
    </div>
  );
}
