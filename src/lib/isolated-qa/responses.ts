import fixture from './fixture.json';

const originHeaders = {
  'Cache-Control': 'no-store',
  'X-Robots-Tag': 'noindex, nofollow',
  'X-EJIP-Data-Source': 'saved-public-response',
};

export function isolatedQaResponse(method: string, url: URL): Response | null {
  let path: string;
  try {
    path = decodeURIComponent(url.pathname);
  } catch {
    return new Response(null, { status: 400, headers: originHeaders });
  }

  if (method !== 'GET' && method !== 'HEAD') {
    return Response.json({ error: 'QA_WRITE_DISABLED' }, { status: 405, headers: originHeaders });
  }

  if (path === '/api/auth/session') {
    return Response.json({}, { headers: originHeaders });
  }

  const { searchParams: params } = url;
  if (path === '/api/apt/광안자이'
      && params.get('lawdCd') === '26500'
      && params.get('dong') === '광안동'
      && params.get('type') === 'apt'
      && ['12', '36'].includes(params.get('period') ?? '')) {
    return Response.json({
      ...fixture.detail,
      // The archived response covers 36 months. The existing timeline applies its 1-year filter.
      coordinate: { status: 'RESOLVED', lat: fixture.marker.lat, lng: fixture.marker.lng },
      qaCapturedAt: fixture.detailCapturedAt,
    }, { headers: originHeaders });
  }

  if (path === '/api/transactions'
      && params.get('lawdCd') === '26500'
      && params.get('type') === 'apt'
      && params.get('months') === '12'
      && params.get('fields') === 'marker') {
    return Response.json({
      transactions: [fixture.marker],
      partial: true,
      qaCapturedAt: fixture.markerCapturedAt,
    }, { headers: originHeaders });
  }

  if (path === '/api/search' && (params.get('q') ?? '').trim() === '광안자이') {
    return Response.json(fixture.search, { headers: originHeaders });
  }

  if (path === '/api' || path.startsWith('/api/')) {
    return Response.json({ error: 'QA_RESPONSE_UNAVAILABLE' }, { status: 503, headers: originHeaders });
  }

  if (path === '/map' || path === '/apt/광안자이' || path.startsWith('/_next/static/')
      || path.startsWith('/brand/') || path === '/favicon.ico') return null;

  if (path === '/') {
    return new Response(null, {
      status: 307,
      headers: { ...originHeaders, Location: new URL('/map?lawdCd=26500', url).href },
    });
  }

  return new Response(null, { status: 404, headers: originHeaders });
}
