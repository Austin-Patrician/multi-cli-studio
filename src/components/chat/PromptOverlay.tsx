interface PromptOverlayItem {
  id: string;
  title: string;
  subtitle?: string;
  meta?: string;
  chips?: string[];
  disabled?: boolean;
}

interface PromptOverlayProps {
  items: PromptOverlayItem[];
  selectedIndex: number;
  onSelect: (item: PromptOverlayItem) => void;
}

export function PromptOverlay({ items, selectedIndex, onSelect }: PromptOverlayProps) {
  if (items.length === 0) return null;

  return (
    <div className="absolute bottom-full left-0 right-0 z-30 mb-3 overflow-hidden rounded-[22px] border border-border bg-white shadow-[0_24px_80px_rgba(15,23,42,0.14)]">
      <div className="max-h-72 overflow-y-auto p-1.5">
        {items.map((item, index) => {
          const isActive = index === selectedIndex;
          return (
            <button
              key={item.id}
              type="button"
              disabled={item.disabled}
              onClick={() => !item.disabled && onSelect(item)}
              className={`flex w-full items-start gap-3 rounded-[14px] px-3 py-2.5 text-left transition-colors ${
                isActive ? "bg-[#eef4ff]" : "hover:bg-surface"
              } ${item.disabled ? "cursor-not-allowed opacity-45" : ""}`}
            >
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="truncate text-sm font-semibold text-text">{item.title}</span>
                  {item.meta && (
                    <span className="shrink-0 text-[11px] font-mono text-muted">{item.meta}</span>
                  )}
                </div>
                {item.subtitle && (
                  <div className="mt-0.5 truncate text-xs text-secondary">{item.subtitle}</div>
                )}
              </div>
              {item.chips && item.chips.length > 0 && (
                <div className="flex shrink-0 items-center gap-1">
                  {item.chips.map((chip) => (
                    <span
                      key={chip}
                      className="rounded-full bg-surface px-1.5 py-0.5 text-[10px] font-semibold text-secondary"
                    >
                      {chip}
                    </span>
                  ))}
                </div>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
