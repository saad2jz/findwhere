import { randomUUID } from 'node:crypto';
import { analysisSchema, mapLinks, pointSchema } from '../src/lib/domain.mjs';
import { pipelineSchema } from '../src/lib/search-pipeline.mjs';
import { assessComparison } from '../src/lib/image-research.mjs';
import { distanceAndBearing } from '../src/lib/geo.mjs';
import { assessAnalysis, sceneContext } from './analysis-quality.mjs';
import { searchPlanSchema, proposalSchema } from './search-prompts.mjs';
import { downloadReference, isRelevantSearchRecord } from './search-retrieval.mjs';

const words = (value) =>
  String(value || '')
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
const nameWords = (value) =>
  words(value)
    .replace(/\bcastle\b/g, 'chateau')
    .replace(/\bpark\b/g, 'parc')
    .split(' ')
    .filter((word) => word && !['de', 'du', 'des', 'le', 'la', 'les', 'the', 'of'].includes(word));
const contains = (text, value) => {
  const haystack = new Set(nameWords(text));
  const needles = nameWords(value);
  return needles.length > 0 && needles.every((word) => haystack.has(word));
};
const isRejected = (name, feedback) =>
  (feedback?.rejectedNames || []).some(
    (rejected) => nameWords(rejected).length && contains(name, rejected),
  );

// Resolve identity, never model coordinates. A brand match alone cannot select among branches.
export function resolveSearchPlace(candidate, results) {
  const categories = new Set([
    'historic',
    'tourism',
    'leisure',
    'amenity',
    'building',
    'natural',
    'man_made',
    'shop',
  ]);
  const matches = results.filter(
    (item) =>
      categories.has(item.category) &&
      pointSchema.safeParse(item).success &&
      nameWords(item.name.split(',')[0]).sort().join(' ') ===
        nameWords(candidate.name).sort().join(' ') &&
      candidate.country &&
      words(item.country) === words(candidate.country) &&
      (!candidate.city || contains(item.city || item.name, candidate.city)) &&
      (!candidate.street || contains(item.street || item.name, candidate.street)),
  );
  if (!matches.length) return null;
  if (matches.some((item) => distanceAndBearing(matches[0], item).distanceMetres > 250))
    return null;
  const place = matches[0];
  return {
    lat: place.lat,
    lng: place.lng,
    mapReference: {
      label: place.name,
      attribution: '© OpenStreetMap contributors',
      url: place.osmUrl || mapLinks(place).osm,
    },
  };
}

export function selectSupportedProposals(raw, sources, clues, feedback) {
  const proposals = proposalSchema.parse(raw).candidates;
  const seen = new Set();
  return proposals.flatMap((candidate) => {
    const supporting = [...new Set(candidate.sourceIds)].map((id) =>
      sources.find((source) => source.id === id),
    );
    const indexes = [...new Set(candidate.supportingClueIndexes)];
    const features = indexes.map((index) => clues[index]?.text.trim()).filter(Boolean);
    const key = words(
      `${candidate.name} ${candidate.city} ${candidate.street} ${candidate.country}`,
    );
    if (
      seen.has(key) ||
      isRejected(candidate.name, feedback) ||
      supporting.some((source) => !source) ||
      indexes.length !== features.length ||
      new Set(features.map(words)).size < 2 ||
      !supporting.some((source) => contains(`${source.title} ${source.text}`, candidate.name))
    )
      return [];
    seen.add(key);
    return [
      {
        ...candidate,
        sourceIds: supporting.map((source) => source.id),
        features,
        referenceIds: [...new Set(candidate.referenceIds)].filter((id) =>
          sources.some((source) => source.id === id && source.kind === 'image'),
        ),
      },
    ];
  });
}

export function rankSearchChecks(checks) {
  return checks.slice().sort((a, b) => {
    const tier = (check) =>
      check.status === 'contradicted'
        ? 3
        : check.status !== 'mapped'
          ? 2
          : check.comparison?.verdict === 'supports'
            ? 0
            : 1;
    return tier(a) - tier(b);
  });
}

