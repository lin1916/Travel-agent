# Travel Agent · 旅行规划助手

版本：**v0.1.0-alpha.1** · 2026-09-05 · 开发预览版

一个以对话为入口的旅行规划 Web 应用。用户通过聊天说明目的地、日期、人数、预算与偏好；真实模型通过受限工具查询地点、整理提案，用户接受后才生成正式行程和预算。

> 本版本面向中国大陆旅行规划，不是生产级预订平台。当前试用流程不下单、不支付。路线计算、完整数据库恢复及生产安全加固仍在继续，详见[版本说明](docs/releases/v0.1.0-alpha.1.md)。

> 检查状态：核心规划场景已有真实联调及定向回归证据，但全仓库 API 测试尚未全绿。此标签用于保存当前开发快照，不是“已通过全部测试”的稳定发布。

## 可以做什么

- 连续多轮真实 Agent 对话：使用已发布的 Pi npm 包和配置的 Responses 兼容模型服务，不需要克隆 Pi 源码。
- 从聊天中提取旅行条件，并通过条件标签回到聊天继续修改。
- 不创建 Trip 也能搜索高德地点、保存候选地点。
- Agent 推荐地点需用户同意才进入候选；接受提案后生成正式行程。
- 查看行程时间线、分类预算、总费用和人均费用，支持版本化撤销。
- 展示工具执行进度和简短规划理由，不展示模型内部完整思维链。
- 匿名 Cookie 会话、CSRF 保护、SSE 事件恢复、敏感文本脱敏。

模型服务和地图服务是真实外部服务；仓库内的单元测试、浏览器测试及旧供应商预订适配器含明确的测试替身。**测试通过不代表真实票价、余量或订单可用。**

## 技术栈与架构

| 层 | 技术 | 职责 |
| --- | --- | --- |
| Web | React 19、TypeScript、Vite 6、CSS | 聊天、地图、候选、提案、行程与预算 |
| API | NestJS 11、Fastify 5 | HTTP 接口、匿名会话、SSE、模块装配 |
| Agent Runtime | Pi Agent Core / Pi AI 0.84.4、Responses 兼容 API | 多轮对话、原生工具调用、结构化提案 |
| Capability Gateway | TypeScript 白名单能力网关 | 受限工具调用、可信上下文与策略边界 |
| 领域与应用服务 | TypeScript、Zod | 条件提取协调、提案接受、时间与预算校验 |
| 存储 | PostgreSQL 16、Kysely；本地内存模式 | 会话、候选、计划版本、事件与事务 |
| 地图 | 高德 JS API、Web Service API | 地图底图、地点检索、路线适配 |
| 工程化 | pnpm workspace、Turborepo、Vitest、Playwright、ESLint | 构建、测试、质量检查 |

```text
响应式 Web / 未来 Mobile
          │ HTTP + SSE
       API / BFF
          │
   Agent Runtime（Pi + 真实模型）
          │ 受限工具调用
   Capability Gateway
          │
   应用服务 / 确定性领域规则
          │
   高德 / 供应商适配器 / PostgreSQL
```

Web-first、API-first，当前采用模块化单体与独立包边界，并非每个模块都是独立微服务。Agent 不直接控制数据库或绕过服务修改正式计划。仓库中的保险箱、授权、预订、审计等属于更大项目的基础模块，不表示本预览版已经开放真实交易。

## 环境要求

- 推荐 Node.js **24 LTS**（本地验证为 24.19.0）；Pi 最低要求 22.19.0，pnpm 11 建议配套 Node 24。
- pnpm **11.19.0**，与根目录 `packageManager` 及 CI 保持一致。
- 可用的 Responses 兼容模型接口和 API Key。
- 高德 JavaScript API Key、安全密钥，以及独立的 Web Service Key。
- PostgreSQL 16 为持久化模式所需；先试用规划功能可不安装数据库。

## 快速启动：先跑通网页

### 1. 下载与安装

```bash
git clone https://github.com/lin1916/Travel-agent.git
cd Travel-agent
git switch --detach v0.1.0-alpha.1
npm install --global pnpm@11.19.0
pnpm install --frozen-lockfile
```

标签用于复现这个版本；如需继续开发，可从标签创建自己的分支。若想获取后续更新，使用仓库默认分支 `codex/travel-agent-implementation`。

### 2. 配置根目录 .env

仅在 `.env` 不存在时复制示例，**不要覆盖已有密钥文件**：

```powershell
# Windows PowerShell，在仓库根目录执行
if (-not (Test-Path -LiteralPath '.env')) {
  Copy-Item -LiteralPath '.env.example' -Destination '.env'
}
```

