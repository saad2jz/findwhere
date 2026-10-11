import { useState } from 'react';
import { Pencil } from 'lucide-react';
import Modal from './Modal.jsx';

export function AnalysisReview({ investigation, onCorrect }) {
  const review = investigation.analysisReview;
  const feedback = investigation.analysisFeedback;
  const legacy = !review && investigation.candidates.some((candidate) => candidate.source === 'ai');
  if (!review && !feedback && !legacy) return null;
  return (
    <section className="analysis-review" aria-label="AI assessment">
      <div className="candidate-edit-heading">
        <strong>{review ? 'AI assessment · unverified' : 'Review the AI result'}</strong>
        <button className="text-button" onClick={onCorrect}>
          <Pencil size={14} aria-hidden="true" /> Correct AI result
        </button>
      </div>
      {legacy && (
        <p>This result predates the stricter visual evidence checks. Its locations may be wrong.</p>
      )}
      {review && (
        <>
          <p>{review.summary}</p>
          {review.withheldCandidates > 0 && (
            <p>
              <strong>
                {review.withheldCandidates} location suggestion
                {review.withheldCandidates === 1 ? '' : 's'} kept off the map: insufficient evidence
                or no unambiguous map reference.
              </strong>
            </p>
          )}
          {review.uncertainties.length > 0 && (
            <>
              <h3>What remains uncertain</h3>
              <ul>
                {review.uncertainties.map((item, i) => (
                  <li key={i}>{item}</li>
                ))}
              </ul>
            </>
          )}
          {review.nextSteps.length > 0 && (
            <details>
              <summary>How to check the scene</summary>
              <ol>
                {review.nextSteps.map((item, i) => (
                  <li key={i}>{item}</li>
                ))}
              </ol>
            </details>
          )}
        </>
      )}
      {feedback && (
        <div className="analysis-correction">
          {feedback.knownPlace && (
            <p>
              <strong>Investigator-reported place:</strong> {feedback.knownPlace}. This is your
              correction, not an AI identification.
            </p>
          )}
          {feedback.rejectedNames.length > 0 && (
            <p>Rejected leads: {feedback.rejectedNames.join('; ')}.</p>
          )}
        </div>
      )}
    </section>
  );
}

export function AnalysisCorrection({ investigation, onSave, onClose }) {
  const [knownPlace, setKnownPlace] = useState(investigation.analysisFeedback?.knownPlace || '');
  const hasAI = investigation.candidates.some(
    (candidate) => candidate.source === 'ai' && candidate.status === 'hypothesis',
  );
  const [rejectAI, setRejectAI] = useState(hasAI);
  return (
    <Modal title="Correct the AI result" onClose={onClose}>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          onSave({ knownPlace, rejectAI });
        }}
      >
        <p>
          Record what was wrong before analyzing again. Your correction is saved locally; saving
          does not call AI.
        </p>
        <label className="notes-label" htmlFor="known-place">
          Actual place, if you know it <span>(optional)</span>
        </label>
        <input
          id="known-place"
          value={knownPlace}
          onChange={(event) => setKnownPlace(event.target.value)}
          maxLength={300}
          placeholder="For example: a park or public landmark"
        />
        {hasAI && (
          <label className="analysis-checkbox">
            <input
              type="checkbox"
              checked={rejectAI}
              onChange={(event) => setRejectAI(event.target.checked)}
            />{' '}
            Rule out all current AI hypotheses
          </label>
        )}
        <p>
          Ruled-out candidates stay in the investigation. You can restore their status from the
          candidate details.
        </p>
        <button className="button primary full-width" type="submit">
          Save correction
        </button>
      </form>
    </Modal>
  );
}
