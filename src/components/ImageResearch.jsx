import { useEffect, useRef, useState } from 'react';
import { ArrowUpRight, Download, LoaderCircle, Search } from 'lucide-react';
import { commonsImageUrl } from '../lib/image-research.mjs';

export default function ImageResearch({ investigation, placeName, onReference, disabled, onBusy }) {
  const [query, setQuery] = useState(placeName || '');
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
  async function search(event) {
    event.preventDefault();
    if (busy || disabled) return;
    const token = ++version.current;
    setBusy('search');
    setError('');
    setStatus('');
    setResults(null);
    try {
      const response = await fetch(`/api/references?${new URLSearchParams({ q: query.trim() })}`);
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
          No reference photos found. Try the local name or import a result from Lens or TinEye.
        </p>
      )}
      {Boolean(results?.length) && (
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
              <a href={item.source} target="_blank" rel="noopener noreferrer">
                Source & license <ArrowUpRight size={13} />
              </a>
              <button
                className="button secondary"
                disabled={Boolean(busy) || disabled}
                onClick={() => useReference(item)}
              >
                Use reference: {item.title}
              </button>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}