macOS / Linux 可用 `test -f .env || cp .env.example .env`。然后用编辑器修改 `.env`：

```dotenv
NODE_ENV=development
API_PORT=3000
TRAVEL_AGENT_RUNTIME=pi
TRAVEL_AGENT_TEST_PROVIDER=
TRAVEL_LLM_BASE_URL=https://apizh-ai.com
TRAVEL_LLM_RESPONSES_PATH=/responses
TRAVEL_LLM_MODEL=gpt-5.5
TRAVEL_LLM_API_KEY=填写你自己的模型密钥
AMAP_WEB_SERVICE_KEY=填写高德Web服务Key
AMAP_JS_KEY=填写高德JavaScript_API_Key
AMAP_JS_SECURITY_CODE=填写与JS_Key配套的安全密钥
```

这里的模型地址是当前适配的第三方服务示例，不是官方服务承诺；请确认该服务支持指定模型、Responses 格式和原生工具调用。调用可能计费。不要把真实姓名、证件、银行卡等资料用于开发演示；必要的脱敏后对话和旅行条件会发送给你配置的模型服务，地点查询会发送给高德。

高德 Key 类型不能混用。JS Key 是浏览器公开标识，浏览器能够看到它；请在高德控制台配置与实际访问地址匹配的域名限制和配额。模型 Key、Web Service Key、JS 安全密钥留在后端，不能写入 `VITE_*` 环境变量或前端源码。

**配置提示：**Pi 当前的 `thinkingLevel` 为 `off`，并未把 `TRAVEL_LLM_REASONING_EFFORT=xhigh` 自动映射到 Pi。页面上的执行过程来自事件和简短说明。当前 Pi 完整轮次的超时/工具次数上限仍待完善，不能把 `TRAVEL_LLM_TIMEOUT_MS` 当成整轮完成时限。

### 3. 构建

```bash
pnpm build
```

workspace 包使用构建产物互相引用。修改 `packages/*` 后需要重新构建相关包，再重启 API。

### 4. 启动 API（内存试用模式）

Windows PowerShell，仓库根目录：

```powershell
$env:NODE_ENV = 'development'
$env:LOCAL_PLANNING_MEMORY_MODE = 'true'
$env:DATABASE_URL = ' '
pnpm --filter @travel/api dev
```

单个空格是刻意设置的进程级覆盖值：它会覆盖 `.env` 内的数据库地址，并被本地模式检测按空值处理，不需要删除 `.env` 中原有数据库配置。

macOS / Linux：

```bash
NODE_ENV=development LOCAL_PLANNING_MEMORY_MODE=true DATABASE_URL=' ' pnpm --filter @travel/api dev
```

该模式只注册规划相关接口，不注册下单、支付、订单、保险箱等交易接口。它**依然调用真实模型和高德**；“内存”指数据存储方式，不是模拟 Agent。

### 5. 启动 Web

另开一个终端，在仓库根目录执行：

```bash
pnpm --filter @travel/web dev --host 127.0.0.1 --port 5173
```

打开 **http://127.0.0.1:5173/**。开发服务器将 `/api` 和 `/_AMapService` 转发给后端。不要混用 `localhost` 与 `127.0.0.1`，它们的 Cookie、浏览器存储及地图域名限制不同。

后端开发入口监听所有网卡，请仅在可信本机开发环境使用，不要直接暴露到公网。

## 网页使用流程

1. 直接聊天，例如：“我想 10 月初去杭州，先帮我看看适合怎么玩。”Agent 会追问缺失条件。
2. 补充年份、日期、人数、预算、出发地（如需要）、兴趣与节奏；每轮都走真实模型链路。
3. 随时用地图搜索地点，点击“加入候选”。没有 Trip 也可以保存。
4. 查看 Agent 的提案。可以接受单个推荐地点，或接受整份行程；没有提案时不会显示正式行程卡片。
5. 接受后查看时间线、总预算、人均预算与版本，继续聊天提出修改要求。

用于本地演示的虚构输入：

> 请规划 2026 年 10 月 1 日至 4 日杭州双人旅行，预算 5000 元，喜欢人文和本地餐馆，节奏宽松，只含杭州本地、不含往返大交通。请核实地点并给出行程提案，未核实价格明确标注估算，不需要预订。

时间用于辅助规划而非实时预约承诺。住宿区间可与白天活动并存；重叠住宿及真正重叠的活动/交通仍会被检查。提案由服务端设定 24 小时审阅有效期。

