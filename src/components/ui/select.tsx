import { Select as SelectPrimitive } from "@base-ui/react/select";
import { ChevronDown, ChevronUp, ChevronsUpDown } from "lucide-react";

type SelectTriggerSize = "default" | "sm";

const Select = SelectPrimitive.Root;

function SelectTrigger({
  className = "",
  size = "default",
  children,
  ...props
}: SelectPrimitive.Trigger.Props & {
  size?: SelectTriggerSize;
}) {
  const sizeClass =
    size === "sm" ? "min-h-8 px-2 text-xs sm:text-xs" : "min-h-9 px-3 text-sm";

  return (
    <SelectPrimitive.Trigger
      className={`${sizeClass} inline-flex w-full items-center justify-between gap-2 rounded-lg border bg-white text-left text-slate-700 outline-none transition-colors ${className}`.trim()}
      data-slot="select-trigger"
      {...props}
    >
      {children}
      <SelectPrimitive.Icon data-slot="select-icon">
        <ChevronsUpDown className="h-4 w-4 opacity-70" />
      </SelectPrimitive.Icon>
    </SelectPrimitive.Trigger>
  );
}

function SelectPopup({
  className = "",
  children,
  side = "bottom",
  sideOffset = 4,
  align = "start",
  alignOffset = 0,
  alignItemWithTrigger = true,
  anchor,
  ...props
}: SelectPrimitive.Popup.Props & {
  side?: SelectPrimitive.Positioner.Props["side"];
  sideOffset?: SelectPrimitive.Positioner.Props["sideOffset"];
  align?: SelectPrimitive.Positioner.Props["align"];
  alignOffset?: SelectPrimitive.Positioner.Props["alignOffset"];
  alignItemWithTrigger?: SelectPrimitive.Positioner.Props["alignItemWithTrigger"];
  anchor?: SelectPrimitive.Positioner.Props["anchor"];
}) {
  return (
    <SelectPrimitive.Portal>
      <SelectPrimitive.Positioner
        side={side}
        sideOffset={sideOffset}
        align={align}
        alignOffset={alignOffset}
        alignItemWithTrigger={alignItemWithTrigger}
        anchor={anchor}
        className="z-50 select-none"
        data-slot="select-positioner"
      >
        <SelectPrimitive.Popup
          className="origin-(--transform-origin) text-slate-900"
          data-slot="select-popup"
          {...props}
        >
          <SelectPrimitive.ScrollUpArrow
            className="flex h-6 items-center justify-center"
            data-slot="select-scroll-up-arrow"
          >
            <ChevronUp className="h-4 w-4" />
          </SelectPrimitive.ScrollUpArrow>
          <div className="rounded-lg border border-slate-200 bg-white shadow-lg">
            <SelectPrimitive.List
              className={`max-h-[min(320px,var(--available-height))] overflow-y-auto p-1 ${className}`.trim()}
              data-slot="select-list"
            >
              {children}
            </SelectPrimitive.List>
          </div>
          <SelectPrimitive.ScrollDownArrow
            className="flex h-6 items-center justify-center"
            data-slot="select-scroll-down-arrow"
          >
            <ChevronDown className="h-4 w-4" />
          </SelectPrimitive.ScrollDownArrow>
        </SelectPrimitive.Popup>
      </SelectPrimitive.Positioner>
    </SelectPrimitive.Portal>
  );
}

function SelectItem({
  className = "",
  children,
  ...props
}: SelectPrimitive.Item.Props) {
  return (
    <SelectPrimitive.Item
      className={`grid min-h-8 cursor-default grid-cols-[1rem_1fr] items-center gap-2 rounded-md px-2 py-1.5 text-sm outline-none data-disabled:pointer-events-none data-disabled:opacity-50 data-highlighted:bg-slate-100 data-highlighted:text-slate-950 ${className}`.trim()}
      data-slot="select-item"
      {...props}
    >
      <SelectPrimitive.ItemIndicator className="col-start-1">
        <svg
          fill="none"
          height="16"
          stroke="currentColor"
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth="2"
          viewBox="0 0 24 24"
          width="16"
        >
          <path d="M5.252 12.7 10.2 18.63 18.748 5.37" />
        </svg>
      </SelectPrimitive.ItemIndicator>
      <SelectPrimitive.ItemText className="col-start-2 min-w-0">
        {children}
      </SelectPrimitive.ItemText>
    </SelectPrimitive.Item>
  );
}

function SelectSeparator(props: SelectPrimitive.Separator.Props) {
  return <SelectPrimitive.Separator data-slot="select-separator" {...props} />;
}

function SelectGroup(props: SelectPrimitive.Group.Props) {
  return <SelectPrimitive.Group data-slot="select-group" {...props} />;
}

function SelectGroupLabel(props: SelectPrimitive.GroupLabel.Props) {
  return <SelectPrimitive.GroupLabel data-slot="select-group-label" {...props} />;
}

export {
  Select,
  SelectGroup,
  SelectGroupLabel,
  SelectItem,
  SelectPopup,
  SelectSeparator,
  SelectTrigger,
};
