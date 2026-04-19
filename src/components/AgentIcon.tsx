import type { CSSProperties } from "react";
import {
  DEFAULT_AGENT_ICON,
  getAgentIconSvgMarkup,
  resolveAgentIconBySeed,
  resolveAgentIcon,
  type AgentIconId,
} from "../lib/agentIcons";

function joinClassName(...parts: Array<string | null | undefined>) {
  return parts.filter((part): part is string => Boolean(part && part.trim())).join(" ");
}

export function AgentIcon({
  icon,
  seed,
  fallback = DEFAULT_AGENT_ICON,
  className,
  size = 16,
  title,
  ariaHidden = true,
}: {
  icon?: unknown;
  seed?: unknown;
  fallback?: AgentIconId;
  className?: string;
  size?: number;
  title?: string;
  ariaHidden?: boolean;
}) {
  const resolved =
    seed === undefined
      ? resolveAgentIcon(icon, fallback)
      : resolveAgentIconBySeed(icon, seed, fallback);
  const svgMarkup = getAgentIconSvgMarkup(resolved);

  return (
    <span
      className={joinClassName("agent-icon-svg", className)}
      aria-hidden={ariaHidden}
      title={title}
      style={
        {
          width: size,
          height: size,
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          flexShrink: 0,
        } as CSSProperties
      }
      dangerouslySetInnerHTML={{ __html: svgMarkup ?? "" }}
    />
  );
}

export default AgentIcon;
