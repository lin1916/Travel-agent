# 国内旅行助手 Agent 设计规格

状态：待用户复核
版本：0.1
日期：2026-08-25
产品路线：响应式 Web 首版，API-first，后续增加原生移动端
实现策略：模块化单体，API 与 Worker 分离运行，供应商逐家接入

## 1. 文档目的

本文档冻结旅行助手 Agent 首版的产品范围、领域边界、工作流、安全策略、技术基线、测试门槛和分阶段交付方式。它是后续实施计划和代码评审的依据。

本文档不包含具体业务代码，也不授权在规格获得批准前开始实现。实现阶段若发现必须改变已冻结的业务不变量、隐私边界或订单状态机，应先更新本文档并重新评审。

## 2. 产品目标与成功标准

用户可以用自然语言描述一次中国大陆境内的自由行需求，Agent 将需求拆解为交通、住宿、景点和餐馆任务，搜索并比较可用选项，形成可解释的行程草案，检查预算和时间约束，并在用户授权后发起预订。

首版的成功不是“聊天回答看起来合理”，而是以下闭环可以在 Mock/Sandbox 环境稳定恢复：

~~~text
自然语言需求
  -> 最小必要追问
  -> 并行搜索
  -> 标准化报价与解释性排序
  -> 行程、预算、时间校验
  -> 用户决策/受限授权
  -> 重新核验价格和库存
  -> API 待支付订单或供应商跳转
  -> 回调、轮询、对账
  -> 行程和预算账本更新
  -> 订单与售后状态可追踪
~~~

## 3. 冻结的产品边界

### 3.1 首版范围

- 市场：中国大陆境内旅行。
- 货币：人民币。
- 时区：中国标准时间。
- 用户：个人或朋友结伴自由行，单个 Trip 最多 6 名旅客。
- 客户端：响应式 Web；后续原生 App 复用 API、领域模型和事件契约。
- 交通：火车和航班可搜索、可预订；地铁、公交、出租车只提供路线、时间和费用估算。
- 住宿：搜索、比较、预订（供应商支持时）。
- 景点：搜索、比较、预订（供应商支持时）。
- 餐馆：搜索、筛选、加入行程；供应商支持时预约桌位，否则跳转或提供电话信息。
- 预算：总预算和交通、住宿、景点、餐饮分类预算。
- 时间：直接重叠阻断；城市交通、机场/车站提前量和游玩节奏只提供警告。
- 预订：开发使用 Mock/Sandbox；生产按供应商能力使用 API 待支付订单或供应商跳转。

### 3.2 明确不做

- 国际旅行、签证、跨境支付、多币种。
- 系统内银行卡、信用卡或钱包支付。
- 网约车下单或代叫。
- 餐馆点餐、优惠券、押金和退款代办。
- 多人协同编辑或共享账户。
- 无限制的高风险全自动预订。
- Agent 直接访问数据库、供应商 API 或隐私保险箱。

### 3.3 关键责任边界

系统负责规划、比较、授权控制、状态跟踪和可恢复执行；供应商负责最终支付、出票/确认以及其自身规则下的售后。系统不能把跳转已打开、支付链接已生成或供应商返回不确定结果误报为已支付或已确认。

## 4. 用户与核心场景

### 4.1 匿名规划

未登录用户可以创建临时 Trip、描述出发地、目的地、日期、人数、预算和偏好，并查看脱敏的搜索结果和行程草案。匿名数据不能触发真实预订，登录后才可保存旅客资料和执行预订。

### 4.2 逐单预订

默认每个会产生供应商订单或释放敏感资料的动作都需要用户在 Action Center 中明确确认。确认前展示供应商、价格快照、退改规则、付款位置、风险和数据字段范围。

### 4.3 受限自主执行

用户可以为一个 Trip 创建 TravelMandate，限定总预算、分类预算、供应商、订单类型、单笔金额、是否仅可退款、允许释放的字段、有效期和例外策略。Mandate 只在其版本和范围内授权；超预算、价格/规则变化、不可退款或其他高风险动作仍需新决策。

Mandate 是授权策略，不是付款授权。支付仍由用户在供应商页面完成。

### 4.4 供应商不支持 API 下单

系统仍然创建内部 BookingIntent，保存报价快照和执行上下文，然后生成供应商跳转。只有收到可验证的供应商订单或确认信息后，SupplierOrder 才能进入相应成功状态。系统不注入任意第三方页面，也不把旅客证件放入 URL、前端本地存储或未授权表单。

