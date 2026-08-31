export interface ReplayGuardOptions { maxAgeSeconds?: number; now?: () => Date; seen?: Set<string> }
export class ReplayGuard { private readonly maxAgeSeconds:number; private readonly now:()=>Date; private readonly seen:Set<string>; constructor(options:ReplayGuardOptions={}) { this.maxAgeSeconds=options.maxAgeSeconds??300; this.now=options.now??(()=>new Date()); this.seen=options.seen??new Set(); }
  assertFresh(eventId:string,timestampSeconds:number): void { if (!eventId || !Number.isSafeInteger(timestampSeconds)) throw new Error('invalid webhook timestamp'); const age=Math.abs(Math.floor(this.now().getTime()/1000)-timestampSeconds); if(age>this.maxAgeSeconds) throw new Error('stale webhook timestamp'); }
  accept(eventId:string,timestampSeconds:number): void { this.assertFresh(eventId,timestampSeconds); if(this.seen.has(eventId)) throw new Error('duplicate webhook signature'); this.seen.add(eventId); }
}
