# 国内旅行助手 Agent 技术架构设计报告

版本：1.0
日期：2026-08-27
状态：架构已冻结，按实施计划开发中
目标产品：面向中国大陆自由行用户的响应式 Web 旅行助手，后续增加原生移动端

## 1. 报告摘要

本项目不是一个只会生成旅行文案的聊天机器人，而是一套可执行、可授权、可恢复、可审计的旅行规划与预订系统。

系统覆盖：

- 火车票和机票搜索、比较及预订执行。
- 住宿搜索、比较及预订。
- 景点搜索、比较及门票预订。
- 餐馆搜索、筛选、加入行程及支持时的订位。
- 地铁、公交、出租车的路线、时间和费用估算。
- 总预算与交通、住宿、景点、餐饮分类预算管理。
- 行程时间冲突检查和非强制性的交通、节奏提醒。
- 旅客敏感资料保险箱、按订单授权及用户审计。
- 供应商订单、支付跳转、回调、轮询、对账及售后状态跟踪。

核心架构采用：

> Web-first + API-first + 模块化单体 + 独立 Worker/Vault 运行单元 + Capability Gateway + PostgreSQL 可靠任务与 Outbox/Inbox。

该方案优先保证订单一致性、隐私和故障恢复，同时控制 V1 的运维复杂度。未来原生 App 可以复用 API、领域模型、事件契约和全部后端能力。

## 2. 产品范围

### 2.1 V1 范围

| 维度 | V1 决策 |
| --- | --- |
| 市场 | 中国大陆境内旅行 |
| 用户 | 个人或朋友自由行 |
| 旅客人数 | 每个 Trip 最多 6 人 |
| 货币 | 人民币 CNY |
| 时间 | 中国标准时间展示，数据库存 UTC 时间点 |
| 客户端 | 响应式 Web |
| 支付 | 用户在供应商页面完成 |
| 开发供应商 | Mock/Sandbox |
| 生产接入 | 逐家供应商、逐品类灰度 |
| 协作 | 单个 Trip 创建者维护，不做多人协同编辑 |

### 2.2 V1 不包含

- 国际旅行、签证、跨境数据和多币种。
- 系统内银行卡、信用卡或钱包支付。
- 网约车下单。
- 餐馆点餐、优惠券、押金和退款处理。
- 多人共享编辑。
- 不受限制的全自动高风险预订。
- Agent 直接访问数据库、Vault 或任意供应商 HTTP。

## 3. 架构原则

### 3.1 Agent 做概率性工作，领域服务做确定性工作

Agent 负责：

- 理解用户自然语言意图。
- 判断缺少哪些必要信息。
- 组织并行搜索和工具调用。
- 汇总报价、解释取舍和修订行程。
- 发起需要用户确认的 ActionRequest。
- 在回调或用户决策后恢复 AgentRun。

确定性代码负责：

- 金额计算和预算阈值。
- 时间区间冲突。
- TravelMandate 权限判断。
- 敏感资料释放。
- 幂等、版本控制和状态迁移。
- 订单、支付、取消、退款和对账状态。

因此，模型输出不能直接成为数据库状态或供应商命令。

### 3.2 所有外部副作用必须经过 Capability Gateway

Agent Runtime 只能调用注册过的结构化能力。Gateway 在工具执行前重新检查：

- 当前用户和 Trip 所有权。
- AgentRun、ActionRequest 和资源版本。
- 工具风险等级。
- 用户逐单决策或 TravelMandate。
- 总预算和分类预算。
- TravelerDataGrant。
- 幂等键和并发版本。
- 审计与关联 ID。

### 3.3 不确定状态不能伪装成成功

供应商建单超时不代表失败，也不代表成功。系统必须进入 creation_unknown，并通过供应商查询或对账得到最终状态。

类似地，支付回调无法验证时进入 payment_unknown，不能显示为已支付。