## 5. 端到端工作流

1. 用户创建 Trip 或继续已有 Trip。
2. Agent 解析目的地、日期、人数、预算、偏好和必需约束。
3. 缺少影响搜索或安全执行的必要信息时，Agent 只提出最小问题。
4. Agent Runtime 通过 Capability Gateway 并行调用交通、住宿、景点、餐馆和路线估算能力。
5. 领域服务将供应商结果标准化为 SupplierOffer，保存来源和更新时间。
6. 排序服务按用户选择的模式计算解释性排序：综合价值、便宜优先、快速优先、舒适优先。
7. 行程服务生成草案；预算服务计算估算、预留、承诺和已支付账本；时间服务阻断直接重叠并生成软警告。
8. 用户选择报价或修改约束，形成 BookingIntent 或新的行程版本。
9. 在执行前，系统重新核验价格、库存、退改规则、预算和行程版本。
10. 需要旅客信息时，Gateway 根据一次性 TravelerDataGrant 从 Vault 取得允许字段；Agent 本身不能读取明文。
11. API 能力创建待支付/待确认供应商订单，或 redirect 能力生成供应商页面。
12. 系统接收供应商回调、主动查询或人工补录，推进 SupplierOrder 生命周期和对账状态。
13. 成功或部分成功的结果回写行程和预算账本；失败、未知和需人工处理的结果进入 Action Center。
14. AgentRun 可以在页面刷新、API 重启或 Worker 重启后从持久化状态恢复。

系统支持部分成功。已支付或已确认的项目不会因另一个项目失败而被自动取消。

## 6. 领域模型与不变量

### 6.1 Trip

保存旅行范围、目的地、日期、旅客引用、预算策略、排序偏好和当前版本。Trip 不保存旅客证件原文。

不变量：

- 只有拥有者可以编辑和创建决策。
- 版本递增用于并发控制。
- 删除 Trip 不绕过订单、账本、审计和法定留存要求。

### 6.2 ItineraryItem

表示交通、住宿、景点、餐馆或人工添加的行程项，包含地点、时间区间、来源、关联报价/订单和软警告。

不变量：

- 同一 Trip 内直接时间区间不能与已确认项目重叠。
- 交通缓冲和游玩节奏是 warning，不自动阻断。
- 已确认项目的关键字段只能通过明确命令修改并产生审计记录。

### 6.3 SupplierOffer

保存供应商、产品类型、报价明细、税费、退改规则摘要、库存/有效期、来源、更新时间和不可变快照哈希。

不变量：

- 预订执行只能引用一个明确的报价快照版本。
- 快照过期、价格或规则变化时必须重新核验。
- 供应商文本被视为不可信输入，不能直接成为 Agent 指令。

### 6.4 BudgetLedger

每个 Trip 一个预算账本，至少区分：

~~~text
estimated       规划估算
reserved        已为待执行动作预留
committed       已提交供应商但未完成支付/确认
paid            已验证支付
released        取消或退款后释放
~~~

默认总预算和分类预算在达到 80% 时警告，超过 100% 时阻断。用户可明确覆盖阻断，但覆盖本身必须形成 ActionRequest 和审计记录。

### 6.5 BookingIntent

表示一次有意执行的预订命令，不等同于供应商订单。

建议状态：

~~~text
draft
-> awaiting_user_decision
-> validating
-> awaiting_traveler_data_grant
-> submitting
-> awaiting_supplier
-> completed
-> failed
-> expired
-> cancelling
-> cancelled
~~~

每次状态变更必须检查当前版本、允许的前置状态、授权范围和幂等键。

### 6.6 SupplierOrder

保存供应商订单引用、支付引用（不保存支付卡数据）、原始响应的脱敏摘要和订单生命周期。

生命周期与对账状态分开：

~~~text
lifecycle_status:
creating | creation_unknown | awaiting_payment | payment_processing |
payment_unknown | paid | confirmed | cancelling | cancelled |
refunding | refunded | failed | expired

reconciliation_status:
not_required | pending | matched | discrepancy | manual_review
~~~

creation_unknown、payment_unknown 和 manual_review 不是成功状态。

### 6.7 TravelerVaultRef

业务库只保存旅客引用、字段元数据、密钥版本和保留策略，不保存姓名、证件号、手机号等明文。

### 6.8 AgentRun、ToolCall、ActionRequest

- AgentRun：一次可恢复的 Agent 工作流。
- ToolCall：一次通过 Gateway 的工具调用，包含风险级别、输入摘要和结果引用。
- ActionRequest：需要用户决策或受 Mandate 决策的持久化动作请求。