内存模式下，当前标签页刷新可恢复会话，**API 重启后数据丢失**。匿名会话不是账户系统，不承诺跨设备同步。“清空”会删除该会话数据，请谨慎操作。

## PostgreSQL 持久化模式

此模式已有实现与部分真实数据库测试，但尚未完成所有重启恢复、回滚和并发场景的发布验收。请用独立开发数据库，不要指向生产数据。

1. 准备 PostgreSQL 16；可用 `docker compose -f infra/compose.yaml up -d postgres` 启动本地开发实例。示例账户仅用于开发，不能用于公网。
2. 在 `.env` 设置自己的 `DATABASE_URL`，并设 `LOCAL_PLANNING_MEMORY_MODE=false`。
3. 清除当前 PowerShell 试用覆盖值：

   ```powershell
   Remove-Item Env:DATABASE_URL -ErrorAction SilentlyContinue
   Remove-Item Env:LOCAL_PLANNING_MEMORY_MODE -ErrorAction SilentlyContinue
   ```

4. 执行迁移并启动 API：

   ```powershell
   Push-Location packages/persistence
   node --env-file=../../.env --import tsx src/migrations/cli.ts
   Pop-Location
   pnpm --filter @travel/api dev
   ```

5. Web 启动方式不变。需要运行后台清理时，可在 `apps/worker` 目录执行 `node --env-file=../../.env --import tsx src/main.ts`。

正常模式会装配更广泛的后台模块，**不是已验收的真实预订入口**。本地试用优先使用上面的规划内存模式。数据库版本升级前请备份；不要通过回滚迁移来代替正式数据恢复方案。

## 开发检查

```bash
pnpm typecheck
pnpm lint
pnpm test
pnpm --filter @travel/web exec playwright install chromium
pnpm --filter @travel/web test:e2e
pnpm security:scan-sensitive-output
```

- 核心单元测试不需要真实模型 Key；持久化包的数据库测试缺少环境变量时会跳过。但部分旧 API 测试尚未适配隔离环境，会因数据库或依赖未配置而失败，当前不能承诺 `pnpm test` 全绿。
- Playwright 使用明确的 API fixture，验证界面行为，不证明模型/地图/数据库服务可用。
- `pnpm smoke:conversation-first` 会调用真实模型与高德，可能产生费用；当前脚本只检查两轮对话和提案读取，**尚不是严格的整条接受流程验收门禁**，必须检查输出中的 `proposal_created` 等结果。
- 不要给一般单元测试加载真实 `.env`；真实数据库测试仅应指向独立开发/测试数据库。

## 常见问题

| 现象 | 检查方式 |
| --- | --- |
| 页面打开但无法聊天 | API 是否启动；根目录 `.env` 是否存在；Pi 模式、Key、模型、接口路径是否正确；修改配置后重启 API |
| 地图不可用但列表能查 | JS Key 类型、安全密钥配套、域名限制、代理与高德脚本网络；不要仅凭底图失败判断 Web Service Key 错误 |
| 地点可查但路线失败 | 当前路线适配仍有已知限制，见版本说明，不表示地点检索也失效 |
| 回复很慢 | 真实模型可能多次调用工具；4 天提案在本地测试中可能需要数分钟，目前性能和整轮时限仍待优化 |
| 接受提案失败 | 检查提案是否过期、条件是否已修改、是否存在真实时间冲突；不要把错误当成已经保存成功 |
| 重启后会话不见 | 内存模式的预期行为；需要跨重启保存时使用数据库模式 |
| 找不到内部包或类型 | 先运行 `pnpm build`；确保 Node/pnpm 版本与锁文件一致 |

## 文档导航

- [本版本更新详情、验证证据与已知问题](docs/releases/v0.1.0-alpha.1.md)
- [更新日志](CHANGELOG.md)
- [总体架构设计报告](docs/architecture/travel-agent-architecture-report.md)（包含长期预订目标，不等于当前可用范围）
- [Conversation-first 设计规格](docs/superpowers/specs/2026-09-03-conversation-first-planning-design.md)
- [本地开发说明](docs/runbooks/local-development.md)
- [发布检查表](docs/runbooks/release-checklist.md)

## 安全与使用边界

`.env`、日志、Playwright 产物和本地调试材料不应提交。示例配置只保留占位符与本地开发默认值。发现疑似凭据泄漏时，先在供应商控制台撤销/轮换，不要把密钥粘贴进 Issue。现有脱敏和扫描不能替代正式隐私审计；在生产部署前还需要认证与授权复核、限流、持久化恢复验收、第三方数据处理审查及供应商生产接入。
