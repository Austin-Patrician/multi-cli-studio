# Context Selection Report

Generated: 2026-04-30T09:41:42.196966300+08:00
Task: tab-tab-1776396168545-171
Curator: Studio automatic context-curator
Strategy: Trellis-class agent-curated projection with heuristic fallback.

## Request

## Loading Policy

Start with this file, .studio/workflow.md, and the active runtime task. Load detailed spec/research files from the JSONL manifests only when needed. Avoid injecting unrelated historical chat into the current turn.

无法设置属性。此语言模式仅支持核心类型的属性设置。
所在位置 行:1 字符: 1
+ [Console]::OutputEncoding=[System.Text.Encoding]::UTF8;
+ ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
    + CategoryInfo          : InvalidOperation: (:) []，RuntimeException
    + FullyQualifiedErrorId : PropertySetterNotSupportedInConstrainedLanguage

## Implement Manifest

- `.studio/spec/index.md` (score 62): Matched current task, files, or request terms (score 62).

## Check Manifest

- `.studio/spec/index.md` (score 62): Matched current task, files, or request terms (score 62).

## Policy Gates

- Context curation is automatic; no human approval is required.
- Source files to edit are not pre-registered in manifests.
- Long-term spec/workspace writes require provenance, confidence, and policy-check output.
- If no curated spec/research exists, fallback entries point to `.studio/spec/index.md` when available.