用户决定绑定 ActionRequest，而不是绑定短暂的 AgentRun 消息或前端按钮。

## 7. 系统架构

### 7.1 部署拓扑

~~~text
响应式 Web / 未来 Mobile
        |
      HTTPS
        v
Web Runtime + CDN/WAF
        |
        v
API/BFF（认证、会话、输入校验、SSE）
        |
        v
Agent Runtime ---> Capability Gateway ---> 确定性领域服务
                                             |
                          +------------------+------------------+
                          |                                     |
                       Worker / Reconciler                  Supplier Adapters
                          |                                     |
                     Outbox/Inbox/Tasks                 供应商 API / Redirect

Vault Service ---> Vault DB + KMS（独立安全域）

App PostgreSQL：Trip、Offer、Budget、Booking、Mandate、
ActionRequest、Tasks、Events、Outbox、Inbox、Audit 引用
~~~

V1 是一个逻辑模块化单体，但 API、Worker 和 Vault 作为独立运行单元部署。暂不引入 Kafka、服务网格、分布式事务，也不把 Redis 作为业务事实来源。

### 7.2 API/BFF

API/BFF 只负责身份认证、会话、语法校验、资源读取和 SSE 连接。预算、状态、权限、隐私释放和版本校验必须在 Gateway/领域服务中再次执行。

### 7.3 Agent Runtime

Agent Runtime 负责：

- 意图解析和最小追问。
- 选择白名单能力并安排并行调用。
- 合并、解释和修订结果。
- 创建或恢复 AgentRun。
- 发起 ActionRequest。

Agent Runtime 不负责：

- 直接访问数据库、供应商 HTTP、Vault 明文或支付数据。
- 最终计算预算和时间冲突。
- 自行推进订单状态。
- 通过自然语言绕过 Gateway 的策略。

### 7.4 Capability Gateway

Gateway 是所有 Agent 工具调用的唯一入口，负责：

- 注入当前用户、Trip、AgentRun、ActionRequest 和资源版本。
- 白名单、身份认证、授权策略和 TravelMandate 检查。
- 预算、隐私、幂等、并发、风险级别和审计。
- 对模型输入输出做脱敏和大小限制。
- 将命令路由到确定性领域服务。

风险级别：

~~~text
read       只读查询
prepare    形成草案或预留，不产生供应商承诺
commit     提交供应商订单或产生外部副作用
redirect   生成供应商跳转，仍须遵守授权和审计
~~~

### 7.5 领域服务与适配器

领域服务拥有业务不变量和状态迁移。SupplierAdapter 只做供应商协议转换：

~~~text
interface SupplierAdapter {
  search(input: SearchRequest): Promise<OfferPage>;
  revalidate(input: RevalidateRequest): Promise<RevalidatedOffer>;
  createOrder(input: CreateSupplierOrder): Promise<CreateOrderResult>;
  getOrder(input: SupplierOrderRef): Promise<SupplierOrderSnapshot>;
  cancel?(input: CancelSupplierOrder): Promise<CancelResult>;
  parseWebhook?(input: SupplierWebhook): Promise<SupplierOrderUpdate>;
}
~~~

适配器不能直接修改 BookingIntent 或 SupplierOrder 的领域状态。createOrder 至少接收 intent 标识、报价快照版本、TravelerDataGrant、执行授权引用和外部幂等键，并区分 accepted、pending、rejected、indeterminate。

## 8. API 与命令契约

### 8.1 主要资源

~~~text
POST   /v1/agent/runs
GET    /v1/agent/runs/{runId}
POST   /v1/agent/runs/{runId}/resume
POST   /v1/trips
GET    /v1/trips/{tripId}
POST   /v1/trips/{tripId}/searches
GET    /v1/trips/{tripId}/itinerary
GET    /v1/trips/{tripId}/budget
POST   /v1/trips/{tripId}/mandates
GET    /v1/trips/{tripId}/mandates
POST   /v1/trips/{tripId}/mandates/{mandateId}/revoke
GET    /v1/action-requests/{actionRequestId}
POST   /v1/action-requests/{actionRequestId}/decisions
POST   /v1/booking-intents/{intentId}/commit
POST   /v1/booking-intents/{intentId}/traveler-data-grants
GET    /v1/supplier-orders/{orderId}
POST   /v1/supplier-orders/{orderId}/cancel
GET    /v1/trips/{tripId}/events
~~~

