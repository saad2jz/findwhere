// Spherical great-circle distance and initial bearing, radius 6,371 km.
// Formula reference: https://www.movable-type.co.uk/scripts/latlong.html
const RADIUS_METRES = 6_371_000;
const radians = (degrees) => (degrees * Math.PI) / 180;
const directions = [
  'N',
  'NNE',
  'NE',
  'ENE',
  'E',
  'ESE',
  'SE',
  'SSE',
  'S',
  'SSW',
  'SW',
  'WSW',
  'W',
  'WNW',
  'NW',
  'NNW',
];

function checkPoint(point) {
  if (
    !point ||
    !Number.isFinite(point.lat) ||
    !Number.isFinite(point.lng) ||
    Math.abs(point.lat) > 90 ||
    Math.abs(point.lng) > 180
  ) {
    throw new RangeError('Use valid latitude and longitude coordinates.');
  }
}
export function distanceAndBearing(from, to) {
  checkPoint(from);
  checkPoint(to);
  const lat1 = radians(from.lat),
    lat2 = radians(to.lat);
  const deltaLat = lat2 - lat1,
    deltaLng = radians(to.lng - from.lng);
  const haversine =
    Math.sin(deltaLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(deltaLng / 2) ** 2;
  const bounded = Math.min(1, Math.max(0, haversine));
  const angle = 2 * Math.atan2(Math.sqrt(bounded), Math.sqrt(1 - bounded));
  const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(deltaLng);
  const y = Math.sin(deltaLng) * Math.cos(lat2);
  // A coincident/antipodal point has no unique direction; north is undefined at an origin pole.
  const initialBearingDegrees =
    Math.abs(Math.sin(angle)) < 1e-12 || Math.abs(Math.cos(lat1)) < 1e-12
      ? null
      : ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
  return { distanceMetres: angle < 1e-12 ? 0 : angle * RADIUS_METRES, initialBearingDegrees };
}

export function compareCandidates(origin, candidates) {
  if (!origin) return [];
  return candidates
    .filter((candidate) => candidate.id !== origin.id)
    .map((candidate) => ({ candidate, ...distanceAndBearing(origin, candidate) }))
    .sort((first, second) => first.distanceMetres - second.distanceMetres);
}

export function formatDistance(metres) {
  if (!Number.isFinite(metres) || metres < 0)
    throw new RangeError('Distance must be non-negative and finite.');
  if (metres === 0) return '0 m';
  if (metres < 1) return '<1 m';
  if (metres < 1000) return `${Math.round(metres)} m`;
  return `${(metres / 1000).toFixed(metres < 10000 ? 2 : 1)} km`;
}
export function formatBearing(degrees) {
  if (degrees === null) return 'Not defined';
  if (!Number.isFinite(degrees)) throw new RangeError('Bearing must be finite.');
  const normalized = ((degrees % 360) + 360) % 360;
  return `${String(Math.round(normalized) % 360).padStart(3, '0')}° ${directions[Math.round(normalized / 22.5) % 16]}`;
}
