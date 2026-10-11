import { useRef, useState } from 'react';
import { Check, Link2 } from 'lucide-react';
import Modal from './Modal.jsx';
import { validateCandidateEdit, validateEvidence } from '../lib/investigation.mjs';

const labels = {
  text: 'Observation',
  category: 'Category',
  source: 'Source name',
  url: 'Source URL',
  observedOn: 'Reference date',
  name: 'Location name',
  country: 'City or country',
  coordinates: 'Latitude, longitude (WGS84)',
  confidence: 'Confidence',
  status: 'Candidate status',
  reason: 'Reasoning and verification notes',
};

function ErrorSummary({ errors, summaryRef }) {
  if (!Object.keys(errors).length) return null;
  return (
    <div className="editor-errors" role="alert" tabIndex={-1} ref={summaryRef}>
      <strong>Check these fields before saving.</strong>
      <ul>
        {Object.entries(errors).map(([field, message]) => (
          <li key={field}>
            <a href={`#editor-${field}`}>
              {labels[field] || 'Details'}: {message}
            </a>
          </li>
        ))}
      </ul>
    </div>
  );
}

function validateBlur(event, result, setErrors) {
  // Let button actions validate on submit, so blur feedback cannot move a button mid-click.
  if (event.relatedTarget?.tagName === 'BUTTON') return;
  const key = event.target.id.replace('editor-', '');
  if (!labels[key]) return;
  setErrors((previous) => {
    const next = { ...previous };
    if (result.errors[key]) next[key] = result.errors[key];
    else delete next[key];
    return next;
  });
}

function Field({ name, label, value, setValue, errors, children, multiline = false, ...props }) {
  const Tag = multiline ? 'textarea' : 'input';
  return (
    <div className="editor-field">
      <label htmlFor={`editor-${name}`}>{label || labels[name]}</label>
      {children || (
        <Tag
          id={`editor-${name}`}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onInput={props.type === 'date' ? (e) => setValue(e.target.value) : undefined}
          aria-invalid={Boolean(errors[name])}
          aria-describedby={errors[name] ? `error-${name}` : undefined}
          {...props}
        />
      )}
      {errors[name] && (
        <p id={`error-${name}`} className="field-error">
          {errors[name]}
        </p>
      )}
    </div>
  );
}

export function EvidenceEditor({ evidence, onSave, onClose }) {
  const [draft, setDraft] = useState({
    text: evidence?.text || '',
    category: evidence?.category || 'Observation',
    source: evidence?.source || 'Investigator',
    url: evidence?.url || '',
    observedOn: evidence?.observedOn || '',
  });
  const [errors, setErrors] = useState({});
  const [submitted, setSubmitted] = useState(false);
  const summary = useRef(null);
  const set = (key) => (value) => setDraft((previous) => ({ ...previous, [key]: value }));
  function save(event) {
    event.preventDefault();
    setSubmitted(true);
    const result = validateEvidence(draft, evidence);
    setErrors(result.errors);
    if (result.value) onSave(result.value);
    else requestAnimationFrame(() => summary.current?.focus());
  }
  return (
    <Modal title={evidence ? 'Edit evidence' : 'Add sourced evidence'} onClose={onClose}>
      <p>Record one observable detail and the source you used to check it.</p>
      <form
        className="investigation-editor"
        onSubmit={save}
        onBlur={(event) => validateBlur(event, validateEvidence(draft, evidence), setErrors)}
        noValidate
      >
        {submitted && <ErrorSummary errors={errors} summaryRef={summary} />}
        <Field
          name="text"
          value={draft.text}
          setValue={set('text')}
          errors={errors}
          multiline
          maxLength={2000}
          required
        />
        <Field
          name="category"
          value={draft.category}
          setValue={set('category')}
          errors={errors}
          maxLength={80}
          list="evidence-categories"
        />
        <datalist id="evidence-categories">
          {[
            'Observation',
            'Architecture',
            'Language',
            'Landmark',
            'Landscape',
            'Road markings',
            'Metadata',
            'Time',
            'Contradiction',
          ].map((value) => (
            <option key={value} value={value} />
          ))}
        </datalist>
        <Field
          name="source"
          value={draft.source}
          setValue={set('source')}
          errors={errors}
          maxLength={200}
        />
        <Field
          name="url"
          label="Source URL (optional)"
          value={draft.url}
          setValue={set('url')}
          errors={errors}
          maxLength={2000}
          type="text"
          inputMode="url"
          placeholder="https://…"
        />
        <Field
          name="observedOn"
          label="Reference image or source date (optional)"
          value={draft.observedOn}
          setValue={set('observedOn')}
          errors={errors}
          type="date"
        />
        <p className="editor-hint">
          {evidence
            ? 'Changing the observation or its source clears its checked status for a fresh review.'
            : 'New evidence starts unchecked. Compare it independently before checking it off.'}
        </p>
        <button className="button primary full-width" type="submit">
          <Link2 size={17} /> {evidence ? 'Save evidence' : 'Add evidence'}
        </button>
      </form>
    </Modal>
  );
}

