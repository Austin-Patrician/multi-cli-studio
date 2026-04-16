import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { MouseEvent as ReactMouseEvent } from "react";
import {
  ArrowDownToLine,
  Palette,
  Play,
  Square,
  Trash2,
  WrapText,
} from "lucide-react";
import {
  Select,
  SelectGroup,
  SelectGroupLabel,
  SelectItem,
  SelectPopup,
  SelectSeparator,
  SelectTrigger,
} from "../ui/select";
import type {
  RuntimeCommandPresetId,
  RuntimeConsoleStatus,
} from "./useRuntimeLogSession";

export type RuntimeLogDockProps = {
  isVisible: boolean;
  status: RuntimeConsoleStatus;
  commandPreview?: string | null;
  log: string;
  error: string | null;
  exitCode?: number | null;
  truncated?: boolean;
  autoScroll?: boolean;
  wrapLines?: boolean;
  commandPresetOptions?: RuntimeCommandPresetId[];
  commandPresetId?: RuntimeCommandPresetId;
  commandInput?: string;
  onRun?: () => Promise<void> | void;
  onCommandPresetChange?: (presetId: RuntimeCommandPresetId) => void;
  onCommandInputChange?: (value: string) => void;
  onStop: () => Promise<void> | void;
  onClear: () => void;
  onCopy?: () => Promise<void> | void;
  onToggleAutoScroll?: () => void;
  onToggleWrapLines?: () => void;
};

const ESCAPE_CHAR = String.fromCharCode(27);
const ANSI_ESCAPE_PATTERN = new RegExp(`${ESCAPE_CHAR}\\[[0-9;?]*[ -/]*[@-~]`, "g");
const LOG_TOKEN_PATTERN =
  /(\bTRACE\b|\bDEBUG\b|\bINFO\b|\bWARN\b|\bERROR\b|\[\s*[\w\-:.]+\s*\]|(?:\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}(?:[.,]\d{3})?)|(?:[a-z_][\w$]*\.)+[A-Za-z_$][\w$]*(?:@[0-9a-fA-F]+)?|---)/g;
const TIMESTAMP_PATTERN = /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}(?:[.,]\d{3})?$/;
const JAVA_FQCN_PATTERN = /^(?:[a-z_][\w$]*\.)+[A-Za-z_$][\w$]*(?:@[0-9a-fA-F]+)?$/;
const SPRING_BOOT_LINE_PATTERN =
  /^(\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}(?:[.,]\d{3})?)\s+(TRACE|DEBUG|INFO|WARN|ERROR)\s+(\d+)\s+---\s+(\[[^\]]+\])\s+([^\s]+)\s*:\s?(.*)$/;
const RUNTIME_PANEL_MIN_HEIGHT = 160;
const RUNTIME_PANEL_MAX_HEIGHT = 640;
const RUNTIME_PANEL_DEFAULT_HEIGHT = 240;
const RUNTIME_PANEL_HEIGHT_STORAGE_KEY = "multi-cli-studio::runtime-console-height";
const RUNTIME_PANEL_THEME_STORAGE_KEY = "multi-cli-studio::runtime-console-theme";

type RuntimeLineTone = "default" | "system" | "info" | "warn" | "error" | "debug";
type RuntimeConsoleIdeaTheme = "classic" | "new-ui";
type RuntimeCommandTool = "maven" | "gradle" | "node" | "python" | "go" | "unknown";

const COMMAND_OPTION_CUSTOM = "__custom__";
const MAVEN_PHASE_OPTIONS = [
  "clean",
  "validate",
  "compile",
  "test",
  "package",
  "verify",
  "install",
  "site",
  "deploy",
];
const MAVEN_SPRING_BOOT_OPTIONS = [
  "spring-boot:build-image",
  "spring-boot:build-info",
  "spring-boot:help",
  "spring-boot:repackage",
  "spring-boot:run",
  "spring-boot:start",
  "spring-boot:stop",
];
const GRADLE_TASK_OPTIONS = ["clean", "assemble", "build", "check", "test", "bootRun", "publish"];
const NODE_SCRIPT_OPTIONS_DEV_FIRST = [
  "dev",
  "tauri dev",
  "start",
  "build",
  "tauri build",
  "preview",
  "test",
];
const NODE_SCRIPT_OPTIONS_START_FIRST = [
  "start",
  "dev",
  "tauri dev",
  "build",
  "tauri build",
  "preview",
  "test",
];
const PYTHON_COMMAND_OPTIONS = [
  "python3 main.py",
  "python3 app.py",
  "python3 manage.py runserver",
  "py -3 main.py",
  "py -3 app.py",
  "py -3 manage.py runserver",
  "main.py",
  "app.py",
  "manage.py runserver",
  "-m uvicorn main:app --reload",
];
const GO_RUN_TARGET_OPTIONS = [".", "./cmd/server", "./cmd/api", "./cmd/main"];

