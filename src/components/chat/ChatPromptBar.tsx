import { KeyboardEvent, useEffect, useMemo, useRef, useState } from "react";
import {
  ACP_COMMANDS,
  AcpCliCapabilities,
  AcpCommandDef,
  AcpOptionDef,
  AcpPickerCommandKind,
  getCommandCategory,
  getCommandCategoryLabel,
  getPickerCatalog,
  isPickerCommandKind,
  parseSlashCommand,
} from "../../lib/acp";
import {
  AgentId,
  CliSkillItem,
  FileMentionCandidate,
  TerminalTab,
  TerminalCliId,
} from "../../lib/models";
import { useStore } from "../../lib/store";
import { CliSelector } from "./CliSelector";
import { PromptOverlay, PromptOverlayItem, PromptOverlaySection } from "./PromptOverlay";

type InteractiveOverlayEntry =
  | { id: string; kind: "command"; command: AcpCommandDef }
  | { id: string; kind: "shortcut"; shortcut: "skills" }
  | { id: string; kind: "skill"; skill: CliSkillItem }
  | { id: string; kind: "mention"; mention: FileMentionCandidate }
  | { id: string; kind: "option"; commandKind: AcpPickerCommandKind; option: AcpOptionDef };

interface SkillOverlayState {
  title: string;
  description: string;
  footer: string;
  sections: PromptOverlaySection[];
  entries: InteractiveOverlayEntry[];
}

type CommandOverlayState =
  | {
      kind: "command-list";
      title: string;
      description: string;
      footer: string;
      sections: PromptOverlaySection[];
      entries: InteractiveOverlayEntry[];
    }
  | {
      kind: "command-help";
      title: string;
      description: string;
      footer: string;
      sections: PromptOverlaySection[];
    }
  | {
      kind: "skill-command";
      title: string;
      description: string;
      footer: string;
      sections: PromptOverlaySection[];
      entries: InteractiveOverlayEntry[];
    }
  | {
      kind: "command-argument";
      title: string;
      description: string;
      footer: string;
      sections: PromptOverlaySection[];
      entries: InteractiveOverlayEntry[];
      commandKind: AcpPickerCommandKind;
      loading: boolean;
    };

function findMentionToken(value: string, caret: number) {
  const prefix = value.slice(0, caret);
  const match = prefix.match(/(?:^|\s)@([^\s@/]*)$/);
  if (!match || match.index == null) return null;
  const start = match.index + match[0].lastIndexOf("@");
  return {
    start,
    end: caret,
    query: match[1] ?? "",
  };
}

function findSkillToken(value: string, caret: number) {
  const prefix = value.slice(0, caret);
  const match = prefix.match(/^\s*\$([A-Za-z0-9._-]*)$/);
  if (!match || match.index == null) return null;
  const start = prefix.lastIndexOf("$");
  if (start < 0) return null;
  return {
    start,
    end: caret,
    query: match[1] ?? "",
  };
}

function parseSkillSlashQuery(value: string) {
  const match = value.match(/^\/skills?(?:\s+(.*))?$/is);
  if (!match) return null;
  return match[1] ?? "";
}

function titleCaseCli(cliId: TerminalCliId) {
  if (cliId === "auto") return "Auto";
  return cliId.charAt(0).toUpperCase() + cliId.slice(1);
}

function resolveConcreteCli(activeTab: TerminalTab | null, fallback: AgentId | undefined): AgentId {
  if (activeTab?.selectedCli && activeTab.selectedCli !== "auto") {
    return activeTab.selectedCli;
  }
  return fallback ?? "codex";
}

function currentModelLabel(tab: TerminalTab) {
  if (tab.selectedCli === "auto") return "auto";
  return tab.modelOverrides[tab.selectedCli] ?? "default";
}

function currentPermissionLabel(tab: TerminalTab) {
  if (tab.selectedCli === "auto") return "auto";
  return tab.permissionOverrides[tab.selectedCli] ?? (
    tab.selectedCli === "codex"
      ? "workspace-write"
      : tab.selectedCli === "claude"
        ? "acceptEdits"
        : "auto_edit"
  );
}

function currentEffortLabel(tab: TerminalTab) {
  return tab.effortLevel ?? "default";
}

function commandStateMeta(command: AcpCommandDef, tab: TerminalTab) {
  switch (command.kind) {
    case "plan":
      return tab.planMode ? "ON" : "OFF";
    case "model":
      return currentModelLabel(tab);
    case "permissions":
      return currentPermissionLabel(tab);
    case "effort":
      return currentEffortLabel(tab);
    case "fast":
      return tab.fastMode ? "ON" : "OFF";
    default:
      return undefined;
  }
}

function commandHelpSubtitle(command: AcpCommandDef, tab: TerminalTab) {
  const details = [command.description];
  const current = commandStateMeta(command, tab);
  if (current) {
    details.push(`Current: ${current}`);
  }
  return details.join("\n");
}

function appendSectionItem(
  sections: PromptOverlaySection[],
  sectionId: string,
  sectionTitle: string,
  item: PromptOverlayItem
) {
  const existing = sections.find((section) => section.id === sectionId);
  if (existing) {
    existing.items.push(item);
    return;
  }
  sections.push({
    id: sectionId,
    title: sectionTitle,
    items: [item],
  });
}