### 8.2 写操作并发和幂等

所有外部副作用命令都要求：

- Idempotency-Key。
- 资源版本或 If-Match。
- 用户、接口和资源范围内唯一的幂等记录。
- 同一 Key 与相同请求返回原结果。
- 同一 Key 与不同请求返回冲突错误。
- 系统幂等键和供应商幂等键分开保存。

推荐执行请求：

~~~text
POST /v1/booking-intents/{id}/commit
If-Match: "intent-version-7"
Idempotency-Key: <client-generated-unique-key>
~~~

状态迁移使用显式命令和领域事件，不允许客户端直接写状态字段。

### 8.3 SSE 事件

事件统一包含：

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

投递语义为至少一次；同一聚合内有序；客户端用 Last-Event-ID 断线恢复并可回放历史。不同聚合之间不保证全局顺序。

至少支持：

~~~text
AgentActionRequired
TravelerDataAuthorizationRequested
BookingApprovalRequested
RevalidationRequired
ReconciliationRequired
BookingStatusChanged
BudgetThresholdReached
~~~

事件和审计日志分离。SSE 载荷只能使用脱敏引用，不能携带旅客敏感字段。

## 9. 供应商执行策略

### 9.1 开发与测试

Mock/Sandbox Supplier 必须覆盖搜索、报价过期、库存丢失、价格变化、待支付、回调乱序、超时和不确定创建结果。完整工作流先在 Mock 中通过验收，再逐家接入生产供应商。

### 9.2 API 供应商

若供应商支持创建待支付订单：

1. revalidate 报价。
2. Gateway 校验 ActionRequest/Mandate、预算、Grant 和版本。
3. Adapter 使用一次性敏感字段调用供应商。
4. Adapter 返回 accepted/pending/rejected/indeterminate；领域服务将可确认的结果映射到 SupplierOrder 的 awaiting_payment、failed 或 creation_unknown。
5. 用户在供应商页面完成支付。
6. 通过回调或查询确认最终状态。

### 9.3 Redirect 供应商

系统生成带有效期和关联 intent 的跳转上下文，用户在供应商页面完成填写和支付。不得把姓名、证件号或手机号放入 URL 查询参数；不得向任意第三方页面注入脚本或表单。

供应商未返回可验证订单前，内部 BookingIntent 保持 awaiting_supplier；对应的 SupplierOrder 使用 creation_unknown 表示外部创建结果不确定。任何一种状态都不得显示“已预订”。

## 10. 隐私、安全与合规控制

### 10.1 隐私保险箱

- Vault 使用独立数据库/Schema、独立服务账号和独立权限边界。
- 使用字段级信封加密；旅客数据密钥按旅客或记录隔离，并由 KMS/HSM 保护。
- 业务库只保存引用、字段清单、密钥版本和保留策略。
- 明文仅在一次请求的短生命周期内存在内存中。
- 明文禁止进入 LLM 上下文、日志、Trace、队列、缓存、向量库、SSE、URL 和浏览器本地存储。
- 生产环境密钥来自 Secrets Manager/KMS，禁止写入仓库。

### 10.2 TravelerDataGrant

授权接口绑定：

~~~text
intent_id
intent_version
supplier_legal_entity
traveler_ids
allowed_fields
purpose
offer_snapshot_hash
mandate_or_decision_ref
expires_at
max_uses = 1
~~~

建议默认有效期为 5 分钟、最多使用一次。报价、供应商、旅客、用途或执行版本变化时立即失效。Agent 只能传递 grant 引用，不能读取其明文内容。

### 10.3 TravelMandate

Mandate 至少包含：

~~~text
trip_id
total_budget_limit
category_limits
allowed_booking_types
allowed_suppliers
refundable_only
max_single_order_amount
allowed_sensitive_fields
valid_until
exception_policy
version
revoked_at
~~~

Gateway 在实际外部调用前再次检查 Mandate，记录策略版本、授权上下文和决策来源。撤销发生在外部调用前时必须阻断；发生在提交后时不能假装撤销成功，而要继续跟踪订单。

### 10.4 Web、供应商和模型安全

- Web 会话使用 HttpOnly、Secure、SameSite Cookie、CSRF 防护和 CSP。
- 旅客资料、Mandate、Grant 和高风险售后操作要求强认证或二次确认。
- 敏感页面禁用分析脚本和会话录制。
- 供应商回调要求签名、时间戳、重放保护和去重。
- 供应商返回内容视为不可信数据，不能改变系统策略或调用权限。
- 适配器使用出站域名白名单、SSRF 防护、超时和响应大小限制。
- 模型供应商的数据区域、留存、训练使用和跨境传输必须在上线前单独审查。