### 3.4 敏感明文最短路径、最短生命周期

旅客姓名、证件、手机号等数据只允许在 Vault 到已授权供应商的一次请求内短暂存在。明文不能进入：

- LLM 上下文。
- 日志和 Trace。
- 事件和 SSE。
- 任务队列和缓存。
- 向量数据库。
- URL。
- 浏览器 localStorage。

## 4. 总体技术架构

~~~mermaid
flowchart TB
    Web[响应式 Web]
    Mobile[未来原生 App]
    Edge[CDN / WAF]
    BFF[API / BFF]
    Agent[Agent Runtime]
    Gateway[Capability Gateway]
    Domain[确定性领域服务]
    Worker[Worker / Reconciler]
    Vault[Vault Service]
    AppDB[(App PostgreSQL)]
    VaultDB[(Vault DB / Schema)]
    KMS[KMS / HSM]
    Adapter[Supplier Adapters]
    Supplier[供应商 API / Redirect / Webhook]
    Model[LLM Provider]
    Obs[日志 / 指标 / Trace / Audit]

    Web --> Edge --> BFF
    Mobile --> Edge
    BFF --> Agent
    Agent --> Gateway
    Gateway --> Domain
    Domain --> AppDB
    Domain --> Worker
    Worker --> AppDB
    Worker --> Adapter
    Adapter --> Supplier
    Supplier --> BFF
    Gateway --> Vault
    Vault --> VaultDB
    Vault --> KMS
    Agent -->|仅脱敏上下文| Model
    BFF --> Obs
    Gateway --> Obs
    Worker --> Obs
~~~

### 4.1 为什么选择模块化单体

V1 使用一个代码仓库和明确领域模块，而不是立即拆成微服务，原因是：

- 订单、预算、授权和状态变更需要强一致性。
- 初期团队和供应商数量有限。
- 本地开发、调试和自动化测试成本更低。
- PostgreSQL 事务可以保护核心不变量。
- 领域模块、Worker、Vault 和适配器边界已经允许后续独立拆分。

API、Worker 和 Vault 虽然来自同一个 Monorepo，但作为不同进程运行。Vault 使用独立数据权限和安全边界。

## 5. 组件职责

### 5.1 Responsive Web

桌面端采用双栏工作台：

- 左侧：Agent 对话、执行进度、工具摘要、风险和待决策事项。
- 右侧：行程、报价比较、预算、订单和售后。

移动端采用纵向页面和底部导航：

- 行程。
- 搜索。
- 预算。
- 订单。
- 设置。

前端只展示 Agent 的执行摘要，不展示模型思维链。

### 5.2 API/BFF

负责：

- 身份认证与会话。
- 请求语法校验。
- Web 所需的聚合查询。
- ActionRequest 决策入口。
- SSE 事件连接。
- Webhook 接收入口。

API/BFF 不替代领域校验。预算、授权、版本和状态规则必须在 Gateway 或领域服务再次验证。

### 5.3 Agent Runtime

Agent Runtime 保存可恢复的 AgentRun，主要数据包括：

- 当前目标和结构化 Trip 上下文。
- 已完成的 ToolCall 摘要。
- 等待中的 ActionRequest。
- 下一步动作。
- 错误和恢复点。

生产模型通过 LlmProvider 接口适配。V1 先使用确定性本地 Provider，使 E2E 流程可重复、可测试，也避免在隐私和工具权限尚未稳定时依赖外部模型。

### 5.4 Capability Gateway

每个工具声明：

~~~ts
interface CapabilityTool<I, O> {
  name: string;
  risk: 'read' | 'prepare' | 'commit' | 'redirect';
  inputSchema: ZodType<I>;
  execute(context: CapabilityContext, input: I): Promise<O>;
}
~~~

风险等级含义：