export function CandidateEditor({ candidate, onSave, onClose }) {
  const [draft, setDraft] = useState({
    name: candidate.name,
    country: candidate.country,
    coordinates: `${candidate.lat}, ${candidate.lng}`,
    confidence: candidate.confidence,
    status: candidate.status,
    reason: candidate.reason,
  });
  const [errors, setErrors] = useState({});
  const [submitted, setSubmitted] = useState(false);
  const summary = useRef(null);
  const set = (key) => (value) => setDraft((previous) => ({ ...previous, [key]: value }));
  function save(event) {
    event.preventDefault();
    setSubmitted(true);
    const result = validateCandidateEdit(candidate, draft);
    setErrors(result.errors);
    if (result.value) onSave(result.value, result.changedPoint);
    else requestAnimationFrame(() => summary.current?.focus());
  }
  return (
    <Modal title="Refine location candidate" onClose={onClose}>
      <p>
        Record your interpretation. The original lead and its source are preserved when you make
        changes.
      </p>
      <form
        className="investigation-editor"
        onSubmit={save}
        onBlur={(event) => validateBlur(event, validateCandidateEdit(candidate, draft), setErrors)}
        noValidate
      >
        {submitted && <ErrorSummary errors={errors} summaryRef={summary} />}
        <Field
          name="name"
          value={draft.name}
          setValue={set('name')}
          errors={errors}
          maxLength={300}
          required
        />
        <Field
          name="country"
          value={draft.country}
          setValue={set('country')}
          errors={errors}
          maxLength={100}
        />
        <Field
          name="coordinates"
          value={draft.coordinates}
          setValue={set('coordinates')}
          errors={errors}
          required
        />
        <p className="editor-hint">
          Moving the point resets status to Hypothesis and confidence to Low until you verify the
          new location.
        </p>
        <div className="editor-columns">
          {['confidence', 'status'].map((name) => (
            <Field key={name} name={name} errors={errors}>
              <select
                id={`editor-${name}`}
                value={draft[name]}
                onChange={(e) => set(name)(e.target.value)}
                aria-invalid={Boolean(errors[name])}
                aria-describedby={errors[name] ? `error-${name}` : undefined}
              >
                {(name === 'confidence'
                  ? [
                      ['low', 'Low'],
                      ['medium', 'Medium'],
                      ['high', 'High'],
                    ]
                  : [
                      ['hypothesis', 'Hypothesis'],
                      ['supported', 'Supported by evidence'],
                      ['ruled-out', 'Ruled out'],
                    ]
                ).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </Field>
          ))}
        </div>
        <Field
          name="reason"
          value={draft.reason}
          setValue={set('reason')}
          errors={errors}
          multiline
          maxLength={2000}
        />
        <p className="editor-hint">
          Confidence is an investigator judgement, not a measured probability.
        </p>
        <button className="button primary full-width" type="submit">
          <Check size={17} /> Save candidate
        </button>
      </form>
    </Modal>
  );
}
