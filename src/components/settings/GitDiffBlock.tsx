import { useMemo } from "react";

export type GitDiffStyle = "split" | "unified";

type ParsedDiffLine = {
  type: "add" | "del" | "context" | "hunk" | "meta";
  oldLine: number | null;
  newLine: number | null;
  text: string;
};

type IndexedDiffLine = {
  index: number;
  line: ParsedDiffLine;
};

type SplitDiffRow =
  | {
      kind: "header";
      key: string;
      line: IndexedDiffLine;
    }
  | {
      kind: "pair";
      key: string;
      left: IndexedDiffLine | null;
      right: IndexedDiffLine | null;
    };

const HUNK_REGEX = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/;

function parseDiff(diff: string): ParsedDiffLine[] {
  const lines = diff.split("\n");
  const parsed: ParsedDiffLine[] = [];
  let oldLine = 0;
  let newLine = 0;
  let inHunk = false;

  for (const line of lines) {
    if (line.startsWith("@@")) {
      const match = HUNK_REGEX.exec(line);
      if (match) {
        oldLine = Number(match[1]);
        newLine = Number(match[3]);
      }
      parsed.push({
        type: "hunk",
        oldLine: null,
        newLine: null,
        text: line,
      });
      inHunk = true;
      continue;
    }

    if (!inHunk) {
      continue;
    }

    if (line.startsWith("+")) {
      parsed.push({
        type: "add",
        oldLine: null,
        newLine,
        text: line.slice(1),
      });
      newLine += 1;
      continue;
    }

    if (line.startsWith("-")) {
      parsed.push({
        type: "del",
        oldLine,
        newLine: null,
        text: line.slice(1),
      });
      oldLine += 1;
      continue;
    }

    if (line.startsWith(" ")) {
      parsed.push({
        type: "context",
        oldLine,
        newLine,
        text: line.slice(1),
      });
      oldLine += 1;
      newLine += 1;
      continue;
    }

    if (line.startsWith("\\")) {
      parsed.push({
        type: "meta",
        oldLine: null,
        newLine: null,
        text: line,
      });
    }
  }

  return parsed;
}

function buildSplitRows(parsed: ParsedDiffLine[]): SplitDiffRow[] {
  const rows: SplitDiffRow[] = [];
  let cursor = 0;

  while (cursor < parsed.length) {
    const line = parsed[cursor];
    if (!line) {
      cursor += 1;
      continue;
    }

    if (line.type === "hunk" || line.type === "meta") {
      rows.push({
        kind: "header",
        key: `header-${cursor}`,
        line: { index: cursor, line },
      });
      cursor += 1;
      continue;
    }

    if (line.type === "context") {
      const entry = { index: cursor, line };
      rows.push({
        kind: "pair",
        key: `context-${cursor}`,
        left: entry,
        right: entry,
      });
      cursor += 1;
      continue;
    }

    const deletions: IndexedDiffLine[] = [];
    const additions: IndexedDiffLine[] = [];

    if (line.type === "del") {
      while (cursor < parsed.length) {
        const current = parsed[cursor];
        if (!current || current.type !== "del") break;
        deletions.push({ index: cursor, line: current });
        cursor += 1;
      }
      while (cursor < parsed.length) {
        const current = parsed[cursor];
        if (!current || current.type !== "add") break;
        additions.push({ index: cursor, line: current });
        cursor += 1;
      }
    } else if (line.type === "add") {
      while (cursor < parsed.length) {
        const current = parsed[cursor];
        if (!current || current.type !== "add") break;
        additions.push({ index: cursor, line: current });
        cursor += 1;
      }
    } else {
      cursor += 1;
      continue;
    }

    const rowCount = Math.max(deletions.length, additions.length);
    for (let offset = 0; offset < rowCount; offset += 1) {
      rows.push({
        kind: "pair",
        key: `pair-${deletions[offset]?.index ?? "x"}-${additions[offset]?.index ?? "x"}`,
        left: deletions[offset] ?? null,
        right: additions[offset] ?? null,
      });
    }
  }

  return rows;
}

function renderLineNumber(value: number | null) {
  return value ?? "";
}

function renderLine(
  indexedLine: IndexedDiffLine,
  mode: "unified" | "old" | "new",
  key: string
) {
  const { line } = indexedLine;
  const lineNumber =
    mode === "old" ? line.oldLine : mode === "new" ? line.newLine : line.newLine ?? line.oldLine;

  return (
    <div
      key={key}
      className={`diff-line diff-line-${line.type}${mode !== "unified" ? " diff-line-split" : ""}`}
      data-line-type={line.type}
      data-line={lineNumber ?? undefined}
    >
      {mode === "unified" ? (
        <div className="diff-gutter">
          <span className="diff-line-number">{renderLineNumber(line.oldLine)}</span>
          <span className="diff-line-number">{renderLineNumber(line.newLine)}</span>
        </div>
      ) : (
        <div className="diff-gutter diff-gutter-single">
          <span className="diff-line-number">{renderLineNumber(lineNumber)}</span>
        </div>
      )}
      <div className="diff-line-content">{line.text || " "}</div>
    </div>
  );
}

function renderEmptyLine(key: string) {
  return (
    <div key={key} className="diff-line diff-line-empty diff-line-split" aria-hidden>
      <div className="diff-gutter diff-gutter-single">
        <span className="diff-line-number" />
      </div>
      <div className="diff-line-content" />
    </div>
  );
}

export function GitDiffBlock({
  diff,
  style = "split",
}: {
  diff: string;
  style?: GitDiffStyle;
}) {
  const parsed = useMemo(() => parseDiff(diff), [diff]);
  const splitRows = useMemo(() => buildSplitRows(parsed), [parsed]);

  if (!parsed.length) {
    return <pre className="git-history-diff-modal-code">{diff || "No diff available."}</pre>;
  }

  if (style === "split") {
    return (
      <div className="diff-viewer-output diff-viewer-output-flat">
        <div className="diffs-container" data-diff-style="split">
          <div className="diff-block-split">
            <div className="diff-split-pane diff-split-pane-old">
              <div className="diff-split-pane-content">
                {splitRows.map((row) =>
                  row.kind === "header"
                    ? renderLine(row.line, "unified", `left-header-${row.key}`)
                    : row.left
                      ? renderLine(row.left, "old", `left-${row.key}`)
                      : renderEmptyLine(`left-empty-${row.key}`)
                )}
              </div>
            </div>
            <div className="diff-split-pane diff-split-pane-new">
              <div className="diff-split-pane-content">
                {splitRows.map((row) =>
                  row.kind === "header"
                    ? renderLine(row.line, "unified", `right-header-${row.key}`)
                    : row.right
                      ? renderLine(row.right, "new", `right-${row.key}`)
                      : renderEmptyLine(`right-empty-${row.key}`)
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="diff-viewer-output diff-viewer-output-flat">
      <div className="diffs-container" data-diff-style="unified">
        <div className="diff-block-unified">
          {parsed.map((line, index) => renderLine({ index, line }, "unified", `unified-${index}`))}
        </div>
      </div>
    </div>
  );
}
