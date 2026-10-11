import { pointSchema, mapLinks } from './domain.mjs';
import { distanceAndBearing } from './geo.mjs';

const words = (value) =>
  value
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLocaleLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
const placeName = (value) =>
  words(value)
    .replace(/\bcastle\b/g, 'chateau')
    .replace(/\bpark\b/g, 'parc')
    .replace(/\b(de|du|des|le|la|les|of|the)\b/g, '')
    .split(/\s+/)
    .filter(Boolean)
    .sort()
    .join(' ');
const landmarkCategories = new Set([
  'historic',
  'tourism',
  'leisure',
  'amenity',
  'building',
  'natural',
  'man_made',
]);

// Matching an indexed landmark name fixes its reference point, not photo recognition.
export function resolvePlaceReference(candidate, results) {
  const matches = results.filter(
    (item) =>
      landmarkCategories.has(item.category) &&
      pointSchema.safeParse(item).success &&
      placeName(item.name.split(',')[0]) === placeName(candidate.name) &&
      (!candidate.country || words(item.country) === words(candidate.country)),
  );
  if (!matches.length) return null;
  const reference = matches[0];
  // Nearby duplicate records can describe one landmark. Separate sites are ambiguous.
  if (matches.some((item) => distanceAndBearing(reference, item).distanceMetres > 250)) return null;
  return {
    ...candidate,
    lat: reference.lat,
    lng: reference.lng,
    modelPoint: candidate.modelPoint || { lat: candidate.lat, lng: candidate.lng },
    mapReference: {
      label: reference.name,
      attribution: '© OpenStreetMap contributors',
      url: mapLinks(reference).osm,
    },
  };
}
