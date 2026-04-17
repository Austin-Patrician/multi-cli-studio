import { useEffect, useId, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { createPortal } from "react-dom";

type GitTooltipButtonProps = {
  tooltip: string;
  className: string;
  onClick?: () => void;
  children: ReactNode;
  ariaLabel?: string;
  disabled?: boolean;
  type?: "button" | "submit" | "reset";
};

type TooltipPosition = {
  top: number;
  left: number;
  arrowOffset: number;
};

const VIEWPORT_PADDING = 10;
const TOOLTIP_OFFSET = 10;

export function GitTooltipButton({
  tooltip,
  className,
  onClick,
  children,
  ariaLabel,
  disabled = false,
  type = "button",
}: GitTooltipButtonProps) {
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const tooltipRef = useRef<HTMLDivElement | null>(null);
  const tooltipId = useId();
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState<TooltipPosition | null>(null);

  useEffect(() => {
    if (!open || !buttonRef.current || !tooltipRef.current) {
      return;
    }

    const updatePosition = () => {
      if (!buttonRef.current || !tooltipRef.current) return;

      const buttonRect = buttonRef.current.getBoundingClientRect();
      const tooltipRect = tooltipRef.current.getBoundingClientRect();
      const buttonCenter = buttonRect.left + buttonRect.width / 2;
      const halfTooltipWidth = tooltipRect.width / 2;
      const minCenter = VIEWPORT_PADDING + halfTooltipWidth;
      const maxCenter = window.innerWidth - VIEWPORT_PADDING - halfTooltipWidth;
      const left = Math.min(maxCenter, Math.max(minCenter, buttonCenter));

      setPosition({
        top: buttonRect.top - TOOLTIP_OFFSET,
        left,
        arrowOffset: buttonCenter - left,
      });
    };

    const rafId = window.requestAnimationFrame(updatePosition);
    window.addEventListener("resize", updatePosition);
    window.addEventListener("scroll", updatePosition, true);

    return () => {
      window.cancelAnimationFrame(rafId);
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("scroll", updatePosition, true);
    };
  }, [open, tooltip]);

  const tooltipStyle = position
    ? ({
        top: `${position.top}px`,
        left: `${position.left}px`,
        ["--git-tooltip-arrow-offset" as string]: `${position.arrowOffset}px`,
      } as CSSProperties)
    : undefined;

  return (
    <>
      <button
        ref={buttonRef}
        type={type}
        className={className}
        onClick={onClick}
        aria-label={ariaLabel ?? tooltip}
        aria-describedby={open ? tooltipId : undefined}
        disabled={disabled}
        onMouseEnter={() => {
          if (!disabled) setOpen(true);
        }}
        onMouseLeave={() => setOpen(false)}
        onFocus={() => {
          if (!disabled) setOpen(true);
        }}
        onBlur={() => setOpen(false)}
      >
        {children}
      </button>
      {open && typeof document !== "undefined"
        ? createPortal(
            <div
              ref={tooltipRef}
              id={tooltipId}
              role="tooltip"
              className="git-floating-tooltip"
              style={tooltipStyle}
            >
              {tooltip}
            </div>,
            document.body
          )
        : null}
    </>
  );
}