### 10.5 审计与留存

审计日志独立于业务事件，至少记录：

~~~text
actor
action
resource
mandate_version
grant_ref
policy_result
result
reason
request_id
correlation_id
occurred_at
~~~

用户可以查看“谁、在什么时间、为哪个订单、向哪个供应商释放了哪些字段”。建议明文请求生命周期结束即清理；一次性 Grant 5 分钟/一次使用；长期加密旅客资料由用户控制删除，未使用资料默认 24 个月清理。具体留存期限、删除流程和自动化决策影响评估在上线前按适用法律和业务合同复核。

合规基线：涉及旅客身份、联系方式和证件信息的处理，应按适用的中国个人信息保护、网络安全和数据安全要求完成目的限定、最小必要、单独授权、影响评估、删除/留存和安全事件响应审查。本文档不是法律意见；上线前必须由具备相应职责的合规或法务人员确认实际供应商、云区域和数据传输方案。

## 11. 错误补偿与恢复

| 情况 | 系统行为 |
| --- | --- |
| Vault/KMS 不可用 | fail closed，不释放敏感字段 |
| Grant 过期 | 停止调用，请求重新授权 |
| 供应商创建超时 | 进入 creation_unknown，查询/对账，不盲目重试 |
| 支付回调无可验证凭证 | 不标记 paid，进入 payment_unknown |
| 重复或乱序 Webhook | 签名校验、去重、按版本处理 |
| 已支付但未出票/确认 | 保留 paid，创建 ReconciliationRequired |
| 取消结果未知 | 进入 manual_review 或 reconciliation |
| 部分项目成功 | 保留成功项目，失败项目单独处理 |
| Mandate 在提交前撤销 | 阻断外部调用 |
| Worker 崩溃 | 任务租约超时后安全重新领取 |
| SSE 断线 | 客户端用 Last-Event-ID 回放 |

所有未知状态必须最终进入已匹配、已解决或人工处理，不得静默丢失。

## 12. 可观测性

### 12.1 关联链

统一传递：

~~~text
request_id
  -> correlation_id
  -> AgentRun
  -> ToolCall
  -> ActionRequest
  -> BookingIntent
  -> SupplierOrder
  -> Webhook/Reconciliation
~~~

### 12.2 指标

- API、Agent、供应商请求延迟和错误率。
- 搜索首个结果和完整结果时间。
- revalidate 失败、价格变化和库存变化率。
- 订单成功、失败、未知和人工处理数量。
- 对账积压量、最大等待时间和供应商回调延迟。
- Worker 队列、Outbox、Webhook 重试。
- 工具错误、用户干预次数、模型 Token 和成本。

日志、Trace、指标只允许脱敏 ID、哈希或引用，禁止记录姓名、证件号、手机号、支付凭证和完整供应商敏感响应。

## 13. 测试与验收

### 13.1 测试层级

- 领域单元测试：预算、时间、状态机、Mandate、Grant。
- 属性测试：预算守恒、状态迁移不可逆越权、幂等重复执行。
- API 契约测试：OpenAPI、错误结构、版本、幂等和并发。
- Adapter 契约测试：每个供应商适配器遵守统一接口。
- 集成测试：PostgreSQL、Outbox/Inbox、任务租约、Webhook、SSE 回放。
- Agent Eval：工具选择、最小追问、结构化输出、越权拒绝、提示注入。
- E2E：匿名规划至 Mock 预订、刷新恢复和部分成功。
- 安全测试：认证、CSRF、SSRF、重放、密钥泄露和日志扫描。

### 13.2 必测故障

报价过期、库存丢失、价格/退改变化、并发 commit、相同幂等键不同请求、供应商创建超时、重复/乱序回调、支付成功但未出票、部分成功、Vault/KMS 不可用、Mandate 撤销、SSE 断线、Worker 崩溃和供应商提示注入。

### 13.3 V1 验收条件

