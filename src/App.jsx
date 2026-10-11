import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react';
import {
  ArrowDownToLine,
  ArrowRight,
  ArrowUpRight,
  BookOpen,
  Check,
  CheckCircle2,
  ChevronRight,
  CircleHelp,
  Compass,
  Crosshair,
  Database,
  FileImage,
  FileText,
  FolderOpen,
  Globe2,
  ImagePlus,
  Layers,
  LoaderCircle,
  MapPin,
  Maximize2,
  Plus,
  Search,
  Settings2,
  ShieldCheck,
  Sparkles,
  Upload,
  X,
} from 'lucide-react';
import {
  createCase,
  exportReport,
  mapLinks,
  parseCoordinates,
  resourceLink,
  safeUrl,
} from './lib/domain.mjs';
import { loadCases, saveCase } from './lib/storage.mjs';
import { demoCase, photoSource } from './data/demo.mjs';
import catalog from './data/resources.json';

const MapPanel = lazy(() => import('./components/MapPanel.jsx'));

const categories = [
  'all',
  'maps',
  'streetlevel',
  'satellite',
  'geodata',
  'weather',
  'terrain',
  'search',
  'imagery',
];
const categoryNames = {
  all: 'All resources',
  maps: 'Maps',
  streetlevel: 'Street imagery',
  satellite: 'Satellite',
  geodata: 'Geospatial data',
  weather: 'Weather',
  terrain: 'Terrain',
  search: 'Search',
  imagery: 'Image search',
};
const icons = {
  maps: MapPin,
  streetlevel: Compass,
  satellite: Layers,
  geodata: Database,
  weather: Globe2,
  terrain: Crosshair,
  search: Search,
  imagery: FileImage,
};
const uid = () => crypto.randomUUID();
const fmtDate = (value) =>
  new Date(value).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });

function External({ href, children, ...props }) {
  return (
    <a href={safeUrl(href) || '#'} target="_blank" rel="noopener noreferrer" {...props}>
      {children}
    </a>
  );
}
function Tag({ children, tone = '' }) {
  return <span className={`tag ${tone}`}>{children}</span>;
}
function Modal({ title, children, onClose, wide = false }) {
  const ref = useRef(null);
  useEffect(() => {
    ref.current.showModal();
  }, []);
  return (
    <dialog
      ref={ref}
      className={wide ? 'wide-modal' : ''}
      onCancel={onClose}
      onClick={(event) => {
        if (event.target === ref.current) onClose();
      }}
      aria-labelledby="modal-title"
    >
      <header className="modal-header">
        <h2 id="modal-title">{title}</h2>
        <button className="icon-button" onClick={onClose} aria-label="Close dialog">
          <X size={20} />
        </button>
      </header>
      <div className="modal-body">{children}</div>
    </dialog>
  );
}