| 等级 | 含义 |
| --- | --- |
| read | 查询数据，不产生业务承诺 |
| prepare | 形成草案、报价快照或预算预留 |
| commit | 创建供应商订单或其他外部副作用 |
| redirect | 生成供应商跳转，仍需授权和审计 |

### 5.5 Domain Services

领域模块包括：

- Trip。
- Planning。
- Catalog/Search。
- Itinerary。
- Budget。
- Booking。
- Traveler Vault。
- Mandate。
- ActionRequest。
- SupplierOrder。
- Reconciliation。
- Audit。

模块之间使用应用服务和明确命令协作，不直接跨模块修改数据库表。

### 5.6 Worker / Reconciler

Worker 负责：

- 并行和长耗时搜索。
- 供应商建单任务。
- 供应商订单主动查询。
- Webhook 后续处理。
- Outbox 分发。
- 未知状态对账。
- 重试和人工处理升级。

任务使用 PostgreSQL 租约领取：

~~~text
pending
  -> leased
  -> completed
  -> dead_letter
~~~

Worker 崩溃后，租约到期的任务可以由其他 Worker 使用 FOR UPDATE SKIP LOCKED 安全领取。

### 5.7 Vault Service

Vault 是独立安全域：

- 独立数据库或 Schema。
- 独立数据库角色。
- 字段级信封加密。
- 数据密钥受 KMS/HSM 保护。
- 单次、短时 TravelerDataGrant。
- 用户可查看、撤销和删除。

Agent 只能看到 Vault 引用和脱敏字段清单，不能读取敏感明文。

### 5.8 Supplier Adapter

统一接口：

~~~ts
interface SupplierAdapter {
  search(input: SearchRequest): Promise<OfferPage>;
  revalidate(input: RevalidateRequest): Promise<RevalidatedOffer>;
  createOrder(input: CreateSupplierOrder): Promise<CreateOrderResponse>;
  getOrder(input: SupplierOrderRef): Promise<SupplierOrderSnapshot>;
  cancel?(input: CancelSupplierOrder): Promise<CancelResult>;
  parseWebhook?(input: SupplierWebhook): Promise<SupplierOrderUpdate>;
}
~~~

Adapter 只做：

- 供应商字段映射。
- 请求签名与协议转换。
- 响应结构验证。
- 错误映射。

Adapter 不直接修改 BookingIntent、SupplierOrder 或 BudgetLedger。

## 6. 核心领域模型

| 聚合/对象 | 作用 |
| --- | --- |
| Trip | 旅行范围、日期、人数、偏好和当前版本 |
| ItineraryItem | 交通、住宿、景点、餐馆或人工行程项 |
| SupplierOffer | 标准化报价和不可变快照 |
| BudgetLedger | 估算、预留、承诺、已支付和释放 |
| BookingIntent | 系统内部一次预订意图和执行状态 |
| SupplierOrder | 供应商订单、支付和确认状态 |
| TravelerVaultRef | 敏感资料在业务库中的引用 |
| TravelMandate | 用户预先授予的受限执行范围 |
| ActionRequest | 需要用户决策的持久化动作 |
| AgentRun | 可暂停和恢复的 Agent 工作流 |

### 6.1 BookingIntent 状态机

~~~mermaid
stateDiagram-v2
    [*] --> draft
    draft --> awaiting_user_decision
    awaiting_user_decision --> validating
    validating --> awaiting_traveler_data_grant
    validating --> submitting
    awaiting_traveler_data_grant --> submitting
    submitting --> awaiting_supplier
    awaiting_supplier --> completed
    awaiting_supplier --> failed
    draft --> expired
    awaiting_user_decision --> expired
    completed --> cancelling
    cancelling --> cancelled
~~~

BookingIntent 表示内部命令，不等于供应商订单。

### 6.2 SupplierOrder 状态

生命周期：

~~~text
creating
creation_unknown
awaiting_payment
payment_processing
payment_unknown
paid
confirmed
cancelling
cancelled
refunding
refunded
failed
expired
~~~

