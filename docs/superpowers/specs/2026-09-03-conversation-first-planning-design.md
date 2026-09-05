# Conversation-First 旅行 Agent 设计规格

状态：已批准，实施计划已完成
版本：1.0
日期：2026-09-03
范围：重构旅行规划入口、全轮真实 Agent 对话、无 Trip 地图搜索、候选地点与行程提案；不包含下单和支付

## 1. 背景与目标

当前 Web 页面仍以“先填写精确行程表单，再创建 Trip，最后进入工作台”为主路径。首屏聊天只暂存一句用户输入，并返回固定的“已记下你的想法”，没有形成完整的多轮 Agent 对话。地图搜索也依赖已经存在的 Trip，导致用户不能在规划前自由探索地点。

本次改造将产品入口调整为真正的 Conversation-first 旅行 Agent：

- 首屏只保留 Agent 聊天与始终可用的地图搜索，不再显示“精确编辑行程范围”表单。
- 每一条用户聊天消息都调用真实 `ThirdPartyResponsesProvider` Agent 链路。
- Conversation 可以先于 Trip 存在；模型通过多轮对话提取旅行条件。
- Trip 尚未创建时，用户仍可搜索地点、查看地图并保存候选地点。
- Agent 先生成可审查的临时行程提案；用户接受后才创建正式 PlanVersion，并保存提案中的候选地点。
- 对话过程中展示可验证的推理摘要、阶段状态和工具执行轨迹，但不暴露原始隐藏思维链。

本规格补充并覆盖 `2026-09-02-planning-workspace-design.md` 中表单优先、Trip 前置和首屏固定回复相关设计。原规格中的真实模型、安全、隐私、预算、时间、地图坐标和禁止下单支付等约束继续有效。

## 2. 产品边界

### 2.1 本阶段包含

- 匿名 Conversation-first 会话。
- 所有用户聊天消息调用真实 Responses 模型。
- 多轮旅行条件提取、缺失信息追问和上下文更新。
- Conversation 创建前或 Trip 创建前可使用的高德地点搜索。
- Conversation 级候选地点列表。
- Agent 行程提案、地点单独接受、整份提案接受或拒绝。
- 接受提案后生成正式 PlanVersion、预算和时间线。
- 推理摘要、工具状态和最终回复的 SSE 更新与恢复。
- 显式开发内存模式，允许本地在无 PostgreSQL 时体验非下单规划流程。

### 2.2 本阶段不包含

- BookingIntent、SupplierOrder、支付、退款或供应商跳转。
- 姓名、证件、银行卡或旅客敏感资料。
- 模型直接访问数据库、任意 URL、密钥或未注册工具。
- 原始隐藏思维链、系统提示词或内部安全策略展示。
- 规则模型、Sandbox Agent 或固定模板作为用户聊天回复的回退路径。

## 3. 核心领域模型

### 3.1 PlanningSession 与 Conversation

匿名服务端会话是所有规划数据的所有权边界。浏览器使用 HttpOnly、SameSite Cookie，不生成或信任 `x-actor-id`。

`AgentConversation` 可以在没有 Trip 的情况下创建，并包含：

```text
id
anonymous_session_id
current_trip_id nullable
status
created_at
updated_at
expires_at
```

一个 Conversation 首版只维护一个当前 Trip。后续若支持同一对话规划多段独立旅行，应通过显式切换或新建 Conversation 实现，不在本阶段增加多 Trip 上下文推断。

### 3.2 PlanningContext

模型从每轮对话提取结构化补丁，领域服务负责合并、校验和版本控制：

```text
conversation_id
destination nullable
origin nullable
starts_at nullable
ends_at nullable
traveler_count nullable
total_budget_cents nullable
preferences[]
assumptions[]
missing_fields[]
version
updated_at
```

模型不能直接覆盖 PlanningContext。所有补丁必须经过日期、人数、货币、预算和会话所有权校验。

目的地和有效日期范围明确后可以自动创建 Trip。若人数仍未知，Agent 应优先追问；确需先给出粗略建议时，必须在回复和 `assumptions` 中明确“暂按 1 人估算”，不得静默假设。

### 3.3 CandidatePlace

候选地点属于 Conversation，不依赖 Trip：

```text
id
conversation_id
place_id
source: user_search | accepted_agent_proposal
note nullable
priority nullable
created_at
```

