import { json, fetchWithTimeout, UA } from '../_lib.js';

const cacheKey = (lat, lon, unit) => `w:${lat.toFixed(2)}:${lon.toFixed(2)}:${unit}`;

const geocode = async (q) => {
  const url = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(q)}&count=6&language=zh&format=json`;
  const res = await fetchWithTimeout(url, { headers: { 'User-Agent': UA } }, 6000);
  if (!res.ok) return [];
  const data = await res.json();
  return (data?.results || []).map((r) => ({
    name: r.name,
    region: [r.admin1, r.country].filter(Boolean).join(' · '),
    lat: r.latitude,
    lon: r.longitude,
  }));
};

const forecast = async (lat, lon, unit, name) => {
  const unitParam = unit === 'f' ? 'fahrenheit' : 'celsius';
  const url =
    `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}` +
    '&current=temperature_2m,relative_humidity_2m,apparent_temperature,is_day,weather_code,wind_speed_10m' +
    `&daily=temperature_2m_max,temperature_2m_min&timezone=auto&forecast_days=1&temperature_unit=${unitParam}`;
  const res = await fetchWithTimeout(url, { headers: { 'User-Agent': UA } }, 6000);
  if (!res.ok) throw new Error(`upstream ${res.status}`);
  const d = await res.json();
  const c = d?.current || {};
  const daily = d?.daily || {};
  return {
    name: name || '当前位置',
    lat,
    lon,
    unit,
    temp: Math.round(c.temperature_2m),
    feels: Math.round(c.apparent_temperature),
    humidity: c.relative_humidity_2m,
    wind: Math.round(c.wind_speed_10m),
    code: c.weather_code,
    isDay: c.is_day === 1,
    max: Math.round(daily.temperature_2m_max?.[0] ?? c.temperature_2m),
    min: Math.round(daily.temperature_2m_min?.[0] ?? c.temperature_2m),
    updated: Date.now(),
  };
};

export const onRequest = async ({ request, env }) => {
  const url = new URL(request.url);

  // 城市搜索：/api/weather?q=杭州
  const q = (url.searchParams.get('q') || '').trim();
  if (q) {
    try {
      return json({ results: await geocode(q.slice(0, 40)) });
    } catch {
      return json({ results: [], error: 'GEOCODE_FAILED' }, 502);
    }
  }

  const lat = Number(url.searchParams.get('lat'));
  const lon = Number(url.searchParams.get('lon'));
  const unit = url.searchParams.get('unit') === 'f' ? 'f' : 'c';
  const name = (url.searchParams.get('name') || '').slice(0, 40);

  if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) {
    return json({ error: 'BAD_COORDS' }, 400);
  }

  const key = cacheKey(lat, lon, unit);
  if (env.nav) {
    const cached = await env.nav.get(key, 'json').catch(() => null);
    if (cached && Date.now() - cached.updated < 10 * 60 * 1000) {
      return json({ ...cached, cached: true });
    }
  }

  try {
    const data = await forecast(lat, lon, unit, name);
    if (env.nav) {
      await env.nav.put(key, JSON.stringify(data), { expirationTtl: 900 }).catch(() => {});
    }
    return json(data);
  } catch (err) {
    return json({ error: 'WEATHER_FAILED', message: String(err) }, 502);
  }
};
