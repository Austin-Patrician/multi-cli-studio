import { memo, useEffect, useMemo, useState } from "react";
import { ArrowLeft, Check, Play, Search, ShieldCheck, X } from "lucide-react";
import type { GitBranchListItem, GitHistoryCommit } from "../../lib/models";

export type ReviewPromptStep = "preset" | "baseBranch" | "commit" | "custom";
export type ReviewPresetChoice = Exclude<ReviewPromptStep, "preset"> | "uncommitted";

export interface ReviewInlinePromptState {
  workspaceName: string;
  step: ReviewPromptStep;
  branches: GitBranchListItem[];
  commits: GitHistoryCommit[];
  isLoadingBranches: boolean;
  isLoadingCommits: boolean;
  selectedBranch: string;
  selectedCommitSha: string;
  selectedCommitTitle: string;
  customInstructions: string;
  error: string | null;
  isSubmitting: boolean;
}

type ReviewInlinePromptProps = {
  reviewPrompt: ReviewInlinePromptState;
  onClose: () => void;
  onShowPreset: () => void;
  onChoosePreset: (preset: ReviewPresetChoice) => void;
  highlightedPresetIndex: number;
  onHighlightPreset: (index: number) => void;
  highlightedBranchIndex: number;
  onHighlightBranch: (index: number) => void;
  highlightedCommitIndex: number;
  onHighlightCommit: (index: number) => void;
  onSelectBranch: (value: string) => void;
  onConfirmBranch: () => Promise<void>;
  onSelectCommit: (sha: string, title: string) => void;
  onConfirmCommit: () => Promise<void>;
  onUpdateCustomInstructions: (value: string) => void;
  onConfirmCustom: () => Promise<void>;
  onKeyDown?: (event: {
    key: string;
    shiftKey?: boolean;
    preventDefault: () => void;
  }) => boolean;
};

function shortSha(sha: string) {
  return sha.slice(0, 7);
}

const StepToolbar = memo(function StepToolbar({
  onBack,
  onConfirm,
  isSubmitting,
  confirmDisabled,
}: {
  onBack: () => void;
  onConfirm: () => Promise<void>;
  isSubmitting: boolean;
  confirmDisabled: boolean;
}) {
  return (
    <div className="review-inline-toolbar">
      <button
        type="button"
        className="review-inline-action-link review-inline-action-back"
        onClick={onBack}
        disabled={isSubmitting}
      >
        <ArrowLeft size={13} aria-hidden />
        <span>Back</span>
      </button>
      <button
        type="button"
        className="review-inline-action-link review-inline-action-start"
        onClick={() => void onConfirm()}
        disabled={isSubmitting || confirmDisabled}
      >
        <Play size={13} aria-hidden />
        <span>Start Review</span>
      </button>
    </div>
  );
});

const PresetStep = memo(function PresetStep({
  onChoosePreset,
  isSubmitting,
  highlightedPresetIndex,
  onHighlightPreset,
}: {
  onChoosePreset: (preset: ReviewPresetChoice) => void;
  isSubmitting: boolean;
  highlightedPresetIndex: number;
  onHighlightPreset: (index: number) => void;
}) {
  const optionClass = (index: number) =>
    `review-inline-option${index === highlightedPresetIndex ? " is-selected" : ""}`;

  return (
    <div className="review-inline-section">
      <button
        type="button"
        className={optionClass(0)}
        onClick={() => onChoosePreset("baseBranch")}
        onMouseEnter={() => onHighlightPreset(0)}
        disabled={isSubmitting}
      >
        <span className="review-inline-option-inline">
          <span className="review-inline-option-title">Review Against Base Branch</span>
          <span className="review-inline-option-subtitle">PR-style</span>
        </span>
      </button>
      <button
        type="button"
        className={optionClass(1)}
        onClick={() => onChoosePreset("uncommitted")}
        onMouseEnter={() => onHighlightPreset(1)}
        disabled={isSubmitting}
      >
        <span className="review-inline-option-title">Review Uncommitted Changes</span>
      </button>
      <button
        type="button"
        className={optionClass(2)}
        onClick={() => onChoosePreset("commit")}
        onMouseEnter={() => onHighlightPreset(2)}
        disabled={isSubmitting}
      >
        <span className="review-inline-option-title">Review a Commit</span>
      </button>
      <button
        type="button"
        className={optionClass(3)}
        onClick={() => onChoosePreset("custom")}
        onMouseEnter={() => onHighlightPreset(3)}
        disabled={isSubmitting}
      >
        <span className="review-inline-option-title">Custom Review Instructions</span>
      </button>
    </div>
  );
});