function hasProgramPrefix(commandInput: string, program: string) {
  const normalized = commandInput.trim().toLowerCase();
  const target = program.toLowerCase();
  return normalized === target || normalized.startsWith(`${target} `);
}

function resolveNodeCommandProgram(commandInput: string): string | null {
  if (hasProgramPrefix(commandInput, "pnpm run")) return "pnpm run";
  if (hasProgramPrefix(commandInput, "npm run")) return "npm run";
  if (hasProgramPrefix(commandInput, "yarn run")) return "yarn run";
  if (hasProgramPrefix(commandInput, "yarn")) return "yarn";
  if (hasProgramPrefix(commandInput, "bun run")) return "bun run";
  return null;
}

function resolveCommandTool(
  presetId: RuntimeCommandPresetId,
  commandInput: string,
): RuntimeCommandTool {
  if (presetId === "java-maven") return "maven";
  if (presetId === "java-gradle") return "gradle";
  if (presetId === "node-dev" || presetId === "node-start") return "node";
  if (presetId === "python-main") return "python";
  if (presetId === "go-run") return "go";
  if (resolveNodeCommandProgram(commandInput)) return "node";
  if (
    hasProgramPrefix(commandInput, "py -3") ||
    hasProgramPrefix(commandInput, "py") ||
    hasProgramPrefix(commandInput, "python3") ||
    hasProgramPrefix(commandInput, "python")
  ) {
    return "python";
  }
  if (hasProgramPrefix(commandInput, "go run")) return "go";
  if (
    hasProgramPrefix(commandInput, "./mvnw") ||
    hasProgramPrefix(commandInput, "mvnw.cmd") ||
    hasProgramPrefix(commandInput, "mvn")
  ) {
    return "maven";
  }
  if (
    hasProgramPrefix(commandInput, "./gradlew") ||
    hasProgramPrefix(commandInput, "gradlew.bat") ||
    hasProgramPrefix(commandInput, "gradle")
  ) {
    return "gradle";
  }
  return "unknown";
}

function resolveCommandProgram(
  presetId: RuntimeCommandPresetId,
  tool: RuntimeCommandTool,
  commandInput: string,
): string | null {
  if (presetId === "java-maven") {
    if (hasProgramPrefix(commandInput, "mvnw.cmd")) return "mvnw.cmd";
    if (hasProgramPrefix(commandInput, "./mvnw")) return "./mvnw";
    if (hasProgramPrefix(commandInput, "mvn")) return "mvn";
    return "mvn";
  }
  if (presetId === "java-gradle") {
    if (hasProgramPrefix(commandInput, "gradlew.bat")) return "gradlew.bat";
    if (hasProgramPrefix(commandInput, "./gradlew")) return "./gradlew";
    if (hasProgramPrefix(commandInput, "gradle")) return "gradle";
    return "gradle";
  }
  if (presetId === "node-dev" || presetId === "node-start") {
    return resolveNodeCommandProgram(commandInput) ?? "npm run";
  }
  if (presetId === "python-main") {
    if (hasProgramPrefix(commandInput, "py -3")) return "py -3";
    if (hasProgramPrefix(commandInput, "py")) return "py";
    if (hasProgramPrefix(commandInput, "python3")) return "python3";
    if (hasProgramPrefix(commandInput, "python")) return "python";
    return "python3";
  }
  if (presetId === "go-run") return "go run";
  if (tool === "maven") {
    if (hasProgramPrefix(commandInput, "mvnw.cmd")) return "mvnw.cmd";
    if (hasProgramPrefix(commandInput, "./mvnw")) return "./mvnw";
    if (hasProgramPrefix(commandInput, "mvn")) return "mvn";
    return null;
  }
  if (tool === "gradle") {
    if (hasProgramPrefix(commandInput, "gradlew.bat")) return "gradlew.bat";
    if (hasProgramPrefix(commandInput, "./gradlew")) return "./gradlew";
    if (hasProgramPrefix(commandInput, "gradle")) return "gradle";
    return null;
  }
  if (tool === "node") return resolveNodeCommandProgram(commandInput);
  if (tool === "python") {
    if (hasProgramPrefix(commandInput, "py -3")) return "py -3";
    if (hasProgramPrefix(commandInput, "py")) return "py";
    if (hasProgramPrefix(commandInput, "python3")) return "python3";
    if (hasProgramPrefix(commandInput, "python")) return "python";
    return null;
  }
  if (tool === "go") return hasProgramPrefix(commandInput, "go run") ? "go run" : null;
  return null;
}

