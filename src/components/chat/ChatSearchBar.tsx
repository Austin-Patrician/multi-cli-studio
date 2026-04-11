import type { KeyboardEvent, ReactNode, RefObject } from "react";

function SearchIcon() {
  return (
    <svg className="h-3.5 w-3.5" viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <path
        d="M14.25 14.25L18 18m-2.25-8a5.75 5.75 0 11-11.5 0 5.75 5.75 0 0111.5 0z"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
    </svg>
  );
}

function ArrowUpIcon() {
  return (
    <svg className="h-3 w-3" viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <path d="M10 15V5m0 0L6 9m4-4l4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function ArrowDownIcon() {
  return (
    <svg className="h-3 w-3" viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <path d="M10 5v10m0 0l4-4m-4 4l-4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg className="h-3 w-3" viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <path d="M6 6l8 8m0-8l-8 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

function SearchToggle({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`inline-flex h-6 min-w-6 items-center justify-center rounded-md border px-1 text-[10px] font-semibold transition-colors ${
        active
          ? "border-[#4f7cff] bg-[#2453c71a] text-white shadow-[inset_0_0_0_1px_rgba(122,162,255,0.18)]"
          : "border-white/10 bg-white/[0.06] text-white/72 hover:bg-white/[0.1] hover:text-white"
      }`}
    >
      {label}
    </button>
  );
}

function IconButton({
  label,
  icon,
  onClick,
  disabled = false,
}: {
  label: string;
  icon: ReactNode;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={label}
      aria-label={label}
      disabled={disabled}
      className="inline-flex h-6 w-6 items-center justify-center rounded-md border border-white/10 bg-white/[0.06] text-white/78 transition-colors hover:bg-white/[0.1] hover:text-white disabled:cursor-not-allowed disabled:opacity-35"
    >
      {icon}
    </button>
  );
}

export function ChatSearchBar({
  query,
  totalMatches,
  currentMatch,
  isCaseSensitive,
  isWholeWord,
  isRegex,
  invalidPattern,
  inputRef,
  onQueryChange,
  onInputKeyDown,
  onToggleCaseSensitive,
  onToggleWholeWord,
  onToggleRegex,
  onPrevious,
  onNext,
  onClose,
}: {
  query: string;
  totalMatches: number;
  currentMatch: number;
  isCaseSensitive: boolean;
  isWholeWord: boolean;
  isRegex: boolean;
  invalidPattern: boolean;
  inputRef: RefObject<HTMLInputElement | null>;
  onQueryChange: (value: string) => void;
  onInputKeyDown: (event: KeyboardEvent<HTMLInputElement>) => void;
  onToggleCaseSensitive: () => void;
  onToggleWholeWord: () => void;
  onToggleRegex: () => void;
  onPrevious: () => void;
  onNext: () => void;
  onClose: () => void;
}) {
  return (
    <div className="pointer-events-auto absolute right-3 top-3 z-30 flex w-[min(420px,calc(100%-1rem))] items-center gap-1.5 rounded-[14px] border border-[#202938]/90 bg-[#0d1118]/90 px-2 py-2 text-white shadow-[0_14px_32px_rgba(2,6,23,0.24)] backdrop-blur-lg">
      <div className="flex min-w-0 flex-1 items-center gap-2 rounded-[10px] border border-[#2b3547] bg-[#121927] px-2.5 py-1 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]">
        <span className="text-white/45">
          <SearchIcon />
        </span>
        <input
          ref={inputRef}
          value={query}
          onChange={(event) => onQueryChange(event.target.value)}
          onKeyDown={onInputKeyDown}
          placeholder="Find"
          spellCheck={false}
          className={`min-w-0 flex-1 bg-transparent text-[12px] font-medium tracking-[0.01em] text-white outline-none placeholder:text-white/34 ${
            invalidPattern ? "text-[#ffd2a1]" : ""
          }`}
        />
        <div className={`shrink-0 rounded-full px-1.5 py-0.5 text-[9px] font-semibold ${
          invalidPattern ? "bg-[#ff9f431a] text-[#ffd2a1]" : "bg-white/[0.06] text-white/62"
        }`}>
          {invalidPattern
            ? "Invalid regex"
            : totalMatches > 0
              ? `${currentMatch}/${totalMatches}`
              : "0/0"}
        </div>
      </div>

      <div className="flex items-center gap-1.5">
        <SearchToggle label="Aa" active={isCaseSensitive} onClick={onToggleCaseSensitive} />
        <SearchToggle label="ab" active={isWholeWord} onClick={onToggleWholeWord} />
        <SearchToggle label=".*" active={isRegex} onClick={onToggleRegex} />
      </div>

      <div className="h-5 w-px bg-white/10" />

      <div className="flex items-center gap-1">
        <IconButton label="Previous Match" icon={<ArrowUpIcon />} onClick={onPrevious} disabled={totalMatches === 0} />
        <IconButton label="Next Match" icon={<ArrowDownIcon />} onClick={onNext} disabled={totalMatches === 0} />
      </div>

      <div className="h-5 w-px bg-white/10" />

      <IconButton label="Close Search" icon={<CloseIcon />} onClick={onClose} />
    </div>
  );
}