对账状态独立维护：

~~~text
not_required
pending
matched
discrepancy
manual_review
~~~

这样可以表示“业务生命周期已支付，但对账仍有差异”，避免用一个状态字段混合多个维度。

### 6.3 BudgetLedger

预算使用整数分，禁止浮点金额：

| 字段 | 含义 |
| --- | --- |
| estimated | 规划估算 |
| reserved | 为待执行动作预留 |
| committed | 已提交供应商但未最终完成 |
| paid | 已验证支付 |
| released | 取消或退款后释放 |

策略：

- 达到总预算或分类预算 80%：警告。
- 超过 100%：默认阻断。
- 用户可明确覆盖，但必须产生 ActionRequest 和审计。

## 7. 关键业务工作流

### 7.1 规划与搜索

~~~mermaid
sequenceDiagram
    participant U as 用户
    participant W as Web
    participant A as Agent Runtime
    participant G as Capability Gateway
    participant S as Search Services
    participant P as Supplier Adapters

    U->>W: 描述目的地、日期、预算和偏好
    W->>A: 创建/恢复 AgentRun
    A->>A: 判断缺失的必要字段
    A->>G: 请求白名单搜索能力
    G->>G: 校验用户、Trip、风险和版本
    par 交通
      G->>S: 交通搜索
    and 住宿
      G->>S: 住宿搜索
    and 景点
      G->>S: 景点搜索
    and 餐馆
      G->>S: 餐馆搜索
    end
    S->>P: 调用 Mock/Sandbox/生产适配器
    P-->>S: 标准化 Offer
    S-->>A: 报价、来源、更新时间和部分失败
    A-->>W: 行程草案、解释性排序和风险摘要
~~~

报价排序维度：

- 价格。
- 总耗时。
- 换乘次数。
- 位置。
- 评分。
- 退改灵活性。

系统提供综合价值、便宜优先、快速优先和舒适优先，不使用不可解释的单一 AI 分数。

### 7.2 预订执行

~~~mermaid
sequenceDiagram
    participant U as 用户
    participant G as Gateway
    participant B as Booking Service
    participant V as Vault
    participant P as Supplier Adapter
    participant R as Reconciler

    U->>G: 逐单批准或创建受限 Mandate
    G->>B: commit BookingIntent
    B->>B: 检查版本、幂等、预算和时间
    B->>P: revalidate 报价/库存/退改
    alt 报价或规则变化
      B-->>U: RevalidationRequired
    else 不变
      G->>V: 消费一次性 TravelerDataGrant
      V-->>G: 仅授权字段
      G->>P: 创建待支付订单或生成 redirect
      alt 结果确定
        P-->>B: awaiting_payment / confirmed / failed
      else 请求超时或结果不确定
        P-->>B: creation_unknown
        B->>R: 创建对账任务
      end
    end
~~~

支付永远由用户在供应商页面完成。系统只记录可验证的供应商订单引用和支付结果。

### 7.3 TravelerDataGrant

Grant 绑定：

- BookingIntent ID 和版本。
- 供应商法律实体。
- 旅客 ID。
- 允许字段。
- 用途。
- Offer 快照哈希。
- 用户决策或 Mandate 引用。
- 过期时间。
- 最大使用次数 1。

默认建议有效期 5 分钟。任何供应商、报价、旅客、用途或意图版本变化都会使 Grant 失效。

## 8. API 和事件设计

主要资源：

~~~text
POST /v1/agent/runs
GET  /v1/agent/runs/{runId}
POST /v1/agent/runs/{runId}/resume

POST /v1/trips
GET  /v1/trips/{tripId}
POST /v1/trips/{tripId}/searches
GET  /v1/trips/{tripId}/itinerary
GET  /v1/trips/{tripId}/budget

POST /v1/trips/{tripId}/mandates
POST /v1/trips/{tripId}/mandates/{mandateId}/revoke
POST /v1/action-requests/{actionRequestId}/decisions