function buildCommandListOverlay(
  activeTab: TerminalTab,
  query: string
): CommandOverlayState {
  const supportedCommands = ACP_COMMANDS.filter((command) =>
    activeTab.selectedCli === "auto" || command.supportedClis.includes(activeTab.selectedCli)
  ).filter((command) => {
    const normalized = query.toLowerCase();
    return (
      !normalized ||
      command.slash.slice(1).startsWith(normalized) ||
      command.label.toLowerCase().includes(normalized)
    );
  });

  const sections: PromptOverlaySection[] = [];
  const entries: InteractiveOverlayEntry[] = [];

  supportedCommands.forEach((command) => {
    const category = getCommandCategory(command.kind);
    const itemId = command.kind;
    appendSectionItem(sections, category, getCommandCategoryLabel(category), {
      id: itemId,
      title: command.slash,
      subtitle: command.description,
      meta: commandStateMeta(command, activeTab),
      badge: command.argsHint ? "pick" : undefined,
    });
    entries.push({ id: itemId, kind: "command", command });
  });

  const normalized = query.trim().toLowerCase();
  if (
    activeTab.selectedCli !== "auto" &&
    (!normalized ||
      "skills".startsWith(normalized) ||
      "skill".startsWith(normalized) ||
      "prompt skills".includes(normalized))
  ) {
    appendSectionItem(sections, "prompt-tools", "Prompt Tools", {
      id: "shortcut-skills",
      title: "/skills",
      subtitle: "Browse installed skills for the active CLI and insert one into the prompt.",
      badge: "picker",
    });
    entries.push({ id: "shortcut-skills", kind: "shortcut", shortcut: "skills" });
  }

  if (sections.length === 0) {
    sections.push({
      id: "empty",
      items: [
        {
          id: "empty",
          title: "No matching commands",
          subtitle: "Try another slash command or press Esc to return to the composer.",
        },
      ],
    });
  }

  return {
    kind: "command-list",
    title: `${titleCaseCli(activeTab.selectedCli)} Commands`,
    description: "Pick a command directly from the palette. Parameterized commands continue in-place with a second selection step.",
    footer: "Arrow keys move, Enter applies, Esc clears, Shift+Tab toggles plan mode when the palette is closed.",
    sections,
    entries,
  };
}

function buildHelpOverlay(activeTab: TerminalTab): CommandOverlayState {
  const commands = ACP_COMMANDS.filter((command) =>
    activeTab.selectedCli === "auto" || command.supportedClis.includes(activeTab.selectedCli)
  );
  const sections: PromptOverlaySection[] = [];

  commands.forEach((command) => {
    const category = getCommandCategory(command.kind);
    appendSectionItem(sections, category, getCommandCategoryLabel(category), {
      id: `help-${command.kind}`,
      title: `${command.slash}${command.argsHint ? ` ${command.argsHint}` : ""}`,
      subtitle: commandHelpSubtitle(command, activeTab),
      meta: command.label,
    });
  });

  if (activeTab.selectedCli !== "auto") {
    appendSectionItem(sections, "prompt-tools", "Prompt Tools", {
      id: "help-skills",
      title: "/skills",
      subtitle: "Open the skill picker for the active CLI and insert one at the start of the prompt.",
      meta: "Prompt Skills",
    });
  }

  return {
    kind: "command-help",
    title: `${titleCaseCli(activeTab.selectedCli)} Help`,
    description: "Reference view for the active CLI. This panel explains each command without executing anything.",
    footer: "Esc returns to the command palette.",
    sections,
  };
}

function optionMatchesQuery(option: AcpOptionDef, query: string) {
  const normalized = query.trim().toLowerCase();
  if (!normalized) return true;
  return (
    option.value.toLowerCase().includes(normalized) ||
    option.label.toLowerCase().includes(normalized) ||
    option.description?.toLowerCase().includes(normalized) === true
  );
}

