import { useEffect, useId, useRef, useState } from 'react';
import { ArrowUpRight, LoaderCircle, MapPinned, Plus } from 'lucide-react';
import { locationContextSchema, contextMatchesCandidate } from '../lib/location-context.mjs';
import { formatBearing, formatDistance } from '../lib/geo.mjs';

const unit = (value, suffix = '') =>
  value === null || value === undefined ? 'No data' : `${Math.round(value * 10) / 10}${suffix}`;
export default function LocationContext({ candidate, onSave, onAdd, canAdd }) {
  const id = useId();
  const [radius, setRadius] = useState(candidate.locationContext?.radius || 1000);
  const [category, setCategory] = useState(candidate.locationContext?.category || 'all');
  const [date, setDate] = useState(candidate.locationContext?.date || '');
  const [expanded, setExpanded] = useState(Boolean(candidate.locationContext));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const controller = useRef(null);
  const context = candidate.locationContext;
  useEffect(() => () => controller.current?.abort(), []);
  const maxDate = new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10);
  async function load(event) {
    event.preventDefault();
    controller.current?.abort();
    const abort = new AbortController();
    controller.current = abort;
    setBusy(true);
    setError('');
    try {
      const response = await fetch('/api/location-context', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: abort.signal,
        body: JSON.stringify({
          lat: candidate.lat,
          lng: candidate.lng,
          radius,
          category,
          ...(date ? { date } : {}),
        }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Location check failed. Try again later.');
      onSave(locationContextSchema.parse(result));
    } catch (error) {
      if (!abort.signal.aborted) setError(error.message || 'Location check failed.');
    } finally {
      if (!abort.signal.aborted) setBusy(false);
    }
  }
  return (
    <details
      className="location-context"
      open={expanded}
      onToggle={(event) => setExpanded(event.currentTarget.open)}
    >
      <summary>
        <MapPinned size={18} aria-hidden="true" /> Check the surroundings{' '}
        <span className="tag">No AI credits</span>
      </summary>
      <p>
        Compare this candidate with nearby public places, sampled terrain and past weather. These
        checks do not identify the photo.
      </p>
      <form onSubmit={load}>
        <div className="context-form-grid">
          <label htmlFor={`${id}-radius`}>
            Search radius
            <select
              id={`${id}-radius`}
              value={radius}
              disabled={busy}
              onChange={(e) => setRadius(Number(e.target.value))}
            >
              <option value={500}>500 m</option>
              <option value={1000}>1 km</option>
              <option value={2000}>2 km</option>
            </select>
          </label>
          <label htmlFor={`${id}-category`}>
            Nearby features
            <select
              id={`${id}-category`}
              value={category}
              disabled={busy}
              onChange={(e) => setCategory(e.target.value)}
            >
              <option value="all">Places & roads</option>
              <option value="fuel">Fuel stations</option>
              <option value="landmarks">Landmarks & parks</option>
            </select>
          </label>
        </div>
        <label htmlFor={`${id}-date`}>
          Photo date for weather (optional)
          <input
            id={`${id}-date`}
            type="date"
            min="1940-01-01"
            max={maxDate}
            value={date}
            disabled={busy}
            onChange={(e) => setDate(e.target.value)}
          />
        </label>
        <p className="context-disclosure">
          Sends this candidate’s coordinates to Overpass (main service, Private.coffee or VK Maps)
          and Open Topo Data. Adding a date also sends the coordinates and that date to Open-Meteo.
          Your photo and notes stay here.
        </p>
        <button className="button secondary" type="submit" disabled={busy}>
          {busy ? (
            <LoaderCircle size={16} className="spin" aria-hidden="true" />
          ) : (
            <MapPinned size={16} aria-hidden="true" />
          )}
          {busy
            ? 'Checking surroundings…'
            : context
              ? 'Refresh location context'
              : 'Load location context'}
        </button>
        {busy && (
          <p role="status">Retrieving available public data. This can take up to 60 seconds.</p>
        )}
        {error && (
          <p className="context-error" role="alert">
            {error}
          </p>
        )}
      </form>
      {context && (
        <div className="context-results" aria-label="Location context results">
          {!contextMatchesCandidate(context, candidate) && (
            <p className="context-error">
              These results belong to an earlier map point. Refresh to check the current
              coordinates.
            </p>
          )}
          <p className="muted">
            Checked {context.lat.toFixed(5)}, {context.lng.toFixed(5)} ·{' '}
            {formatDistance(context.radius)} · {new Date(context.fetchedAt).toLocaleString()}
          </p>
          <h4>Nearby places & roads</h4>
          {context.nearby.status === 'unavailable' ? (
            <p>
              Nearby lookup is temporarily unavailable. Terrain and weather results remain below.
            </p>
          ) : context.nearby.items.length === 0 ? (
            <p>
              No named public features were returned. Try a wider radius or another feature
              category; map coverage can be incomplete.
            </p>
          ) : (
            <ul className="nearby-places">
              {context.nearby.items.map((item) => (
                <li key={item.id}>
                  <div>
                    <a href={item.url} target="_blank" rel="noopener noreferrer">
                      {item.name} <ArrowUpRight size={13} aria-hidden="true" />
                    </a>
                    <small>
                      {item.type.replaceAll('_', ' ')} · {formatDistance(item.distanceMetres)} ·{' '}
                      {formatBearing(item.bearing)}
                    </small>
                  </div>
                  <button
                    className="icon-button"
                    type="button"
                    disabled={!canAdd || !contextMatchesCandidate(context, candidate)}
                    onClick={() => onAdd(item)}
                    aria-label={`Add ${item.name} as an unverified lead`}
                    title="Add unverified lead"
                  >
                    <Plus size={16} />
                  </button>
                </li>
              ))}
            </ul>
          )}
          <p className="context-footnote">
            Up to 20 returned records. Distances and directions use map centers, which can differ
            from entrances. Nearby does not mean depicted in your photo.{' '}
            <a href={context.nearby.source} target="_blank" rel="noopener noreferrer">
              {context.nearby.attribution}
            </a>
          </p>
          <h4>Terrain samples</h4>
          {context.terrain.status === 'unavailable' ? (
            <p>Elevation data is temporarily unavailable. Try again later.</p>
          ) : (
            <>
              <dl className="terrain-samples">
                {context.terrain.samples.map((sample) => (
                  <div key={sample.direction}>
                    <dt>
                      {sample.direction}
                      {sample.direction !== 'Center' ? ` · ${formatDistance(context.radius)}` : ''}
                    </dt>
                    <dd>{unit(sample.elevation, ' m')}</dd>
                    <small>{sample.dataset}</small>
                  </div>
                ))}
              </dl>
              <p className="context-footnote">
                Five raster estimates, around 30–90 m resolution. This does not measure the building
                height or reconstruct the skyline.
              </p>
            </>
          )}
          <a
            className="context-source"
            href={context.terrain.source}
            target="_blank"
            rel="noopener noreferrer"
          >
            {context.terrain.attribution}
          </a>
          <h4>Historical weather</h4>
          {context.weather.status === 'not-requested' ? (
            <p>
              Choose the photo date above to compare past weather. Dates are entered by you, not
              inferred from the image.
            </p>
          ) : context.weather.status === 'unavailable' ? (
            <p>Weather data for {context.date} is unavailable. Other checks remain available.</p>
          ) : (
            <>
              <p>
                {context.date} · {context.weather.timezone}
              </p>
              <dl className="context-weather">
                <div>
                  <dt>Temperature</dt>
                  <dd>
                    {unit(context.weather.minimum)} to {unit(context.weather.maximum, ' °C')}
                  </dd>
                </div>
                <div>
                  <dt>Daily precipitation</dt>
                  <dd>{unit(context.weather.precipitation, ' mm')}</dd>
                </div>
                <div>
                  <dt>Mean cloud cover</dt>
                  <dd>{unit(context.weather.cloudCover, '%')}</dd>
                </div>
                <div>
                  <dt>Sunrise / sunset</dt>
                  <dd>
                    {context.weather.sunrise?.slice(11, 16) || 'No data'} /{' '}
                    {context.weather.sunset?.slice(11, 16) || 'No data'} (local)
                  </dd>
                </div>
              </dl>
              <p className="context-footnote">
                ERA5 reanalysis, approximately 25 km grid. Daily weather cannot prove conditions at
                the moment of the photo. Free Open-Meteo access is for non-commercial use.
              </p>
            </>
          )}
          <a
            className="context-source"
            href={context.weather.source}
            target="_blank"
            rel="noopener noreferrer"
          >
            {context.weather.attribution}
          </a>
        </div>
      )}
    </details>
  );
}
