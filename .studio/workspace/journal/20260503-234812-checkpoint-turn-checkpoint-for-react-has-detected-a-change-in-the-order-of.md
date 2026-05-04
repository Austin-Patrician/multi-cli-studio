# checkpoint - Turn checkpoint for `React has detected a change in the order of

Promoted: 2026-05-03T23:48:12.254389+08:00
Source: .studio/runtime/active-context/memory-candidates.jsonl

## Source

- Context: `.studio/runtime/active-context`
- Context ID: `active-context`
- Candidate type: `contextSnapshot`
- Promoted automatically after policy-check.

## Content

Turn checkpoint for `React has detected a change in the order of Hooks called by ChatPromptBar. This will lead to bugs and errors if not fixed. For more information, read the Rules of Hooks: https://re...`: 我先定位 `ChatPromptBar` 里最近引入的 hook 位置，重点看有没有被放进条件分支或早返回路径里。我看到 `ChatPromptBar` 中段有一个 `if (!activeTab || !workspace) return null;`。现在继续确认我们新加的 `useMemo` 是否落在这个早返回之后了。问题点已经找到了：`ChatPromptBar` 在 `if (!activeTab || !workspace) return null;` 之后新增了一个 `useMemo`...

## Evidence

```json
{
  "_studioManaged": true,
  "candidateType": "contextSnapshot",
  "confidence": "high",
  "content": "Turn checkpoint for `React has detected a change in the order of Hooks called by ChatPromptBar. This will lead to bugs and errors if not fixed. For more information, read the Rules of Hooks: https://re...`: 我先定位 `ChatPromptBar` 里最近引入的 hook 位置，重点看有没有被放进条件分支或早返回路径里。我看到 `ChatPromptBar` 中段有一个 `if (!activeTab || !workspace) return null;`。现在继续确认我们新加的 `useMemo` 是否落在这个早返回之后了。问题点已经找到了：`ChatPromptBar` 在 `if (!activeTab || !workspace) return null;` 之后新增了一个 `useMemo`...",
  "id": "snapshot-1245a555-cb0e-4e65-8698-8b8d6c9e3550",
  "kind": "checkpoint",
  "promotionHint": "journal",
  "sourceEvidenceIds": [],
  "sourceFactId": "snapshot-1245a555-cb0e-4e65-8698-8b8d6c9e3550",
  "updatedAt": "2026-05-03T23:47:35.930641+08:00"
}
```
