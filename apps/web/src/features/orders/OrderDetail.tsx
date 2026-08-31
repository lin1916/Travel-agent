import type { OrderListItem } from './OrderList';
export function OrderDetail({ order }: { order: OrderListItem }) { return <article className="section-block"><h3>订单 {order.id}</h3><p>{order.supplierId} · {order.lifecycleStatus}</p>{order.requiredUserAction && <p className="warning-line">需要操作：{order.requiredUserAction}</p>}</article>; }
