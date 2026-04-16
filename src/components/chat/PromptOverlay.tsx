import { useEffect, useRef } from "react";

export interface PromptOverlayItem {
  id: string;
  title: string;
  subtitle?: string;
  meta?: string;
  chips?: string[];
  badge?: string;
  disabled?: boolean;
}

export interface PromptOverlaySection {
  id: string;
  title?: string;
  items: PromptOverlayItem[];
}

interface PromptOverlayProps {
  title?: string;
  description?: string;
  sections: PromptOverlaySection[];
  selectedIndex?: number;
  onSelect?: (item: PromptOverlayItem) => void;
  onBack?: () => void;
  footer?: string;
  interactive?: boolean;
}

function BackIcon() {
  return (
    <svg className="h-3.5 w-3.5" viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <path
        d="M11.5 4.5L6 10l5.5 5.5"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function PromptOverlay({
  title,
  description,
  sections,
  selectedIndex = -1,
  onSelect,
  onBack,
  footer,
  interactive = true,
}: PromptOverlayProps) {
  const scrollContainerRef = useRef<HTMLDivElement | null>(null);
  const itemRefs = useRef<Record<string, HTMLButtonElement | HTMLDivElement | null>>({});
  const hasItems = sections.some((section) => section.items.length > 0);
  if (!hasItems) return null;

  useEffect(() => {
    if (!interactive || selectedIndex < 0) {
      return;
    }

    const flatItems = sections.flatMap((section) => section.items);
    const selectedItem = flatItems[selectedIndex] ?? null;
    if (!selectedItem) {
      return;
    }

    const node = itemRefs.current[selectedItem.id];
    const container = scrollContainerRef.current;
    if (!node || !container) {
      return;
    }

    node.scrollIntoView({
      block: "nearest",
      inline: "nearest",
    });
  }, [interactive, sections, selectedIndex]);

  let flatIndex = -1;

  return (
    <div className="absolute bottom-full left-0 right-0 z-30 mb-3 overflow-hidden rounded-[26px] border border-[#d9e3ef] bg-[linear-gradient(180deg,#ffffff_0%,#f8fbff_100%)] shadow-[0_28px_90px_rgba(15,23,42,0.16)] backdrop-blur-sm">
      {(title || description || onBack) && (
        <div className="border-b border-[#e6edf5] px-4 py-3.5">
          <div className="flex items-start gap-3">
            {onBack && (
              <button
                type="button"
                onClick={onBack}
                className="mt-0.5 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-[#d7e0eb] bg-white text-secondary transition-colors hover:border-accent/35 hover:text-text"
                aria-label="Back"
              >
                <BackIcon />
              </button>
            )}

            <div className="min-w-0 flex-1">
              {title && (
                <div className="text-[13px] font-semibold tracking-[0.01em] text-text">
                  {title}
                </div>
              )}
              {description && (
                <div className="mt-1 text-[11px] leading-5 text-secondary">{description}</div>
              )}
            </div>
          </div>
        </div>
      )}

      <div ref={scrollContainerRef} className="max-h-[23rem] overflow-y-auto p-2">
        <div className="space-y-2">
          {sections.map((section) => {
            if (section.items.length === 0) return null;

            return (
              <div key={section.id} className="space-y-1.5">
                {section.title && (
                  <div className="px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-muted">
                    {section.title}
                  </div>
                )}

                {section.items.map((item) => {
                  flatIndex += 1;
                  const isActive = interactive && flatIndex === selectedIndex;
                  const rowClasses = `flex w-full items-start gap-3 rounded-[16px] px-3 py-3 text-left transition-colors ${
                    isActive ? "bg-[#eaf1ff]" : "hover:bg-[#f5f8fc]"
                  } ${item.disabled ? "cursor-not-allowed opacity-45" : ""}`;

                  const content = (
                    <>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className="truncate text-[13px] font-semibold text-text">
                            {item.title}
                          </span>
                          {item.meta && (
                            <span className="shrink-0 rounded-full bg-[#eef3f8] px-2 py-0.5 text-[10px] font-medium text-secondary">
                              {item.meta}
                            </span>
                          )}
                          {item.badge && (
                            <span className="shrink-0 rounded-full bg-[#e8eef8] px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.08em] text-secondary">
                              {item.badge}
                            </span>
                          )}
                        </div>
                        {item.subtitle && (
                          <div className="mt-1 whitespace-pre-wrap break-words text-[11px] leading-5 text-secondary">
                            {item.subtitle}
                          </div>
                        )}
                      </div>

                      {item.chips && item.chips.length > 0 && (
                        <div className="flex shrink-0 flex-wrap justify-end gap-1">
                          {item.chips.map((chip) => (
                            <span
                              key={chip}
                              className="rounded-full border border-[#dfe6f0] bg-white px-2 py-0.5 text-[10px] font-semibold text-secondary"
                            >
                              {chip}
                            </span>
                          ))}
                        </div>
                      )}
                    </>
                  );

                  if (!interactive || !onSelect) {
                    return (
                      <div
                        key={item.id}
                        ref={(node) => {
                          itemRefs.current[item.id] = node;
                        }}
                        className={rowClasses}
                      >
                        {content}
                      </div>
                    );
                  }

                  return (
                    <button
                      key={item.id}
                      ref={(node) => {
                        itemRefs.current[item.id] = node;
                      }}
                      type="button"
                      disabled={item.disabled}
                      onClick={() => !item.disabled && onSelect(item)}
                      className={rowClasses}
                    >
                      {content}
                    </button>
                  );
                })}
              </div>
            );
          })}
        </div>
      </div>

      {footer && (
        <div className="border-t border-[#e6edf5] bg-[#fbfcfe] px-4 py-2.5 text-[10px] text-muted">
          {footer}
        </div>
      )}
    </div>
  );
}
