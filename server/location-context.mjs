import { contextRequestSchema, locationContextSchema } from '../src/lib/location-context.mjs';
import { distanceAndBearing } from '../src/lib/geo.mjs';
import { plainText } from './search-retrieval.mjs';

const OVERPASS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
  'https://maps.mail.ru/osm/tools/overpass/api/interpreter',
];
const TOPO = 'https://api.opentopodata.org/v1/srtm90m,aster30m';
const WEATHER = 'https://archive-api.open-meteo.com/v1/archive';
const userAgent = 'Findwhere/1.0 (https://github.com/saad2jz/findwhere)';
export class ContextBusy extends Error {}
class ProviderFailure extends Error {
  constructor(reason) {
    super('Public data provider unavailable');
    this.reason = reason;
  }
}
function failureReason(error) {
  if (error instanceof ProviderFailure) return error.reason;
  if (['TimeoutError', 'AbortError'].includes(error?.name)) return 'TIMEOUT';
  const code = error?.cause?.code || error?.code;
  return [
    'ENOTFOUND',
    'EAI_AGAIN',
    'ETIMEDOUT',
    'ECONNREFUSED',
    'ECONNRESET',
    'UND_ERR_CONNECT_TIMEOUT',
    'UND_ERR_SOCKET',
    'CERT_HAS_EXPIRED',
    'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
    'ERR_TLS_CERT_ALTNAME_INVALID',
  ].includes(code)
    ? code
    : 'INVALID_OR_UNAVAILABLE_DATA';
}

// Great-circle destinations remain valid at poles and across the date line.
export function terrainPoints(point, metres) {
  const radians = (degrees) => (degrees * Math.PI) / 180;
  const degrees = (radians) => (radians * 180) / Math.PI;
  const lat = radians(point.lat),
    lng = radians(point.lng),
    arc = metres / 6371000;
  return [
    { ...point, direction: 'Center' },
    ...['N', 'E', 'S', 'W'].map((direction, index) => {
      const bearing = (index * Math.PI) / 2;
      const nextLat = Math.asin(
        Math.sin(lat) * Math.cos(arc) + Math.cos(lat) * Math.sin(arc) * Math.cos(bearing),
      );
      const nextLng =
        lng +
        Math.atan2(
          Math.sin(bearing) * Math.sin(arc) * Math.cos(lat),
          Math.cos(arc) - Math.sin(lat) * Math.sin(nextLat),
        );
      return {
        direction,
        lat: Number(degrees(nextLat).toFixed(6)),
        lng: Number((((degrees(nextLng) + 540) % 360) - 180).toFixed(6)),
      };
    }),
  ];
}

async function jsonRequest(fetcher, url, options = {}) {
  const response = await fetcher(url, {
    ...options,
    redirect: 'error',
    headers: { 'User-Agent': userAgent, ...options.headers },
    signal: AbortSignal.timeout(18000),
  });
  if (!response.ok) throw new ProviderFailure(`HTTP_${response.status}`);
  if (Number(response.headers.get('content-length')) > 1_000_000)
    throw new ProviderFailure('RESPONSE_TOO_LARGE');
  const reader = response.body.getReader();
  const chunks = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > 1_000_000) throw new ProviderFailure('RESPONSE_TOO_LARGE');
      chunks.push(value);
    }
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } finally {
    await reader.cancel().catch(() => {});
  }
}

