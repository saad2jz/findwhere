import { useEffect, useRef, useState } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { Crosshair, Layers, MapPin } from 'lucide-react';

export default function MapPanel({ candidates, selected, onSelect }) {
  const host = useRef(null);
  const mapRef = useRef(null);
  const layerRef = useRef(null);
  const markersRef = useRef(null);
  const [tileError, setTileError] = useState(false);
  const [layer, setLayer] = useState('street');
  useEffect(() => {
    const map = L.map(host.current, {
      zoomControl: false,
      scrollWheelZoom: false,
      attributionControl: true,
    }).setView([28, 0], 2);
    L.control.zoom({ position: 'topright' }).addTo(map);
    mapRef.current = map;
    markersRef.current = L.layerGroup().addTo(map);
    const observer = new ResizeObserver(() => map.invalidateSize());
    observer.observe(host.current);
    return () => {
      observer.disconnect();
      map.remove();
      mapRef.current = null;
    };
  }, []);
  useEffect(() => {
    if (!mapRef.current) return;
    if (layerRef.current) layerRef.current.remove();
    setTileError(false);
    layerRef.current = L.tileLayer(
      layer === 'street'
        ? 'https://tile.openstreetmap.org/{z}/{x}/{y}.png'
        : 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
      {
        maxZoom: 19,
        attribution:
          layer === 'street'
            ? '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
            : 'Tiles &copy; Esri, Maxar, Earthstar Geographics',
      },
    ).addTo(mapRef.current);
    layerRef.current.on('tileerror', () => setTileError(true));
    layerRef.current.on('load', () => setTileError(false));
  }, [layer]);
  useEffect(() => {
    const group = markersRef.current;
    if (!group) return;
    group.clearLayers();
    candidates.forEach((candidate, index) => {
      const active = candidate.id === selected?.id;
      if (candidate.status === 'ruled-out' && !active) return;
      const marker = L.marker([candidate.lat, candidate.lng], {
        icon: L.divIcon({
          className: 'candidate-marker',
          iconSize: [36, 36],
          iconAnchor: [18, 18],
          html: `<span class="${active ? 'active' : ''} ${candidate.status === 'ruled-out' ? 'excluded' : ''}">${index + 1}</span>`,
        }),
        title: candidate.name,
        alt: `Candidate ${index + 1}: ${candidate.name}`,
        keyboard: true,
      }).addTo(group);
      marker.on('click', () => onSelect(candidate.id));
    });
    if (selected)
      mapRef.current.setView([selected.lat, selected.lng], selected.source === 'ai' ? 12 : 14, {
        animate: false,
      });
    else mapRef.current.setView([28, 0], 2, { animate: false });
  }, [candidates, selected?.id, onSelect]);
  function recenter() {
    if (selected)
      mapRef.current.setView([selected.lat, selected.lng], selected.source === 'ai' ? 12 : 15);
    else if (candidates.some((candidate) => candidate.status !== 'ruled-out'))
      mapRef.current.fitBounds(
        candidates
          .filter((candidate) => candidate.status !== 'ruled-out')
          .map((c) => [c.lat, c.lng]),
        { padding: [40, 40], maxZoom: 15 },
      );
    else mapRef.current.setView([28, 0], 2);
  }
  return (
    <div className="map-wrap">
      <div className="map-canvas" ref={host} role="region" aria-label="Location candidate map" />
      <div className="map-label">
        <span className="live-dot" />{' '}
        {selected?.mapReference
          ? 'Geocoded landmark reference'
          : selected?.source === 'ai'
            ? 'Approximate AI reference point'
            : selected
              ? 'Candidate location'
              : 'Your next discovery'}
      </div>
      <div className="map-actions">
        <button
          className="map-control"
          onClick={recenter}
          title="Center map"
          aria-label="Center map on candidate"
        >
          <Crosshair size={17} />
        </button>
        <button
          className={`map-control ${layer === 'satellite' ? 'is-active' : ''}`}
          onClick={() => setLayer(layer === 'street' ? 'satellite' : 'street')}
          title="Toggle satellite view"
          aria-label="Satellite view"
          aria-pressed={layer === 'satellite'}
        >
          <Layers size={17} />
        </button>
      </div>
      {selected && (
        <div className="map-location">
          <span className="location-icon">
            <MapPin size={17} />
          </span>
          <div>
            <strong>{selected.name}</strong>
            <span>
              {selected.source === 'ai' && !selected.mapReference ? 'Approx. ' : ''}
              {selected.lat.toFixed(
                selected.source === 'ai' && !selected.mapReference ? 3 : 5,
              )}°,{' '}
              {selected.lng.toFixed(selected.source === 'ai' && !selected.mapReference ? 3 : 5)}°
            </span>
          </div>
        </div>
      )}
      {tileError && (
        <div className="map-network-note" role="status">
          Map tiles unavailable. Candidate coordinates and research links still work.
        </div>
      )}
      {!selected && (
        <div className="map-empty">
          <MapPin size={24} />
          <strong>A starting point for your search</strong>
          <span>Add a candidate or upload a GPS-tagged photo.</span>
        </div>
      )}
    </div>
  );
}
