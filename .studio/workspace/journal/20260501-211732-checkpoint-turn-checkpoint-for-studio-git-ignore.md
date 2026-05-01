# checkpoint - Turn checkpoint for `我想知道我们项目的 @.studio/ 文件会被git ignore 么？ 正确的用户

Promoted: 2026-05-01T21:17:32.920206+08:00
Source: .studio/runtime/active-context/memory-candidates.jsonl

## Source

- Context: `.studio/runtime/active-context`
- Context ID: `active-context`
- Candidate type: `contextSnapshot`
- Promoted automatically after policy-check.

## Content

Turn checkpoint for `我想知道我们项目的 @.studio/ 文件会被git ignore 么？ 正确的用户操作是怎么样子，带入git 管理么？包括自动生成的hooks`: 我先检查仓库的 `.gitignore` 和当前追踪状态，再给你一套明确的 Git 使用建议。我再对照一下你们自己的 CLI 适配 spec，确保建议和项目约定一致。**当前状态** - 你这个仓库里，只有 `.studio/runtime` 被忽略：[`/Users/aa123456/code/rust/multi-cli-studio/.gitignore:13`](/Users/aa123456/code/rust/multi-cli-studio/.gitignore#L13)。 - `.studio/spec`、`.studio/w...

## Evidence

```json
{
  "_studioManaged": true,
  "candidateType": "contextSnapshot",
  "confidence": "high",
  "content": "Turn checkpoint for `我想知道我们项目的 @.studio/ 文件会被git ignore 么？ 正确的用户操作是怎么样子，带入git 管理么？包括自动生成的hooks`: 我先检查仓库的 `.gitignore` 和当前追踪状态，再给你一套明确的 Git 使用建议。我再对照一下你们自己的 CLI 适配 spec，确保建议和项目约定一致。**当前状态** - 你这个仓库里，只有 `.studio/runtime` 被忽略：[`/Users/aa123456/code/rust/multi-cli-studio/.gitignore:13`](/Users/aa123456/code/rust/multi-cli-studio/.gitignore#L13)。 - `.studio/spec`、`.studio/w...",
  "id": "snapshot-68d43563-df7e-49ed-b973-90ff5165a38f",
  "kind": "checkpoint",
  "promotionHint": "journal",
  "sourceEvidenceIds": [],
  "sourceFactId": "snapshot-68d43563-df7e-49ed-b973-90ff5165a38f",
  "updatedAt": "2026-05-01T21:16:52.667718+08:00"
}
```