1. 匿名用户可创建中国大陆 Trip 并获得脱敏搜索结果。
2. 交通、住宿、景点、餐馆搜索可以并行执行并展示来源和更新时间。
3. 排序模式可解释，用户能看到价格、时长、换乘、位置、评分和退改因素。
4. 总预算和分类预算正确计算，80% 警告、超过 100% 阻断和明确覆盖均可追踪。
5. 直接时间冲突被阻断，软性交通/节奏问题只产生警告。
6. 登录后可维护最多 6 个旅客档案，敏感字段不进入 Agent、日志或 SSE。
7. 逐单决策或受限 Mandate 可触发 API 待支付订单或供应商跳转。
8. 重试、并发和 Worker 重启不会产生重复供应商订单。
9. 未知结果不会被显示为成功，且能够进入查询/对账/人工处理。
10. 用户能查看行程、预算、订单、授权和审计记录。

发布门槛：

~~~text
重复供应商订单：0
敏感字段泄露扫描：0
非法状态迁移：全部拒绝
未知订单：全部进入对账或人工队列
Mandate 范围外高风险执行：0
~~~

## 14. Web 产品与代码组织

### 14.1 交互基线

桌面端采用“Agent 执行区 + 结构化行程区”双栏布局；移动端采用行程、搜索、预算、订单、设置底部导航。每个外部副作用动作必须有可见的供应商、价格快照、退改、数据字段和当前状态。

界面展示执行摘要，不展示模型思维链：

~~~text
正在做什么
使用了哪些能力和数据源
结果和更新时间
风险/假设
需要用户决定什么
~~~

### 14.2 技术基线

~~~text
Web: React + TypeScript + Vite + React Router + TanStack Query
API: Node.js + TypeScript + NestJS/Fastify + OpenAPI + SSE
Worker: Node.js + TypeScript + PostgreSQL 持久化任务
Vault: 独立 Node.js 运行单元 + 独立数据权限 + KMS/HSM 接口
Data: PostgreSQL；Kysely 或 Drizzle；Redis 不作为事实来源
Tests: Vitest、Playwright、契约测试和安全扫描
~~~

具体 ORM、认证供应商和云厂商在 P0 实施计划中根据团队约束确定，但不得改变本文档中的数据边界和状态语义。

### 14.3 Monorepo

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
  ui/
  testkit/
~~~

## 15. 分阶段交付

### P0：基础骨架

Monorepo、Web/API/Worker/Vault 运行单元、PostgreSQL、OpenAPI、Trip 基础模型、任务租约、Outbox/Inbox、Mock Supplier、健康检查和基础可观测性。

### P1：搜索与规划

Agent 意图解析、最小追问、四类并行搜索、报价标准化、解释性排序、行程草案、预算和时间检查、执行状态展示。

### P2：账户与隐私

登录、最多 6 个旅客、Vault、字段级加密、TravelerDataGrant、TravelMandate、ActionRequest、撤销和审计查看。

### P3：预订与支付跳转

revalidate、BookingIntent 状态机、commit、API 待支付订单、redirect、幂等/并发、creation_unknown 和 Mock 完整流程。

### P4：回调与售后

签名 Webhook、去重乱序处理、SupplierOrder 生命周期、对账、轮询补偿、SSE 恢复、取消/退款请求和部分成功。

### P5：生产灰度

第一家真实供应商 Sandbox、单类别灰度、隐私/安全/合规复核、KMS、备份恢复演练、告警和逐类别扩展。

每个阶段都必须交付可运行的纵向切片、自动化测试和回滚/恢复说明，而不是只交付孤立的基础设施。

## 16. 后续多 Agent 扩展

V1 只有一个逻辑 Travel Orchestrator。未来可以增加 Supervisor 和交通、住宿、景点、餐馆等 Specialist Agent，但必须继续通过 Capability Gateway，复用相同的领域对象、工具契约、ActionRequest、幂等记录、事件和状态所有权。

拆分前必须证明：

- 单 Agent 已出现明确的上下文、延迟或并行度瓶颈。
- Specialist 的输入输出可结构化。
- 领域状态不会被多个 Agent 直接写入。
- 权限、预算、隐私和审计仍由共享确定性层执行。

## 17. 设计评审清单

在规格批准前确认：

- 产品范围和“不做什么”是否准确。
- 默认逐单确认与受限 Mandate 的关系是否清楚。
- 供应商 API、redirect、支付和未知状态边界是否可执行。
- Vault、Grant、日志、SSE 和模型上下文是否没有敏感数据泄露路径。
- 预算、时间、订单生命周期和对账状态是否可测试。
- Web-first 与未来 Mobile 的 API 边界是否稳定。
- P0-P5 顺序和验收门槛是否符合实际资源。

规格批准后，下一步才是编写分阶段实施计划；计划会为每个阶段列出文件、数据库迁移、接口、测试和验证命令。