function extractCommandTail(program: string | null, commandInput: string): string {
  const normalized = commandInput.trim();
  if (!program || !normalized.startsWith(program)) {
    return "";
  }
  return normalized.slice(program.length).trim();
}

function sanitizeRuntimeOutput(raw: string) {
  return raw.replace(ANSI_ESCAPE_PATTERN, "").replace(/\r/g, "");
}

function resolveLineTone(line: string): RuntimeLineTone {
  if (SPRING_BOOT_LINE_PATTERN.test(line)) return "default";
  const normalized = line.toUpperCase();
  if (line.includes("[multi-cli Run]") || line.includes("[ccgui Run]") || line.includes("[CodeMoss Run]")) {
    return "system";
  }
  if (
    /^\s*CAUSED BY:/.test(normalized) ||
    /^\s*AT\s+/.test(normalized) ||
    /^\s*\.\.\. \d+ MORE$/.test(normalized) ||
    /\bEXCEPTION\b/.test(normalized) ||
    /\bERROR\b/.test(normalized)
  ) {
    return "error";
  }
  return "default";
}

function clampPanelHeight(value: number) {
  return Math.round(Math.min(RUNTIME_PANEL_MAX_HEIGHT, Math.max(RUNTIME_PANEL_MIN_HEIGHT, value)));
}

function readSavedPanelHeight() {
  if (typeof window === "undefined") return RUNTIME_PANEL_DEFAULT_HEIGHT;
  const raw = window.localStorage.getItem(RUNTIME_PANEL_HEIGHT_STORAGE_KEY);
  const parsed = raw ? Number.parseInt(raw, 10) : Number.NaN;
  if (!Number.isFinite(parsed)) return RUNTIME_PANEL_DEFAULT_HEIGHT;
  return clampPanelHeight(parsed);
}

function normalizeIdeaTheme(value: string | null): RuntimeConsoleIdeaTheme {
  return value === "classic" ? "classic" : "new-ui";
}

function readSavedIdeaTheme(): RuntimeConsoleIdeaTheme {
  if (typeof window === "undefined") return "new-ui";
  return normalizeIdeaTheme(window.localStorage.getItem(RUNTIME_PANEL_THEME_STORAGE_KEY));
}

function classifyToken(token: string) {
  const normalized = token.toUpperCase();
  if (/^(TRACE|DEBUG|INFO|WARN|ERROR)$/.test(normalized)) {
    return `is-level is-level-${normalized.toLowerCase()}`;
  }
  if (token.startsWith("[") && token.endsWith("]")) return "is-thread";
  if (TIMESTAMP_PATTERN.test(token)) return "is-time";
  if (token === "---") return "is-separator";
  if (JAVA_FQCN_PATTERN.test(token)) return "is-java";
  return "";
}

function renderJavaToken(token: string, keyPrefix: string) {
  if (!JAVA_FQCN_PATTERN.test(token) || !token.includes(".")) {
    return (
      <span key={`${keyPrefix}-java`} className="runtime-console-token is-java">
        {token}
      </span>
    );
  }

  const hashStart = token.indexOf("@");
  const symbolPart = hashStart >= 0 ? token.slice(0, hashStart) : token;
  const hashPart = hashStart >= 0 ? token.slice(hashStart) : "";
  const splitAt = symbolPart.lastIndexOf(".");
  if (splitAt <= 0) {
    return (
      <span key={`${keyPrefix}-java`} className="runtime-console-token is-java">
        {token}
      </span>
    );
  }

  return (
    <Fragment key={`${keyPrefix}-java`}>
      <span className="runtime-console-token is-java-package">{symbolPart.slice(0, splitAt + 1)}</span>
      <span className="runtime-console-token is-java-class">{symbolPart.slice(splitAt + 1)}</span>
      {hashPart ? <span className="runtime-console-token is-java-meta">{hashPart}</span> : null}
    </Fragment>
  );
}

