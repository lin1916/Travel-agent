import { useEffect, useMemo, useRef, useState } from 'react';
import type { Place, RoutePlan } from '@travel/contracts';
import type { MapPublicConfig } from '../../lib/api-client';
import { loadAMap } from './amap-loader';

const categoryLabels: Record<string, string> = { attraction: '景点', dining: '餐饮', stay: '住宿', train: '交通', flight: '交通' };
export interface MapMarker { id: string; name: string; category: string; latitude: number; longitude: number }
export function buildMapMarkers(places: Array<Pick<Place, 'id' | 'name' | 'category' | 'latitude' | 'longitude'>>): MapMarker[] {
  return places.map(place => ({ ...place, category: categoryLabels[place.category] ?? place.category }));
}
export function destroyMapOnCleanup(map: { destroy: () => void }) { return () => map.destroy(); }

export function TravelMap({ publicConfig, places = [], selectedPlaceId, onSelect, route, routeUnavailableReason }: { publicConfig?: MapPublicConfig; places?: Array<Pick<Place, 'id' | 'name' | 'category' | 'latitude' | 'longitude'>>; selectedPlaceId?: string; onSelect?: (id: string) => void; route?: RoutePlan; routeUnavailableReason?: string }) {
  const container = useRef<HTMLDivElement>(null);
  const [mapError, setMapError] = useState<string>();
  const markers = useMemo(() => buildMapMarkers(places), [places]);
  useEffect(() => {
    if (!publicConfig?.jsKey || !container.current) return;
    let disposed = false;
    let map: any;
    void loadAMap(publicConfig).then(AMap => {
      if (disposed || !container.current) return;
      map = new AMap.Map(container.current, {
        viewMode: '3D',
        pitch: 28,
        zoom: 11,
        center: markers[0] ? [markers[0].longitude, markers[0].latitude] : [120.15, 30.24],
        mapStyle: 'amap://styles/normal',
      });
      markers.forEach(marker => { const item = new AMap.Marker({ position: [marker.longitude, marker.latitude], title: marker.name }); item.on('click', () => onSelect?.(marker.id)); item.setMap(map); });
      if (markers.length > 1) map.setFitView?.(undefined, false, [80, 360, 80, 80]);
    }).catch(error => { if (!disposed) setMapError(error instanceof Error ? error.message : '地图加载失败'); });
    return () => { disposed = true; if (map) destroyMapOnCleanup(map)(); };
  }, [publicConfig, markers, onSelect]);
  return <section className="map-panel section-block" aria-labelledby="map-title"><div className="section-heading"><h2 id="map-title">地图与位置</h2><span className="muted">点击地点查看详情</span></div>{publicConfig?.jsKey && !mapError ? <div className="travel-map-canvas" data-testid="travel-map" ref={container} aria-label="高德地图" /> : <div className="map-fallback" role="status">
    <div className="map-fallback__terrain" aria-hidden="true"><span className="map-fallback__water" /><span className="map-fallback__road map-fallback__road--one" /><span className="map-fallback__road map-fallback__road--two" /><span className="map-fallback__road map-fallback__road--three" /><span className="map-fallback__route" /><span className="map-fallback__marker map-fallback__marker--one">1</span><span className="map-fallback__marker map-fallback__marker--two">2</span><span className="map-fallback__marker map-fallback__marker--three">3</span><span className="map-fallback__marker map-fallback__marker--four">4</span></div>
    <div className="map-fallback__hud"><span className="map-fallback__badge">MAP PREVIEW</span><strong>地图暂不可用</strong><p>{mapError ?? (publicConfig ? '尚未配置公开地图密钥。列表仍可用，你可以继续调整行程。' : '地图服务尚未连接。列表仍可用，你可以继续调整行程。')}</p></div>
    <div className="map-fallback__legend" aria-hidden="true"><span><i className="map-fallback__legend-dot" />规划路线</span><span><i className="map-fallback__legend-pin" />候选地点</span></div>
  </div>}{routeUnavailableReason && <p className="warning-line" data-testid="route-unavailable">{routeUnavailableReason}</p>}{route?.status === 'unavailable' && <p className="warning-line" data-testid="route-unavailable">{route.reason}</p>}{markers.length > 0 && <ol className="map-place-list" aria-label="地点列表">{markers.map(marker => <li key={marker.id} className={selectedPlaceId === marker.id ? 'is-selected' : ''}><button type="button" onClick={() => onSelect?.(marker.id)}><span className="map-marker-dot" aria-hidden="true" /><span><strong>{marker.name}</strong><small>{marker.category} · {marker.latitude.toFixed(3)}, {marker.longitude.toFixed(3)}</small></span></button></li>)}</ol>}</section>;
}