const BaseBranchStep = memo(function BaseBranchStep({
  reviewPrompt,
  onSelectBranch,
  highlightedBranchIndex,
  onHighlightBranch,
}: {
  reviewPrompt: ReviewInlinePromptState;
  onSelectBranch: (value: string) => void;
  highlightedBranchIndex: number;
  onHighlightBranch: (index: number) => void;
}) {
  const branches = reviewPrompt.branches;
  const [branchQuery, setBranchQuery] = useState("");
  const normalizedBranchQuery = branchQuery.trim().toLowerCase();
  const filteredBranches = useMemo(() => {
    if (!normalizedBranchQuery) {
      return branches;
    }
    return branches.filter((branch) => branch.name.toLowerCase().includes(normalizedBranchQuery));
  }, [branches, normalizedBranchQuery]);
  const selectedBranchIndex = useMemo(
    () => branches.findIndex((branch) => branch.name === reviewPrompt.selectedBranch),
    [branches, reviewPrompt.selectedBranch]
  );

  return (
    <div className="review-inline-section">
      <div className="review-inline-hint">Pick a recent local branch.</div>
      <div className="review-inline-search">
        <Search size={13} aria-hidden />
        <input
          className="review-inline-input"
          type="text"
          value={branchQuery}
          onChange={(event) => setBranchQuery(event.target.value)}
          placeholder="Type to search branches"
          autoFocus
        />
      </div>
      <div
        className="review-inline-list"
        role="listbox"
        aria-label="Base branches"
        onMouseLeave={() => onHighlightBranch(selectedBranchIndex >= 0 ? selectedBranchIndex : -1)}
      >
        {reviewPrompt.isLoadingBranches ? (
          <div className="review-inline-empty">Loading branches…</div>
        ) : filteredBranches.length === 0 ? (
          <div className="review-inline-empty">No branches found.</div>
        ) : (
          filteredBranches.map((branch) => {
            const sourceIndex = branches.findIndex((entry) => entry.name === branch.name);
            const selected = branch.name === reviewPrompt.selectedBranch;
            const active = sourceIndex === highlightedBranchIndex;
            return (
              <button
                key={branch.name}
                type="button"
                role="option"
                aria-selected={selected}
                className={`review-inline-list-item${selected ? " is-selected" : ""}${
                  !selected && active ? " is-active" : ""
                }`}
                onClick={() => onSelectBranch(branch.name)}
                onMouseEnter={() => {
                  if (sourceIndex >= 0) onHighlightBranch(sourceIndex);
                }}
                disabled={reviewPrompt.isSubmitting}
              >
                <span className="review-inline-list-item-content">{branch.name}</span>
                {selected ? <Check size={13} className="review-inline-selected-icon" aria-hidden /> : null}
              </button>
            );
          })
        )}
      </div>
    </div>
  );
});

