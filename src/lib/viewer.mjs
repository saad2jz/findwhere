export const MIN_ZOOM = 1;
export const MAX_ZOOM = 8;

export function viewerFrame(image, viewport, rotation, zoom = 1) {
  const turned = Math.abs(rotation % 180) === 90;
  const width = turned ? image.height : image.width;
  const height = turned ? image.width : image.height;
  if (!width || !height || !viewport.width || !viewport.height) {
    return { scale: 0, limitX: 0, limitY: 0 };
  }
  const scale =
    Math.min(viewport.width / width, viewport.height / height) *
    Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, zoom));
  return {
    scale,
    limitX: Math.max(0, (width * scale - viewport.width) / 2),
    limitY: Math.max(0, (height * scale - viewport.height) / 2),
  };
}

export function clampPan(pan, frame) {
  return {
    x: frame.limitX ? Math.max(-frame.limitX, Math.min(frame.limitX, pan.x)) : 0,
    y: frame.limitY ? Math.max(-frame.limitY, Math.min(frame.limitY, pan.y)) : 0,
  };
}
