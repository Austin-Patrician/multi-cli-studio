# Multi-CLI Share Context Phase Plan

## 目标

这份文档用于跟踪 `TerminalPage` 背后的 `Context Kernel` 演进路线，目标是把当前以 `session + recentTurns + compactedSummaries + handoff` 为主的上下文传递方式，升级为以 `task-centric kernel` 为主的跨 CLI 共享上下文系统。

最终目标不是“把更多 transcript 塞进 prompt”，而是建立一个对 `Codex / Claude / Gemini` 都成立的统一任务内核，让：

- 单 CLI 多轮对话依赖原生 `thread/session/resume`
- 跨 CLI 切换依赖 `Task Kernel`
- 长时任务依赖 `checkpoint + compaction + durable memory`
- 上下文传递依赖 `facts + evidence + plan + work items`

---

## 当前基线

### 已落地

- 已新增 `TaskKernel / KernelSessionRef / KernelFact / KernelEvidence / KernelPlan / KernelWorkItem`
- SQLite 已有 `kernel_session_refs / kernel_facts / kernel_evidence / kernel_plans / kernel_work_items`
- 每次 assistant 消息 `finalize` 后，会同步：
  - task checkpoint
  - kernel session ref
  - evidence
  - facts
  - active plan
  - work items
- `build_context_assembly` 已开始注入：
  - `kernel facts`
  - `kernel evidence ledger`
- `TerminalPage` 前台不再展示 kernel 数据；kernel 作为底层共享上下文内核存在

### 当前限制

- CLI 切换仍然主要依赖 `latestAssistantSummary / latestUserPrompt / relevantFiles`
- facts 没有人工校正和去重
- plan/work items 只是从消息块抽取，语义还不稳定
- 当前没有默认前台 kernel 操作入口

### 阶段进度判断

- Phase 1: 完成
- Phase 2: 完成
- Phase 3: 完成
- Phase 4: 完成
- Phase 5: 完成
- Phase 6: 完成
- Phase 7: 完成

---

## 总体原则

### 原则 1: 原生会话连续性与共享内核分层

- `Codex / Claude / Gemini` 各自的 `thread/session/resume` 继续保留
- `Context Kernel` 只负责跨 CLI、跨 tab、跨长时间共享
- 不尝试统一三家的底层 session 协议

### 原则 2: 共享真相不是摘要，而是结构化状态

- `summary` 只能作为视图层或 fallback
- 共享真相应由以下对象构成：
  - task
  - facts
  - evidence
  - plan
  - work items
  - checkpoints

### 原则 3: Prompt 是检索结果，不是存储本体

- transcript 和 prompt injection 不是 kernel 本体
- prompt 只是在每次调用前，从 kernel 中检索出的工作上下文切片

### 原则 4: 先稳定语义，再扩 UI

- 先把数据层和状态机稳定
- 再扩交互、审阅和人工修正能力

---

## Phase 2: Fact / Evidence Ledger 稳定化

### 目标

把当前自动抽取的 `KernelFact / KernelEvidence` 从“可用雏形”提升到“可依赖的共享真相层”。

### 当前问题

- facts 可能重复
- facts 缺少冲突检测
- facts 与 evidence 的映射是单轮即时抽取，缺少归并逻辑
- evidence 目前没有 drill-down 视图
- `verified / inferred / pending / invalidated` 虽然已有字段，但没有真正进入工作流

### 本阶段实施内容

#### 后端

- 为 `kernel_facts` 增加去重规则
  - 以 `task_id + normalized_statement + kind` 作为近似归并键
  - 新证据进入时优先更新已有 fact，而不是无限新增
- 为 `kernel_facts` 增加冲突策略
  - 相同 kind 下出现互斥 statement 时，旧 fact 标记为 `invalidated`
  - 新 fact 标记为 `pending` 或 `verified`
- evidence 抽取增强
  - `command`
  - `fileChange`
  - `toolCall`
  - `status`
  - `assistantMessage`
  保留 messageId / payloadRef，确保可追溯
- checkpoint 和 fact 对齐
  - snapshot summary 不再只是文本
  - 要明确引用最近的 fact/evidence 集合

#### 前端

- `KernelInspector` 增加 Facts 区域的状态 badge
- 增加 Evidence 列表的基础 drill-down 展示
  - 展示 evidence type
  - 展示来源 message id
  - 展示 payloadRef
- 暂不做写操作，只加强可读性和可追溯性

### 验收标准

- 同一任务连续多轮执行后，facts 不会明显爆炸式重复
- facts 能追溯到 evidence
- 当新结论覆盖旧结论时，至少会出现 `invalidated` 或状态更新
- kernel facts 可以作为 prompt 注入的主输入之一