function buildArgumentOverlay(
  activeTab: TerminalTab,
  commandKind: AcpPickerCommandKind,
  capabilities: AcpCliCapabilities | null | undefined,
  capabilityStatus: "idle" | "loading" | "ready" | "error" | undefined,
  query: string
): CommandOverlayState {
  const catalog = getPickerCatalog(capabilities, commandKind);
  const current =
    commandKind === "model"
      ? currentModelLabel(activeTab)
      : commandKind === "permissions"
        ? currentPermissionLabel(activeTab)
        : currentEffortLabel(activeTab);

  if (capabilityStatus === "loading" || (capabilityStatus !== "error" && !catalog)) {
    return {
      kind: "command-argument",
      commandKind,
      loading: true,
      title: `Select ${commandKind} for ${titleCaseCli(activeTab.selectedCli)}`,
      description: `Current: ${current}. Loading available options from the installed CLI...`,
      footer: "Esc returns to the command palette.",
      sections: [
        {
          id: "loading",
          items: [
            {
              id: "loading",
              title: "Loading options",
              subtitle: "Inspecting CLI help output and available flags.",
              badge: "runtime",
            },
          ],
        },
      ],
      entries: [],
    };
  }

  if (!catalog || !catalog.supported) {
    return {
      kind: "command-argument",
      commandKind,
      loading: false,
      title: `Select ${commandKind} for ${titleCaseCli(activeTab.selectedCli)}`,
      description: `Current: ${current}. This parameter is not exposed by the active CLI.`,
      footer: "Esc returns to the command palette.",
      sections: [
        {
          id: "unsupported",
          items: [
            {
              id: "unsupported",
              title: "No selectable options",
              subtitle: catalog?.note ?? "The active CLI does not expose this parameter as a selectable flag.",
            },
          ],
        },
      ],
      entries: [],
    };
  }

  const filteredOptions = catalog.options.filter((option) => optionMatchesQuery(option, query));
  const options = [...filteredOptions];
  const trimmedQuery = query.trim();
  const hasExactQueryMatch = options.some((option) => option.value.toLowerCase() === trimmedQuery.toLowerCase());

  if (commandKind === "model" && trimmedQuery && !hasExactQueryMatch) {
    options.push({
      value: trimmedQuery,
      label: trimmedQuery,
      description: "Apply the typed model value directly.",
      source: "manual",
    });
  }

  const sections: PromptOverlaySection[] = [];
  const entries: InteractiveOverlayEntry[] = [];

  options.forEach((option) => {
    const sourceKey = option.source === "manual" ? "manual" : option.source;
    const sourceLabel =
      option.source === "runtime"
        ? "runtime"
        : option.source === "fallback"
          ? "preset"
          : "manual";

    const itemId = `${commandKind}-${option.value}`;
    appendSectionItem(
      sections,
      sourceKey,
      sourceLabel === "runtime" ? "Detected" : sourceLabel === "preset" ? "Presets" : "Typed Value",
      {
        id: itemId,
        title: option.label,
        subtitle: option.description ?? undefined,
        meta: current === option.value ? "current" : undefined,
        badge: sourceLabel,
      }
    );
    entries.push({ id: itemId, kind: "option", commandKind, option });
  });

  if (sections.length === 0) {
    sections.push({
      id: "empty",
      items: [
        {
          id: "empty",
          title: "No matching options",
          subtitle: "Refine the filter or press Esc to return to the command palette.",
        },
      ],
    });
  }

  return {
    kind: "command-argument",
    commandKind,
    loading: false,
    title: `Select ${commandKind} for ${titleCaseCli(activeTab.selectedCli)}`,
    description: `Current: ${current}.${catalog.note ? ` ${catalog.note}` : ""}`,
    footer: "Arrow keys move, Enter applies, Esc returns to the command palette.",
    sections,
    entries,
  };
}

function skillChips(skill: CliSkillItem) {
  return [skill.scope, skill.source].filter(
    (value, index, values): value is string => Boolean(value) && values.indexOf(value) === index
  );
}

function buildSkillOverlay(
  cliId: AgentId,
  query: string,
  skills: CliSkillItem[],
  status: "idle" | "loading" | "ready" | "error" | undefined
): SkillOverlayState {
  const normalized = query.trim().toLowerCase();
  const filteredSkills = skills.filter((skill) => {
    if (!normalized) return true;
    return (
      skill.name.toLowerCase().includes(normalized) ||
      skill.displayName?.toLowerCase().includes(normalized) === true ||
      skill.description?.toLowerCase().includes(normalized) === true
    );
  });

  if (status === "loading" && skills.length === 0) {
    return {
      title: `${titleCaseCli(cliId)} Skills`,
      description: `Loading the skills currently available for ${titleCaseCli(cliId)} in this workspace.`,
      footer: "Type to narrow the list. Enter inserts the selected skill at the start of the prompt.",
      sections: [
        {
          id: "loading",
          items: [
            {
              id: "loading",
              title: "Loading skills",
              subtitle: "Inspecting the active CLI runtime and local skill directories.",
              badge: "runtime",
            },
          ],
        },
      ],
      entries: [],
    };
  }

  if (status === "error") {
    return {
      title: `${titleCaseCli(cliId)} Skills`,
      description: `Skill discovery failed for ${titleCaseCli(cliId)}.`,
      footer: "Esc dismisses the picker.",
      sections: [
        {
          id: "error",
          items: [
            {
              id: "error",
              title: "Unable to load skills",
              subtitle: "Check the installed CLI runtime and local skill directories, then try again.",
            },
          ],
        },
      ],
      entries: [],
    };
  }

  if (filteredSkills.length === 0) {
    return {
      title: `${titleCaseCli(cliId)} Skills`,
      description: `Select one skill to apply to the next ${titleCaseCli(cliId)} turn.`,
      footer: "Esc dismisses the picker.",
      sections: [
        {
          id: "empty",
          items: [
            {
              id: "empty",
              title: skills.length === 0 ? "No skills available" : "No matching skills",
              subtitle:
                skills.length === 0
                  ? `${titleCaseCli(cliId)} does not expose any selectable skills for this workspace.`
                  : "Refine the filter or press Esc to return to the composer.",
            },
          ],
        },
      ],
      entries: [],
    };
  }

  const sections: PromptOverlaySection[] = [];
  const entries: InteractiveOverlayEntry[] = [];

  filteredSkills.forEach((skill) => {
    const sectionId = skill.scope ?? skill.source ?? "skills";
    const sectionTitle = skill.scope ?? skill.source ?? "Skills";
    const itemId = `skill:${skill.name}:${skill.path}`;
    appendSectionItem(sections, sectionId, sectionTitle, {
      id: itemId,
      title: skill.displayName || skill.name,
      subtitle: skill.description ?? skill.path,
      meta:
        skill.displayName && skill.displayName !== skill.name
          ? skill.name
          : undefined,
      chips: skillChips(skill),
    });
    entries.push({ id: itemId, kind: "skill", skill });
  });

  return {
    title: `${titleCaseCli(cliId)} Skills`,
    description: `Select one skill to apply to the next ${titleCaseCli(cliId)} turn.`,
    footer: "Arrow keys move, Enter inserts the skill, Esc dismisses.",
    sections,
    entries,
  };
}

