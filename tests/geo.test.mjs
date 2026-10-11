import test from 'node:test';
import assert from 'node:assert/strict';
import {
  distanceAndBearing,
  compareCandidates,
  formatDistance,
  formatBearing,
} from '../src/lib/geo.mjs';
import { createCase, exportReport } from '../src/lib/domain.mjs';

function near(actual, expected, tolerance = 0.001) {
  assert.ok(
    Math.abs(actual - expected) <= tolerance,
    `${actual} is not within ${tolerance} of ${expected}`,
  );
}
const origin = { lat: 0, lng: 0 };

test('cardinal arcs have known distances and initial bearings in both directions', () => {
  const points = [
    [{ lat: 1, lng: 0 }, 0],
    [{ lat: 0, lng: 1 }, 90],
    [{ lat: -1, lng: 0 }, 180],
    [{ lat: 0, lng: -1 }, 270],
  ];
  for (const [target, bearing] of points) {
    const result = distanceAndBearing(origin, target);
    near(result.distanceMetres, 111194.926645);
    near(result.initialBearingDegrees, bearing);
    near(distanceAndBearing(target, origin).distanceMetres, result.distanceMetres);
  }
  near(distanceAndBearing(origin, { lat: 0, lng: 90 }).distanceMetres, 10007543.39801);
});
test('the published Cambridge–Paris example gives about 404.3 km and 156.2 degrees', () => {
  // Independent reference: movable-type.co.uk/scripts/latlong.html
  const result = distanceAndBearing({ lat: 52.205, lng: 0.119 }, { lat: 48.857, lng: 2.351 });
  near(result.distanceMetres, 404300, 50);
  near(result.initialBearingDegrees, 156.2, 0.05);
});
test('antimeridian crossing follows the short arc and handles longitude aliases', () => {
  const result = distanceAndBearing({ lat: 0, lng: 179 }, { lat: 0, lng: -179 });
  near(result.distanceMetres, 222389.85329);
  near(result.initialBearingDegrees, 90);
  assert.deepEqual(distanceAndBearing({ lat: 0, lng: -180 }, { lat: 0, lng: 180 }), {
    distanceMetres: 0,
    initialBearingDegrees: null,
  });
});
test('coincident points, antipodes and polar origins never invent a unique bearing', () => {
  assert.deepEqual(distanceAndBearing(origin, origin), {
    distanceMetres: 0,
    initialBearingDegrees: null,
  });
  const opposite = distanceAndBearing(origin, { lat: 0, lng: 180 });
  near(opposite.distanceMetres, 20015086.79602);
  assert.equal(opposite.initialBearingDegrees, null);
  const polar = distanceAndBearing({ lat: 90, lng: 25 }, { lat: 89, lng: 70 });
  assert.ok(Number.isFinite(polar.distanceMetres));
  assert.equal(polar.initialBearingDegrees, null);
});
test('tiny separations stay finite and invalid coordinates are rejected', () => {
  const tiny = distanceAndBearing(origin, { lat: 0, lng: 0.000001 });
  near(tiny.distanceMetres, 0.1111949266, 0.0000001);
  near(tiny.initialBearingDegrees, 90);
  for (const point of [
    null,
    { lat: NaN, lng: 0 },
    { lat: 91, lng: 0 },
    { lat: 0, lng: -181 },
    { lat: '0', lng: 0 },
    { lat: 0, lng: Infinity },
  ]) {
    assert.throws(() => distanceAndBearing(origin, point), /valid latitude/);
    assert.throws(() => distanceAndBearing(point, origin), /valid latitude/);
  }
});
test('comparison sorts separation while retaining ruled-out and coincident candidates', () => {
  const start = { ...origin, id: 'origin' };
  const candidates = [
    start,
    { id: 'far', lat: 0, lng: 3, status: 'supported' },
    { id: 'close', lat: 0, lng: 1, status: 'ruled-out' },
    { id: 'same', ...origin, status: 'hypothesis' },
  ];
  const before = structuredClone(candidates);
  const result = compareCandidates(start, candidates);
  assert.deepEqual(
    result.map((row) => row.candidate.id),
    ['same', 'close', 'far'],
  );
  assert.equal(result[1].candidate.status, 'ruled-out');
  assert.equal(result[0].initialBearingDegrees, null);
  assert.deepEqual(candidates, before);
  assert.deepEqual(compareCandidates(null, candidates), []);
  assert.deepEqual(compareCandidates(start, [start]), []);
});
test('display units and compass bearings round consistently without a 360-degree north', () => {
  assert.equal(formatDistance(0), '0 m');
  assert.equal(formatDistance(0.1), '<1 m');
  assert.equal(formatDistance(125.4), '125 m');
  assert.equal(formatDistance(1250), '1.25 km');
  assert.equal(formatDistance(12000), '12.0 km');
  assert.equal(formatBearing(null), 'Not defined');
  assert.equal(formatBearing(359.9), '000° N');
  assert.equal(formatBearing(45), '045° NE');
  assert.throws(() => formatDistance(-1));
  assert.throws(() => formatBearing(NaN));
});
test('reports honor the selected origin, include all alternatives and handle fewer than two leads', () => {
  const investigation = createCase();
  const lead = {
    name: 'First',
    country: '',
    confidence: 'low',
    status: 'hypothesis',
    source: 'manual',
    reason: '',
  };
  investigation.candidates = [
    { ...lead, ...origin, id: 'first' },
    { ...lead, name: 'East', lat: 0, lng: 1, id: 'east', status: 'ruled-out' },
  ];
  const report = exportReport(investigation, { originId: 'east' });
  assert.match(report, /Origin: East; coordinates: 0, 1/);
  assert.match(report, /First \(hypothesis\): 111.2 km; initial bearing: 270° W/);
  assert.match(report, /Distance order does not imply likelihood/);
  assert.match(exportReport(investigation), /East \(ruled-out\)/);
  assert.match(exportReport(investigation, { originId: 'missing' }), /Origin: First/);
  investigation.candidates.pop();
  assert.doesNotMatch(exportReport(investigation), /## Candidate location comparison/);
});