const CommitStep = memo(function CommitStep({
  reviewPrompt,
  onSelectCommit,
  highlightedCommitIndex,
  onHighlightCommit,
}: {
  reviewPrompt: ReviewInlinePromptState;
  onSelectCommit: (sha: string, title: string) => void;
  highlightedCommitIndex: number;
  onHighlightCommit: (index: number) => void;
}) {
  const commits = reviewPrompt.commits;
  const [commitQuery, setCommitQuery] = useState("");
  const normalizedCommitQuery = commitQuery.trim().toLowerCase();
  const filteredCommits = useMemo(() => {
    if (!normalizedCommitQuery) {
      return commits;
    }
    return commits.filter((commit) => {
      const title = commit.summary || commit.sha;
      return (
        title.toLowerCase().includes(normalizedCommitQuery) ||
        commit.sha.toLowerCase().includes(normalizedCommitQuery) ||
        commit.author.toLowerCase().includes(normalizedCommitQuery)
      );
    });
  }, [commits, normalizedCommitQuery]);
  const selectedCommitIndex = useMemo(
    () => commits.findIndex((commit) => commit.sha === reviewPrompt.selectedCommitSha),
    [commits, reviewPrompt.selectedCommitSha]
  );

  return (
    <div className="review-inline-section">
      <div className="review-inline-hint">Select a recent commit.</div>
      <div className="review-inline-search">
        <Search size={13} aria-hidden />
        <input
          className="review-inline-input"
          type="text"
          value={commitQuery}
          onChange={(event) => setCommitQuery(event.target.value)}
          placeholder="Type to search commits"
          autoFocus
        />
      </div>
      <div
        className="review-inline-list"
        role="listbox"
        aria-label="Commits"
        onMouseLeave={() => onHighlightCommit(selectedCommitIndex >= 0 ? selectedCommitIndex : -1)}
      >
        {reviewPrompt.isLoadingCommits ? (
          <div className="review-inline-empty">Loading commits…</div>
        ) : filteredCommits.length === 0 ? (
          <div className="review-inline-empty">No commits found.</div>
        ) : (
          filteredCommits.map((commit) => {
            const title = commit.summary || commit.sha;
            const sourceIndex = commits.findIndex((entry) => entry.sha === commit.sha);
            const selected = commit.sha === reviewPrompt.selectedCommitSha;
            const active = sourceIndex === highlightedCommitIndex;
            return (
              <button
                key={commit.sha}
                type="button"
                role="option"
                aria-selected={selected}
                className={`review-inline-list-item review-inline-commit${selected ? " is-selected" : ""}${
                  !selected && active ? " is-active" : ""
                }`}
                onClick={() => onSelectCommit(commit.sha, title)}
                onMouseEnter={() => {
                  if (sourceIndex >= 0) onHighlightCommit(sourceIndex);
                }}
                disabled={reviewPrompt.isSubmitting}
              >
                <span className="review-inline-commit-title-row">
                  <span className="review-inline-commit-title">{title}</span>
                  {selected ? <Check size={13} className="review-inline-selected-icon" aria-hidden /> : null}
                </span>
                <span className="review-inline-commit-meta">{shortSha(commit.sha)}</span>
              </button>
            );
          })
        )}
      </div>
    </div>
  );
});

const CustomStep = memo(function CustomStep({
  reviewPrompt,
  onUpdateCustomInstructions,
}: {
  reviewPrompt: ReviewInlinePromptState;
  onUpdateCustomInstructions: (value: string) => void;
}) {
  return (
    <div className="review-inline-section">
      <label className="review-inline-label" htmlFor="review-inline-custom-instructions">
        Instructions
      </label>
      <textarea
        id="review-inline-custom-instructions"
        className="review-inline-textarea"
        value={reviewPrompt.customInstructions}
        onChange={(event) => onUpdateCustomInstructions(event.target.value)}
        placeholder="Explain what you want the review to focus on."
        autoFocus
        rows={6}
      />
    </div>
  );
});

