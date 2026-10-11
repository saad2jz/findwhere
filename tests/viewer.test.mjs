import test from 'node:test';
import assert from 'node:assert/strict';
import { clampPan, viewerFrame } from '../src/lib/viewer.mjs';

test('fit contains a landscape image and recenters without overflow', () => {
  const frame = viewerFrame({ width: 1200, height: 800 }, { width: 600, height: 500 }, 0);
  assert.deepEqual(frame, { scale: 0.5, limitX: 0, limitY: 0 });
  assert.deepEqual(clampPan({ x: 200, y: -100 }, frame), { x: 0, y: 0 });
});
test('rotation fits the rotated bounds and zoom allows bounded panning', () => {
  const frame = viewerFrame({ width: 1200, height: 800 }, { width: 600, height: 500 }, 90, 3);
  assert.equal(frame.scale, 1.25);
  assert.equal(frame.limitX, 200);
  assert.equal(frame.limitY, 500);
  assert.deepEqual(clampPan({ x: 900, y: -800 }, frame), { x: 200, y: -500 });
});
test('resizing into a wider viewport clamps an existing pan to new bounds', () => {
  const frame = viewerFrame({ width: 1200, height: 800 }, { width: 1000, height: 500 }, 0, 2);
  assert.deepEqual(clampPan({ x: 400, y: -400 }, frame), { x: 250, y: -250 });
});
test('unloaded image and zero-size viewport have no movable bounds', () => {
  assert.deepEqual(viewerFrame({ width: 0, height: 0 }, { width: 600, height: 400 }, 0), {
    scale: 0,
    limitX: 0,
    limitY: 0,
  });
  assert.deepEqual(viewerFrame({ width: 1200, height: 800 }, { width: 0, height: 0 }, 0), {
    scale: 0,
    limitX: 0,
    limitY: 0,
  });
});
test('zoom bounds prevent shrinking below fit and expanding beyond eight times fit', () => {
  const image = { width: 1200, height: 800 },
    viewport = { width: 600, height: 500 };
  assert.equal(viewerFrame(image, viewport, 0, 0.1).scale, 0.5);
  assert.equal(viewerFrame(image, viewport, 0, 100).scale, 4);
});
