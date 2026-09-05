/**
 * Bounded process-local defense in depth only. Production duplicate/replay
 * authority is the durable webhook_receipts unique key in WebhookRepository.
 */
export interface ReplayGuardOptions { maxAgeSeconds?: number; now?: () => Date; seen?: Set<string>; maxEntries?: number }
export class ReplayGuard { private readonly maxAgeSeconds:number; private readonly now:()=>Date; private readonly seen:Map<string,number>; private readonly maxEntries:number; constructor(options:ReplayGuardOptions={}) { this.maxAgeSeconds=options.maxAgeSeconds??300; this.now=options.now??(()=>new Date()); this.maxEntries=options.maxEntries??10_000; this.seen=new Map(Array.from(options.seen ?? [], key => [key, 0])); }
  private prune(now:number): void { for (const [key, expires] of this.seen) if (expires && expires <= now) this.seen.delete(key); while (this.seen.size >= this.maxEntries) { const first=this.seen.keys().next().value as string | undefined; if (!first) break; this.seen.delete(first); } }
  assertFresh(eventId:string,timestampSeconds:number): void { if (!eventId || !Number.isSafeInteger(timestampSeconds)) throw new Error('invalid webhook timestamp'); const now=Math.floor(this.now().getTime()/1000); this.prune(now); const age=Math.abs(now-timestampSeconds); if(age>this.maxAgeSeconds) throw new Error('stale webhook timestamp'); }
  accept(eventId:string,timestampSeconds:number): void { this.assertFresh(eventId,timestampSeconds); if(this.seen.has(eventId)) throw new Error('duplicate webhook signature'); this.seen.set(eventId, Math.floor(this.now().getTime()/1000)+this.maxAgeSeconds); }
}
