import { ApplicationError } from '@travel/application';
import type { Coordinate, MapProvider, Place, RoutePlan, RouteRequest } from '@travel/contracts';
import { assertOutboundUrl, isAllowedOutboundUrlResolved, supplierRequestOptions } from '@travel/security';

export interface MapHttpResponse {
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
}
export type MapHttpTransport = (url: string, init?: { signal?: AbortSignal }) => Promise<MapHttpResponse>;

interface AMapClientOptions {
  key?: string;
  baseUrl?: string;
  timeoutMs?: number;
  transport?: MapHttpTransport;
  allowlist?: readonly string[];
}

export interface AMapJsProxyOptions { securityCode?: string; transport?: MapHttpTransport; baseUrl?: string; allowlist?: readonly string[] }

function location(value: unknown): Coordinate {
  const [longitude, latitude] = String(value).split(',').map(Number);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) throw new Error('invalid provider coordinates');
  return { latitude, longitude, coordinateSystem: 'GCJ-02' };
}

export class AMapClient implements MapProvider {
  private readonly key: string;
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly transport: MapHttpTransport;
  private readonly allowlist: readonly string[];
  private readonly resolveDns: boolean;

  constructor(options: AMapClientOptions = {}) {
    this.key = options.key ?? process.env.AMAP_WEB_SERVICE_KEY ?? '';
    this.baseUrl = options.baseUrl ?? 'https://restapi.amap.com';
    this.timeoutMs = options.timeoutMs ?? 5000;
    this.transport = options.transport ?? (globalThis.fetch as unknown as MapHttpTransport);
    const configuredAllowlist = options.allowlist ?? (process.env.AMAP_ALLOWED_HOSTS ?? '').split(',').map(v => v.trim()).filter(Boolean);
    this.allowlist = configuredAllowlist.length > 0 ? configuredAllowlist : [new URL(this.baseUrl).hostname];
    this.resolveDns = !options.transport;
  }

  async searchPlaces(query: string): Promise<Place[]> {
    const body = await this.request('/v3/place/text', { keywords: query, offset: '20' });
    return Array.isArray(body.pois) ? body.pois.map((poi: any) => {
      if (![poi.id, poi.name, poi.type, poi.address, poi.cityname ?? poi.adname, poi.location].every(value => typeof value === 'string' && value.trim())) {
        throw new Error('provider returned malformed place');
      }
      const point = location(poi.location);
      return {
      id: String(poi.id),
      name: String(poi.name),
      category: poi.type,
      address: poi.address,
      city: poi.cityname ?? poi.adname,
      latitude: point.latitude,
      longitude: point.longitude,
      location: point,
      coordinateSystem: 'gcj02' as const,
      provider: 'amap' as const,
      providerPlaceId: String(poi.id),
      sourceUpdatedAt: new Date().toISOString(),
    };
    }) : [];
  }

  async geocode(address: string): Promise<Coordinate> {
    const body = await this.request('/v3/geocode/geo', { address });
    const first = Array.isArray(body.geocodes) ? body.geocodes[0] : undefined;
    if (!first?.location) throw new Error('provider returned no geocode');
    return location(first.location);
  }