Trip 创建前后都使用同一候选列表，不迁移、不复制。Agent 仅提出地点建议；未被用户接受的建议保存在 PlanProposal 中，不写入 CandidatePlace。

### 3.4 PlanProposal 与 PlanVersion

`PlanProposal` 是可丢弃、可接受的临时草案：

```text
id
conversation_id
trip_id
planning_context_version
proposed_places[]
itinerary
budget_summary
warnings[]
reasoning_summary nullable
status: pending | accepted | rejected | expired
created_at
expires_at
```

Agent 可以生成或更新 PlanProposal，但不能接受自己的提案。用户点击“接受行程”后，由确定性应用服务完成以下原子操作：

1. 再次校验 Conversation、Trip、PlanningContext 和 Proposal 版本。
2. 将提案中的地点写入 CandidatePlace，来源标记为 `accepted_agent_proposal`。
3. 创建新的正式 PlanVersion。
4. 重新计算预算、时间冲突和软提醒。
5. 发布脱敏的候选、计划和预算事件。

用户在聊天中明确提出修改要求时，Agent 生成新的调整 Proposal；用户接受后再产生新 PlanVersion。撤销作用于已经接受的 PlanVersion，不改变被用户手动保存的候选地点。

## 4. Agent Runtime 与对话规则

### 4.1 所有聊天都调用真实 Agent

以下是不可放宽的运行约束：

- 每一条由用户发送的聊天消息都进入共享 Agent Runtime。
- 补充人数、修改预算、改变偏好、追问原因和一般旅行咨询也必须调用真实模型。
- 前端、本地服务或规则引擎不得返回伪装成 Agent 的固定成功回复。
- 初始欢迎语可以是产品静态说明，但用户发送消息后的回复必须来自真实模型运行结果。
- 模型配置缺失、超时、限流或协议不兼容时，本轮进入可恢复失败状态，UI 提供“重试本轮”。
- 不允许静默切换到 `RuleBasedProvider`、Sandbox Agent 或模板回复。

地图搜索、加入候选、接受或拒绝 Proposal 等明确的 UI 命令不属于聊天消息，可以直接调用确定性领域接口；这些操作不能生成冒充模型的聊天回复。

### 4.2 共享规划运行时

Conversation、AgentRun、Trip、PlanService、MapService、CandidateService、ProposalService 和 Capability Gateway 必须共享同一个身份与运行时组合：

```text
Conversation Service
  -> Shared Planning Runtime
       -> ThirdPartyResponsesProvider
       -> PlanningOrchestrator
       -> Capability Gateway
       -> AgentRunStore
       -> Trip / Map / Candidate / Proposal / Plan / Budget Services
```

不能在 ConversationModule 内另建与 AgentModule 隔离的 Orchestrator、AgentRunStore 或内存领域仓库。开发内存模式和 PostgreSQL 模式只替换存储实现，不改变运行时行为。

### 4.3 模型结构化输出

每轮真实模型输出经过严格 Zod 校验，至少包含：

```text
assistant_message
planning_context_patch
missing_fields
tool_calls
plan_proposal nullable
reasoning_summary nullable
```

模型只提出结构化工具调用；所有工具经 Capability Gateway 执行。模型请求必须设置 `store: false`，发送给第三方的上下文只包含当前规划需要的最小数据。

### 4.4 能力范围

Trip 创建前允许：

- 一般旅行咨询。
- 地点搜索、地理编码和地点比较。
- 读取或解释 Conversation 候选地点。
- 更新经过校验的 PlanningContext。

Trip 创建后增加：

- 交通、住宿、景点和餐馆搜索。
- 路线规划、预算计算、时间检查。
- 创建或更新 PlanProposal。

保存候选、接受 Proposal 和创建正式 PlanVersion 只能由用户命令触发。规划 Runtime 不注册 booking、redirect、payment、refund、traveler profile 或 identity-document 工具。

## 5. 推理摘要与执行过程

产品展示“可解释执行过程”，不展示模型原始隐藏思维链。

页面可显示：

```text
正在理解旅行需求
已识别：杭州、10 月 1 日至 4 日、2 人
仍需确认：出发城市

正在搜索旅行方案
已找到 6 个交通方案
正在比较 12 家住宿

正在组合行程
考虑地点距离、营业时间、预算和游玩节奏
```

规则如下：

