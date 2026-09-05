# Travel Agent 发布检查清单

## 发布前

- [ ] 仅启用 Mock/Sandbox supplier，确认生产配置没有真实下单凭据。
- [ ] 验证匿名用户仅可规划和比较；保存、旅客资料授权及预订必须经过登录与授权门禁。
- [ ] 运行 `pnpm security:scan-sensitive-output`，结果为 0 泄漏。
- [ ] 运行 `pnpm --filter @travel/api test:e2e`，确认 Conversation-first 消息幂等、匿名 Cookie、SSE 和共享 AgentRun 回归通过。
- [ ] 运行 `pnpm --filter @travel/persistence test:integration`；没有 `DATABASE_URL` 时确认集成测试明确标记为 skipped，而不是误报通过。
- [ ] 运行 `pnpm --filter @travel/web test:e2e`，确认桌面和移动端首屏无表单、无 Trip 地图搜索、候选管理和 Proposal 接受流程。
- [ ] 验证重复提交使用同一幂等键不会产生重复订单。
- [ ] 验证非法订单状态迁移被拒绝，未知供应商结果进入 reconciliation。
- [ ] 验证超出 TravelMandate 的高风险动作被阻止并产生审计事件。
- [ ] 验证预算达到 80% 发出告警，超过 100% 阻止；只有显式用户决策才可覆盖。
- [ ] 验证 BookingIntent 与 SupplierOrder 生命周期、版本号、策略快照、Grant/Mandate 绑定及重叠检查一致。
- [ ] 验证 API 下单与支付跳转边界均使用幂等键；重复提交不产生第二个 SupplierOrder。
- [ ] 验证 offer/inventory/Vault/KMS/Mandate 阻断和价格变化重新校验不会生成 confirmed/committed 订单。
- [ ] 检查 Vault/KMS、数据库和队列健康状态及告警。
- [ ] 运行本地 gated planning smoke：仅输出 `configured`/`missing`、模型名、延迟和高层结果；不得输出 `TRAVEL_LLM_API_KEY`、AMap key、Authorization header 或完整消息。

## 发布后

- [ ] 执行一次数据库备份恢复演练并记录恢复时间。
- [ ] 检查 webhook 重放、乱序与 SSE 断线恢复指标。
- [ ] 验证未知订单保持 `creation_unknown`/`pending`，在对账完成前绝不展示成功。
- [ ] 验证浏览器刷新及 Worker 重启从持久化版本恢复，而非依赖内存布尔标志。
- [ ] 完成供应商与法务的数据流审查（字段、用途、保留期限、跨境传输）。
- [ ] 确认审计日志可按 trip、run、correlation id 查询。
- [ ] 验证匿名 planning 数据默认七天到期，cleanup job 可重复执行且会级联删除聊天、计划、地点和路线。