### 风险

- 自动归并可能误把不同事实合并
- 自动 invalidation 规则过强时会误杀有效事实

### 出口条件

- facts 可以稳定作为跨 CLI handoff 的输入
- evidence 能支撑人工检查 facts 正确性

---

## Phase 3: Plan / Work Item 语义稳定化

### 目标

把当前从消息块里抽出来的 `activePlan / workItems` 从“展示层派生结果”升级成“真正的任务步骤状态层”。

### 当前问题

- work items 没有依赖关系
- 没有“当前执行步骤”的稳定语义
- 相同 step 在多轮消息中可能重复生成
- `autoRoute / orchestrationStep / plan` 只是被记录，没有统一归一化

### 本阶段实施内容

#### 后端

- 定义 work item 归并规则
  - 优先使用 `step_id`
  - 无 `step_id` 时使用 `task_id + owner_cli + normalized_title`
- 增加 work item 状态流转
  - `planned`
  - `running`
  - `completed`
  - `failed`
  - `blocked`
  - `skipped`
- active plan 归一化
  - 同一 task 只有一个 `active` plan
  - 新 plan 到来时，旧 plan 标为 `superseded`
- 引入“当前 work item”概念
  - 根据最新更新时间和状态推断
  - 或在 kernel 中显式存 `current_work_item_id`
- 在 auto orchestration 和 CLI 切换时，优先更新 work item，而不是只写 summary

#### 前端

- inspector 中新增当前 plan 状态展示
- work items 支持按状态分组
- 高亮当前 running/blocked item

### 验收标准

- 多轮 orchestration 后，work items 不会重复炸裂
- 当前任务做到哪一步可以从 kernel 中直接判断
- CLI 切换时不会丢失当前 plan/work item 位置

### 风险

- 不同 CLI 输出风格差异会导致 step 归并不稳定
- `plan` 文本类块和 `orchestrationStep` 结构块可能互相冲突

### 出口条件

- `activePlan + workItems` 可以作为跨 CLI handoff 的主输入

---

## Phase 4: Kernel-Driven Prompt / Handoff 重构

### 目标

把当前 `sendChatMessage / switchCliForTask / compose_tab_context_prompt` 从“recent turns + summary”为主，升级为“kernel retrieval”为主。

### 当前问题

- handoff 仍偏向 `latestAssistantSummary`
- `crossTabContext` 仍是摘要视图，不是共享内核
- prompt 预算控制仍偏“字符窗口 + turn window”

### 本阶段实施内容

#### 后端

- 新增 kernel retrieval builder
  输入：
  - task id
  - target cli
  - current work item
  - write/read mode
  输出：
  - facts slice
  - evidence slice
  - plan slice
  - checkpoint slice
  - fallback recent turns

- 重写 `compose_tab_context_prompt`
  新注入顺序：
  1. workspace
  2. task goal
  3. current plan
  4. current work items
  5. verified facts
  6. relevant evidence
  7. latest checkpoint
  8. fallback recent turns
  9. user request

- 重写 `switch_cli_for_task`
  不再以 `latestAssistantSummary` 为主
  改为生成 `kernel-aware handoff payload`

- 区分 CLI 注入策略
  - Claude: facts / reasoning / risks 优先
  - Codex: work items / files / commands 优先
  - Gemini: UI-relevant files / design steps / visual evidence 优先

#### 前端

- 保持发送链路不变
- handoff 仍从 store 触发，但后端主导上下文构造

### 验收标准

- 切 CLI 后，即使没有 recent turns，也能靠 kernel 继续任务
- 同一任务在多个 CLI 间切换时，上下文连续性明显优于当前实现
- prompt 注入内容显著更结构化，summary 依赖下降

### 风险

- 一开始 kernel 检索策略可能不如“塞更多 summary”稳定
- 针对不同 CLI 的注入策略需要调试

### 出口条件

- `recentTurns` 退为 fallback
- `TaskKernel` 成为 prompt builder 主输入

---

## Phase 5: Durable Memory

### 目标

在 task kernel 之外，引入跨 session 的长期记忆，让上下文不再只依赖当前 task 和当前 tab。

### 记忆层次

- `task memory`
  当前任务长期有效的信息
- `workspace memory`
  当前仓库/项目的稳定约定
- `global memory`
  用户偏好、通用策略、常见错误模式

### 本阶段实施内容

#### 后端

- 新增 `kernel_memory_entries`
- 支持 scope:
  - `task`
  - `workspace`
  - `global`
- 从以下来源提取 durable memory
  - 高置信 verified facts
  - 多次重复出现的修复模式
  - 用户明确确认的偏好
  - 稳定仓库约定