export default function App() {
  const [page, setPage] = useState('workspace');
  const [current, setCurrent] = useState(demoCase);
  const [cases, setCases] = useState([]);
  const [selectedId, setSelectedId] = useState('demo-castle');
  const [ready, setReady] = useState(false);
  const [saveStatus, setSaveStatus] = useState('Sample investigation');
  const [health, setHealth] = useState({ aiEnabled: false });
  const [busy, setBusy] = useState('');
  const [message, setMessage] = useState('');
  const [modal, setModal] = useState(null);
  const [tab, setTab] = useState('evidence');
  const [category, setCategory] = useState('all');
  const [resourceSearch, setResourceSearch] = useState('');
  const [caseSearch, setCaseSearch] = useState('');
  const [context, setContext] = useState('');
  const [note, setNote] = useState('');
  const [dragging, setDragging] = useState(false);
  const input = useRef(null);
  const revision = useRef(0);
  const currentRef = useRef(current);
  currentRef.current = current;
  const selected = current.candidates.find((c) => c.id === selectedId) || current.candidates[0];
  const onSelect = useCallback((id) => setSelectedId(id), []);

  useEffect(() => {
    loadCases()
      .then(setCases)
      .catch((error) => setMessage(error.message))
      .finally(() => setReady(true));
    fetch('/api/health')
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then(setHealth)
      .catch(() => setHealth({ aiEnabled: false, offline: true }));
  }, []);
  useEffect(() => {
    if (current.demo) {
      setSaveStatus('Sample investigation');
      return;
    }
    if (!ready) return;
    let active = true;
    setSaveStatus('Saving…');
    const timeout = setTimeout(() => {
      saveCase(current)
        .then(() => {
          if (!active) return;
          setSaveStatus('Saved on this browser');
          setCases((previous) => [current, ...previous.filter((c) => c.id !== current.id)]);
        })
        .catch((error) => {
          if (active) {
            setSaveStatus('Not saved');
            setMessage(error.message);
          }
        });
    }, 350);
    return () => {
      active = false;
      clearTimeout(timeout);
    };
  }, [current, ready]);
  useEffect(() => {
    if (!message) return;
    const timer = setTimeout(() => setMessage(''), 8000);
    return () => clearTimeout(timer);
  }, [message]);

  function update(change) {
    setCurrent((previous) => ({ ...previous, ...change, updatedAt: new Date().toISOString() }));
  }
  function flushCurrent() {
    const value = currentRef.current;
    if (!ready || value.demo) return;
    saveCase(value)
      .then(() => setCases((previous) => [value, ...previous.filter((c) => c.id !== value.id)]))
      .catch((error) => setMessage(error.message));
  }
  function startNew() {
    flushCurrent();
    revision.current++;
    setCurrent(createCase());
    setSelectedId(null);
    setPage('workspace');
    setContext('');
    setTab('evidence');
  }
  function openCase(item) {
    flushCurrent();
    revision.current++;
    setCurrent(item);
    setSelectedId(item.candidates[0]?.id);
    setPage('workspace');
    setContext('');
  }
  async function uploadPhoto(file) {
    if (!file || busy) return;
    setBusy('photo');
    const requestRevision = ++revision.current;
    try {
      const { readPhoto } = await import('./lib/photo.mjs');
      const photo = await readPhoto(file);
      if (requestRevision !== revision.current) return;
      flushCurrent();
      const investigation = createCase(
        file.name
          .replace(/\.[^.]+$/, '')
          .replaceAll(/[_-]/g, ' ')
          .slice(0, 200) || 'Photo investigation',
      );
      investigation.photo = photo.photo;
      investigation.fileName = photo.fileName;
      investigation.metadata = photo.metadata;
      if (photo.gps) {
        investigation.candidates.push({
          ...photo.gps,
          id: uid(),
          name: 'Embedded GPS location',
          country: 'Verify with reference imagery',
          confidence: 'high',
          status: 'hypothesis',
          source: 'gps',
          reason:
            'Coordinates extracted locally from the original file. Embedded metadata can be edited; compare the scene before confirming this point.',
        });
        investigation.clues.push({
          id: uid(),
          category: 'Metadata',
          text: `Embedded GPS: ${photo.gps.lat}, ${photo.gps.lng}`,
          source: 'Original photo EXIF',
          checked: false,
        });
      }
      setCurrent(investigation);
      setSelectedId(investigation.candidates[0]?.id);
      setPage('workspace');
      setTab('evidence');
      setContext('');
      setMessage(
        photo.gps
          ? 'GPS found. A location candidate has been added to the map.'
          : 'Photo ready. Add a location candidate or explore the scene clues.',
      );
    } catch (error) {
      setMessage(error.message);
    } finally {
      setBusy('');
      if (input.current) input.current.value = '';
    }
  }
  async function analyzePhoto() {
    if (!current.photo || current.demo || busy) return;
    setBusy('analysis');
    const requestRevision = revision.current;
    try {
      const response = await fetch('/api/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ image: current.photo, context }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Analysis failed. Please try again.');
      if (requestRevision !== revision.current) return;
      const candidates = result.candidates.map((c) => ({
        ...c,
        id: uid(),
        source: 'ai',
        status: 'hypothesis',
      }));
      setCurrent((previous) => ({
        ...previous,
        updatedAt: new Date().toISOString(),
        candidates: [...previous.candidates.filter((c) => c.source !== 'ai'), ...candidates].slice(
          0,
          50,
        ),
        clues: [
          ...previous.clues.filter((c) => c.source !== 'AI scene analysis'),
          ...result.clues.map((c) => ({
            ...c,
            id: uid(),
            checked: false,
            source: 'AI scene analysis',
          })),
        ].slice(0, 100),
        notes: [
          previous.notes,
          `AI scene read (unverified): ${result.summary}`,
          'Next checks:\n' + result.nextSteps.map((s) => '• ' + s).join('\n'),
        ]
          .filter(Boolean)
          .join('\n\n')
          .slice(0, 20000),
      }));
      if (candidates.length) setSelectedId(candidates[0].id);
      setMessage(
        candidates.length
          ? 'Scene analysis added. Verify these hypotheses against independent imagery.'
          : 'Clues added. The scene was too ambiguous for a location candidate.',
      );
      setModal(null);
    } catch (error) {
      setMessage(error.message);
    } finally {
      setBusy('');
    }
  }
  async function addCandidate(candidate) {
    if (current.candidates.length >= 50) {
      setMessage('This investigation already has 50 candidates.');
      return;
    }
    const value = {
      ...candidate,
      id: uid(),
      confidence: 'low',
      status: 'hypothesis',
      source: 'manual',
      reason:
        'Added by the investigator. Compare the scene and record supporting or contradictory evidence.',
    };
    update({ candidates: [...current.candidates, value] });
    setSelectedId(value.id);
    setModal(null);
  }
  function toggleClue(id) {
    update({ clues: current.clues.map((c) => (c.id === id ? { ...c, checked: !c.checked } : c)) });
  }
  function addClue(event) {
    event.preventDefault();
    if (!note.trim() || current.clues.length >= 100) return;
    update({
      clues: [
        ...current.clues,
        {
          id: uid(),
          category: 'Observation',
          text: note.trim(),
          source: 'Investigator',
          checked: false,
        },
      ],
    });
    setNote('');
  }
  async function downloadReport() {
    const text = exportReport(current);
    const blob = new Blob([text], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `${current.title.replace(/[^\p{L}\p{N} -]/gu, '').trim() || 'findwhere'}-report.md`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
    setMessage('Report download started.');
  }
  const filteredResources = catalog.resources.filter(
    (r) =>
      (category === 'all' || r.category === category) &&
      `${r.name} ${r.description} ${r.tags.join(' ')}`
        .toLowerCase()
        .includes(resourceSearch.toLowerCase()),
  );
  const sampleResources = catalog.resources.filter((r) =>
    ['google-maps', 'mapillary', 'earth-engine', 'google-lens'].includes(r.id),
  );

  return (
    <div className="app-shell">
      <a className="skip-link" href="#main">
        Skip to content
      </a>
      <aside className="sidebar">
        <button
          className="brand"
          onClick={() => setPage('workspace')}
          aria-label="Findwhere workspace"
        >
          <img src="/favicon.svg" alt="" />
          <span>
            findwhere<span className="brand-period">.</span>
          </span>
        </button>
        <div className="workspace-label">PERSONAL WORKSPACE</div>
        <nav aria-label="Main navigation">
          <button
            className={page === 'workspace' ? 'active' : ''}
            onClick={() => setPage('workspace')}
          >
            <Compass size={19} /> Workspace
          </button>
          <button className={page === 'cases' ? 'active' : ''} onClick={() => setPage('cases')}>
            <FolderOpen size={19} /> Investigations{' '}
            <span className="nav-count">{cases.length}</span>
          </button>
          <button
            className={page === 'resources' ? 'active' : ''}
            onClick={() => setPage('resources')}
          >
            <Globe2 size={19} /> Resource library
          </button>
        </nav>
        <div className="sidebar-section">
          <span>FIELD GUIDE</span>
          <button onClick={() => setModal('guide')}>
            <BookOpen size={17} /> How to investigate <ArrowUpRight size={14} />
          </button>
        </div>
        <div className="sidebar-bottom">
          <div className="privacy-card">
            <ShieldCheck size={21} />
            <strong>
              Your investigation.
              <br />
              Your browser.
            </strong>
            <p>Photos and case notes stay in local storage until you choose to share them.</p>
          </div>
          <button className="profile" onClick={() => setModal('settings')}>
            <span className="avatar">S</span>
            <span>
              <strong>Saad’s workspace</strong>
              <small>Personal / local</small>
            </span>
            <Settings2 size={16} />
          </button>
        </div>
      </aside>
      <div className="main-shell">
        <header className="topbar">
          <div className="breadcrumb">
            <span>Workspace</span>
            <ChevronRight size={14} />
            <strong>
              {page === 'workspace'
                ? 'Investigation'
                : page === 'cases'
                  ? 'Investigations'
                  : 'Resources'}
            </strong>
          </div>
          <div className="top-actions">
            <span className="local-status">
              <span className="live-dot" /> Local-first workspace
            </span>
            <button
              className="icon-button"
              onClick={() => setModal('guide')}
              aria-label="Open investigation guide"
            >
              <CircleHelp size={19} />
            </button>
            <button
              className="icon-button"
              onClick={() => setModal('settings')}
              aria-label="Open settings"
            >
              <Settings2 size={19} />
            </button>
          </div>
        </header>
        <main id="main">
          {page === 'workspace' && (
            <>
              <div className="page-heading">
                <div>
                  <div className="eyebrow">
                    <span className="small-compass">↗</span> FIND THE PLACE BEHIND THE PICTURE
                  </div>
                  <h1>{current.photo ? current.title : 'Every picture has a place.'}</h1>
                  <p>
                    {current.demo
                      ? 'Follow the clues. Compare the possibilities. Find your way there.'
                      : current.photo
                        ? 'Build a location hypothesis, then follow the evidence.'
                        : 'Start with a photo. Turn the details into a direction.'}
                  </p>
                </div>
                <div className="heading-actions">
                  <button className="button secondary" onClick={downloadReport}>
                    <ArrowDownToLine size={16} /> Export report
                  </button>
                  <button className="button primary" onClick={startNew} disabled={Boolean(busy)}>
                    <Plus size={17} /> New investigation
                  </button>
                </div>
              </div>
              <div className="case-strip">
                <div>
                  <span className="case-number">
                    {current.demo ? 'FW / SAMPLE' : `FW / ${current.id.slice(0, 6).toUpperCase()}`}
                  </span>
                  <span className="separator">/</span>
                  <span>{current.demo ? 'Lisbon, Portugal' : 'Photo investigation'}</span>
                  {current.demo && <Tag tone="gold">Sample case</Tag>}
                </div>
                <span className="save-status">
                  <CheckCircle2 size={13} /> {saveStatus}
                </span>
              </div>
              <section className="investigation-grid" aria-label="Photo and map workspace">
                <div className="panel photo-panel">
                  <div className="panel-header">
                    <h2>
                      <FileImage size={17} /> Source image
                    </h2>
                    <button
                      className="text-button"
                      onClick={() => input.current.click()}
                      disabled={Boolean(busy)}
                    >
                      <Upload size={14} /> {current.photo ? 'Replace photo' : 'Upload photo'}
                    </button>
                  </div>
                  <div
                    className={`photo-stage ${current.photo ? 'has-photo' : 'empty-photo'} ${dragging ? 'dragging' : ''}`}
                    onDragOver={(e) => {
                      e.preventDefault();
                      setDragging(true);
                    }}
                    onDragLeave={() => setDragging(false)}
                    onDrop={(e) => {
                      e.preventDefault();
                      setDragging(false);
                      uploadPhoto(e.dataTransfer.files[0]);
                    }}
                  >
                    {current.photo ? (
                      <>
                        <img
                          src={current.photo}
                          alt={
                            current.demo
                              ? 'Terracotta rooftops and the historic skyline of Lisbon, a sample investigation'
                              : `Investigation source: ${current.fileName}`
                          }
                        />
                        <div className="photo-corners" aria-hidden="true">
                          <i />
                          <i />
                          <i />
                          <i />
                        </div>
                        <span className="photo-badge">
                          <span className="live-dot" />{' '}
                          {current.demo ? 'Reference image' : 'Original metadata read locally'}
                        </span>
                        <button
                          className="photo-expand"
                          onClick={() => setModal('photo')}
                          aria-label="Expand source image"
                        >
                          <Maximize2 size={17} />
                        </button>
                      </>
                    ) : (
                      <button
                        className="upload-target"
                        onClick={() => input.current.click()}
                        disabled={Boolean(busy)}
                      >
                        <span className="upload-orbit">
                          <ImagePlus size={29} />
                        </span>
                        <strong>
                          {busy === 'photo'
                            ? 'Reading your photo…'
                            : 'Drop a picture. Start exploring.'}
                        </strong>
                        <span>Drag an image here, or choose a file</span>
                        <small>JPEG, PNG or WebP · up to 20 MB</small>
                      </button>
                    )}
                    {busy === 'photo' && (
                      <div className="photo-loading">
                        <LoaderCircle className="spin" /> Reading photo & metadata…
                      </div>
                    )}
                  </div>
                  <div className="photo-footer">
                    <div>
                      <FileImage size={17} />
                      <span>
                        <strong>{current.fileName || 'No image selected'}</strong>
                        <small>
                          {current.metadata.Dimensions || 'Your photo is processed in this browser'}
                        </small>
                      </span>
                    </div>
                    {current.demo ? (
                      <External className="source-credit" href={photoSource}>
                        Bert K. · CC BY 2.0 <ArrowUpRight size={12} />
                      </External>
                    ) : (
                      <Tag>
                        {current.metadata.GPS && current.metadata.GPS !== 'Not embedded'
                          ? 'GPS found'
                          : 'Local photo'}
                      </Tag>
                    )}
                  </div>
                </div>
                <div className="panel map-panel">
                  <div className="panel-header">
                    <h2>
                      <MapPin size={17} /> Explore the location
                    </h2>
                    <span className="subtle">WGS84 coordinates</span>
                  </div>
                  <Suspense
                    fallback={
                      <div className="map-wrap map-skeleton">
                        <LoaderCircle className="spin" size={20} /> Loading map…
                      </div>
                    }
                  >
                    <MapPanel
                      candidates={current.candidates}
                      selected={selected}
                      onSelect={onSelect}
                    />
                  </Suspense>
                  <div className="map-footer">
                    <span>
                      <span className="legend-dot" /> Selected candidate{' '}
                      <span className="legend-dot outline" /> Alternative
                    </span>
                    <span>
                      {current.candidates.length}{' '}
                      {current.candidates.length === 1 ? 'location' : 'locations'}
                    </span>
                  </div>
                </div>
              </section>
              <div className="analysis-bar">
                <div className="analysis-icon">
                  <Sparkles size={21} />
                </div>
                <div>
                  <strong>A second pair of eyes.</strong>
                  <p>
                    {health.aiEnabled
                      ? 'Let AI read the scene for architecture, language, terrain and other clues.'
                      : 'Extract GPS locally, or connect AI to read the scene and suggest location hypotheses.'}
                  </p>
                </div>
                <button
                  className="button analysis-button"
                  onClick={() =>
                    setModal(
                      health.aiEnabled && current.photo && !current.demo ? 'analyze' : 'settings',
                    )
                  }
                  disabled={Boolean(busy)}
                >
                  {busy === 'analysis' ? (
                    <LoaderCircle size={16} className="spin" />
                  ) : (
                    <Sparkles size={16} />
                  )}
                  {health.aiEnabled && current.photo && !current.demo
                    ? 'Analyze scene'
                    : 'Set up AI analysis'}
                  <ArrowRight size={15} />
                </button>
              </div>
              <section className="lower-grid">
                <div className="panel candidates-panel">
                  <div className="panel-header">
                    <h2>
                      Location candidates{' '}
                      <span className="count-badge">{current.candidates.length}</span>
                    </h2>
                    <button className="text-button" onClick={() => setModal('candidate')}>
                      <Plus size={15} /> Add
                    </button>
                  </div>
                  <div className="candidate-list">
                    {current.candidates.length ? (
                      current.candidates.map((candidate, index) => (
                        <button
                          key={candidate.id}
                          className={`candidate-card ${selected?.id === candidate.id ? 'selected' : ''} ${candidate.status === 'ruled-out' ? 'ruled-out' : ''}`}
                          onClick={() => setSelectedId(candidate.id)}
                        >
                          <span className="candidate-index">
                            {String(index + 1).padStart(2, '0')}
                          </span>
                          <span className="candidate-info">
                            <strong>{candidate.name}</strong>
                            <small>{candidate.country}</small>
                            <span className="candidate-tags">
                              <Tag
                                tone={
                                  candidate.status === 'supported'
                                    ? 'green'
                                    : candidate.status === 'ruled-out'
                                      ? ''
                                      : 'gold'
                                }
                              >
                                {candidate.status === 'supported'
                                  ? 'Supported'
                                  : candidate.status === 'ruled-out'
                                    ? 'Ruled out'
                                    : 'Hypothesis'}
                              </Tag>
                              <span>
                                {candidate.source === 'demo'
                                  ? 'Sample reference'
                                  : candidate.source === 'gps'
                                    ? 'EXIF metadata'
                                    : candidate.source === 'ai'
                                      ? 'AI suggestion'
                                      : 'Manual lead'}
                              </span>
                            </span>
                          </span>
                          <ChevronRight size={15} />
                        </button>
                      ))
                    ) : (
                      <div className="empty-section">
                        <MapPin size={25} />
                        <strong>No candidates yet</strong>
                        <p>Add a place you suspect, search a landmark, or use embedded GPS.</p>
                        <button className="text-button" onClick={() => setModal('candidate')}>
                          Add your first candidate <ArrowRight size={14} />
                        </button>
                      </div>
                    )}
                  </div>
                  {selected && (
                    <div className="candidate-details">
                      <p>{selected.reason}</p>
                      <label className="status-label">
                        Candidate status
                        <select
                          value={selected.status}
                          onChange={(e) =>
                            update({
                              candidates: current.candidates.map((c) =>
                                c.id === selected.id ? { ...c, status: e.target.value } : c,
                              ),
                            })
                          }
                        >
                          <option value="hypothesis">Hypothesis</option>
                          <option value="supported">Supported by evidence</option>
                          <option value="ruled-out">Ruled out</option>
                        </select>
                      </label>
                      <div className="candidate-links">
                        <External href={mapLinks(selected).google}>
                          Google Maps <ArrowUpRight size={13} />
                        </External>
                        <External href={mapLinks(selected).streetview}>
                          Street View <ArrowUpRight size={13} />
                        </External>
                      </div>
                    </div>
                  )}
                </div>
                <div className="panel ledger-panel">
                  <div className="ledger-tabs" role="tablist" aria-label="Investigation details">
                    {[
                      ['evidence', 'Evidence ledger', current.clues.length],
                      ['metadata', 'Metadata'],
                      ['notes', 'Notes'],
                    ].map(([value, label, count]) => (
                      <button
                        key={value}
                        role="tab"
                        aria-selected={tab === value}
                        aria-controls={`tab-${value}`}
                        id={`button-${value}`}
                        onClick={() => setTab(value)}
                        className={tab === value ? 'active' : ''}
                      >
                        {label}
                        {count !== undefined && <span className="count-badge">{count}</span>}
                      </button>
                    ))}
                  </div>
                  <div
                    className="ledger-content"
                    role="tabpanel"
                    id={`tab-${tab}`}
                    aria-labelledby={`button-${tab}`}
                  >
                    {tab === 'evidence' && (
                      <>
                        <div className="ledger-intro">
                          <p>The little details tell the bigger story.</p>
                          <span>{current.clues.filter((c) => c.checked).length} checked</span>
                        </div>
                        {current.clues.length ? (
                          current.clues.map((clue) => (
                            <div className="clue-row" key={clue.id}>
                              <button
                                className={`clue-check ${clue.checked ? 'checked' : ''}`}
                                onClick={() => toggleClue(clue.id)}
                                aria-label={`${clue.checked ? 'Uncheck' : 'Check'} evidence: ${clue.text}`}
                                aria-pressed={clue.checked}
                              >
                                {clue.checked && <Check size={13} />}
                              </button>
                              <div>
                                <span className="clue-category">{clue.category}</span>
                                <p>{clue.text}</p>
                                <small>
                                  {clue.source}
                                  {clue.url && (
                                    <External href={clue.url}>
                                      {' '}
                                      View source <ArrowUpRight size={11} />
                                    </External>
                                  )}
                                </small>
                              </div>
                            </div>
                          ))
                        ) : (
                          <div className="empty-evidence">
                            <Search size={23} />
                            <p>
                              Look for signs, building styles, road markings, vegetation, and
                              shadows. Record one observation at a time.
                            </p>
                          </div>
                        )}
                        <form className="add-clue" onSubmit={addClue}>
                          <label className="sr-only" htmlFor="new-clue">
                            Add an observation
                          </label>
                          <input
                            id="new-clue"
                            placeholder="Add an observation or a clue…"
                            value={note}
                            onChange={(e) => setNote(e.target.value)}
                            maxLength={2000}
                          />
                          <button
                            type="submit"
                            aria-label="Add observation"
                            disabled={!note.trim() || current.clues.length >= 100}
                          >
                            <Plus size={18} />
                          </button>
                        </form>
                      </>
                    )}
                    {tab === 'metadata' && (
                      <>
                        <p className="metadata-notice">
                          {current.demo
                            ? 'Published reference metadata from the sample photo source.'
                            : 'Read directly from your original file in this browser. Metadata can be altered.'}
                        </p>
                        <dl className="metadata-grid">
                          {Object.entries(current.metadata).map(([key, value]) => (
                            <div key={key}>
                              <dt>{key}</dt>
                              <dd>{value}</dd>
                            </div>
                          ))}
                        </dl>
                        {!Object.keys(current.metadata).length && (
                          <p className="subtle">Upload a photo to inspect its embedded metadata.</p>
                        )}
                      </>
                    )}
                    {tab === 'notes' && (
                      <>
                        <label className="notes-label" htmlFor="case-title">
                          Investigation title
                        </label>
                        <input
                          id="case-title"
                          className="title-input"
                          value={current.title}
                          onChange={(e) =>
                            update({ title: e.target.value || 'Untitled investigation' })
                          }
                          maxLength={200}
                        />
                        <label className="notes-label" htmlFor="investigator-notes">
                          Investigator notes
                        </label>
                        <textarea
                          id="investigator-notes"
                          className="notes-input"
                          placeholder="Record hypotheses, source dates, contradictions, and what to check next…"
                          value={current.notes}
                          onChange={(e) => update({ notes: e.target.value })}
                          maxLength={20000}
                        />
                      </>
                    )}
                  </div>
                </div>
              </section>
              <section className="resource-preview">
                <div className="section-heading">
                  <div>
                    <h2>Go a little further.</h2>
                    <p>The right source can turn a possibility into a place.</p>
                  </div>
                  <button className="text-button" onClick={() => setPage('resources')}>
                    Explore all {catalog.resources.length} resources <ArrowRight size={15} />
                  </button>
                </div>
                <div className="quick-resources">
                  {sampleResources.map((resource) => (
                    <ResourceCard key={resource.id} resource={resource} selected={selected} />
                  ))}
                </div>
              </section>
              <footer className="page-footer">
                <span>
                  <Compass size={14} /> Curiosity, backed by evidence.
                </span>
                <span>
                  Inspired by GeoINT & OSINT4ALL <span className="footer-dot">·</span> Findwhere 1.0
                </span>
              </footer>
            </>
          )}
          {page === 'cases' && (
            <>
              <div className="page-heading">
                <div>
                  <div className="eyebrow">YOUR FIELD NOTES</div>
                  <h1>Every trail, in one place.</h1>
                  <p>Pick up where you left off. Your investigations are saved in this browser.</p>
                </div>
                <button className="button primary" onClick={startNew}>
                  <Plus size={17} /> New investigation
                </button>
              </div>
              <div className="filter-search">
                <Search size={18} />
                <label className="sr-only" htmlFor="case-search">
                  Search investigations
                </label>
                <input
                  id="case-search"
                  value={caseSearch}
                  onChange={(e) => setCaseSearch(e.target.value)}
                  placeholder="Search your investigations…"
                />
              </div>
              <div className="saved-cases">
                {cases
                  .filter((c) => c.title.toLowerCase().includes(caseSearch.toLowerCase()))
                  .map((item) => (
                    <button className="saved-card" key={item.id} onClick={() => openCase(item)}>
                      <div className="saved-image">
                        {item.photo ? <img src={item.photo} alt="" /> : <FileImage size={35} />}
                      </div>
                      <div>
                        <h2>{item.title}</h2>
                        <p>
                          {item.candidates.length} locations · {item.clues.length} clues
                        </p>
                        <span>
                          Updated {fmtDate(item.updatedAt)} <ArrowUpRight size={15} />
                        </span>
                      </div>
                    </button>
                  ))}
              </div>
              {cases.length === 0 && (
                <div className="large-empty">
                  <FolderOpen size={35} />
                  <h2>Your first discovery is waiting.</h2>
                  <p>
                    Upload a photo to create an investigation. It will be saved here automatically.
                  </p>
                  <button
                    className="button primary"
                    onClick={() => {
                      startNew();
                      input.current.click();
                    }}
                  >
                    <ImagePlus size={18} /> Choose a photo
                  </button>
                </div>
              )}
              <button className="demo-link" onClick={() => openCase(demoCase())}>
                <Compass size={17} /> Explore the Lisbon sample investigation{' '}
                <ArrowRight size={16} />
              </button>
            </>
          )}
          {page === 'resources' && (
            <>
              <div className="page-heading">
                <div>
                  <div className="eyebrow">OPEN-SOURCE INTELLIGENCE</div>
                  <h1>A wider world of clues.</h1>
                  <p>
                    {catalog.resources.length} handpicked tools for maps, imagery, terrain, and the
                    details in between.
                  </p>
                </div>
                <External className="button secondary" href={catalog.source}>
                  OSINT4ALL directory <ArrowUpRight size={16} />
                </External>
              </div>
              <div className="resource-toolbar">
                <div className="filter-search">
                  <Search size={18} />
                  <label className="sr-only" htmlFor="resource-search">
                    Search resource library
                  </label>
                  <input
                    id="resource-search"
                    placeholder="Search by tool, clue, or keyword…"
                    value={resourceSearch}
                    onChange={(e) => setResourceSearch(e.target.value)}
                  />
                </div>
                <span>{filteredResources.length} resources</span>
              </div>
              <div className="category-filters" aria-label="Resource categories">
                {categories.map((value) => (
                  <button
                    key={value}
                    className={category === value ? 'active' : ''}
                    onClick={() => setCategory(value)}
                    aria-pressed={category === value}
                  >
                    {categoryNames[value]}
                  </button>
                ))}
              </div>
              <div className="library-grid">
                {filteredResources.map((resource) => (
                  <ResourceCard
                    key={resource.id}
                    resource={resource}
                    selected={selected}
                    expanded
                  />
                ))}
              </div>
              {!filteredResources.length && (
                <div className="large-empty">
                  <Search size={28} />
                  <h2>No resources found.</h2>
                  <p>Try another keyword or choose a different category.</p>
                  <button
                    className="button secondary"
                    onClick={() => {
                      setCategory('all');
                      setResourceSearch('');
                    }}
                  >
                    Clear filters
                  </button>
                </div>
              )}
              <p className="resource-disclaimer">
                Links open external tools. Map links include your selected candidate’s coordinates;
                other resources may require manual input or an account. Discovery does not guarantee
                availability.
              </p>
            </>
          )}
        </main>
      </div>
      <input
        className="sr-only"
        type="file"
        ref={input}
        accept="image/jpeg,image/png,image/webp"
        onChange={(e) => uploadPhoto(e.target.files[0])}
        aria-label="Upload investigation photo"
      />
      {message && (
        <div className="toast" role="status">
          <span>{message}</span>
          <button
            className="icon-button"
            onClick={() => setMessage('')}
            aria-label="Dismiss notification"
          >
            <X size={16} />
          </button>
        </div>
      )}
      {modal === 'candidate' && (
        <CandidateModal onClose={() => setModal(null)} onAdd={addCandidate} />
      )}
      {modal === 'photo' && (
        <Modal title="Source image" onClose={() => setModal(null)} wide>
          <img
            className="expanded-image"
            src={current.photo}
            alt={`Source image: ${current.fileName}`}
          />
          {current.demo && (
            <p className="subtle">
              Photo by Bert K. / Bert Kaufmann,{' '}
              <External href="https://creativecommons.org/licenses/by/2.0/">CC BY 2.0</External>,
              via <External href={photoSource}>Wikimedia Commons</External>. Resized preview.
            </p>
          )}
        </Modal>
      )}
      {modal === 'analyze' && (
        <Modal title="Read the scene" onClose={() => !busy && setModal(null)}>
          <div className="modal-feature-icon">
            <Sparkles size={26} />
          </div>
          <p>
            Find visual clues and plausible locations from the architecture, landscape, road signs,
            and written language.
          </p>
          <label className="notes-label" htmlFor="analysis-context">
            Any clues you already have? <span>(optional)</span>
          </label>
          <textarea
            id="analysis-context"
            maxLength={2000}
            value={context}
            onChange={(e) => setContext(e.target.value)}
            placeholder="For example: this may be in northern Portugal…"
          />
          <div className="info-box">
            <ShieldCheck size={18} />
            <p>
              A resized photo and these clues will be sent to OpenAI through your server. The
              original file and its EXIF metadata stay in your browser. Results are hypotheses to
              verify.
            </p>
          </div>
          <button
            className="button primary full-width"
            onClick={analyzePhoto}
            disabled={Boolean(busy)}
          >
            {busy === 'analysis' ? (
              <>
                <LoaderCircle size={17} className="spin" /> Reading the scene…
              </>
            ) : (
              <>
                <Sparkles size={17} /> Send photo & analyze
              </>
            )}
          </button>
        </Modal>
      )}
      {modal === 'settings' && (
        <Modal title="Your workspace" onClose={() => setModal(null)}>
          <div className="settings-state">
            <span className="location-icon">
              <ShieldCheck size={24} />
            </span>
            <div>
              <strong>Local by default</strong>
              <p>
                Photos, notes, and investigations are stored in this browser using IndexedDB. Export
                reports to keep a separate copy.
              </p>
            </div>
          </div>
          <h3>
            AI scene analysis{' '}
            <Tag tone={health.aiEnabled ? 'green' : 'gold'}>
              {health.aiEnabled ? 'Connected' : 'Not configured'}
            </Tag>
          </h3>
          <p>
            GPS extraction, location candidates, place search, evidence notes, and the resource
            library work without an AI key.
          </p>
          {!health.aiEnabled && (
            <>
              <p>
                To enable scene analysis, create a <code>.env</code> file on the server from{' '}
                <code>.env.example</code>, set <code>OPENAI_API_KEY</code>, and restart the app.
              </p>
              <pre>
                OPENAI_API_KEY=your-key-here
                <br />
                OPENAI_MODEL=gpt-4.1-mini
              </pre>
              <p className="subtle">
                Keep the key on the server. No API key is stored in your browser or included in the
                app bundle.
              </p>
            </>
          )}
          <h3>External services</h3>
          <p>
            Maps request tiles from OpenStreetMap or Esri. Place searches are sent to the configured
            geocoder, Nominatim by default. Research links open the selected service.
          </p>
          <External
            className="button secondary full-width"
            href="https://github.com/saad2jz/findwhere"
          >
            View project & setup instructions <ArrowUpRight size={16} />
          </External>
        </Modal>
      )}
      {modal === 'guide' && (
        <Modal title="Follow the evidence" onClose={() => setModal(null)}>
          <p className="guide-intro">
            A good investigation starts with curiosity and ends with something you can verify.
          </p>
          {[
            [
              '01',
              'Look before you leap',
              'Write your first impression. Look for language, building materials, road markings, vegetation, shadows, and the shape of the landscape.',
            ],
            [
              '02',
              'Build a short list',
              'Read photo metadata, add candidate locations, and compare them on the map. Use AI as a source of leads when connected.',
            ],
            [
              '03',
              'Check the little details',
              'Open independent maps and street-level imagery. Compare three permanent features, check capture dates, and record contradictions.',
            ],
            [
              '04',
              'Leave a clear trail',
              'Keep source links and notes in the evidence ledger. Support or rule out candidates, then export a report. A precise point needs two independent constraints.',
            ],
          ].map(([number, title, text]) => (
            <div className="guide-step" key={number}>
              <span>{number}</span>
              <div>
                <h3>{title}</h3>
                <p>{text}</p>
              </div>
            </div>
          ))}
          <div className="info-box">
            <Compass size={19} />
            <p>
              Method inspired by{' '}
              <External href="https://github.com/marouane53/GeoINT">GeoINT</External>. Resource
              discovery inspired by <External href={catalog.source}>OSINT4ALL</External>.
            </p>
          </div>
        </Modal>
      )}
    </div>
  );
}

function ResourceCard({ resource, selected, expanded }) {
  const Icon = icons[resource.category] || Globe2;
  return (
    <External
      href={resourceLink(resource, selected)}
      className={`resource-card ${expanded ? 'expanded' : ''}`}
    >
      <div className="resource-card-top">
        <span className={`resource-icon ${resource.category}`}>
          <Icon size={20} />
        </span>
        <ArrowUpRight size={17} />
      </div>
      <h3>{resource.name}</h3>
      <p>{resource.description}</p>
      {expanded && (
        <>
          <div className="resource-tags">
            {resource.tags.map((tag) => (
              <span key={tag}>{tag}</span>
            ))}
          </div>
          <div className="resource-action">{resource.action}</div>
        </>
      )}
      <span className="resource-category">
        {categoryNames[resource.category]} <ArrowRight size={13} />
      </span>
    </External>
  );
}

function CandidateModal({ onClose, onAdd }) {
  const [mode, setMode] = useState('search');
  const [query, setQuery] = useState('');
  const [name, setName] = useState('');
  const [coords, setCoords] = useState('');
  const [country, setCountry] = useState('');
  const [results, setResults] = useState([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [searched, setSearched] = useState(false);
  async function search(event) {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      const response = await fetch(`/api/geocode?${new URLSearchParams({ q: query })}`);
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Place search unavailable.');
      setResults(data.results);
      setSearched(true);
    } catch (error) {
      setError(error.message);
    } finally {
      setBusy(false);
    }
  }
  function manual(event) {
    event.preventDefault();
    try {
      const point = parseCoordinates(coords);
      onAdd({
        ...point,
        name: name.trim() || 'Manual candidate',
        country: country.trim() || 'Location to verify',
      });
    } catch (error) {
      setError(error.message);
    }
  }
  return (
    <Modal title="Add a location candidate" onClose={onClose}>
      <div className="segmented">
        <button
          className={mode === 'search' ? 'active' : ''}
          onClick={() => {
            setMode('search');
            setError('');
          }}
        >
          Search a place
        </button>
        <button
          className={mode === 'coordinates' ? 'active' : ''}
          onClick={() => {
            setMode('coordinates');
            setError('');
          }}
        >
          Use coordinates
        </button>
      </div>
      {mode === 'search' ? (
        <>
          <form onSubmit={search}>
            <label className="notes-label" htmlFor="place-query">
              Place, landmark, or address
            </label>
            <div className="place-search">
              <input
                id="place-query"
                minLength={3}
                maxLength={200}
                required
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="For example, Hassan Tower, Rabat"
              />
              <button className="button primary" disabled={busy}>
                {busy ? <LoaderCircle size={17} className="spin" /> : <Search size={17} />} Search
              </button>
            </div>
          </form>
          <div className="geocode-results">
            {results.map((result, index) => (
              <button key={index} onClick={() => onAdd(result)}>
                <MapPin size={19} />
                <span>
                  <strong>{result.name}</strong>
                  <small>
                    {result.lat.toFixed(5)}, {result.lng.toFixed(5)}
                  </small>
                </span>
                <Plus size={18} />
              </button>
            ))}
            {searched && !results.length && (
              <p>No matches. Try a more specific name or use coordinates.</p>
            )}
          </div>
          <p className="subtle">
            Place queries are sent to Nominatim. Results © OpenStreetMap contributors.
          </p>
        </>
      ) : (
        <form className="manual-form" onSubmit={manual}>
          <label htmlFor="candidate-name">
            Location name
            <input
              id="candidate-name"
              maxLength={300}
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="A place worth checking"
            />
          </label>
          <label htmlFor="candidate-coords">
            Latitude, longitude (WGS84)
            <input
              id="candidate-coords"
              value={coords}
              onChange={(e) => setCoords(e.target.value)}
              required
              placeholder="38.71217, -9.13380"
            />
          </label>
          <label htmlFor="candidate-country">
            City or country <span>(optional)</span>
            <input
              id="candidate-country"
              maxLength={100}
              value={country}
              onChange={(e) => setCountry(e.target.value)}
              placeholder="Lisbon, Portugal"
            />
          </label>
          <button className="button primary full-width" type="submit">
            <Plus size={17} /> Add candidate
          </button>
        </form>
      )}
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
    </Modal>
  );
}
