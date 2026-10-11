import { useEffect, useRef, useState } from 'react';
import { RotateCw, Scan, ZoomIn, ZoomOut } from 'lucide-react';
import { clampPan, MAX_ZOOM, MIN_ZOOM, viewerFrame } from '../lib/viewer.mjs';

export default function PhotoInspector({ src, fileName }) {
  const surface = useRef(null);
  const drag = useRef(null);
  const [image, setImage] = useState({ width: 0, height: 0 });
  const [viewport, setViewport] = useState({ width: 0, height: 0 });
  const [view, setView] = useState({ zoom: 1, rotation: 0, x: 0, y: 0 });
  const [failed, setFailed] = useState(false);
  const [dragging, setDragging] = useState(false);
  const frame = viewerFrame(image, viewport, view.rotation, view.zoom);
  const pan = clampPan(view, frame);
  const ready = image.width > 0 && !failed;

  useEffect(() => {
    const observer = new ResizeObserver(([entry]) => {
      setViewport({ width: entry.contentRect.width, height: entry.contentRect.height });
    });
    observer.observe(surface.current);
    return () => observer.disconnect();
  }, []);

  // Keep the stored offset bounded too, so a resize cannot leave a hidden stale offset.
  useEffect(() => {
    setView((previous) => {
      const bounded = clampPan(
        previous,
        viewerFrame(image, viewport, previous.rotation, previous.zoom),
      );
      return bounded.x === previous.x && bounded.y === previous.y
        ? previous
        : { ...previous, ...bounded };
    });
  }, [image, viewport]);

  function zoomBy(factor) {
    setView((previous) => {
      const zoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, previous.zoom * factor));
      const currentPan = clampPan(
        previous,
        viewerFrame(image, viewport, previous.rotation, previous.zoom),
      );
      const nextPan = clampPan(
        { x: (currentPan.x * zoom) / previous.zoom, y: (currentPan.y * zoom) / previous.zoom },
        viewerFrame(image, viewport, previous.rotation, zoom),
      );
      return { ...previous, zoom, ...nextPan };
    });
  }
  function moveBy(x, y) {
    setView((previous) => ({
      ...previous,
      ...clampPan(
        { x: previous.x + x, y: previous.y + y },
        viewerFrame(image, viewport, previous.rotation, previous.zoom),
      ),
    }));
  }
  function rotate() {
    setView((previous) => ({ ...previous, rotation: (previous.rotation + 90) % 360, x: 0, y: 0 }));
  }
  function reset() {
    setView({ zoom: 1, rotation: 0, x: 0, y: 0 });
  }
  function onKeyDown(event) {
    if (!ready || event.ctrlKey || event.metaKey || event.altKey) return;
    const keys = {
      '+': () => zoomBy(1.5),
      '=': () => zoomBy(1.5),
      '-': () => zoomBy(1 / 1.5),
      0: reset,
      r: rotate,
      R: rotate,
      ArrowLeft: () => moveBy(40, 0),
      ArrowRight: () => moveBy(-40, 0),
      ArrowUp: () => moveBy(0, 40),
      ArrowDown: () => moveBy(0, -40),
    };
    if (keys[event.key]) {
      event.preventDefault();
      keys[event.key]();
    }
  }
  function endDrag(event) {
    if (drag.current?.id !== event.pointerId) return;
    drag.current = null;
    setDragging(false);
  }

  return (
    <div className="photo-inspector">
      <div className="inspector-toolbar" role="group" aria-label="Image view controls">
        <div className="inspector-zoom-controls">
          <button
            type="button"
            onClick={() => zoomBy(1 / 1.5)}
            disabled={!ready || view.zoom <= MIN_ZOOM}
            aria-label="Zoom out"
          >
            <ZoomOut size={18} />
          </button>
          <output aria-label="Zoom level">{Math.round(view.zoom * 100)}%</output>
          <button
            type="button"
            onClick={() => zoomBy(1.5)}
            disabled={!ready || view.zoom >= MAX_ZOOM}
            aria-label="Zoom in"
          >
            <ZoomIn size={18} />
          </button>
        </div>
        <button type="button" onClick={rotate} disabled={!ready}>
          <RotateCw size={17} /> Rotate
        </button>
        <button type="button" onClick={reset} disabled={!ready}>
          <Scan size={17} /> Reset view
        </button>
      </div>
      <div
        className={`inspector-surface${dragging ? ' is-dragging' : ''}`}
        ref={surface}
        tabIndex={0}
        role="region"
        aria-label="Photo inspection area"
        aria-describedby="inspector-help"
        onKeyDown={onKeyDown}
        onPointerDown={(event) => {
          if (!ready || !event.isPrimary || event.button !== 0) return;
          event.currentTarget.focus({ preventScroll: true });
          event.currentTarget.setPointerCapture(event.pointerId);
          drag.current = { id: event.pointerId, x: event.clientX, y: event.clientY };
          setDragging(true);
        }}
        onPointerMove={(event) => {
          if (drag.current?.id !== event.pointerId) return;
          moveBy(event.clientX - drag.current.x, event.clientY - drag.current.y);
          drag.current = { id: event.pointerId, x: event.clientX, y: event.clientY };
        }}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onLostPointerCapture={endDrag}
      >
        <img
          src={src}
          alt={`Source image: ${fileName}`}
          draggable={false}
          onLoad={(event) =>
            setImage({
              width: event.currentTarget.naturalWidth,
              height: event.currentTarget.naturalHeight,
            })
          }
          onError={() => setFailed(true)}
          style={{
            width: image.width || undefined,
            height: image.height || undefined,
            visibility: ready ? 'visible' : 'hidden',
            transform: `translate(-50%, -50%) translate(${pan.x}px, ${pan.y}px) rotate(${view.rotation}deg) scale(${frame.scale})`,
          }}
        />
        {!ready && (
          <p role="status">
            {failed
              ? 'The image could not be loaded. Close this view and try again.'
              : 'Loading image…'}
          </p>
        )}
      </div>
      <p className="inspector-status" role="status">
        {ready
          ? `${image.width} × ${image.height} preview · ${Math.round(view.zoom * 100)}% of fitted size · ${view.rotation}° rotation`
          : 'Source image preview'}
      </p>
      <p className="subtle" id="inspector-help">
        Zoom in, then drag to inspect. With the image area focused, use + / − to zoom, arrow keys to
        pan, R to rotate, and 0 to reset. These controls do not change the saved photo or add
        detail.
      </p>
    </div>
  );
}
