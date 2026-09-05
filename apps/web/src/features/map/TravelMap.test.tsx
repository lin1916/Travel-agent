import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { TravelMap, buildMapMarkers, destroyMapOnCleanup } from './TravelMap';

describe('TravelMap', () => {
  it('renders an actionable fallback when the public map key is missing', () => {
    const html = renderToStaticMarkup(<TravelMap publicConfig={{ jsKey: '', proxyUrl: '/_AMapService' }} />);
    expect(html).toContain('地图暂不可用');
    expect(html).toContain('列表仍可用');
    expect(html).toContain('map-fallback__terrain');
    expect(html).toContain('map-fallback__route');
  });

  it('builds category markers and keeps route unavailable explicit', () => {
    const markers = buildMapMarkers([
      { id: 'p1', name: '西湖', category: 'attraction', latitude: 30.24, longitude: 120.15 },
    ]);
    expect(markers[0]).toMatchObject({ id: 'p1', category: '景点', latitude: 30.24, longitude: 120.15 });
    const html = renderToStaticMarkup(<TravelMap publicConfig={{ jsKey: '', proxyUrl: '/_AMapService' }} route={{ status: 'unavailable', reason: '暂无路线' } as any} />);
    expect(html).toContain('暂无路线');
  });

  it('destroys an initialized map when the component cleanup runs', () => {
    let destroyed = false;
    destroyMapOnCleanup({ destroy: () => { destroyed = true; } })();
    expect(destroyed).toBe(true);
  });
});
