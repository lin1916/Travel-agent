# 真实模型旅行规划工作台设计规格

状态：已批准并进入实施  
版本：1.0  
日期：2026-09-02  
范围：完整规划功能，不包含下单、支付或旅客证件处理

## 1. 目标

把现有以表单和文字卡片为主的规划演示升级为可实际使用的旅行规划 Agent。用户通过多轮对话表达目的地、日期、人数、预算和偏好，真实模型通过受限工具完成交通、住宿、景点、餐馆、地图路线、时间安排和预算优化，并把结果同步展示在聊天、地图与每日行程中。

产品运行路径只使用真实 Responses 模型。`RuleBasedProvider` 仅允许用于自动化测试，不能成为开发或生产环境的用户可选模式，也不能在真实模型失败时静默接管同一次 AgentRun。

## 2. 明确边界

本阶段包含：

- 真实第三方 OpenAI-compatible Responses API。
- 聊天优先、表单辅助的响应式 Web。
- 交通、住宿、景点和餐馆的搜索、比较与解释。
- 高德地图、地点搜索、地理编码和步行/公交/驾车路线规划。
- 行程草案自动修改、版本记录、撤销和恢复。
- 时间冲突检查、路线耗时、行程节奏提醒。
- 总预算及交通、住宿、景点、餐饮分类预算。
- 匿名会话、7 天自动清理和立即删除。

本阶段不包含：

- 创建 BookingIntent 或 SupplierOrder 的用户入口。
- 真实下单、供应商跳转、支付、退款或售后。
- 姓名、证件、银行卡、旅客资料收集。
- 模型自动访问任意 URL、数据库、地图密钥或供应商 API。

## 3. 用户体验

### 3.1 首屏

首屏直接展示 Agent 对话，而不是要求用户先完成完整表单。Agent 从自然语言中提取目的地、出发日期、返程日期、人数、预算和偏好，只追问阻塞规划的必要字段。结构化条件在侧边抽屉中展示并允许精确修改。

### 3.2 桌面布局

~~~text
┌────────────────┬────────────────────────┬────────────────┐
│ Agent 聊天     │ 交互式地图             │ 每日行程/预算  │
│ 消息与方案卡片 │ POI、路线、选中项联动  │ 时间线与提醒   │
└────────────────┴────────────────────────┴────────────────┘
~~~

移动端使用“聊天 / 地图 / 行程”三个主标签，并保持输入框可访问。

### 3.3 草案修改

Agent 可以自动修改无外部副作用的规划草案。每次修改必须生成 `PlanVersion` 和变更摘要，用户可以撤销。用户锁定的行程项不得被 Agent 自动移动或删除；删除整日内容、突破预算等明显变化需要在聊天中明确说明。

## 4. 真实模型接入

新增 `ThirdPartyResponsesProvider` 实现现有 `LlmProvider`：

~~~text
Conversation Service
  -> ThirdPartyResponsesProvider
  -> 第三方 Responses API
  -> StructuredAgentOutput
  -> PlanningOrchestrator
  -> Capability Gateway
~~~

服务端配置：

~~~text
TRAVEL_LLM_BASE_URL=https://apizh-ai.com
TRAVEL_LLM_RESPONSES_PATH=/responses
TRAVEL_LLM_API_KEY=<server-only>
TRAVEL_LLM_MODEL=gpt-5.5
TRAVEL_LLM_REASONING_EFFORT=xhigh
TRAVEL_LLM_STORE=false
~~~

具体 path 和鉴权头必须可由环境变量覆盖，因为供应商公开首页没有给出足以验证的请求示例。应用不能读取或复用 Codex 登录态。

每个请求显式设置 `store: false`，使用结构化输出并限制工具定义。模型只能根据工具结果陈述价格、地点、路线和可用性。模型超时或限流时，AgentRun 保持可恢复失败状态并允许用户重试；不能静默切换到规则模型。

## 5. Agent 工具和执行边界

首版规划工具：

~~~text
search_transport
search_stays
search_attractions
search_restaurants
geocode_place
plan_route
add_itinerary_item
move_itinerary_item
remove_itinerary_item
replace_itinerary_item
optimize_day
check_schedule
calculate_budget
undo_plan_change
~~~

所有工具调用必须经过 Capability Gateway。Gateway 注入当前匿名会话、Trip、AgentRun、请求关联 ID、Trip 版本和权限；领域服务再次验证参数、所有权、预算和时间规则。规划工具风险仅为 `read` 或 `prepare`，不注册 `commit`、`redirect` 或支付工具。

供应商文本、地图内容和模型输出全部视为不可信输入。它们只能作为结构化数据参与计算，不能成为运行时指令。

## 6. 地图与路线

Web 使用高德地图 JS API 2.0；NestJS 侧通过高德 Web Service 完成地点搜索、地理编码和路线规划。Web 与未来原生 App 复用领域契约，但地图渲染分别实现。

`Place` 至少包含：

~~~text
id, name, category, address, city,
latitude, longitude, coordinateSystem=gcj02,
provider=amap, providerPlaceId, sourceUpdatedAt
~~~