POST /v1/booking-intents/{intentId}/traveler-data-grants
POST /v1/booking-intents/{intentId}/commit
GET  /v1/supplier-orders/{orderId}
POST /v1/supplier-orders/{orderId}/cancel

GET  /v1/trips/{tripId}/events
~~~

所有外部副作用命令要求：

- Idempotency-Key。
- If-Match 或资源版本。
- ActionRequest 或有效 Mandate。
- Gateway 策略检查。
- 审计和 correlation_id。

### 8.1 SSE 语义

事件至少一次投递，同一聚合内有序，不保证跨聚合全局有序。客户端使用 Last-Event-ID 断线恢复。

事件字段：

~~~text
event_id
event_type
aggregate_type
aggregate_id
run_id
sequence
schema_version
occurred_at
request_id
correlation_id
redacted_payload
~~~

## 9. 数据与可靠性设计

### 9.1 PostgreSQL

PostgreSQL 是唯一业务事实来源，保存：

- Trip 和行程。
- Offer 快照。
- 预算账本。
- BookingIntent 和 SupplierOrder。
- Mandate 和 ActionRequest。
- AgentRun 和 ToolCall 摘要。
- Task、Outbox、Inbox 和事件历史。

不使用 Redis 作为事实来源，也不在 V1 引入 Kafka 和分布式事务。

### 9.2 乐观并发

写操作使用资源 version：

~~~sql
update trips
set version = version + 1
where id = :id
  and owner_id = :owner
  and version = :expected_version;
~~~

更新行数为 0 时返回冲突，客户端或 Agent 必须重新读取。

### 9.3 幂等

幂等键作用域至少包含：

- 用户。
- API/命令。
- 资源。

规则：

- 相同 Key + 相同请求：返回原结果。
- 相同 Key + 不同请求：返回冲突。
- 内部幂等键和供应商幂等键分开保存。
- 供应商返回不确定结果时不能盲目重试建单。

### 9.4 Outbox/Inbox

领域状态和 Outbox 事件在同一 PostgreSQL 事务提交。Worker 分发后，消费端用 Inbox 去重，实现至少一次投递下的幂等处理。

## 10. 隐私、安全和审计

### 10.1 Web 安全

- HttpOnly、Secure、SameSite Cookie。
- CSRF 防护。
- CSP。
- 请求大小限制。
- 敏感页面禁用第三方分析和会话录制。
- 高风险操作要求强认证或二次确认。

### 10.2 供应商安全

- 出站域名白名单。
- SSRF 防护。
- 超时和响应大小限制。
- Webhook 签名、时间戳和重放保护。
- 供应商文本视为不可信数据，防止提示注入。

### 10.3 审计

审计日志独立于 SSE 事件，记录：

- actor。
- action。
- resource。
- mandate_version。
- grant_ref。
- policy_result。
- result/reason。
- request_id。
- correlation_id。
- occurred_at。

用户可以查看谁在什么时间为哪个订单向哪个供应商释放了哪些字段。

## 11. 技术栈

### 11.1 当前确定的技术

| 层 | 技术 | 用途 |
| --- | --- | --- |
| 语言 | TypeScript | Web、API、Worker、Vault 和共享包 |
| 运行时 | Node.js 22 | 后端及开发工具 |
| 包管理 | pnpm workspace | Monorepo 依赖和脚本 |
| 构建编排 | Turbo 2.10 | build、typecheck、lint、test |
| Web | React 19 + Vite 6 | 响应式工作台 |
| 路由 | React Router | Web 路由 |
| 服务端状态 | TanStack Query | API 缓存和请求状态 |
| API | NestJS 11 + Fastify | 模块化 API/BFF |
| 数据库 | PostgreSQL 16 | 事务、状态、任务和事件 |
| SQL | Kysely 0.28 + pg | 类型化 SQL 和显式事务 |
| 运行时校验 | Zod 3 | HTTP、模型和供应商边界 |
| 实时事件 | SSE | Agent/订单状态推送和恢复 |
| 单元/集成测试 | Vitest 3 | TypeScript 测试 |
| 浏览器测试 | Playwright | 桌面和移动端 E2E |
| 日志 | Pino（计划） | 结构化脱敏日志 |
| 指标 | Prometheus 兼容指标（计划） | 延迟、失败、队列、对账 |
| 本地基础设施 | Docker Compose | PostgreSQL 和本地运行 |

