# Travel Agent 发布检查清单

## 发布前

- [ ] 仅启用 Mock/Sandbox supplier，确认生产配置没有真实下单凭据。
- [ ] 验证匿名用户仅可规划和比较；保存、旅客资料授权及预订必须经过登录与授权门禁。
- [ ] 运行 `pnpm security:scan-sensitive-output`，结果为 0 泄漏。
- [ ] 验证重复提交使用同一幂等键不会产生重复订单。
- [ ] 验证非法订单状态迁移被拒绝，未知供应商结果进入 reconciliation。
- [ ] 验证超出 TravelMandate 的高风险动作被阻止并产生审计事件。
- [ ] 检查 Vault/KMS、数据库和队列健康状态及告警。

## 发布后

- [ ] 执行一次数据库备份恢复演练并记录恢复时间。
- [ ] 检查 webhook 重放、乱序与 SSE 断线恢复指标。
- [ ] 完成供应商与法务的数据流审查（字段、用途、保留期限、跨境传输）。
- [ ] 确认审计日志可按 trip、run、correlation id 查询。
