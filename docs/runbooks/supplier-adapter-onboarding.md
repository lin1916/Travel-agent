# Supplier Adapter 接入（Mock/Sandbox）

1. 建立供应商数据流清单，确认仅传输已授权字段，并完成法律与隐私评审。
2. 实现 `SupplierAdapter` 的 search、revalidate、createOrder、getOrder；取消与 webhook 按能力提供。
3. 适配器只做协议转换，不推进领域订单状态；所有副作用经 Capability Gateway。
4. 为请求设置独立幂等键、超时和未知结果查询路径，禁止超时后盲目重试。
5. 增加签名 webhook 的重复、乱序、重放测试，并验证敏感字段不会进入日志、队列、SSE 或 URL。
6. 在沙盒完成端到端回放、对账和故障演练后，才可提交生产变更评审。