  async planRoute(request: RouteRequest): Promise<RoutePlan> {
    const path = request.mode === 'walk'
      ? '/v5/direction/walking'
      : request.mode === 'transit'
        ? '/v5/direction/transit/integrated'
        : '/v5/direction/driving';
    const body = await this.request(path, {
      origin: `${request.origin.longitude},${request.origin.latitude}`,
      destination: `${request.destination.longitude},${request.destination.latitude}`,
    });
    const route = body.route as any;
    const first = request.mode === 'transit' ? route?.transits?.[0] : route?.paths?.[0];
    const base = {
      originPlaceId: request.originPlaceId ?? `${request.origin.longitude},${request.origin.latitude}`,
      destinationPlaceId: request.destinationPlaceId ?? `${request.destination.longitude},${request.destination.latitude}`,
      mode: request.mode, origin: request.origin, destination: request.destination,
      provider: 'amap' as const, updatedAt: new Date().toISOString(),
    };
    if (!first) return { ...base, status: 'unavailable', reason: 'no route is available' };
    const distanceRaw = first.distance ?? route.distance;
    const durationRaw = first.duration ?? route.duration;
    const validMetric = (value: unknown): value is string | number =>
      (typeof value === 'number' && Number.isFinite(value))
      || (typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value)));
    const distanceMeters = validMetric(distanceRaw) ? Number(distanceRaw) : Number.NaN;
    const durationMinutes = validMetric(durationRaw) ? Number(durationRaw) / 60 : Number.NaN;
    if (!Number.isFinite(distanceMeters) || !Number.isFinite(durationMinutes)) {
      return { ...base, status: 'unavailable', reason: 'provider returned an incomplete route' };
    }
    return { ...base, status: 'available', distanceMeters, durationMinutes, polyline: typeof first.polyline === 'string' ? first.polyline : null, estimatedCostCents: null };
  }

  private async request(path: string, params: Record<string, string>): Promise<any> {
    if (!this.key) throw new ApplicationError('supplier_unavailable', 'AMap map provider is not configured');
    const url = assertOutboundUrl(new URL(path, this.baseUrl).toString(), this.allowlist);
    url.search = new URLSearchParams({ ...params, key: this.key, output: 'JSON' }).toString();
    if (this.resolveDns && !(await isAllowedOutboundUrlResolved(url.toString(), this.allowlist))) throw new ApplicationError('supplier_unavailable', 'map provider URL is not allowed');
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), supplierRequestOptions(this.timeoutMs).timeoutMs);
    try {
      const response = await this.transport(url.toString(), { signal: controller.signal });
      if (!response.ok) throw new Error(`provider HTTP ${response.status}`);
      const body = await response.json() as any;
      if (body?.status !== '1') throw new Error('provider rejected map request');
      return body;
    } catch (error) {
      if (error instanceof ApplicationError) throw error;
      throw new ApplicationError('supplier_unavailable', error instanceof Error ? error.message : 'map provider request failed');
    } finally {
      clearTimeout(timer);
    }
  }
}

export class AMapJsProxy {
  private readonly securityCode: string;
  private readonly baseUrl: string;
  private readonly transport: MapHttpTransport;
  private readonly allowlist: readonly string[];
  private readonly timeoutMs: number;
  private readonly resolveDns: boolean;

  constructor(options: AMapJsProxyOptions = {}) {
    this.securityCode = options.securityCode ?? process.env.AMAP_JS_SECURITY_CODE ?? '';
    this.baseUrl = options.baseUrl ?? 'https://webapi.amap.com';
    this.transport = options.transport ?? (globalThis.fetch as unknown as MapHttpTransport);
    this.timeoutMs = 5000;
    const configuredAllowlist = options.allowlist ?? (process.env.AMAP_ALLOWED_HOSTS ?? '').split(',').map(v => v.trim()).filter(Boolean);
    this.allowlist = configuredAllowlist.length > 0 ? configuredAllowlist : [new URL(this.baseUrl).hostname];
    this.resolveDns = !options.transport;
  }

  async forward(path: string, query: Record<string, string | undefined>): Promise<MapHttpResponse> {
    if (!this.securityCode) throw new ApplicationError('supplier_unavailable', 'AMap JavaScript proxy is not configured');
    let url: URL;
    try { url = assertOutboundUrl(new URL(path.replace(/^\/+/, '/'), this.baseUrl).toString(), this.allowlist); }
    catch { throw new ApplicationError('supplier_unavailable', 'map provider URL is not allowed'); }
    url.search = new URLSearchParams({ ...query, jscode: this.securityCode } as Record<string, string>).toString();
    if (this.resolveDns && !(await isAllowedOutboundUrlResolved(url.toString(), this.allowlist))) throw new ApplicationError('supplier_unavailable', 'map provider URL is not allowed');
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), supplierRequestOptions(this.timeoutMs).timeoutMs);
    try { return await this.transport(url.toString(), { signal: controller.signal }); }
    catch { throw new ApplicationError('supplier_unavailable', 'map provider request failed'); }
    finally { clearTimeout(timer); }
  }
}