当前开发机实测：

- Node.js v22.16.0。
- pnpm v11.19.0。
- Git for Windows 2.45.2。

仓库 packageManager 字段暂为 pnpm 9.15.5，但实际工具运行在 pnpm 11.19.0。后续应统一版本并用 Corepack 锁定，避免 CI 与本地行为不一致。

### 11.2 仍需生产环境选择的技术

以下接口已确定，但供应商尚未锁定：

- LLM Provider。
- OIDC、手机号或其他身份平台。
- 云 KMS/HSM。
- 云 PostgreSQL。
- CDN/WAF 和部署平台。
- 第一家交通、住宿、景点或餐馆供应商。

这些选择不能改变 Gateway、Vault、领域状态机、API 和事件语义。

## 12. Monorepo 结构

~~~text
apps/
  web/
  api/
  worker/
  vault/

packages/
  contracts/
  domain/
  application/
  capability-gateway/
  agent-runtime/
  supplier-adapters/
  persistence/
  security/
  observability/
  testkit/

infra/
  compose.yaml
  postgres/

docs/
  architecture/
  api/
  runbooks/
  superpowers/
~~~

## 13. 测试策略

| 测试类型 | 重点 |
| --- | --- |
| 领域单元测试 | 预算、时间、状态机、Mandate、Grant |
| 属性测试 | 金额守恒、状态不越权、幂等 |
| 契约测试 | OpenAPI、Zod、SupplierAdapter |
| PostgreSQL 集成 | 事务、版本、锁、Outbox/Inbox、租约 |
| Agent Eval | 工具选择、最小追问、越权拒绝、提示注入 |
| E2E | 匿名规划、登录、授权、预订、回调、恢复 |
| 安全测试 | CSRF、SSRF、Webhook 重放、日志泄露 |

必测故障：

- Offer 过期、库存丢失、价格或退改变化。
- 并发 commit 和幂等冲突。
- 供应商建单超时但实际可能成功。
- 重复或乱序 Webhook。
- 已支付但未出票。
- 部分成功。
- Vault/KMS 不可用。
- Mandate 撤销。
- SSE 断线。
- Worker 崩溃和任务重领。
- 供应商提示注入。

## 14. 可观测性

统一关联链：

~~~text
request_id
  -> correlation_id
  -> AgentRun
  -> ToolCall
  -> ActionRequest
  -> BookingIntent
  -> SupplierOrder
  -> Webhook / Reconciliation
~~~

关键指标：

- 搜索首个结果和完整结果耗时。
- 模型和工具延迟、失败率、Token 和成本。
- revalidate 失败和价格变化率。
- 订单成功、失败、未知和人工处理数量。
- 对账积压和最大等待时间。
- Worker 队列、Outbox 和 Webhook 重试。
- 用户干预次数。

指标、日志和 Trace 只记录脱敏 ID，不记录旅客明文。

## 15. 部署设计

### 15.1 本地

~~~text
Vite Web
NestJS/Fastify API
Node Worker
Node Vault
PostgreSQL 16 via Docker Compose
~~~

### 15.2 生产

推荐部署为四个独立工作负载：

1. Web 静态资源和边缘入口。
2. 无状态 API/BFF，可水平扩展。
3. Worker/Reconciler，可按任务积压扩展。
4. Vault，使用单独网络、角色、数据库和 KMS。

