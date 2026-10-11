import { useEffect, useRef, useState } from 'react';
import { ImagePlus, LoaderCircle } from 'lucide-react';
import Modal from './Modal.jsx';
import PhotoInspector from './PhotoInspector.jsx';
import { referenceDetailsSchema, referenceSchema, safeUrl } from '../lib/domain.mjs';

export default function PhotoComparison({ investigation, onChange, onClose, children }) {
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
  }, [reference]);

  async function chooseReference(file) {
    if (!file || loading) return;
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
    <Modal title="Compare images" onClose={onClose} wide className="comparison-modal">
      <p className="comparison-intro">
        Compare stable landmarks, angles, and contradictions. Each image has independent view
        controls. Zoom, then drag; keyboard: + / −, arrows, R, 0.
      </p>
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
                disabled={loading}
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
                disabled={loading}
              >
                Replace reference image
              </button>
              <button
                className="text-button"
                type="button"
                disabled={loading}
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
            <button className="button primary" type="submit" disabled={loading}>
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
          disabled={loading}
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
