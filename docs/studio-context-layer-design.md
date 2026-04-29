# Studio Context Layer 设计方案

## 背景

Multi CLI Studio 旧的跨 CLI 协作依赖运行期 `handoff prompt`、compact summary、cross-tab context 和 SQLite FTS recall。它能把上下文传过去，但本质是“大包注入”：内容越来越长、生成逻辑分散、不同 CLI 看到的是一次性 prompt，而不是同一个可维护的项目知识源。

Trellis 更值得借鉴的是知识层设计：把项目知识拆成长期规范、当前任务、工作历史和 session 入口，让不同 AI CLI 通过平台适配器读取同一套文件。Studio 的新方案采用这个方向，彻底替换旧 handoff 注入链路。

## 目标

- Codex、Claude、Gemini 跨 CLI 时读取同一套项目上下文文件。
- 长期规则、当前任务、会话历史分层保存，避免混在聊天历史里。
- 默认只注入小型 Studio prelude，告诉 CLI 应该读哪些文件。
- SQLite 保留为运行期索引、UI 状态和兜底搜索，不再作为长期记忆主链路。
- 旧 handoff 只保留为“切换事件记录”，不再生成或注入大上下文包。

## 文件结构

```text
.studio/
  spec/                 # durable, user/team curated
    index.md
  workspace/            # durable, user/team curated journals
    index.md
  runtime/              # generated, ignored by git
    context.md
    tasks/
      <task-id>/
        task.md
        implement.jsonl
        check.jsonl
    sessions/
      <context-key>.json
```

## 分层职责

- `.studio/spec/`：长期工程规范、跨任务都应遵守的规则；只在用户要求保存知识时创建/修改。
- `.studio/workspace/`：跨 session 的 durable journal；只在用户要求沉淀历史时创建/修改。
- `.studio/runtime/context.md`：每个 turn 刷新的轻量入口，不提交。
- `.studio/runtime/tasks/<task-id>/`：当前任务运行期快照，不提交，可覆盖。
- `.studio/runtime/tasks/<task-id>/implement.jsonl`：实现前可读取的 spec/research 清单。
- `.studio/runtime/tasks/<task-id>/check.jsonl`：检查时可读取的 spec/research 清单。
- `.studio/runtime/sessions/`：CLI session/window 到 active task 的绑定。

## 新注入链路

1. 用户发送消息或切换 CLI。
2. 后端刷新 `.studio/runtime/context.md`、active task、manifest、session binding。
3. compact summary、cross-tab summary、working memory 写入 runtime context 文件。
4. Prompt 只注入 Studio prelude：runtime context、active task、manifest 路径和读取规则。
5. CLI 根据需要读取 `.studio` 文件，不再接收旧 handoff 大包。
6. SQLite 中的 handoff event 只作为切换记录和 UI 展示数据。

## 已替换的旧设计

- 前端不再构造 `HandoffDocument`。
- 前端不再调用 `semanticRecall` 来增强 handoff prompt。
- 前端不再传 `handoffContext` / `handoffDocument` 给后端。
- 后端不再序列化、解析或格式化旧 handoff payload。
- `send_chat_message` 有 Studio Context 时绕过旧 `build_context_assembly` 大包组装。
- `switch_cli_for_task` 继续记录切换事件，但 `handoff_payload_json` 固定为空。

## Token 策略

- Prompt 内只保留项目元数据、response rules、workspace dirty/check 状态、Studio prelude 和用户请求。
- compacted summaries、cross-tab context、working memory 只写 runtime 文件，不直塞 prompt。
- 如果 `.studio/runtime` 不可用，才回退旧上下文组装，保证兼容 remote 或不可写 workspace。

## 已实现的 P1.5 硬化

- `.studio/runtime` 写入使用临时文件 + rename，避免半写入文件。
- runtime context、active task、optional context section 都有字符上限，避免长对话无限膨胀。
- runtime task/session binding 会保留最近条目，自动清理旧快照。
- 每次 Studio Context 生效时在后端 console 输出观测指标：`prelude_chars`、`runtime_context_chars`、`task_chars`、`final_prompt_chars`、`adapter_files`。

## 已实现的 P2

- 自动生成托管 adapter：`AGENTS.md`、`CLAUDE.md`、`GEMINI.md`。
- adapter 只在文件不存在，或包含 `STUDIO-CONTEXT:MANAGED` 标记时覆盖，避免误改用户已有规则。
- 新增后端 promote 接口，把当前结论/片段提升为 `.studio/spec/`、`.studio/workspace/tasks/` 或 `.studio/workspace/journal/` 文件。
- promote 会维护目标目录的 `index.md`，便于后续 manifest 或 CLI 读取。

## 后续阶段

- 在 UI 上增加 `Promote to Spec / Task / Journal` 操作，调用已有 `promoteStudioMemory` bridge。
- 把 `kernel_memory_entries` 导出为候选 spec/task/journal 条目。
- 如需真正语义相似度，再引入 embedding/vector index，但不替代文件化事实源。