export const ReviewInlinePrompt = memo(function ReviewInlinePrompt({
  reviewPrompt,
  onClose,
  onShowPreset,
  onChoosePreset,
  highlightedPresetIndex,
  onHighlightPreset,
  highlightedBranchIndex,
  onHighlightBranch,
  highlightedCommitIndex,
  onHighlightCommit,
  onSelectBranch,
  onConfirmBranch,
  onSelectCommit,
  onConfirmCommit,
  onUpdateCustomInstructions,
  onConfirmCustom,
  onKeyDown,
}: ReviewInlinePromptProps) {
  const { step, error, isSubmitting } = reviewPrompt;

  useEffect(() => {
    if (!onKeyDown) {
      return;
    }
    const handleWindowKeyDown = (event: KeyboardEvent) => {
      const handled = onKeyDown({
        key: event.key,
        shiftKey: event.shiftKey,
        preventDefault: () => event.preventDefault(),
      });
      if (handled) {
        event.stopPropagation();
      }
    };
    window.addEventListener("keydown", handleWindowKeyDown, true);
    return () => {
      window.removeEventListener("keydown", handleWindowKeyDown, true);
    };
  }, [onKeyDown]);

  const title = useMemo(() => {
    switch (step) {
      case "baseBranch":
        return "Select Base Branch";
      case "commit":
        return "Select Commit to Review";
      case "custom":
        return "Custom Review Instructions";
      case "preset":
      default:
        return "Select Review Preset";
    }
  }, [step]);

  const toolbarConfirmDisabled = useMemo(() => {
    if (step === "baseBranch") {
      return !reviewPrompt.selectedBranch.trim();
    }
    if (step === "commit") {
      return !reviewPrompt.selectedCommitSha;
    }
    if (step === "custom") {
      return reviewPrompt.customInstructions.trim().length === 0;
    }
    return true;
  }, [
    reviewPrompt.customInstructions,
    reviewPrompt.selectedBranch,
    reviewPrompt.selectedCommitSha,
    step,
  ]);

  const handleToolbarConfirm = useMemo<(() => Promise<void>) | null>(() => {
    if (step === "baseBranch") {
      return onConfirmBranch;
    }
    if (step === "commit") {
      return onConfirmCommit;
    }
    if (step === "custom") {
      return onConfirmCustom;
    }
    return null;
  }, [onConfirmBranch, onConfirmCommit, onConfirmCustom, step]);

  return (
    <div className="review-inline" role="dialog" aria-label={title}>
      <div className="review-inline-header">
        <div className="review-inline-header-main">
          <div>
            <div className="review-inline-title">
              <ShieldCheck size={15} className="review-inline-title-icon" aria-hidden />
              <span>{title}</span>
            </div>
            <div className="review-inline-subtitle">{reviewPrompt.workspaceName}</div>
          </div>
          <div className="review-inline-header-actions">
            {step !== "preset" && handleToolbarConfirm ? (
              <StepToolbar
                onBack={onShowPreset}
                onConfirm={handleToolbarConfirm}
                isSubmitting={isSubmitting}
                confirmDisabled={toolbarConfirmDisabled}
              />
            ) : null}
            <button
              type="button"
              className="review-inline-action-link review-inline-action-close"
              onClick={onClose}
            >
              <X size={13} aria-hidden />
              <span>Close</span>
            </button>
          </div>
        </div>
      </div>

      {step === "preset" ? (
        <PresetStep
          onChoosePreset={onChoosePreset}
          isSubmitting={isSubmitting}
          highlightedPresetIndex={highlightedPresetIndex}
          onHighlightPreset={onHighlightPreset}
        />
      ) : step === "baseBranch" ? (
        <BaseBranchStep
          reviewPrompt={reviewPrompt}
          onSelectBranch={onSelectBranch}
          highlightedBranchIndex={highlightedBranchIndex}
          onHighlightBranch={onHighlightBranch}
        />
      ) : step === "commit" ? (
        <CommitStep
          reviewPrompt={reviewPrompt}
          onSelectCommit={onSelectCommit}
          highlightedCommitIndex={highlightedCommitIndex}
          onHighlightCommit={onHighlightCommit}
        />
      ) : (
        <CustomStep
          reviewPrompt={reviewPrompt}
          onUpdateCustomInstructions={onUpdateCustomInstructions}
        />
      )}

      {error ? <div className="review-inline-error">{error}</div> : null}
    </div>
  );
});
