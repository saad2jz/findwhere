import { useEffect, useRef, useState } from 'react';
import { ImagePlus, LoaderCircle } from 'lucide-react';
import Modal from './Modal.jsx';
import PhotoInspector from './PhotoInspector.jsx';
import { referenceDetailsSchema, referenceSchema, safeUrl } from '../lib/domain.mjs';
import { comparisonSchema, comparisonVerdicts } from '../lib/image-research.mjs';
import ImageResearch from './ImageResearch.jsx';
import { formatDistance } from '../lib/geo.mjs';

export default function PhotoComparison({
  investigation,
  onChange,
  onClose,
  children,
  health,
  providerName,
  onRefreshHealth,
  onUnlock,
  startResearch,
  placeName,
  candidate,
}) {
  const reference = investigation.reference;
  const input = useRef(null);
  const request = useRef(0);
  const [loading, setLoading] = useState(false);
  const [referenceVersion, setReferenceVersion] = useState(0);
  const [removedReference, setRemovedReference] = useState(null);
  const [error, setError] = useState('');
  const [fieldErrors, setFieldErrors] = useState({});
  const [status, setStatus] = useState('');
  const [sourceUrl, setSourceUrl] = useState(reference?.sourceUrl || '');
  const [notes, setNotes] = useState(reference?.notes || '');
  const [aiBusy, setAiBusy] = useState(false);
  const [researchBusy, setResearchBusy] = useState(false);
  const [consent, setConsent] = useState(false);
  useEffect(
    () => () => {
      request.current++;
    },
    [],
  );
  useEffect(() => {
    setSourceUrl(reference?.sourceUrl || '');
    setNotes(reference?.notes || '');
    setFieldErrors({});
  }, [reference?.photo, reference?.sourceUrl, reference?.notes]);

  async function compareWithAI() {
    if (!reference || !consent || loading || aiBusy || researchBusy) return;
    const token = ++request.current;
    setAiBusy(true);
    setError('');
    setStatus('');
    try {
      let image = investigation.photo;
      if (image === '/lisbon.jpg') {
        const { readPhoto } = await import('../lib/photo.mjs');
        const blob = await (await fetch(image)).blob();
        image = (await readPhoto(new File([blob], 'sample.jpg', { type: blob.type }))).photo;
      }
      if (image === reference.photo)
        throw new Error('Choose an independent reference, not the same image.');
      if (image.length + reference.photo.length > 5_000_000)
        throw new Error('The two previews exceed the combined AI limit. Import smaller images.');
      const response = await fetch('/api/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode: 'comparison', image, referenceImage: reference.photo }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Image comparison failed.');
      const result = comparisonSchema.parse(data);
      if (token !== request.current) return;
      onChange({
        ...reference,
        comparison: { ...result, comparedAt: new Date().toISOString(), provider: providerName },
      });
      setStatus(
        'AI comparison saved. Review the findings; no candidate status or map point was changed.',
      );
    } catch (failure) {
      if (token === request.current) setError(failure.message);
    } finally {
      if (token === request.current) {
        setAiBusy(false);
        setConsent(false);
        onRefreshHealth();
      }
    }
  }

  async function chooseReference(file) {
    if (!file || loading || aiBusy || researchBusy) return;
    const token = ++request.current;
    setLoading(true);
    setError('');
    setStatus('');
    try {
      const { readPhoto } = await import('../lib/photo.mjs');
      const photo = await readPhoto(file);
      if (token !== request.current) return;
      const value = referenceSchema.parse({
        photo: photo.photo,
        fileName: photo.fileName,
        sourceUrl: '',
        notes: '',
      });
      setReferenceVersion((previous) => previous + 1);
      setRemovedReference(null);
      setConsent(false);
      onChange(value);
      setStatus('Reference image added. Add its source and comparison notes below.');
    } catch (failure) {
      if (token === request.current) setError(failure.message);
    } finally {
      if (token === request.current) setLoading(false);
      if (input.current) input.current.value = '';
    }
  }
  function saveDetails(event) {
    event.preventDefault();
    setStatus('');
    const result = referenceDetailsSchema.safeParse({
      sourceUrl: safeUrl(sourceUrl.trim()) || sourceUrl.trim(),
      notes: notes.trim(),
    });
    if (!result.success) {
      const errors = {};
      for (const issue of result.error.issues) errors[issue.path[0]] = issue.message;
      setFieldErrors(errors);
      document
        .getElementById(errors.sourceUrl ? 'comparison-source-url' : 'comparison-notes')
        ?.focus();
      return;
    }
    onChange({ ...reference, ...result.data });
    setFieldErrors({});
    setStatus('Reference details saved with this investigation.');
  }
  return (
    <Modal
      title="Compare images"
      onClose={() => !aiBusy && !loading && !researchBusy && onClose()}
      wide
      className="comparison-modal"
    >
      <p className="comparison-intro">
        Compare stable landmarks, angles, and contradictions. Each image has independent view
        controls. Zoom, then drag; keyboard: + / −, arrows, R, 0.
      </p>
      <details className="research-disclosure" open={startResearch || !reference}>
        <summary>Find reference photos · reverse image search & Wikimedia</summary>
        <ImageResearch
          investigation={investigation}
          placeName={placeName}
          candidate={candidate}
          disabled={loading || aiBusy}
          onBusy={setResearchBusy}
          onReference={(value) => {
            setReferenceVersion((previous) => previous + 1);
            setRemovedReference(null);
            setConsent(false);
            onChange(referenceSchema.parse(value));
          }}
        />
      </details>
      <div className="comparison-grid">
        <section aria-label="Investigation image">
          <h3>Investigation image</h3>
          <p className="comparison-filename" title={investigation.fileName}>
            {investigation.fileName}
          </p>
          <PhotoInspector
            src={investigation.photo}
            fileName={investigation.fileName}
            label="Investigation image"
            compact
          />
        </section>
        <section aria-label="Reference image">
          <h3>Reference image</h3>
          <p className="comparison-filename" title={reference?.fileName}>
            {reference?.fileName || 'Choose an image to compare'}
          </p>
          {reference ? (
            <PhotoInspector
              key={referenceVersion}
              src={reference.photo}
              fileName={reference.fileName}
              label="Reference image"
              compact
            />
          ) : (
            <div className="comparison-empty">
              <ImagePlus size={32} aria-hidden="true" />
              <strong>A second view can reveal a match</strong>
              <p>
                Choose a reference photo or screenshot you have saved. JPEG, PNG or WebP, up to 20
                MB.
              </p>
              <button
                className="button secondary"
                type="button"
                onClick={() => input.current.click()}
                disabled={loading || aiBusy || researchBusy}
              >
                Choose reference image
              </button>
            </div>
          )}
          {reference && (
            <div className="comparison-reference-actions">
              <button
                className="button secondary"
                type="button"
                onClick={() => input.current.click()}
                disabled={loading || aiBusy || researchBusy}
              >
                Replace reference image
              </button>
              <button
                className="text-button"
                type="button"
                disabled={loading || aiBusy || researchBusy}
                onClick={() => {
                  setRemovedReference(reference);
                  onChange(null);
                  setError('');
                  setStatus('Reference removed. You can undo this while this dialog is open.');
                }}
              >
                Remove reference
              </button>
            </div>
          )}
          <input
            className="sr-only"
            ref={input}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            tabIndex={-1}
            aria-label="Reference image file"
            onChange={(event) => chooseReference(event.target.files?.[0])}
          />
          {loading && (
            <p className="comparison-loading" role="status">
              <LoaderCircle size={16} className="spin" /> Reading reference image…
            </p>
          )}
          {error && (
            <p className="comparison-error" role="alert">
              {error}
            </p>
          )}
        </section>
      </div>
      {reference?.attribution && (
        <p className="reference-attribution">
          Reference attribution: {reference.attribution}.{' '}
          <a href={safeUrl(reference.sourceUrl)} target="_blank" rel="noopener noreferrer">
            View source & license
          </a>
        </p>
      )}
      {reference?.discovery && (
        <p className="reference-attribution">
          Found within {formatDistance(reference.discovery.radius)} of{' '}
          {reference.discovery.lat.toFixed(5)}, {reference.discovery.lng.toFixed(5)}. Reported file
          geotag: {reference.discovery.geotag.lat.toFixed(5)},{' '}
          {reference.discovery.geotag.lng.toFixed(5)} (
          {formatDistance(reference.discovery.distanceMetres)} from search point). Proximity does
          not establish a visual match.
        </p>
      )}
      {reference && (
        <section className="ai-comparison" aria-label="AI image comparison" aria-busy={aiBusy}>
          <h3>Compare the two photos with {providerName}</h3>
          <p>
            The model compares visible features in image A and image B. It cannot verify the source
            label or the exact camera position. No candidate is automatically confirmed.
          </p>
          {health?.aiEnabled && (!health.authRequired || health.authenticated) ? (
            <>
              <label className="research-consent">
                <input
                  type="checkbox"
                  checked={consent}
                  disabled={aiBusy || loading || researchBusy}
                  onChange={(event) => setConsent(event.target.checked)}
                />
                Send both resized photos to {providerName} through this server. One comparison
                consumes one daily AI allowance and may use more image tokens than a single-photo
                analysis. Source URLs, notes and my reported place are not sent.
              </label>
              <button
                className="button primary"
                disabled={
                  !consent || aiBusy || loading || researchBusy || health.dailyRemaining === 0
                }
                onClick={compareWithAI}
              >
                {aiBusy ? (
                  <>
                    <LoaderCircle className="spin" size={16} /> Comparing the two photos…
                  </>
                ) : (
                  'Compare with AI'
                )}
              </button>
              {health.dailyRemaining !== undefined && (
                <p className="subtle">
                  {health.dailyRemaining} daily AI requests remaining · shared with scene analysis.
                </p>
              )}
            </>
          ) : (
            <button className="button secondary" onClick={onUnlock}>
              Unlock AI comparison
            </button>
          )}
          {reference.comparison && (
            <div className="comparison-assessment">
              <h4>{comparisonVerdicts[reference.comparison.verdict]}</h4>
              <p>{reference.comparison.summary}</p>
              <p className="subtle">
                {reference.comparison.provider} ·{' '}
                {new Date(reference.comparison.comparedAt).toLocaleString()}
              </p>
              <div className="comparison-findings">
                {reference.comparison.findings.map((finding, index) => (
                  <article key={index}>
                    <strong>{finding.feature}</strong>
                    <span className="tag">{finding.assessment}</span>
                    <p>
                      <b>Image A:</b> {finding.sourceObservation}
                    </p>
                    <p>
                      <b>Image B:</b> {finding.referenceObservation}
                    </p>
                  </article>
                ))}
              </div>
              {reference.comparison.limitations.length > 0 && (
                <>
                  <h4>Limits to check</h4>
                  <ul>
                    {reference.comparison.limitations.map((item, index) => (
                      <li key={index}>{item}</li>
                    ))}
                  </ul>
                </>
              )}
            </div>
          )}
        </section>
      )}
      {reference && (
        <form className="comparison-details" onSubmit={saveDetails} noValidate>
          <div>
            <label htmlFor="comparison-source-url">
              Reference source URL <span>(optional)</span>
            </label>
            <input
              id="comparison-source-url"
              type="url"
              value={sourceUrl}
              disabled={aiBusy || researchBusy}
              maxLength={2000}
              placeholder="https://…"
              onChange={(event) => setSourceUrl(event.target.value)}
              aria-invalid={Boolean(fieldErrors.sourceUrl)}
              aria-describedby={fieldErrors.sourceUrl ? 'comparison-source-error' : undefined}
            />
            {fieldErrors.sourceUrl && (
              <p id="comparison-source-error" className="comparison-error">
                {fieldErrors.sourceUrl}
              </p>
            )}
          </div>
          <div>
            <label htmlFor="comparison-notes">
              Comparison notes <span>(optional)</span>
            </label>
            <textarea
              id="comparison-notes"
              value={notes}
              disabled={aiBusy || researchBusy}
              maxLength={2000}
              placeholder="Which features match? What contradicts this location?"
              onChange={(event) => setNotes(event.target.value)}
              aria-invalid={Boolean(fieldErrors.notes)}
              aria-describedby={fieldErrors.notes ? 'comparison-notes-error' : undefined}
            />
            {fieldErrors.notes && (
              <p id="comparison-notes-error" className="comparison-error">
                {fieldErrors.notes}
              </p>
            )}
          </div>
          <div className="comparison-save">
            <button
              className="button primary"
              type="submit"
              disabled={loading || aiBusy || researchBusy}
            >
              Save reference details
            </button>
          </div>
        </form>
      )}
      {status && (
        <p className="comparison-status" role="status">
          {status}
        </p>
      )}
      {!reference && removedReference && (
        <button
          className="button secondary"
          type="button"
          disabled={loading || aiBusy || researchBusy}
          onClick={() => {
            onChange(removedReference);
            setRemovedReference(null);
            setReferenceVersion((previous) => previous + 1);
            setStatus('Reference restored with its source and notes.');
          }}
        >
          Undo remove reference
        </button>
      )}
      <p className="subtle">
        Reference previews are resized and stored in this browser with the investigation. Replacing
        an image clears its previous source and notes. Adding a reference does not verify a
        candidate. Both previews are included in JSON backups.
      </p>
      {children}
    </Modal>
  );
}
