import { useId } from 'react';
import Modal from './Modal.jsx';
import { compareCandidates, formatBearing, formatDistance } from '../lib/geo.mjs';

const statusLabel = { supported: 'Supported', hypothesis: 'Hypothesis', 'ruled-out': 'Ruled out' };
export default function CandidateComparison({ candidates, selected, onSelect, onClose }) {
  const selectId = useId();
  const origin = selected || candidates[0];
  const rows = compareCandidates(origin, candidates);
  return (
    <Modal title="Compare candidate locations" onClose={onClose} wide>
      <p>
        Compare the spacing of competing leads. Distance alone does not tell you which location is
        correct.
      </p>
      {origin ? (
        <>
          <label className="comparison-origin-label" htmlFor={selectId}>
            Origin candidate
          </label>
          <select
            className="comparison-origin-select"
            id={selectId}
            value={origin.id}
            onChange={(event) => onSelect(event.target.value)}
          >
            {candidates.map((candidate) => (
              <option key={candidate.id} value={candidate.id}>
                {candidate.name} — {statusLabel[candidate.status]}
              </option>
            ))}
          </select>
          <p className="comparison-origin-point">
            {origin.lat.toFixed(6)}, {origin.lng.toFixed(6)} · {statusLabel[origin.status]}
          </p>
          {rows.length ? (
            <div className="distance-table-wrap">
              <table className="distance-table">
                <caption>From {origin.name} · nearest first</caption>
                <thead>
                  <tr>
                    <th scope="col">Other candidate</th>
                    <th scope="col">Distance</th>
                    <th scope="col">Initial bearing</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map(({ candidate, distanceMetres, initialBearingDegrees }) => (
                    <tr key={candidate.id}>
                      <th scope="row">
                        <strong>{candidate.name}</strong>
                        <span>{candidate.country}</span>
                        <small>{statusLabel[candidate.status]}</small>
                      </th>
                      <td>{formatDistance(distanceMetres)}</td>
                      <td>{formatBearing(initialBearingDegrees)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="distance-empty">Add another candidate to compare locations.</p>
          )}
        </>
      ) : (
        <p className="distance-empty">Add at least two location candidates to make a comparison.</p>
      )}
      <p className="distance-method">
        Distances are approximate straight-line surface distances on a sphere (radius 6,371 km),
        ignoring terrain and routes. Bearings start clockwise from true north; they are not the
        camera’s viewing direction. A direction is not defined for identical or opposite points, or
        from a pole.
      </p>
      <p className="subtle">
        Changing the origin also selects that candidate on the workspace map. Exported reports use
        the currently selected candidate as their origin.
      </p>
    </Modal>
  );
}