- retrieval 规则
  - task memory 优先
  - workspace memory 次之
  - global memory 最后
  - 不自动注入全部，按 CLI 和当前 work item 过滤

#### 前端

- memory 默认不直接暴露在 Terminal 前台
- 如需调试或内部运维，可通过内部面板或开发接口读取

### 验收标准

- 重启应用后，除了 transcript，还能恢复稳定任务知识
- 相似任务再次执行时，能自动带出有效 memory
- 不会因为 memory 注入过量而污染 prompt

### 风险

- memory 容易积累垃圾
- 需要人工治理机制

### 出口条件

- memory 成为 long-horizon continuity 的主要支撑之一

---

## Phase 6: Inspector / Human-in-the-Loop UI

### 目标

把当前只读 inspector 升级成真正的上下文调试与修正面板。

### 当前问题

- 只能看，不能改
- 不能手动打 checkpoint
- 不能修正 fact 状态
- 不能从 evidence 反查消息和文件

### 本阶段实施内容

#### 前端

- 默认不在 Terminal 前台暴露 kernel inspector
- 若后续需要诊断模式，可通过独立调试入口接入：
  - Task
  - Facts
  - Evidence
  - Plan
  - Work Items
  - Memory
  - Checkpoints
  - Session refs

#### 后端

- 增加写接口
  - `mark_kernel_fact_status`
  - `pin_kernel_memory`
  - `create_manual_checkpoint`
  - `dismiss_kernel_work_item`

### 验收标准

- 用户可以人工修正 kernel 状态
- kernel 成为可审计、可纠偏系统
- 当模型抽取错误时，用户可以低成本修复

### 风险

- UI 过重影响终端主对话体验
- 需要控制默认展开程度

### 出口条件

- inspector 成为跨 CLI 调试和纠错的标准入口

---

## Phase 7: 回收旧链路

### 目标

在 kernel 成熟后，逐步把旧的 summary-centered 链路退役。

### 待替换对象

- `latestAssistantSummary` 为主的 handoff
- `crossTabContext` 为主的共享上下文
- 只看 `recentTurns` 的 prompt fallback 主路径

### 实施内容

- 保留兼容字段，但不再作为主输入
- 日志与调试页明确区分：
  - transcript
  - kernel
  - memory
  - prompt assembly result

### 验收标准

- kernel 是默认主路径
- 旧链路只作为兼容 fallback

---

## 跟踪清单

### Phase 2
- [x] facts 去重
- [x] facts 冲突检测
- [x] evidence drill-down
- [x] snapshot 引用 fact/evidence

### Phase 3
- [x] work item 归并
- [x] active plan 生命周期
- [x] current work item 语义
- [x] inspector 分组展示 work items

### Phase 4
- [x] kernel retrieval builder
- [x] handoff 改为 kernel-aware
- [x] Claude/Codex/Gemini 差异化注入策略
- [x] `recentTurns` 降级为 fallback

### Phase 5
- [x] memory 表与类型
- [x] task/workspace/global scope
- [x] memory 提取规则
- [x] memory 注入策略

### Phase 6
- [x] fact 状态编辑
- [x] manual checkpoint
- [x] pin to memory
- [x] evidence drill-down 跳转

### Phase 7
- [x] 旧 handoff 降级
- [x] 旧 crossTabContext 降级
- [x] prompt assembly 调试视图

---

## 推荐执行顺序

1. 先做 Phase 2 完整化  
原因：没有稳定 facts/evidence，后面的 handoff 和 retrieval 都不可靠。

2. 再做 Phase 3  
原因：跨 CLI 继续工作，核心是 plan/work item 不丢。

3. 然后做 Phase 4  
原因：这一步会真正改变系统行为。

4. 再做 Phase 6  
原因：行为切换后，需要 UI 让人类可以检查和纠偏。

5. 最后做 Phase 5 和 Phase 7  
原因：durable memory 和旧链路退役都依赖前面体系已经稳定。

---

## 每阶段完成定义

### Done 的统一标准

每个 phase 都必须满足：

- 数据结构已落库或落状态
- 至少一个 UI 或 API 能读到结果
- `cargo check` 通过
- `npm run build` 通过
- 不破坏现有单 CLI 对话链路

### 最终完成定义

当满足以下条件时，认为 `Share Context Kernel` 主目标达成：

- 同一个任务在多个 CLI 之间切换，不依赖 transcript 也能继续推进
- 用户可以从 inspector 直接看到任务状态、事实、证据、计划和 work items
- 长时间任务可以通过 checkpoint + memory 延续
- 旧的 summary-centered handoff 已退为 fallback