function resolveStatusLabel(status: RuntimeConsoleStatus) {
  switch (status) {
    case "starting":
      return "Starting";
    case "running":
      return "Running";
    case "stopped":
      return "Stopped";
    case "error":
      return "Error";
    default:
      return "Idle";
  }
}

export function RuntimeLogDock({
  isVisible,
  status,
  log,
  error,
  exitCode,
  truncated = false,
  autoScroll = true,
  wrapLines = true,
  commandPresetOptions = ["auto", "custom"],
  commandPresetId = "auto",
  commandInput = "",
  onRun,
  onCommandPresetChange,
  onCommandInputChange,
  onStop,
  onClear,
  onToggleAutoScroll,
  onToggleWrapLines,
}: RuntimeLogDockProps) {
  const logRef = useRef<HTMLPreElement | null>(null);
  const commandInlineRef = useRef<HTMLDivElement | null>(null);
  const [panelHeight, setPanelHeight] = useState(readSavedPanelHeight);
  const [ideaTheme, setIdeaTheme] = useState<RuntimeConsoleIdeaTheme>(readSavedIdeaTheme);
  const [isResizing, setIsResizing] = useState(false);
  const [isGoalSelectCompact, setIsGoalSelectCompact] = useState(false);
  const statusLabel = useMemo(() => resolveStatusLabel(status), [status]);
  const isStoppable = status === "starting" || status === "running";
  const canRun = !isStoppable && Boolean(onRun);
  const rawOutput = error
    ? `${log}${log.endsWith("\n") || !log ? "" : "\n"}[multi-cli Run] ${error}\n`
    : log;
  const output = useMemo(() => sanitizeRuntimeOutput(rawOutput), [rawOutput]);
  const logLines = useMemo(() => (output ? output.split("\n") : ["No runtime logs yet."]), [output]);
  const commandPresetItems: ReadonlyArray<{ id: RuntimeCommandPresetId; label: string }> =
    commandPresetOptions.map((id) => {
      switch (id) {
        case "auto":
          return { id, label: "Auto detect" };
        case "java-maven":
          return { id, label: "Java Maven" };
        case "java-gradle":
          return { id, label: "Java Gradle" };
        case "node-dev":
          return { id, label: "Node Dev" };
        case "node-start":
          return { id, label: "Node Start" };
        case "python-main":
          return { id, label: "Python Main" };
        case "go-run":
          return { id, label: "Go Run" };
        case "custom":
          return { id, label: "Custom" };
      }
    });
  const selectedPresetLabel = useMemo(
    () => commandPresetItems.find((option) => option.id === commandPresetId)?.label ?? commandPresetId,
    [commandPresetId, commandPresetItems],
  );
  const commandTool = useMemo(() => resolveCommandTool(commandPresetId, commandInput), [commandPresetId, commandInput]);
  const commandProgram = useMemo(
    () => resolveCommandProgram(commandPresetId, commandTool, commandInput),
    [commandPresetId, commandTool, commandInput],
  );
  const commandGoalOptions = useMemo(() => {
    if (commandTool === "maven") return [...MAVEN_PHASE_OPTIONS, ...MAVEN_SPRING_BOOT_OPTIONS];
    if (commandTool === "gradle") return GRADLE_TASK_OPTIONS;
    if (commandTool === "node") {
      return commandPresetId === "node-start"
        ? NODE_SCRIPT_OPTIONS_START_FIRST
        : NODE_SCRIPT_OPTIONS_DEV_FIRST;
    }
    if (commandTool === "python") return PYTHON_COMMAND_OPTIONS;
    if (commandTool === "go") return GO_RUN_TARGET_OPTIONS;
    return [];
  }, [commandPresetId, commandTool]);
  const commandTail = useMemo(() => extractCommandTail(commandProgram, commandInput), [commandProgram, commandInput]);
  const selectedCommandGoal = useMemo(() => {
    if (!commandGoalOptions.length) return COMMAND_OPTION_CUSTOM;
    return commandGoalOptions.includes(commandTail) ? commandTail : COMMAND_OPTION_CUSTOM;
  }, [commandGoalOptions, commandTail]);
  const selectedGoalLabel = useMemo(() => {
    if (!commandProgram || commandGoalOptions.length === 0) return "Goal";
    return selectedCommandGoal === COMMAND_OPTION_CUSTOM ? "Custom" : selectedCommandGoal;
  }, [commandGoalOptions.length, commandProgram, selectedCommandGoal]);
  const nextThemeLabel = ideaTheme === "classic" ? "New UI" : "Classic";

  const renderHighlightedLine = useCallback((line: string) => {
    const parts = line.split(LOG_TOKEN_PATTERN);
    return parts.map((part, index) => {
      if (!part) return null;
      const tokenClass = classifyToken(part);
      if (!tokenClass) return <span key={`plain-${index}`}>{part}</span>;
      if (tokenClass === "is-java") return renderJavaToken(part, `token-${index}`);
      return (
        <span key={`token-${index}`} className={`runtime-console-token ${tokenClass}`}>
          {part}
        </span>
      );
    });
  }, []);

  const renderSpringBootLine = useCallback(
    (line: string) => {
      const matched = line.match(SPRING_BOOT_LINE_PATTERN);
      if (!matched) return null;
      const [, timestamp, level, pid, thread, logger, message] = matched;
      const normalizedLevel = level ?? "info";
      return (
        <>
          <span className="runtime-console-token is-time">{timestamp}</span>{" "}
          <span className={`runtime-console-token is-level is-level-${normalizedLevel.toLowerCase()}`}>
            {normalizedLevel}
          </span>{" "}
          <span className="runtime-console-token is-pid">{pid}</span>{" "}
          <span className="runtime-console-token is-separator">---</span>{" "}
          <span className="runtime-console-token is-thread">{thread}</span>{" "}
          {renderJavaToken(logger ?? "", "spring-logger")}
          <span className="runtime-console-token is-separator"> : </span>
          {message ? renderHighlightedLine(message) : null}
        </>
      );
    },
    [renderHighlightedLine],
  );

  const handleResizeStart = useCallback(
    (event: ReactMouseEvent<HTMLDivElement>) => {
      if (event.button !== 0) return;
      event.preventDefault();
      const startY = event.clientY;
      const startHeight = panelHeight;
      setIsResizing(true);
      document.body.style.cursor = "row-resize";
      document.body.style.userSelect = "none";

      const handleMouseMove = (moveEvent: globalThis.MouseEvent) => {
        const deltaY = moveEvent.clientY - startY;
        setPanelHeight(clampPanelHeight(startHeight - deltaY));
      };

      const handleMouseUp = () => {
        window.removeEventListener("mousemove", handleMouseMove);
        window.removeEventListener("mouseup", handleMouseUp);
        document.body.style.cursor = "";
        document.body.style.userSelect = "";
        setIsResizing(false);
      };

      window.addEventListener("mousemove", handleMouseMove);
      window.addEventListener("mouseup", handleMouseUp);
    },
    [panelHeight],
  );

  useEffect(() => {
    if (!autoScroll) return;
    const node = logRef.current;
    if (!node) return;
    node.scrollTop = node.scrollHeight;
  }, [autoScroll, output]);

  useEffect(() => {
    if (typeof window !== "undefined") {
      window.localStorage.setItem(RUNTIME_PANEL_HEIGHT_STORAGE_KEY, String(panelHeight));
    }
  }, [panelHeight]);

  useEffect(() => {
    if (typeof window !== "undefined") {
      window.localStorage.setItem(RUNTIME_PANEL_THEME_STORAGE_KEY, ideaTheme);
    }
  }, [ideaTheme]);

  useEffect(() => {
    const node = commandInlineRef.current;
    if (!node) return;

    const updateCompactState = () => {
      setIsGoalSelectCompact(node.getBoundingClientRect().width < 540);
    };

    updateCompactState();

    if (typeof ResizeObserver === "undefined") {
      window.addEventListener("resize", updateCompactState);
      return () => {
        window.removeEventListener("resize", updateCompactState);
      };
    }

    const observer = new ResizeObserver(updateCompactState);
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  if (!isVisible) return null;

  return (
    <section
      className={`runtime-console-panel is-idea-${ideaTheme}${isResizing ? " is-resizing" : ""}`}
      style={{ height: `${panelHeight}px` }}
    >
      <div
        className="runtime-console-resizer"
        role="separator"
        aria-orientation="horizontal"
        aria-label="Resize runtime console"
        onMouseDown={handleResizeStart}
      >
        <span className="runtime-console-resizer-bar" aria-hidden />
      </div>
      <div className="runtime-console-header">
        <div className="runtime-console-header-main">
          <div className="runtime-console-title-wrap">
            <div className="runtime-console-title">Run Console</div>
            <span className={`runtime-console-status is-${status}`}>{statusLabel}</span>
            {exitCode !== null && exitCode !== undefined ? (
              <span className={`runtime-console-exit ${exitCode === 0 ? "is-ok" : "is-fail"}`}>
                Exit {exitCode}
              </span>
            ) : null}
            {truncated ? <span className="runtime-console-truncated">Showing latest 5000 lines</span> : null}
          </div>
          <div className="runtime-console-command-inline" ref={commandInlineRef}>
            <div className="runtime-console-select-cluster">
              <div className="runtime-console-select-wrap runtime-console-select-wrap-preset">
                <Select
                  value={commandPresetId}
                  onValueChange={(value) => onCommandPresetChange?.(value as RuntimeCommandPresetId)}
                >
                  <SelectTrigger
                    size="sm"
                    className="runtime-console-select-trigger runtime-console-select-trigger-preset w-auto"
                    aria-label="Preset"
                    title={selectedPresetLabel}
                  >
                    <span className="runtime-console-select-trigger-text">{selectedPresetLabel}</span>
                  </SelectTrigger>
                  <SelectPopup
                    side="top"
                    sideOffset={10}
                    align="start"
                    alignOffset={0}
                    alignItemWithTrigger={false}
                    className="runtime-console-select-list"
                  >
                    {commandPresetItems.map((option) => (
                      <SelectItem key={option.id} value={option.id}>
                        {option.label}
                      </SelectItem>
                    ))}
                  </SelectPopup>
                </Select>
              </div>
              <div className={`runtime-console-select-wrap runtime-console-select-wrap-goal${isGoalSelectCompact ? " is-compact" : ""}`}>
                <Select
                  value={selectedCommandGoal}
                  onValueChange={(value) => {
                    if (value === COMMAND_OPTION_CUSTOM || !commandProgram || !commandGoalOptions.length) {
                      return;
                    }
                    onCommandInputChange?.(`${commandProgram} ${value}`);
                  }}
                >
                  <SelectTrigger
                    size="sm"
                    className={`runtime-console-select-trigger runtime-console-select-trigger-goal w-auto${isGoalSelectCompact ? " is-compact" : ""}`}
                    aria-label="Goal"
                    title={selectedGoalLabel}
                    disabled={!commandProgram || commandGoalOptions.length === 0}
                  >
                    <span className="runtime-console-select-trigger-text">{selectedGoalLabel}</span>
                  </SelectTrigger>
                  <SelectPopup
                    side="top"
                    sideOffset={10}
                    align="start"
                    alignOffset={0}
                    alignItemWithTrigger={false}
                    className="runtime-console-select-list"
                  >
                    {commandTool === "maven" ? (
                      <>
                        <SelectGroup>
                          <SelectGroupLabel>Maven phases</SelectGroupLabel>
                          {MAVEN_PHASE_OPTIONS.map((option) => (
                            <SelectItem key={option} value={option}>
                              {option}
                            </SelectItem>
                          ))}
                        </SelectGroup>
                        <SelectSeparator />
                        <SelectGroup>
                          <SelectGroupLabel>Spring Boot</SelectGroupLabel>
                          {MAVEN_SPRING_BOOT_OPTIONS.map((option) => (
                            <SelectItem key={option} value={option}>
                              {option}
                            </SelectItem>
                          ))}
                        </SelectGroup>
                      </>
                    ) : commandTool === "gradle" ? (
                      <SelectGroup>
                        <SelectGroupLabel>Gradle tasks</SelectGroupLabel>
                        {commandGoalOptions.map((option) => (
                          <SelectItem key={option} value={option}>
                            {option}
                          </SelectItem>
                        ))}
                      </SelectGroup>
                    ) : commandTool === "node" ? (
                      <SelectGroup>
                        <SelectGroupLabel>Node scripts</SelectGroupLabel>
                        {commandGoalOptions.map((option) => (
                          <SelectItem key={option} value={option}>
                            {option}
                          </SelectItem>
                        ))}
                      </SelectGroup>
                    ) : commandTool === "python" ? (
                      <SelectGroup>
                        <SelectGroupLabel>Python examples</SelectGroupLabel>
                        {commandGoalOptions.map((option) => (
                          <SelectItem key={option} value={option}>
                            {option}
                          </SelectItem>
                        ))}
                      </SelectGroup>
                    ) : commandTool === "go" ? (
                      <SelectGroup>
                        <SelectGroupLabel>Go examples</SelectGroupLabel>
                        {commandGoalOptions.map((option) => (
                          <SelectItem key={option} value={option}>
                            {option}
                          </SelectItem>
                        ))}
                      </SelectGroup>
                    ) : null}
                    {commandGoalOptions.length > 0 ? <SelectSeparator /> : null}
                    <SelectItem value={COMMAND_OPTION_CUSTOM}>Custom</SelectItem>
                  </SelectPopup>
                </Select>
              </div>
            </div>
            <input
              className="runtime-console-command-input"
              type="text"
              value={commandInput}
              onChange={(event) => onCommandInputChange?.(event.target.value)}
              placeholder="Enter run command"
              aria-label="Command"
              spellCheck={false}
              autoCapitalize="off"
              autoCorrect="off"
            />
          </div>
        </div>
        <div className="runtime-console-actions">
          <button
            type="button"
            className="runtime-console-action runtime-console-action-run"
            onClick={() => void onRun?.()}
            disabled={!canRun}
            aria-label="Run project"
            title="Run project"
          >
            <Play size={14} aria-hidden />
          </button>
          <button
            type="button"
            className="runtime-console-action runtime-console-action-stop"
            onClick={() => void onStop()}
            disabled={!isStoppable}
            aria-label="Stop run"
            title="Stop run"
          >
            <Square size={14} aria-hidden />
          </button>
          <button type="button" className="runtime-console-action" onClick={onClear} aria-label="Clear logs" title="Clear logs">
            <Trash2 size={14} aria-hidden />
          </button>
          <button
            type="button"
            className={`runtime-console-action${autoScroll ? " is-active" : ""}`}
            onClick={onToggleAutoScroll}
            disabled={!onToggleAutoScroll}
            aria-label={autoScroll ? "Auto scroll on" : "Auto scroll off"}
            title={autoScroll ? "Auto scroll on" : "Auto scroll off"}
          >
            <ArrowDownToLine size={14} aria-hidden />
          </button>
          <button
            type="button"
            className={`runtime-console-action${wrapLines ? " is-active" : ""}`}
            onClick={onToggleWrapLines}
            disabled={!onToggleWrapLines}
            aria-label={wrapLines ? "Wrap off" : "Wrap on"}
            title={wrapLines ? "Wrap off" : "Wrap on"}
          >
            <WrapText size={14} aria-hidden />
          </button>
          <button
            type="button"
            className={`runtime-console-action runtime-console-action-theme${ideaTheme === "classic" ? " is-active" : ""}`}
            onClick={() => {
              setIdeaTheme((prev) => (prev === "classic" ? "new-ui" : "classic"));
            }}
            aria-label={`Switch to ${nextThemeLabel}`}
            title={`Switch to ${nextThemeLabel}`}
          >
            <Palette size={14} aria-hidden />
          </button>
        </div>
      </div>
      <pre className={`runtime-console-log ${wrapLines ? "is-wrap" : "is-nowrap"}`} ref={logRef}>
        {logLines.map((line, index) => (
          <span key={`line-${index}-${line.length}`} className={`runtime-console-line is-${resolveLineTone(line)}`}>
            {renderSpringBootLine(line) ?? renderHighlightedLine(line)}
            {index < logLines.length - 1 ? "\n" : null}
          </span>
        ))}
      </pre>
    </section>
  );
}
