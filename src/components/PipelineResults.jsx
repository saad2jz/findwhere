import { Check, LoaderCircle } from 'lucide-react';
import { pipelineStages } from '../lib/search-pipeline.mjs';
import { comparisonVerdicts, commonsImageUrl } from '../lib/image-research.mjs';
import { safeUrl } from '../lib/domain.mjs';

function SourceLink({ source, children }) {
  return (
    <a href={safeUrl(source.url) || '#'} target="_blank" rel="noopener noreferrer">
      {children || source.title}
    </a>
  );
}

export function PipelineProgress({ progress }) {
  const active = pipelineStages.findIndex(([id]) => id === progress?.stage);
  return (
    <section className="pipeline-progress" aria-label="Findwhere search progress">
      <ol>
        {pipelineStages.map(([id, label], index) => (
          <li
            key={id}
            aria-current={index === active ? 'step' : undefined}
            className={index === active ? 'active' : index < active ? 'complete' : ''}
          >
            <span aria-hidden="true">
              {index < active ? (
                <Check size={16} />
              ) : index === active ? (
                <LoaderCircle size={16} className="spin" />
              ) : (
                index + 1
              )}
            </span>
            {label}
          </li>
        ))}
      </ol>
      <p role="status">
        {progress?.detail || 'Starting the search…'} A full search can take several minutes.
      </p>
    </section>
  );
}

export default function PipelineResults({ pipeline }) {
  if (!pipeline) return null;
  return (
    <section className="pipeline-results" aria-label="Findwhere search evidence">
      <h3>Findwhere search · evidence trail</h3>
      <p>
        {pipeline.engines.join(' · ')}
        <br />
        {pipeline.requestsUsed} AI request{pipeline.requestsUsed === 1 ? '' : 's'} ·{' '}
        {pipeline.queries.length} searches · {pipeline.sources.length} retrieved sources
      </p>
      <p>
        {pipeline.contextUsed || pipeline.correctionUsed
          ? `Context-assisted run${pipeline.correctionUsed ? '; your correction was included' : ''}.`
          : 'Photo-only run. Saved map candidates, notes and corrections were not supplied.'}
      </p>
      {pipeline.warnings.map((warning, index) => (
        <p className="pipeline-warning" key={index}>
          {warning}
        </p>
      ))}
      {pipeline.checks.map((check, index) => {
        const reference = pipeline.sources.find((source) => source.id === check.referenceId);
        const thumbnail = commonsImageUrl(reference?.thumbnail);
        return (
          <article className="pipeline-check" key={check.id}>
            <h4>
              {index + 1}. {check.name}
              {check.country ? ` · ${check.country}` : ''}
            </h4>
            <span className="tag">
              {check.status === 'mapped'
                ? 'Map record found · hypothesis'
                : check.status === 'contradicted'
                  ? 'Contradictions · kept off map'
                  : 'Map identity unresolved · kept off map'}
            </span>
            <p>{check.reason}</p>
            <p>
              <strong>Uncertainty:</strong> {check.uncertainty}
            </p>
            <p>
              <strong>Reference check:</strong>{' '}
              {check.comparison
                ? comparisonVerdicts[check.comparison.verdict]
                : check.referenceStatus === 'skipped'
                  ? 'Comparison not completed'
                  : 'No relevant reference photo available'}
            </p>
            <ul>
              {check.sourceIds.map((id) => {
                const source = pipeline.sources.find((item) => item.id === id);
                return source ? (
                  <li key={id}>
                    <SourceLink source={source} />
                  </li>
                ) : null;
              })}
            </ul>
            <details>
              <summary>Visible clues behind this proposal</summary>
              <ul>
                {check.features.map((feature, i) => (
                  <li key={i}>{feature}</li>
                ))}
              </ul>
            </details>
            {reference && (
              <div className="pipeline-reference">
                {thumbnail && (
                  <SourceLink source={reference}>
                    <img
                      src={thumbnail}
                      alt={`Retrieved reference: ${reference.title}`}
                      loading="lazy"
                      referrerPolicy="no-referrer"
                    />
                  </SourceLink>
                )}
                <p>
                  <SourceLink source={reference} />
                  <br />
                  {reference.attribution}
                  {reference.date ? ` · Declared date: ${reference.date}` : ''}
                </p>
                <p>The source label and camera position have not been independently verified.</p>
              </div>
            )}
            {check.comparison && (
              <details>
                <summary>Paired photo findings</summary>
                <p>{check.comparison.summary}</p>
                {check.comparison.findings.map((finding, i) => (
                  <div className="pipeline-finding" key={i}>
                    <strong>
                      {finding.feature} · {finding.assessment}
                    </strong>
                    <p>Investigation: {finding.sourceObservation}</p>
                    <p>Reference: {finding.referenceObservation}</p>
                  </div>
                ))}
                <ul>
                  {check.comparison.limitations.map((limitation, i) => (
                    <li key={i}>{limitation}</li>
                  ))}
                </ul>
              </details>
            )}
          </article>
        );
      })}
      {!pipeline.checks.length && (
        <p>
          No specific place survived the source and clue checks. The search record below remains
          available for follow-up.
        </p>
      )}
      <details>
        <summary>Search queries and retrieved sources</summary>
        <ol>
          {pipeline.queries.map((query, index) => (
            <li key={index}>
              <strong>{query.service}:</strong> {query.query}
            </li>
          ))}
        </ol>
        <ul>
          {pipeline.sources.map((source) => (
            <li key={source.id}>
              <SourceLink source={source} /> <span className="muted">({source.kind})</span>
            </li>
          ))}
        </ul>
      </details>
      <p className="muted">
        Rank reflects evidence checks, not a measured probability. Text search is not reverse-image
        matching. Map points locate public places, not the camera.
      </p>
    </section>
  );
}