function buildSkillCommandOverlay(
  cliId: AgentId,
  query: string,
  skills: CliSkillItem[],
  status: "idle" | "loading" | "ready" | "error" | undefined
): CommandOverlayState {
  const base = buildSkillOverlay(cliId, query, skills, status);
  return {
    kind: "skill-command",
    title: `${titleCaseCli(cliId)} Skills`,
    description: base.description,
    footer: "Arrow keys move, Enter inserts the skill, Esc returns to the command palette.",
    sections: base.sections,
    entries: base.entries,
  };
}

export function ChatPromptBar() {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const actionMenuRef = useRef<HTMLDivElement>(null);
  const promptHistoryStateRef = useRef<{ index: number | null; draft: string }>({
    index: null,
    draft: "",
  });
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [mentionItems, setMentionItems] = useState<FileMentionCandidate[]>([]);
  const [dismissedMentionKey, setDismissedMentionKey] = useState<string | null>(null);
  const [dismissedSkillKey, setDismissedSkillKey] = useState<string | null>(null);
  const [isActionMenuOpen, setIsActionMenuOpen] = useState(false);

  const terminalTabs = useStore((s) => s.terminalTabs);
  const workspaces = useStore((s) => s.workspaces);
  const activeTerminalTabId = useStore((s) => s.activeTerminalTabId);
  const busyAction = useStore((s) => s.busyAction);
  const activeSession = useStore((s) =>
    s.activeTerminalTabId ? s.chatSessions[s.activeTerminalTabId] ?? null : null
  );
  const acpCapabilitiesByCli = useStore((s) => s.acpCapabilitiesByCli);
  const acpCapabilityStatusByCli = useStore((s) => s.acpCapabilityStatusByCli);
  const cliSkillsByContext = useStore((s) => s.cliSkillsByContext);
  const cliSkillStatusByContext = useStore((s) => s.cliSkillStatusByContext);
  const setTabDraftPrompt = useStore((s) => s.setTabDraftPrompt);
  const sendChatMessage = useStore((s) => s.sendChatMessage);
  const executeAcpCommand = useStore((s) => s.executeAcpCommand);
  const snapshotWorkspace = useStore((s) => s.snapshotWorkspace);
  const runChecks = useStore((s) => s.runChecks);
  const togglePlanMode = useStore((s) => s.togglePlanMode);
  const searchWorkspaceFiles = useStore((s) => s.searchWorkspaceFiles);
  const loadCliSkills = useStore((s) => s.loadCliSkills);
  const loadAcpCapabilities = useStore((s) => s.loadAcpCapabilities);
  const appendChatSystemMessage = useStore((s) => s.appendChatSystemMessage);

  const activeTab = terminalTabs.find((tab) => tab.id === activeTerminalTabId) ?? null;
  const workspace = workspaces.find((item) => item.id === activeTab?.workspaceId) ?? null;
  const effectiveCli = resolveConcreteCli(activeTab, workspace?.activeAgent);
  const prompt = activeTab?.draftPrompt ?? "";
  const isStreaming = activeTab?.status === "streaming";
  const isBusy = busyAction === "checks" || busyAction?.startsWith("review-") || false;
  const cliSkillCacheKey = workspace ? `${effectiveCli}:${workspace.id}` : null;
  const cliSkills = cliSkillCacheKey ? cliSkillsByContext[cliSkillCacheKey] ?? [] : [];
  const cliSkillStatus = cliSkillCacheKey
    ? cliSkillStatusByContext[cliSkillCacheKey] ?? "idle"
    : "idle";

  const rawSlashPrompt = prompt.trimStart();
  const slashQuery = rawSlashPrompt.startsWith("/") ? rawSlashPrompt.slice(1).toLowerCase() : "";
  const skillSlashQuery = useMemo(() => {
    if (!activeTab || activeTab.selectedCli === "auto") return null;
    return parseSkillSlashQuery(rawSlashPrompt);
  }, [activeTab, rawSlashPrompt]);
  const promptHistory = useMemo(
    () => activeSession?.messages.filter((message) => message.role === "user").map((message) => message.content) ?? [],
    [activeSession?.messages]
  );

  useEffect(() => {
    if (!activeTab) return;
    void loadAcpCapabilities(effectiveCli);
  }, [activeTab, effectiveCli, loadAcpCapabilities]);

  useEffect(() => {
    promptHistoryStateRef.current = {
      index: null,
      draft: "",
    };
  }, [activeTab?.id]);

  const mentionToken = useMemo(() => {
    const caret = textareaRef.current?.selectionStart ?? prompt.length;
    return findMentionToken(prompt, caret);
  }, [prompt]);
  const skillToken = useMemo(() => {
    const caret = textareaRef.current?.selectionStart ?? prompt.length;
    return findSkillToken(prompt, caret);
  }, [prompt]);

  const mentionKey = mentionToken ? `${mentionToken.start}:${mentionToken.query}` : null;
  const skillKey = skillToken ? `${skillToken.start}:${skillToken.query}` : null;

  useEffect(() => {
    if (!activeTab || !workspace || activeTab.selectedCli === "auto") {
      return;
    }
    if (!skillToken && skillSlashQuery == null) {
      setDismissedSkillKey(null);
      return;
    }

    if (skillKey && dismissedSkillKey && skillKey !== dismissedSkillKey) {
      setDismissedSkillKey(null);
    }

    void loadCliSkills(effectiveCli, workspace.id);
  }, [
    activeTab,
    dismissedSkillKey,
    effectiveCli,
    loadCliSkills,
    rawSlashPrompt,
    skillSlashQuery,
    skillKey,
    skillToken,
    workspace,
  ]);

  useEffect(() => {
    if (!activeTab || !workspace || rawSlashPrompt.startsWith("/")) return;
    if (!mentionToken) {
      setMentionItems([]);
      setDismissedMentionKey(null);
      return;
    }

    if (mentionKey && dismissedMentionKey && mentionKey !== dismissedMentionKey) {
      setDismissedMentionKey(null);
    }

    let cancelled = false;
    searchWorkspaceFiles(workspace.id, mentionToken.query).then((items) => {
      if (!cancelled) {
        setMentionItems(items);
        if (items.length > 0) {
          setSelectedIndex(0);
        }
      }
    });
    return () => {
      cancelled = true;
    };
  }, [
    activeTab,
    dismissedMentionKey,
    mentionKey,
    mentionToken,
    rawSlashPrompt,
    searchWorkspaceFiles,
    workspace,
  ]);

  const commandOverlay = useMemo<CommandOverlayState | null>(() => {
    if (!activeTab || !rawSlashPrompt.startsWith("/")) return null;

    if (skillSlashQuery != null && activeTab.selectedCli !== "auto") {
      return buildSkillCommandOverlay(effectiveCli, skillSlashQuery, cliSkills, cliSkillStatus);
    }

    if (/^\/help\s*$/i.test(rawSlashPrompt)) {
      return buildHelpOverlay(activeTab);
    }

    const pickerMatch = rawSlashPrompt.match(/^\/(model|permissions|effort)\s+(.*)$/is);
    if (pickerMatch && isPickerCommandKind(pickerMatch[1] as AcpPickerCommandKind)) {
      const commandKind = pickerMatch[1] as AcpPickerCommandKind;
      return buildArgumentOverlay(
        activeTab,
        commandKind,
        acpCapabilitiesByCli[effectiveCli],
        acpCapabilityStatusByCli[effectiveCli],
        pickerMatch[2] ?? ""
      );
    }

    return buildCommandListOverlay(activeTab, slashQuery);
  }, [
    activeTab,
    acpCapabilitiesByCli,
    acpCapabilityStatusByCli,
    cliSkillStatus,
    cliSkills,
    effectiveCli,
    rawSlashPrompt,
    slashQuery,
    skillSlashQuery,
  ]);

  const skillOverlay = useMemo<SkillOverlayState | null>(() => {
    if (!skillToken || !workspace || !activeTab || activeTab.selectedCli === "auto" || commandOverlay) {
      return null;
    }
    return buildSkillOverlay(effectiveCli, skillToken.query, cliSkills, cliSkillStatus);
  }, [activeTab, cliSkillStatus, cliSkills, commandOverlay, effectiveCli, skillToken, workspace]);

  const showSkillOverlay =
    !commandOverlay &&
    !!skillToken &&
    activeTab?.selectedCli !== "auto" &&
    skillKey !== dismissedSkillKey &&
    !!skillOverlay;

  const showMentionOverlay =
    !commandOverlay &&
    !showSkillOverlay &&
    !!mentionToken &&
    mentionItems.length > 0 &&
    mentionKey !== dismissedMentionKey;

  const activeSections = commandOverlay
    ? commandOverlay.sections
    : showSkillOverlay && skillOverlay
      ? skillOverlay.sections
    : showMentionOverlay
      ? [
          {
            id: "mentions",
            items: mentionItems.map((item) => ({
              id: item.id,
              title: item.relativePath,
              subtitle: item.name,
            })),
          },
        ]
      : [];

  const interactiveEntries = commandOverlay
    ? "entries" in commandOverlay
      ? commandOverlay.entries
      : []
    : showSkillOverlay && skillOverlay
      ? skillOverlay.entries
    : showMentionOverlay
      ? mentionItems.map<InteractiveOverlayEntry>((mention) => ({
          id: mention.id,
          kind: "mention",
          mention,
        }))
      : [];

  const safeSelectedIndex = Math.max(0, Math.min(selectedIndex, interactiveEntries.length - 1));

  useEffect(() => {
    setSelectedIndex(0);
  }, [commandOverlay?.kind, rawSlashPrompt, mentionKey, skillKey, skillSlashQuery]);

  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
  }, [prompt]);

  useEffect(() => {
    function handlePointerDown(event: MouseEvent) {
      if (!actionMenuRef.current?.contains(event.target as Node)) {
        setIsActionMenuOpen(false);
      }
    }

    if (isActionMenuOpen) {
      window.addEventListener("mousedown", handlePointerDown);
    }

    return () => {
      window.removeEventListener("mousedown", handlePointerDown);
    };
  }, [isActionMenuOpen]);

  function setPrompt(value: string) {
    if (!activeTab) return;
    setTabDraftPrompt(activeTab.id, value);
  }

  function handlePromptChange(value: string) {
    if (promptHistoryStateRef.current.index !== null) {
      promptHistoryStateRef.current = {
        index: null,
        draft: "",
      };
    }
    setPrompt(value);
  }

  function focusPromptAtEnd() {
    requestAnimationFrame(() => {
      const el = textareaRef.current;
      if (!el) return;
      el.focus();
      const caret = el.value.length;
      el.setSelectionRange(caret, caret);
    });
  }

  function navigatePromptHistory(direction: -1 | 1) {
    if (!activeTab || promptHistory.length === 0) return;

    const current = promptHistoryStateRef.current;
    if (direction === -1) {
      const nextIndex =
        current.index == null
          ? promptHistory.length - 1
          : Math.max(current.index - 1, 0);
      promptHistoryStateRef.current = {
        index: nextIndex,
        draft: current.index == null ? prompt : current.draft,
      };
      setPrompt(promptHistory[nextIndex]);
      focusPromptAtEnd();
      return;
    }

    if (current.index == null) return;
    if (current.index >= promptHistory.length - 1) {
      setPrompt(current.draft);
      promptHistoryStateRef.current = {
        index: null,
        draft: "",
      };
      focusPromptAtEnd();
      return;
    }

    const nextIndex = current.index + 1;
    promptHistoryStateRef.current = {
      index: nextIndex,
      draft: current.draft,
    };
    setPrompt(promptHistory[nextIndex]);
    focusPromptAtEnd();
  }

  function handleSend() {
    if (!activeTab) return;
    setIsActionMenuOpen(false);

    if (commandOverlay) {
      if (commandOverlay.kind === "command-help" || commandOverlay.kind === "skill-command") {
        return;
      }

      if (interactiveEntries.length > 0) {
        handleOverlaySelect(safeSelectedIndex);
        return;
      }

      const parsed = parseSlashCommand(rawSlashPrompt);
      if (parsed && commandOverlay.kind === "command-list") {
        setPrompt("");
        void executeAcpCommand(parsed, activeTab.id);
        return;
      }

      if (commandOverlay.kind === "command-argument") {
        if (commandOverlay.loading) {
          return;
        }
        appendChatSystemMessage(
          activeTab.id,
          effectiveCli,
          `No matching ${commandOverlay.commandKind} option for ${titleCaseCli(effectiveCli)}.`,
          1
        );
        return;
      }
    }

    promptHistoryStateRef.current = {
      index: null,
      draft: "",
    };
    void sendChatMessage(activeTab.id);
  }

  function selectCommand(command: AcpCommandDef) {
    if (!activeTab) return;
    if (!command.supportedClis.includes(effectiveCli)) return;

    if (command.kind === "help") {
      setPrompt("/help");
      requestAnimationFrame(() => textareaRef.current?.focus());
      return;
    }

    if (isPickerCommandKind(command.kind)) {
      void loadAcpCapabilities(effectiveCli);
      setPrompt(`${command.slash} `);
      requestAnimationFrame(() => textareaRef.current?.focus());
      return;
    }

    const parsed = parseSlashCommand(command.slash);
    if (!parsed) return;
    setPrompt("");
    void executeAcpCommand(parsed, activeTab.id);
  }

  function selectShortcut(shortcut: "skills") {
    if (!activeTab) return;
    if (shortcut === "skills") {
      void loadCliSkills(effectiveCli, workspace?.id ?? "");
      setPrompt("/skills ");
      requestAnimationFrame(() => textareaRef.current?.focus());
    }
  }

  function selectSkill(skill: CliSkillItem) {
    if (!activeTab) return;
    const trimmedPrompt = prompt.trimStart();
    const promptWithoutLeadingSkill = trimmedPrompt.replace(/^\$(?:[A-Za-z0-9._-]+)?\s*/, "");
    const fromSkillCommand = commandOverlay?.kind === "skill-command" || parseSkillSlashQuery(rawSlashPrompt) != null;
    const nextPrompt = fromSkillCommand
      ? `$${skill.name} `
      : `$${skill.name}${promptWithoutLeadingSkill ? ` ${promptWithoutLeadingSkill}` : " "}`;
    setPrompt(nextPrompt);
    setDismissedSkillKey(skillKey);
    requestAnimationFrame(() => {
      const el = textareaRef.current;
      if (!el) return;
      const nextCaret = `$${skill.name} `.length;
      el.focus();
      el.setSelectionRange(nextCaret, nextCaret);
    });
  }

  function selectMention(item: FileMentionCandidate) {
    if (!activeTab || !mentionToken) return;
    const next = `${prompt.slice(0, mentionToken.start)}@${item.relativePath} ${prompt.slice(mentionToken.end)}`;
    setPrompt(next);
    setDismissedMentionKey(null);
    requestAnimationFrame(() => {
      const el = textareaRef.current;
      if (!el) return;
      const nextCaret = mentionToken.start + item.relativePath.length + 2;
      el.focus();
      el.setSelectionRange(nextCaret, nextCaret);
    });
  }

  function selectOption(commandKind: AcpPickerCommandKind, option: AcpOptionDef) {
    if (!activeTab) return;
    setPrompt("");
    void executeAcpCommand(
      {
        kind: commandKind,
        args: [option.value],
        rawInput: `/${commandKind} ${option.value}`,
      },
      activeTab.id
    );
  }

  function handleOverlaySelect(index: number) {
    const entry = interactiveEntries[index];
    if (!entry) return;
    if (entry.kind === "command") {
      selectCommand(entry.command);
      return;
    }
    if (entry.kind === "shortcut") {
      selectShortcut(entry.shortcut);
      return;
    }
    if (entry.kind === "skill") {
      selectSkill(entry.skill);
      return;
    }
    if (entry.kind === "mention") {
      selectMention(entry.mention);
      return;
    }
    selectOption(entry.commandKind, entry.option);
  }

  function handleEscape() {
    if (
      commandOverlay?.kind === "command-argument" ||
      commandOverlay?.kind === "command-help" ||
      commandOverlay?.kind === "skill-command"
    ) {
      setPrompt("/");
      return;
    }

    if (commandOverlay?.kind === "command-list") {
      setPrompt("");
      return;
    }

    if (showSkillOverlay && skillKey) {
      setDismissedSkillKey(skillKey);
      return;
    }

    if (showMentionOverlay && mentionKey) {
      setDismissedMentionKey(mentionKey);
      return;
    }

    if (isActionMenuOpen) {
      setIsActionMenuOpen(false);
    }
  }

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    const hasInteractiveOverlay = interactiveEntries.length > 0;
    const selectionStart = event.currentTarget.selectionStart ?? 0;
    const selectionEnd = event.currentTarget.selectionEnd ?? 0;
    const hasSelection = selectionStart !== selectionEnd;
    const atPromptStart = !hasSelection && selectionStart === 0;
    const atPromptEnd = !hasSelection && selectionEnd === event.currentTarget.value.length;

    if (event.key === "Tab" && event.shiftKey && activeTab && !commandOverlay && !showSkillOverlay && !showMentionOverlay) {
      event.preventDefault();
      togglePlanMode(activeTab.id);
      return;
    }

    if (hasInteractiveOverlay) {
      if (event.key === "ArrowDown") {
        event.preventDefault();
        setSelectedIndex((current) => Math.min(current + 1, interactiveEntries.length - 1));
        return;
      }
      if (event.key === "ArrowUp") {
        event.preventDefault();
        setSelectedIndex((current) => Math.max(current - 1, 0));
        return;
      }
      if (event.key === "Enter" && !event.shiftKey) {
        event.preventDefault();
        handleOverlaySelect(safeSelectedIndex);
        return;
      }
      if (event.key === "Tab" && !event.shiftKey) {
        event.preventDefault();
        handleOverlaySelect(safeSelectedIndex);
        return;
      }
    }

    if (!commandOverlay && !showSkillOverlay && !showMentionOverlay && !isActionMenuOpen) {
      if (event.key === "ArrowUp" && atPromptStart) {
        event.preventDefault();
        navigatePromptHistory(-1);
        return;
      }
      if (event.key === "ArrowDown" && atPromptEnd && promptHistoryStateRef.current.index !== null) {
        event.preventDefault();
        navigatePromptHistory(1);
        return;
      }
    }

    if (event.key === "Escape" && (commandOverlay || showSkillOverlay || showMentionOverlay || isActionMenuOpen)) {
      event.preventDefault();
      handleEscape();
      return;
    }

    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      handleSend();
    }
  }

  if (!activeTab || !workspace) return null;
  const cliLabel = titleCaseCli(activeTab.selectedCli);
  const isAutoMode = activeTab.selectedCli === "auto";

  return (
    <div className="border-t border-border bg-[radial-gradient(circle_at_top,#f8fbff_0%,#ffffff_48%)] px-5 py-4">
      <div className="mx-auto max-w-5xl">
        <div className="relative overflow-visible">
          {(commandOverlay || showSkillOverlay || showMentionOverlay) && (
            <PromptOverlay
              title={commandOverlay?.title ?? (showSkillOverlay ? skillOverlay?.title : undefined)}
              description={
                commandOverlay?.description ??
                (showSkillOverlay ? skillOverlay?.description : undefined)
              }
              sections={activeSections}
              selectedIndex={safeSelectedIndex}
              interactive={interactiveEntries.length > 0}
              footer={commandOverlay?.footer ?? (showSkillOverlay ? skillOverlay?.footer : undefined)}
              onBack={
                commandOverlay?.kind === "command-argument" ||
                commandOverlay?.kind === "command-help" ||
                commandOverlay?.kind === "skill-command"
                  ? () => setPrompt("/")
                  : undefined
              }
              onSelect={(item) => {
                const index = interactiveEntries.findIndex((entry) => entry.id === item.id);
                if (index >= 0) handleOverlaySelect(index);
              }}
            />
          )}

          <div className="rounded-[28px] border border-[#d7e0eb] bg-[linear-gradient(180deg,#ffffff_0%,#f8fbff_100%)] px-4 pt-3 pb-3.5 shadow-[0_18px_54px_rgba(15,23,42,0.08)] transition-colors focus-within:border-accent/40 focus-within:shadow-[0_22px_64px_rgba(59,130,246,0.09)]">
            <div className="mb-3 flex items-center justify-between gap-3">
              <div className="min-w-0">
                <CliSelector />
              </div>

              <div ref={actionMenuRef} className="relative shrink-0">
                <button
                  type="button"
                  onClick={() => {
                    setDismissedMentionKey(null);
                    setDismissedSkillKey(null);
                    setIsActionMenuOpen((current) => !current);
                  }}
                  disabled={isStreaming || isBusy}
                  className="flex h-7 w-7 items-center justify-center rounded-full border border-slate-200 bg-white/90 text-slate-400 transition-all hover:border-indigo-300 hover:text-indigo-600 active:scale-95 shadow-sm disabled:cursor-not-allowed disabled:opacity-40"
                  title="快捷操作"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className={`w-4 h-4 transition-transform duration-300 ${isActionMenuOpen ? 'rotate-45 text-indigo-600' : ''}`}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
                  </svg>
                </button>

                {isActionMenuOpen && (
                  <div className="absolute bottom-full right-0 z-20 mb-3 w-[210px] overflow-hidden rounded-[18px] border border-[#dce4ef] bg-white shadow-[0_24px_70px_rgba(15,23,42,0.14)]">
                    <button
                      type="button"
                      onClick={() => {
                        setIsActionMenuOpen(false);
                        void snapshotWorkspace();
                      }}
                      disabled={isStreaming || isBusy}
                      className="flex w-full items-center gap-3 px-3.5 py-3 text-left transition-colors hover:bg-[#f7f9fc] disabled:cursor-not-allowed disabled:opacity-45"
                      title="Mark this workspace as ready for handoff"
                    >
                      <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-2xl bg-[#eef4ff] text-accent">
                        <svg className="h-3.5 w-3.5" viewBox="0 0 20 20" fill="none" aria-hidden="true">
                          <path d="M10 3v9m0 0l3-3m-3 3L7 9" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
                          <path d="M4 13.5v1A1.5 1.5 0 005.5 16h9A1.5 1.5 0 0016 14.5v-1" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
                        </svg>
                      </div>
                      <div className="min-w-0">
                        <div className="text-[13px] font-semibold text-text">Snapshot</div>
                        <div className="mt-0.5 text-[11px] leading-5 text-secondary">
                          Mark handoff
                        </div>
                      </div>
                    </button>

                    <div className="border-t border-border" />

                    <button
                      type="button"
                      onClick={() => {
                        setIsActionMenuOpen(false);
                        void runChecks();
                      }}
                      disabled={isStreaming || isBusy}
                      className="flex w-full items-center gap-3 px-3.5 py-3 text-left transition-colors hover:bg-[#f7f9fc] disabled:cursor-not-allowed disabled:opacity-45"
                      title="Run the default validation command for this workspace"
                    >
                      <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-2xl bg-[#f4f7fb] text-[#334155]">
                        <svg className="h-3.5 w-3.5" viewBox="0 0 20 20" fill="none" aria-hidden="true">
                          <path d="M4.5 10.5l3 3L15.5 5.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
                        </svg>
                      </div>
                      <div className="min-w-0">
                        <div className="text-[13px] font-semibold text-text">Run Checks</div>
                        <div className="mt-0.5 text-[11px] leading-5 text-secondary">
                          Validate
                        </div>
                      </div>
                    </button>

                    <div className="border-t border-border bg-[#fbfcfe] px-3.5 py-2 text-[10px] text-muted">
                      Shift+Tab toggles plan mode.
                    </div>
                  </div>
                )}
              </div>
            </div>

            <textarea
              ref={textareaRef}
              rows={1}
              value={prompt}
              onChange={(event) => handlePromptChange(event.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={
                isStreaming
                  ? "Waiting for response..."
                  : isAutoMode
                    ? "Describe the task and Auto will let Claude plan and route the work"
                    : `Message ${cliLabel}`
              }
              disabled={isStreaming}
              className="min-h-[3.5rem] w-full resize-none bg-transparent px-0 py-0 text-[15px] leading-8 text-text placeholder:text-secondary/65 focus:outline-none disabled:cursor-not-allowed disabled:opacity-50"
            />
          </div>

          <div className="mt-4 flex flex-col gap-4 border-t border-slate-100 pt-4 text-[10px] font-medium text-slate-400 select-none md:flex-row md:items-center md:justify-between">
            <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
              <div className="flex items-center gap-2">
                <kbd className="rounded border border-slate-200 bg-slate-50 px-1.5 py-0.5 font-mono text-[9px] font-bold text-slate-500 shadow-sm">/</kbd>
                <span className="tracking-tight">指令中心</span>
              </div>
              <div className="flex items-center gap-2">
                <kbd className="rounded border border-slate-200 bg-slate-50 px-1.5 py-0.5 font-mono text-[9px] font-bold text-slate-500 shadow-sm">@</kbd>
                <span className="tracking-tight">引用文件</span>
              </div>
              {!isAutoMode && (
                <div className="flex items-center gap-2">
                  <kbd className="rounded border border-slate-200 bg-slate-50 px-1.5 py-0.5 font-mono text-[9px] font-bold text-slate-500 shadow-sm">$</kbd>
                  <span className="tracking-tight">调用技能</span>
                </div>
              )}
              {isAutoMode && (
                <div className="flex items-center gap-2 text-indigo-500/80">
                  <div className="h-1 w-1 rounded-full bg-indigo-400 animate-pulse" />
                  <span className="font-semibold tracking-tight">Auto 模式已激活</span>
                </div>
              )}
            </div>
            
            <div className="flex flex-wrap items-center gap-x-5 gap-y-2 border-slate-100 md:border-l md:pl-5">
              <div className="flex items-center gap-2">
                <kbd className="rounded border border-slate-200 bg-slate-50 px-1.5 py-0.5 font-mono text-[9px] font-bold text-slate-500 shadow-sm">ENTER</kbd>
                <span className="tracking-tight">发送</span>
              </div>
              <div className="flex items-center gap-2">
                <kbd className="rounded border border-slate-200 bg-slate-50 px-1.5 py-0.5 font-mono text-[9px] font-bold text-slate-500 shadow-sm">SHIFT + ↵</kbd>
                <span className="tracking-tight">换行</span>
              </div>
              <div className="flex items-center gap-2">
                <kbd className="rounded border border-slate-200 bg-slate-50 px-1.5 py-0.5 font-mono text-[9px] font-bold text-slate-500 shadow-sm">↑ ↓</kbd>
                <span className="tracking-tight">历史记录</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