export function createLocationContext({
  fetcher = fetch,
  now = Date.now,
  onUnavailable = () => {},
} = {}) {
  const cache = new Map();
  const cooldowns = new Map();
  let lastStarted = -Infinity,
    running = 0,
    day = '',
    count = 0;
  return async (raw) => {
    const input = contextRequestSchema.parse(raw);
    const today = new Date(now()).toISOString().slice(0, 10);
    if (
      input.date &&
      (input.date < '1940-01-01' ||
        input.date > new Date(now() - 7 * 86400000).toISOString().slice(0, 10))
    )
      throw new RangeError('Choose a date from 1940 through seven days ago.');
    const key = JSON.stringify(input);
    if (cache.get(key)?.expires > now()) return cache.get(key).value;
    if (today !== day) {
      day = today;
      count = 0;
    }
    // Below public provider limits, including failed attempts. Resets on server restart.
    if (running >= 1 || now() - lastStarted < 1500 || count >= 90) throw new ContextBusy();
    lastStarted = now();
    running++;
    count++;
    const nearby = {
      status: 'unavailable',
      source: 'https://www.openstreetmap.org/copyright',
      attribution: '© OpenStreetMap contributors · ODbL',
      items: [],
    };
    const terrain = {
      status: 'unavailable',
      source: 'https://www.opentopodata.org/',
      attribution: 'Open Topo Data · SRTM / ASTER (NASA/USGS)',
      samples: [],
    };
    const weather = {
      status: input.date ? 'unavailable' : 'not-requested',
      source: 'https://open-meteo.com/en/docs/historical-weather-api',
      attribution: 'Open-Meteo · ERA5 (ECMWF/Copernicus) · CC BY 4.0',
    };
    try {
      const around = `(around:${input.radius},${input.lat},${input.lng})`;
      const selectors =
        input.category === 'fuel'
          ? [`nwr${around}[amenity=fuel]`]
          : [
              `nwr${around}[tourism~"^(museum|attraction|viewpoint|artwork|gallery)$"]`,
              `nwr${around}[historic]`,
              `nwr${around}[leisure=park][name]`,
              ...(input.category === 'all'
                ? [
                    `nwr${around}[amenity~"^(fuel|place_of_worship|hospital|theatre|cinema)$"]`,
                    `nwr${around}[railway=station]`,
                    `way${around}[highway][name]`,
                  ]
                : []),
            ];
      const points = terrainPoints(input, input.radius);
      await Promise.allSettled([
        (async () => {
          let data, backend;
          for (const endpoint of OVERPASS) {
            if ((cooldowns.get(endpoint) || 0) > now()) continue;
            const url = new URL(endpoint);
            url.search = new URLSearchParams({
              data: `[out:json][timeout:10];(${selectors.join(';')};);out center 100;`,
            });
            try {
              const result = await jsonRequest(fetcher, url);
              if (!Array.isArray(result.elements) || result.remark)
                throw new ProviderFailure('QUERY_INCOMPLETE');
              data = result;
              backend = url.hostname;
              break;
            } catch (error) {
              // Fixed host and allowlisted reason only; never log queries, coordinates or bodies.
              try {
                onUnavailable({
                  provider: 'overpass',
                  host: url.hostname,
                  reason: failureReason(error),
                });
              } catch {}
              // Do not retry a failed server. Each remaining documented instance gets one attempt.
              cooldowns.set(endpoint, now() + 5 * 60000);
            }
          }
          if (!data) throw new Error('Unavailable');
          const seen = new Set();
          const items = data.elements
            .slice(0, 100)
            .flatMap((item) => {
              if (
                !['node', 'way', 'relation'].includes(item.type) ||
                !Number.isSafeInteger(item.id) ||
                item.id <= 0
              )
                return [];
              const tags = item.tags || {};
              if (
                tags.access === 'private' ||
                tags.building === 'residential' ||
                tags.building === 'apartments'
              )
                return [];
              const name = plainText(tags.name || tags['name:en'] || tags.brand, 300);
              const lat = item.lat ?? item.center?.lat,
                lng = item.lon ?? item.center?.lon;
              if (
                !name ||
                !Number.isFinite(lat) ||
                !Number.isFinite(lng) ||
                Math.abs(lat) > 90 ||
                Math.abs(lng) > 180
              )
                return [];
              const geometry = distanceAndBearing(input, { lat, lng });
              // Ways/relations use their bounding-box center, not an entrance or closest edge.
              if (geometry.distanceMetres > input.radius) return [];
              const id = `${item.type}/${item.id}`;
              if (seen.has(id)) return [];
              seen.add(id);
              return [
                {
                  id,
                  name,
                  lat,
                  lng,
                  type: plainText(
                    tags.amenity ||
                      tags.tourism ||
                      tags.historic ||
                      tags.leisure ||
                      tags.railway ||
                      'road',
                    80,
                  ),
                  url: `https://www.openstreetmap.org/${id}`,
                  distanceMetres: geometry.distanceMetres,
                  bearing: geometry.initialBearingDegrees,
                },
              ];
            })
            .sort((a, b) => a.distanceMetres - b.distanceMetres)
            .slice(0, 20);
          Object.assign(nearby, {
            status: 'available',
            items,
            attribution: `© OpenStreetMap contributors · ODbL · ${backend}`,
          });
        })(),
        (async () => {
          const url = new URL(TOPO);
          url.search = new URLSearchParams({
            locations: points.map((p) => `${p.lat},${p.lng}`).join('|'),
            interpolation: 'bilinear',
          });
          const data = await jsonRequest(fetcher, url);
          if (data.status !== 'OK' || data.results?.length !== 5) throw new Error('Unavailable');
          const samples = data.results.map((sample, index) => {
            if (
              !['srtm90m', 'aster30m'].includes(sample.dataset) ||
              (sample.elevation !== null &&
                (!Number.isFinite(sample.elevation) || Math.abs(sample.elevation) > 15000)) ||
              !sample.location ||
              !Number.isFinite(sample.location.lat) ||
              !Number.isFinite(sample.location.lng) ||
              Math.abs(sample.location.lat - points[index].lat) > 0.00001 ||
              Math.abs(sample.location.lng - points[index].lng) > 0.00001
            )
              throw new Error('Invalid elevation');
            return { ...points[index], elevation: sample.elevation, dataset: sample.dataset };
          });
          Object.assign(terrain, { status: 'available', samples });
        })(),
        ...(input.date
          ? [
              (async () => {
                const url = new URL(WEATHER);
                url.search = new URLSearchParams({
                  latitude: input.lat,
                  longitude: input.lng,
                  start_date: input.date,
                  end_date: input.date,
                  daily:
                    'temperature_2m_min,temperature_2m_max,precipitation_sum,cloud_cover_mean,sunrise,sunset',
                  timezone: 'auto',
                  models: 'era5',
                });
                const data = await jsonRequest(fetcher, url);
                if (
                  data.daily?.time?.length !== 1 ||
                  data.daily.time[0] !== input.date ||
                  data.error
                )
                  throw new Error('Unavailable');
                const value = (field) => data.daily[field]?.[0] ?? null;
                if (
                  ![
                    value('temperature_2m_min'),
                    value('temperature_2m_max'),
                    value('precipitation_sum'),
                    value('cloud_cover_mean'),
                  ].some(Number.isFinite) ||
                  data.daily_units?.temperature_2m_min !== '°C' ||
                  data.daily_units?.precipitation_sum !== 'mm' ||
                  data.daily_units?.cloud_cover_mean !== '%'
                )
                  throw new Error('Unavailable');
                const parsed = locationContextSchema.shape.weather.parse({
                  ...weather,
                  status: 'available',
                  grid: { lat: data.latitude, lng: data.longitude },
                  timezone: data.timezone,
                  minimum: value('temperature_2m_min'),
                  maximum: value('temperature_2m_max'),
                  precipitation: value('precipitation_sum'),
                  cloudCover: value('cloud_cover_mean'),
                  sunrise: value('sunrise'),
                  sunset: value('sunset'),
                });
                Object.assign(weather, parsed);
              })(),
            ]
          : []),
      ]);
      const result = locationContextSchema.parse({
        ...input,
        fetchedAt: new Date(now()).toISOString(),
        nearby,
        terrain,
        weather,
      });
      if (cache.size >= 100) cache.delete(cache.keys().next().value);
      // Short-lived failures allow a later manual retry; never loop on upstream errors.
      const complete =
        nearby.status === 'available' &&
        terrain.status === 'available' &&
        weather.status !== 'unavailable';
      cache.set(key, { value: result, expires: now() + (complete ? 6 * 3600000 : 60000) });
      return result;
    } finally {
      running--;
    }
  };
}