`RoutePlan` 至少包含：

~~~text
originPlaceId, destinationPlaceId, mode,
distanceMeters, durationMinutes, polyline,
estimatedCostCents, provider, updatedAt
~~~

地图展示交通、住宿、景点和餐馆分类标记、按天路线、交通耗时和选中项。卡片、聊天消息、地图标记和时间线必须双向联动。浏览器默认不请求用户位置；只有用户明确选择“从我的位置出发”时才申请定位权限。

凭据分别配置为：

~~~text
AMAP_JS_KEY
AMAP_JS_SECURITY_CODE
AMAP_WEB_SERVICE_KEY
~~~

安全密钥和 Web Service Key 只能在服务端使用。地图失败时保留聊天、列表、时间线和预算，并明确标注路线暂不可用。

## 7. 行程、时间与预算

行程修改必须通过命令执行，至少支持加入、移动、删除、替换、锁定、按日优化和撤销。每个成功命令产生一个新 `PlanVersion`；版本冲突返回明确冲突响应，不能覆盖更新。

时间采用宽松规划策略：使用建议时间段和预计停留时长，阻止直接重叠；交通缓冲、机场或车站提前量、排队和过密节奏生成软提醒。用户锁定项是硬约束。

预算在每次规划变更后重新计算，区分总预算与分类预算、单人价格与整组价格。不确定价格使用区间。80% 产生提醒，超过 100% 产生显著警告；本阶段只展示 `estimated`，不展示预留、承诺、支付或退款状态。

## 8. 会话、隐私与存储

匿名身份由服务端通过 HttpOnly、SameSite Cookie 签发，不再信任浏览器生成的 `x-actor-id`。浏览器只保存 UI 偏好和不敏感的临时导航状态，完整聊天与规划从服务端恢复。

新增持久化概念：

~~~text
anonymous_sessions
agent_conversations
agent_messages
plan_versions
plan_change_sets
places
route_plans
~~~

匿名数据默认保留 7 天，到期自动清理；用户可以立即删除。规划阶段不要求敏感旅客资料。日志、指标和事件只能记录脱敏摘要、模型、工具名、耗时和关联 ID，不记录 API Key 或完整消息正文。

发送给第三方模型的上下文只包含完成规划所需的数据。UI 必须说明输入由第三方模型处理；`store: false` 是请求约束，不宣称能够替第三方保证其内部留存政策。

## 9. API 与事件

首版新增或扩展：

~~~text
POST   /v1/conversations
GET    /v1/conversations/{id}
POST   /v1/conversations/{id}/messages
GET    /v1/conversations/{id}/events
DELETE /v1/conversations/{id}

GET    /v1/trips/{tripId}/places
POST   /v1/trips/{tripId}/routes
GET    /v1/trips/{tripId}/plans/current
POST   /v1/trips/{tripId}/plans/commands
POST   /v1/trips/{tripId}/plans/undo
~~~

SSE 事件至少包含聊天增量、模型状态、工具调用状态、方案更新、地图更新、PlanVersion 更新、预算更新和可恢复错误。事件保留现有 `event_id`、序列、schema version、request ID、correlation ID 和 `Last-Event-ID` 恢复语义。

## 10. 错误恢复

- 模型超时或限流：保留当前计划，允许重试，不运行替代 Agent。
- 单类别搜索失败：其他类别继续，失败类别显示来源和重试。
- 地图或路线失败：保留文字计划，不编造距离和时间。
- SSE 断线：按最后事件 ID 恢复。
- Trip 或 PlanVersion 冲突：返回 409 并重新加载最新版本。
- API 重启：PostgreSQL 环境从持久化恢复；无数据库的开发环境不得宣称具备重启恢复。
- 删除会话：清除聊天、计划、地点和路线，仅保留无用户内容的聚合指标。

## 11. 测试与验收

普通自动化测试使用不可见的确定性模型传输和地图适配器，不消耗真实额度；这不构成产品 Sandbox Agent。真实模型和真实地图只在显式开启的人工或受控冒烟测试中调用。

验收场景：

1. 用户输入“计划 2026 年 10 月 1 日到 10 月 4 日去杭州，2 人，预算 5000 元”。
2. 真实模型只追问必要信息，并调用受限搜索工具。
3. 页面显示交通、住宿、景点和餐馆方案及来源。
4. 地图显示地点和每日路线。
5. Agent 生成包含交通时间、软提醒和预算的行程草案。
6. 用户要求第二天轻松一点并把酒店控制在每晚 600 元内。
7. Agent 自动产生新 PlanVersion，更新地图、时间线和预算，并提供撤销。
8. 刷新页面后恢复当前会话和计划。
9. 删除后相关数据不可恢复。
10. 全流程不出现下单、支付或证件入口。

质量门槛包括单元测试、契约测试、API 集成测试、桌面与移动 Playwright、敏感输出扫描、类型检查、Lint 和构建。真实接口测试必须通过环境变量显式开启，不能进入普通 CI。