export async function runSearchPipeline({
  input,
  callAI,
  reserve,
  searchPlaces,
  searchDocuments,
  waterfall,
  searchReferences,
  fetcher = fetch,
  broadSearch = false,
  onProgress = () => {},
  signal,
}) {
  const startedAt = new Date().toISOString();
  const queries = [],
    sources = [],
    checks = [],
    warnings = [];
  const engine = broadSearch ? 'Brave Search' : 'Wikipedia';
  const attempts = [];
  const documentSearch = waterfall?.createRun({
    signal,
    onProgress: (detail) => progress('retrieve', detail),
    onAttempt: (attempt) => {
      attempts.push(attempt);
      discardedSources += attempt.discarded;
      if (['success', 'empty', 'irrelevant', 'error', 'cached'].includes(attempt.status))
        queries.push({ service: attempt.service, query: attempt.query });
    },
  });
  let requestsUsed = 0;
  let discardedSources = 0;
  let scene;
  const progress = (stage, detail) => {
    signal?.throwIfAborted();
    onProgress({ stage, detail });
  };
  const ai = async (request) => {
    signal?.throwIfAborted();
    if (requestsUsed >= 4 || !(await reserve())) throw new Error('allowance');
    requestsUsed++;
    return callAI(request);
  };
  const addSource = (record) => {
    const duplicate = sources.find((source) => source.url === record.url);
    if (duplicate) return duplicate;
    if (sources.length >= 40) return null;
    const source = { ...record, id: `source-${sources.length + 1}` };
    sources.push(source);
    return source;
  };
  const search = async (service, query, operation) => {
    signal?.throwIfAborted();
    queries.push({ service, query });
    try {
      return await operation();
    } catch {
      signal?.throwIfAborted();
      warnings.push(
        `${service} could not complete a search. Other available evidence was retained.`,
      );
      return [];
    }
  };
  const finish = () => {
    const ranked = rankSearchChecks(checks);
    const candidates = ranked
      .filter((check) => check.status === 'mapped' && check.point)
      .map((check) => ({
        ...check.point,
        name: check.name,
        country: check.country,
        confidence: check.comparison?.verdict === 'supports' ? 'medium' : 'low',
        reason: `${check.reason} ${check.uncertainty} ${
          check.comparison
            ? `Reference comparison: ${check.comparison.verdict}.`
            : 'No reference photo was visually compared.'
        }`.slice(0, 2000),
        searchCheckId: check.id,
      }));
    const pipeline = pipelineSchema.parse({
      version: 1,
      startedAt,
      completedAt: new Date().toISOString(),
      engines: [
        ...new Set([
          ...(documentSearch
            ? attempts
                .filter((attempt) =>
                  ['success', 'empty', 'irrelevant', 'error', 'cached'].includes(attempt.status),
                )
                .map((attempt) => attempt.service)
            : [engine]),
          'OpenStreetMap',
          'Wikimedia Commons',
        ]),
      ],
      attempts,
      reverseImageUsed: attempts.some(
        (attempt) =>
          attempt.service === 'Google Lens via SerpApi' &&
          ['success', 'empty'].includes(attempt.status),
      ),
      requestsUsed,
      discardedSources,
      contextUsed: Boolean(input.context.trim()),
      correctionUsed: Boolean(input.feedback),
      queries,
      sources,
      checks: ranked,
      warnings: [...new Set(warnings)].slice(0, 12),
    });
    return analysisSchema.parse({
      ...scene,
      candidates,
      pipeline,
      summary: candidates.length
        ? `Search found ${candidates.length} mapped public-place ${candidates.length === 1 ? 'hypothesis' : 'hypotheses'}. ${
            candidates.some((candidate) => candidate.confidence === 'medium')
              ? 'At least one reference comparison reports visual support; verify the paired features.'
              : 'No positive reference-photo match has been established.'
          } These are place reference points, not camera positions.`
        : 'Search did not establish a mapped location hypothesis. Retrieved sources, unresolved proposals and visible-feature research leads are available below.',
      uncertainties: [
        ...new Set([
          ...scene.uncertainties,
          'Search coverage is incomplete. A retrieved place record does not identify the photo or establish coordinate accuracy.',
          ...warnings,
        ]),
      ].slice(0, 8),
    });
  };
  progress('scene', 'Reading the photo and planning bounded searches.');
  const raw = await ai({ ...input, mode: 'pipeline' });
  scene = assessAnalysis(analysisSchema.parse(raw), input.feedback);
  // Recognition-only guesses never pass through as pipeline map coordinates.
  scene.candidates = [];
  const parsedPlan = searchPlanSchema.safeParse(raw.searchPlan);
  const plan = parsedPlan.success
    ? parsedPlan.data
    : {
        queries: scene.researchLeads.map((lead) => lead.query).slice(0, 3),
        placeQueries: [],
      };
  if (!broadSearch)
    warnings.push(
      'Broad web search is not configured. This run searches Wikipedia, OpenStreetMap and Wikimedia Commons; coverage of ordinary shops and less documented places is limited.',
    );
  progress(
    'retrieve',
    `Searching ${documentSearch ? 'the configured provider waterfall' : engine}, public map records and reference photographs.`,
  );
  if (documentSearch && input.reverseImageConsent) {
    const matches = await documentSearch.reverseImage(input.reverseImage || input.image);
    for (const match of matches) addSource(match);
    warnings.push(
      'Google Lens visual matches are unverified leads. Retrieved web photos are not automatically fetched; reference comparison uses Wikimedia Commons.',
    );
  }
  const places = new Map();
  for (const query of [...new Set(plan.placeQueries)]) {
    const records = await search('OpenStreetMap', query, () =>
      searchPlaces(query, { waitForSlot: true, signal }),
    );
    places.set(query, records);
    for (const record of records)
      addSource({
        kind: 'place',
        title: record.name,
        text: `${record.category}; ${record.country}`,
        url: record.osmUrl || mapLinks(record).osm,
      });
  }
  for (const query of [...new Set(plan.queries)]) {
    progress('retrieve', `Searching: ${query}`);
    const docs = documentSearch
      ? await documentSearch.search(query)
      : await search(engine, query, () => searchDocuments(query, signal));
    for (const record of docs) {
      if (isRelevantSearchRecord(record, query)) addSource(record);
      else discardedSources++;
    }
    const photos = await search('Wikimedia Commons', query, () =>
      searchReferences(query, { waitForSlot: true, signal }),
    );
    for (const photo of photos || [])
      addSource({
        kind: 'image',
        title: photo.title,
        text: photo.title,
        url: photo.source,
        thumbnail: photo.thumbnail,
        attribution: photo.attribution,
        date: photo.date,
      });
  }
  progress('locate', 'Selecting source-backed hypotheses and resolving their map records.');
  if (!sources.length) {
    if (discardedSources)
      warnings.push(
        'Retrieved documents did not contain the exact query names or enough relevant terms. They were excluded before candidate selection.',
      );
    warnings.push(
      'No records were retrieved. Try readable signage, a wider photo or a country/region hint.',
    );
    progress('rank', 'Keeping visible clues and search details; no sourced place was found.');
    return finish();
  }
  let proposals;
  try {
    const selected = await ai({
      image: input.image,
      mode: 'selection',
      context: JSON.stringify({
        userContext: sceneContext(input),
        observations: scene.clues,
        records: sources,
      }),
    });
    proposals = selectSupportedProposals(selected, sources, scene.clues, input.feedback);
  } catch {
    signal?.throwIfAborted();
    warnings.push(
      'Candidate selection could not finish (provider failure or daily allowance reached). Retrieved evidence and scene clues were retained.',
    );
    progress('rank', 'Preserving the retrieved evidence.');
    return finish();
  }
  for (const proposal of proposals) {
    const records =
      places.get(proposal.query) ||
      (await search('OpenStreetMap', proposal.query, () =>
        searchPlaces(proposal.query, { waitForSlot: true, signal }),
      ));
    const point = resolveSearchPlace(proposal, records);
    const mapSource =
      point &&
      addSource({
        kind: 'place',
        title: point.mapReference.label,
        text: proposal.country,
        url: point.mapReference.url,
      });
    checks.push({
      id: randomUUID(),
      name: proposal.name,
      country: proposal.country,
      reason: proposal.reason,
      uncertainty: proposal.uncertainty,
      sourceIds: [...new Set([...proposal.sourceIds, ...(mapSource ? [mapSource.id] : [])])].slice(
        0,
        8,
      ),
      features: proposal.features,
      status: point ? 'mapped' : 'unresolved',
      referenceStatus: 'unavailable',
      point,
      referenceIds: proposal.referenceIds,
      referenceQuery: `${proposal.name} ${proposal.street} ${proposal.city} ${proposal.country}`
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 200),
    });
  }
  progress('compare', 'Looking for reference photos of the proposed places.');
  let comparisons = 0;
  for (const check of checks) {
    if (comparisons >= 2) {
      check.referenceStatus = 'skipped';
      continue;
    }
    // A candidate-specific Commons search can add a relevant photo missed by the initial feature search.
    let reference = sources.find(
      (source) => source.id === check.referenceIds[0] && source.kind === 'image',
    );
    if (!reference) {
      const query = check.referenceQuery;
      const photos = await search('Wikimedia Commons', query, () =>
        searchReferences(query, { waitForSlot: true, signal }),
      );
      const photo = (photos || []).find((item) => contains(item.title, check.name));
      if (photo)
        reference = addSource({
          kind: 'image',
          title: photo.title,
          text: photo.title,
          url: photo.source,
          thumbnail: photo.thumbnail,
          attribution: photo.attribution,
          date: photo.date,
        });
    }
    if (!reference) continue;
    check.referenceId = reference.id;
    progress('compare', `Comparing the photo with ${reference.title}.`);
    try {
      const image = await downloadReference(reference.thumbnail, { fetcher, signal });
      // Count attempts, not successes, against the per-run maximum and shared daily quota.
      comparisons++;
      const result = await ai({
        mode: 'comparison',
        image: input.image,
        referenceImage: image,
        context: 'Compare the two images only. No place name or expected answer is supplied.',
      });
      check.comparison = assessComparison(result);
      check.referenceStatus = 'compared';
      // Even an inconclusive verdict with unresolved contradictions cannot promote a map hypothesis.
      if (check.comparison.findings.some((finding) => finding.assessment === 'contradiction'))
        check.status = 'contradicted';
    } catch {
      signal?.throwIfAborted();
      check.referenceStatus = 'skipped';
      warnings.push(
        'A reference comparison could not finish (image unavailable, provider failure or daily allowance reached). It is not counted as visual support.',
      );
    }
  }
  progress('rank', 'Ordering mapped hypotheses by reference support and retaining contradictions.');
  return finish();
}
