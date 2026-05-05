# checkpoint - Turn checkpoint for `@src/components/chat/ChatConversation.tsx

Promoted: 2026-05-05T16:14:11.125371+08:00
Source: .studio/runtime/active-context/memory-candidates.jsonl

## Source

- Context: `.studio/runtime/active-context`
- Context ID: `active-context`
- Candidate type: `contextSnapshot`
- Promoted automatically after policy-check.

## Content

Turn checkpoint for `@src/components/chat/ChatConversation.tsx  的下半部分展示聊天历史区域在我们显示file preview的时候，没有上下滚动轴查看`: 我用 `frontend-design` 的约束来收这个分栏滚动问题，因为这是聊天区布局行为，不是单点样式。先看 `ChatConversation` 在 file preview 模式下的 split 容器高度和 overflow 关系，再直接修。我直接收这个 flex/overflow 关系，不绕。下半区要能滚，关键是 split 模式下包裹聊天区的两层都要明确 `overflow-hidden + min-h-0 + h-full`，否则滚动...

## Evidence

```json
{
  "_studioManaged": true,
  "candidateType": "contextSnapshot",
  "confidence": "high",
  "content": "Turn checkpoint for `@src/components/chat/ChatConversation.tsx  的下半部分展示聊天历史区域在我们显示file preview的时候，没有上下滚动轴查看`: 我用 `frontend-design` 的约束来收这个分栏滚动问题，因为这是聊天区布局行为，不是单点样式。先看 `ChatConversation` 在 file preview 模式下的 split 容器高度和 overflow 关系，再直接修。我直接收这个 flex/overflow 关系，不绕。下半区要能滚，关键是 split 模式下包裹聊天区的两层都要明确 `overflow-hidden + min-h-0 + h-full`，否则滚动...",
  "id": "snapshot-ac17d2d2-b471-4d37-9d0f-0ad7d2724fbd",
  "kind": "checkpoint",
  "promotionHint": "journal",
  "sourceEvidenceIds": [],
  "sourceFactId": "snapshot-ac17d2d2-b471-4d37-9d0f-0ad7d2724fbd",
  "updatedAt": "2026-05-05T16:13:37.228645+08:00"
}
```