PostgreSQL 使用托管高可用实例、加密备份、PITR 和恢复演练。供应商 Webhook 只进入受保护 API 入口。

## 16. 当前实现进度

截至 2026-08-27：

| 任务 | 状态 | 结果 |
| --- | --- | --- |
| Task 1 工程骨架 | 已完成 | API/Web/Worker/Vault 可构建，健康检查通过 |
| Task 2 共享契约 | 已完成 | 状态、错误和边界 Schema；契约测试 8/8 |
| Task 3 PostgreSQL 持久化 | 已完成，保留环境门槛 | 并发和事务审查通过；真实 PostgreSQL 集成测试待环境可用后执行 |
| Task 4 行程/预算/时间规则 | 已实现，等待独立复审 | 领域、应用和 API 测试已通过 |
| Task 5-14 | 未开始 | 按实施计划顺序执行 |

当前分支：

~~~text
codex/travel-agent-implementation
~~~

当前已实现的不代表完整产品已经可用。规划 UI、Agent Runtime、Gateway、Vault、Booking、Webhook 和售后仍在后续任务中。

### 16.1 当前验证限制

当前开发机没有 Docker CLI、psql、postgres 或 pg_ctl，因此真实 PostgreSQL 集成测试尚未运行。当前能确认的是：

- TypeScript 类型检查通过。
- 构建通过。
- lint 通过。
- 契约测试通过。
- 持久化边界单元测试通过。
- PostgreSQL 集成用例已编写但被明确跳过。

在安装 Docker Desktop 或可访问的 PostgreSQL 16 后，必须执行迁移、回滚、并发锁、幂等和租约恢复测试，才能关闭 Task 3 的发布风险。

## 17. 主要取舍与风险

### 17.1 Web-first 的取舍

优点：

- 首版交付快。
- API、领域对象和事件可被原生 App 复用。
- 更容易验证复杂工作流。

代价：

- 原生 App 的界面仍需重新开发。
- Web 不能直接获得所有系统级能力。

### 17.2 模块化单体的取舍

优点：

- 事务和一致性更直接。
- 运维成本低。
- 本地调试容易。

风险：

- 必须维护模块边界，避免演变成共享数据库的混乱单体。
- 拆分服务时需要稳定的命令和事件契约。

### 17.3 PostgreSQL 任务队列的取舍

优点：

- V1 无需 Kafka/Redis。
- 状态和任务可在同一事务提交。
- 故障恢复简单。

风险：

- 高吞吐时数据库可能成为瓶颈。
- 需要正确实现索引、租约、SKIP LOCKED 和清理策略。

只有当真实负载证明 PostgreSQL 任务模型不足时，才考虑独立消息系统。

## 18. 发布门槛

V1 Mock/Sandbox 发布必须满足：

- 重复供应商订单为 0。
- 敏感字段泄露扫描为 0。
- 非法状态迁移全部拒绝。
- 未知订单全部进入对账或人工队列。
- TravelMandate 范围外高风险执行为 0。
- 页面刷新、API/Worker 重启后工作流可以恢复。
- 桌面和移动端关键流程 E2E 通过。

真实供应商上线还要求：

- SupplierAdapter 契约测试通过。
- Sandbox 流程通过。
- 数据流和隐私评估完成。
- Webhook、幂等和对账演练完成。
- 单品类灰度和回滚方案确认。

## 19. 关联文档

- 冻结设计规格：docs/superpowers/specs/2026-08-25-travel-agent-design.md
- 可执行实施计划：docs/superpowers/plans/2026-08-25-travel-agent-implementation.md
- 本报告：docs/architecture/travel-agent-architecture-report.md

冻结设计规格是业务和架构边界的权威来源；实施计划规定任务顺序和验证方式；本报告用于向开发、评审和项目相关人员解释整体方案与当前状态。
