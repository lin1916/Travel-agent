export interface Counter { inc(value?: number, labels?: Record<string,string>): void; value(labels?: Record<string,string>): number }
export interface Histogram { observe(value: number, labels?: Record<string,string>): void; values(labels?: Record<string,string>): number[] }
export interface TravelMetrics {
  httpRequests: Counter;
  supplierErrors: Counter;
  unknownOrders: Counter;
  interventions: Counter;
  webhookEvents: Counter;
  auditAppends: Counter;
  modelCost: Histogram;
  supplierLatency: Histogram;
  queueAge: Histogram;
}
function key(labels?: Record<string,string>): string { return JSON.stringify(labels ?? {}); }
export class MetricsRegistry { private counters = new Map<string,Map<string,number>>(); private histograms = new Map<string,Map<string,number[]>>(); counter(name:string): Counter { const map=this.counters.get(name) ?? new Map(); this.counters.set(name,map); return { inc:(v=1,l) => map.set(key(l),(map.get(key(l))??0)+v), value:l => map.get(key(l))??0 }; } histogram(name:string): Histogram { const map=this.histograms.get(name) ?? new Map(); this.histograms.set(name,map); return { observe:(v,l) => map.set(key(l),[...(map.get(key(l))??[]),v]), values:l => map.get(key(l))??[] }; } snapshot(){ return { counters:Object.fromEntries([...this.counters].map(([n,m])=>[n,Object.fromEntries(m)])), histograms:Object.fromEntries([...this.histograms].map(([n,m])=>[n,Object.fromEntries([...m].map(([k,v])=>[k,v]))])) }; } }
export const metrics = new MetricsRegistry();
export function createTravelMetrics(registry: MetricsRegistry = metrics): TravelMetrics {
  return {
    httpRequests: registry.counter('http_requests_total'),
    supplierErrors: registry.counter('supplier_errors_total'),
    unknownOrders: registry.counter('unknown_orders_total'),
    interventions: registry.counter('interventions_total'),
    webhookEvents: registry.counter('webhook_events_total'),
    auditAppends: registry.counter('audit_appends_total'),
    modelCost: registry.histogram('model_cost_cents'),
    supplierLatency: registry.histogram('supplier_latency_ms'),
    queueAge: registry.histogram('queue_age_ms'),
  };
}
export const travelMetrics = createTravelMetrics();