- 第三方 Responses 接口返回受支持的 reasoning summary 时，展示其脱敏摘要。
- 第三方接口不支持时，只展示系统能够验证的阶段、工具名、状态、耗时、来源和结果摘要。
- 系统不得自行编造模型的思维内容。
- 工具参数只显示用户可理解且不敏感的部分，不显示内部 JSON、提示词、Cookie、密钥或授权头。
- 当前步骤实时展开；完成后折叠为“查看思考与执行过程”。
- 推理摘要与执行事件可通过 SSE 恢复，但日志只保留脱敏摘要。

建议事件：

```text
AgentTurnStarted
PlanningContextUpdated
ReasoningSummaryUpdated
ToolCallStarted
ToolCallCompleted
ToolCallFailed
PlanProposalCreated
AgentMessageCompleted
AgentTurnFailed
```

## 6. 页面设计

### 6.1 首屏与桌面端

删除“精确编辑行程范围”表单。首屏使用聊天与地图双栏：

```text
┌────────────────────────┬──────────────────────────────────┐
│ Voyager Agent          │ 搜索景点、餐厅、酒店             │
│ 条件标签               │                                  │
│ 完整多轮聊天            │          高德交互地图            │
│ 建议与 Proposal 卡片    │          标记与结果列表           │
│ 固定聊天输入框          │                                  │
└────────────────────────┴──────────────────────────────────┘
```

- 地图搜索从首屏开始始终启用。
- 没有 Trip 或 PlanProposal 时不显示行程卡、预算卡或空时间线。
- PlanningContext 以轻量标签显示，例如“杭州”“10.1–10.4”“2 人”“预算 ¥5000”。
- 点击标签通过聊天内联方式修改，不恢复独立大表单。
- Agent 建议地点显示“加入候选”和“忽略”。
- Proposal 显示“接受行程”和“拒绝”。
- 接受后才展开正式行程、预算和撤销能力。

### 6.2 地图与候选地点

- 无目的地上下文时执行全局地点搜索，结果必须展示城市和地址，避免同名地点混淆。
- 有目的地上下文时，可以将目的地作为搜索提示，但不得隐藏其他城市的明确查询结果。
- 搜索结果同时显示地图标记与结果卡片。
- 用户点击“加入候选”后才持久化地图搜索结果。
- Agent 推荐的地点只有在用户单独接受，或用户接受整份 Proposal 后，才进入候选。
- 候选地点可以删除、置顶或要求 Agent 纳入下一版 Proposal。

### 6.3 响应式行为

移动端使用“聊天 / 地图 / 行程”三个标签。Trip 或正式计划不存在时，“行程”标签可以显示为禁用或隐藏；聊天输入框在聊天标签底部保持可访问。

## 7. API 设计

### 7.1 Conversation 与消息

```text
POST   /v1/conversations
GET    /v1/conversations/{conversationId}
POST   /v1/conversations/{conversationId}/messages
GET    /v1/conversations/{conversationId}/events
DELETE /v1/conversations/{conversationId}
```

消息提交包含 `client_message_id`，相同 ID 和相同内容返回原结果；相同 ID 和不同内容返回冲突。同一 Conversation 同时只执行一个 AgentTurn。

### 7.2 地点与候选

```text
GET    /v1/conversations/{conversationId}/places/search?query=...
GET    /v1/conversations/{conversationId}/candidates
POST   /v1/conversations/{conversationId}/candidates
DELETE /v1/conversations/{conversationId}/candidates/{candidateId}
```

地图搜索与候选接口不要求 Trip ID，但必须验证匿名会话所有权。高德 Web Service Key 和安全码只保留在服务端。

### 7.3 Proposal

```text
GET  /v1/conversations/{conversationId}/plan-proposals/current
POST /v1/conversations/{conversationId}/plan-proposals/{proposalId}/accept
POST /v1/conversations/{conversationId}/plan-proposals/{proposalId}/reject
```

接受操作需要 Proposal 版本和幂等键。过期 Proposal、PlanningContext 版本变化或 Trip 版本冲突返回 409，并提示重新生成或加载最新提案。

## 8. 错误处理与隐私

