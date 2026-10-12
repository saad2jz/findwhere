import { useEffect, useRef, useState } from 'react';
import { ArrowUpRight, Download, LoaderCircle, MapPinned, Search } from 'lucide-react';
import { commonsImageUrl } from '../lib/image-research.mjs';
import { formatDistance } from '../lib/geo.mjs';
import { photoSource } from '../data/demo.mjs';

export default function ImageResearch({
  investigation,
  placeName,
  candidate,
  onReference,
  disabled,
  onBusy,
}) {
  const [query, setQuery] = useState(placeName || '');
  const [radius, setRadius] = useState(1000);
  const [searchedPoint, setSearchedPoint] = useState(null);
  const [results, setResults] = useState(null);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [status, setStatus] = useState('');
  const version = useRef(0);
  useEffect(() => {
    onBusy(Boolean(busy));
  }, [busy, onBusy]);
  useEffect(
    () => () => {
      version.current++;
    },
    [],
  );

  async function downloadSearchPhoto() {
    if (busy || disabled) return;
    const token = ++version.current;
    setBusy('download');
    setError('');
    try {
      const { readPhoto } = await import('../lib/photo.mjs');
      const response = await fetch(investigation.photo);
      const blob = await response.blob();
      const clean = await readPhoto(new File([blob], 'findwhere-search.jpg', { type: blob.type }));
      if (token !== version.current) return;
      const searchBlob = await (await fetch(clean.photo)).blob();
      if (token !== version.current) return;
      const downloadUrl = URL.createObjectURL(searchBlob);
      const link = document.createElement('a');
      link.href = downloadUrl;
      link.download = 'findwhere-search.jpg';
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(downloadUrl), 10000);
      setStatus('Search copy download started. Open Lens or TinEye and upload it there.');
    } catch {
      if (token === version.current)
        setError('Could not prepare the search copy. Try another photo.');
    } finally {
      if (token === version.current) setBusy('');
    }
  }
  async function search(event, nearby = false) {
    event.preventDefault();
    if (busy || disabled) return;
    const token = ++version.current;
    setBusy('search');
    setError('');
    setStatus('');
    setResults(null);
    setSearchedPoint(nearby ? { lat: candidate.lat, lng: candidate.lng, radius } : null);
    try {
      const response = nearby
        ? await fetch('/api/references/nearby', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ lat: candidate.lat, lng: candidate.lng, radius }),
          })
        : await fetch(`/api/references?${new URLSearchParams({ q: query.trim() })}`);
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Reference search unavailable.');
      if (version.current === token) setResults(result.results);
    } catch (failure) {
      if (version.current === token) setError(failure.message);
    } finally {
      if (version.current === token) setBusy('');
    }
  }
  async function useReference(item) {
    if (busy || disabled) return;
    const token = ++version.current;
    setBusy(item.source);
    setError('');
    setStatus('');
    try {
      const url = commonsImageUrl(item.thumbnail);
      if (!url) throw new Error('Unsupported reference image host.');
      const response = await fetch(url, {
        credentials: 'omit',
        redirect: 'error',
        signal: AbortSignal.timeout(15000),
      });
      if (
        !response.ok ||
        !['image/jpeg', 'image/png', 'image/webp'].includes(
          response.headers.get('content-type')?.split(';')[0],
        )
      )
        throw new Error(
          'Reference preview could not be loaded. Save a photo from its source and import it instead.',
        );
      const reader = response.body.getReader();
      let size = 0;
      const chunks = [];
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          size += value.length;
          if (size > 3_500_000)
            throw new Error('Reference preview is too large. Import a smaller copy.');
          chunks.push(value);
        }
      } finally {
        await reader.cancel();
      }
      const { readPhoto } = await import('../lib/photo.mjs');
      const photo = await readPhoto(
        new File(chunks, item.title, { type: response.headers.get('content-type').split(';')[0] }),
      );
      if (token !== version.current) return;
      onReference({
        photo: photo.photo,
        fileName: photo.fileName,
        sourceUrl: item.source,
        attribution: item.attribution,
        ...(item.discovery ? { discovery: item.discovery } : {}),
        notes: item.date ? `Reference capture date reported by Wikimedia: ${item.date}.` : '',
      });
      setStatus(
        'Reference added with its Wikimedia source and attribution. Check that it depicts the proposed place.',
      );
    } catch (failure) {
      if (token === version.current) setError(failure.message);
    } finally {
      if (token === version.current) setBusy('');
    }
  }
  return (
    <section
      className="image-research"
      aria-label="Find reference photos"
      aria-busy={Boolean(busy)}
    >
      <h3>1. Search by image</h3>
      <p>
        Download a resized JPEG without embedded metadata, then upload it to Lens or TinEye in the
        new tab. Findwhere does not upload your photo to these services or import their results
        automatically.
      </p>
      <div className="research-actions">
        <button
          className="button secondary"
          disabled={Boolean(busy) || disabled}
          onClick={downloadSearchPhoto}
        >
          <Download size={16} /> Download search copy
        </button>
        <a
          className="button secondary"
          href="https://lens.google.com/"
          target="_blank"
          rel="noopener noreferrer"
        >
          Open Google Lens <ArrowUpRight size={15} />
        </a>
        <a
          className="button secondary"
          href="https://tineye.com/"
          target="_blank"
          rel="noopener noreferrer"
        >
          Open TinEye <ArrowUpRight size={15} />
        </a>
      </div>
      <p className="subtle">
        On the provider, choose Upload image. Save a useful result photo or screenshot, then choose
        a reference image below and record its original source URL.
      </p>
      <h3>2. Find sourced reference photos</h3>
      <p>
        Search Wikimedia Commons by place name or a distinctive feature. This is a text search, not
        a visual match. Your query and preview requests go to Wikimedia; your investigation photo
        stays here.
      </p>
      <form className="reference-search-form" onSubmit={search}>
        <div>
          <label htmlFor="reference-query">Place or feature</label>
          <input
            id="reference-query"
            value={query}
            disabled={Boolean(busy) || disabled}
            minLength={3}
            maxLength={200}
            required
            onChange={(event) => setQuery(event.target.value)}
            placeholder="For example: Château de Sceaux"
          />
        </div>
        <button
          className="button primary"
          disabled={Boolean(busy) || disabled || query.trim().length < 3}
        >
          <Search size={16} /> Search references
        </button>
      </form>
      {candidate ? (
        <form
          className="reference-search-form nearby-reference-form"
          onSubmit={(event) => search(event, true)}
        >
          <div>
            <h4>Or search near this candidate</h4>
            <p>
              {candidate.name} · {candidate.lat.toFixed(5)}, {candidate.lng.toFixed(5)}. Sends this
              point and radius to Wikimedia Commons. Your photo stays here.
            </p>
            <label htmlFor="reference-radius">Photo search radius</label>
            <select
              id="reference-radius"
              value={radius}
              disabled={Boolean(busy) || disabled}
              onChange={(event) => setRadius(Number(event.target.value))}
            >
              <option value={500}>500 m</option>
              <option value={1000}>1 km</option>
              <option value={2000}>2 km</option>
              <option value={5000}>5 km</option>
            </select>
          </div>
          <button className="button secondary" disabled={Boolean(busy) || disabled}>
            <MapPinned size={16} aria-hidden="true" /> Find photos nearby
          </button>
        </form>
      ) : (
        <p className="subtle">Add a map candidate to search for geotagged photos nearby.</p>
      )}
      <p className="subtle">
        Nearby photos are ordered by distance from their file geotag. A geotag can describe the
        photographer or the subject. Coverage is incomplete; check the scene and source.
      </p>
      {busy && (
        <p role="status">
          <LoaderCircle className="spin" size={16} />{' '}
          {busy === 'search'
            ? 'Searching Wikimedia…'
            : busy === 'download'
              ? 'Preparing search copy…'
              : 'Loading reference preview…'}
        </p>
      )}
      {error && (
        <p role="alert" className="comparison-error">
          {error}
        </p>
      )}
      {status && (
        <p role="status" className="comparison-status">
          {status}
        </p>
      )}
      {results?.length === 0 && (
        <p role="status">
          {searchedPoint
            ? 'No geotagged photo previews found in this radius. Try a wider area, search by name or import a reference.'
            : 'No reference photos found. Try the local name or import a result from Lens or TinEye.'}
        </p>
      )}
      {Boolean(results?.length) && (
        <>
          <p role="status">
            {results.length} reference previews
            {searchedPoint
              ? ` near ${searchedPoint.lat.toFixed(5)}, ${searchedPoint.lng.toFixed(5)} within ${formatDistance(searchedPoint.radius)}`
              : ' from your text search'}
            . Choose an independent view; matching the same photo does not verify a location.
          </p>
          <div className="reference-results">
            {results.map((item) => (
              <article key={item.source}>
                <img
                  src={item.thumbnail}
                  alt={item.title}
                  loading="lazy"
                  referrerPolicy="no-referrer"
                />
                <h4>{item.title}</h4>
                <p>{item.attribution}</p>
                {item.date && <p>Reported date: {item.date}</p>}
                {item.discovery && (
                  <p>
                    File geotag · {formatDistance(item.discovery.distanceMetres)} from search point
                  </p>
                )}
                {investigation.photo === '/lisbon.jpg' && item.source === photoSource && (
                  <p>This is the investigation’s sample photo. Choose another view.</p>
                )}
                <a href={item.source} target="_blank" rel="noopener noreferrer">
                  Source & license <ArrowUpRight size={13} />
                </a>
                <button
                  className="button secondary"
                  disabled={
                    Boolean(busy) ||
                    disabled ||
                    (investigation.photo === '/lisbon.jpg' && item.source === photoSource)
                  }
                  onClick={() => useReference(item)}
                >
                  Use reference: {item.title}
                </button>
              </article>
            ))}
          </div>
        </>
      )}
    </section>
  );
}