- 模型失败：保留用户消息、PlanningContext、候选和现有计划，允许重试同一 AgentTurn。
- 单类搜索失败：其他搜索继续，失败类别显示来源和重试入口。
- 高德 Web Service Key 无效：底图若可用则继续显示，并明确提示地点或路线服务凭据无效。
- 路线失败：不编造距离、时间或费用。
- SSE 断线：使用 `Last-Event-ID` 恢复，同一聚合内保持顺序和至少一次投递语义。
- 匿名数据默认保留七天；删除 Conversation 时清除 PlanningContext、候选、Proposal、消息、地点与路线数据。
- 不在日志、事件、浏览器存储或错误响应中记录模型 Key、高德安全码、Cookie、完整授权头或原始系统提示词。
- 浏览器只保存不敏感的导航状态和服务端资源 ID；完整数据从服务端恢复。

## 9. 开发与正式运行模式

开发内存模式必须显式满足：

```text
NODE_ENV=development
LOCAL_PLANNING_MEMORY_MODE=true
DATABASE_URL 为空
```

该模式支持 Conversation、真实 Agent、PlanningContext、地图、候选、Proposal、Trip、Plan 和预算，但不装配下单、支付、Vault、旅客资料、Webhook 或退款接口。

普通开发和生产模式继续强制 PostgreSQL；数据库连接失败不得自动降级到内存。两种模式都必须使用真实模型，不能启用规则或 Sandbox Agent 回退。

## 10. 验收标准

1. 首屏不出现“精确编辑行程范围”。
2. Trip 未创建时可以搜索地图并手动加入候选。
3. 用户发送的每一条聊天消息都产生真实 AgentRun。
4. 不存在固定“已记下你的想法”或规则模型代答。
5. Agent 能在多轮对话中追问缺失信息并更新 PlanningContext。
6. 条件足够后自动创建 Trip，且 Conversation 与 Trip 使用同一匿名身份。
7. 推理摘要、工具状态和最终回复通过 SSE 更新并可恢复。
8. Agent 推荐地点未经用户接受不会进入 CandidatePlace。
9. 接受整份 Proposal 后创建 PlanVersion，并保存其中的地点。
10. 后续每一条修改、追问或咨询消息仍调用真实 Agent。
11. 刷新页面后恢复聊天、候选、Proposal、当前 Trip 和正式计划。
12. 模型或地图失败时显示可重试错误，不使用假数据、固定成功文案或规则回退。
13. 桌面和移动端均能完成聊天、地图搜索、候选管理、接受方案和撤销流程。
14. 页面及规划 Agent 中没有下单、支付、退款、证件或旅客资料入口。
15. 敏感输出扫描确认模型 Key、高德凭据、Cookie 和授权头未进入 Git、日志、事件、网络响应或前端构建。

## 11. 测试策略

- Agent Runtime 契约测试：验证每条用户消息都调用真实 Provider 边界；普通测试使用显式 fake transport，不消耗真实额度。
- Conversation 集成测试：覆盖无 Trip 对话、信息提取、自动建 Trip、共享身份、共享 AgentRunStore 和后续修改。
- Map/Candidate 测试：覆盖无 Trip 搜索、所有权、加入、删除、去重和 Agent 建议不得自动保存。
- Proposal 测试：覆盖生成、接受、拒绝、过期、版本冲突、原子创建 PlanVersion 和候选地点。
- SSE 测试：覆盖推理摘要、工具状态、最终消息、断线恢复和重复事件去重。
- React 测试：覆盖无表单首屏、始终启用地图搜索、完整聊天、条件标签、候选与 Proposal 操作。
- Playwright：覆盖聊天前地图搜索、加入候选、多轮 Agent 对话、自动建 Trip、接受 Proposal、计划与预算出现、刷新恢复和删除。
- 真实模型和高德只在显式 live smoke 中调用；命令只输出 configured/missing、模型名、耗时和高级结果，不输出凭据或完整消息正文。

## 12. 实施顺序

1. 建立共享 Planning Runtime 和统一匿名身份。
2. 增加 Conversation-first PlanningContext 与全轮真实 Agent 调用。
3. 增加无 Trip 地图搜索与 Conversation 候选地点。
4. 增加 PlanProposal 接受、拒绝和 PlanVersion 提交流程。
5. 重构 React 首屏、完整聊天、推理轨迹、候选和地图交互。
6. 更新持久化、清理任务、API 集成测试和浏览器验收。
7. 使用已配置的真实模型与高德凭据执行受控完整冒烟测试。
