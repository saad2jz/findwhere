# Findwhere

**Find the place behind the picture.** A standalone web app for photo geolocation investigations: upload a
photo, inspect local metadata, map possible locations, collect evidence, and export a report.

Built with React, Vite, Leaflet, and a Node/Express server. Inspired by the investigation method in
[GeoINT](https://github.com/marouane53/GeoINT) and the resource discovery directory
[OSINT4ALL](https://start.me/p/L1rEYQ/osint4all). This is an independent application with a fresh Git history;
it does not bundle or run the upstream agent skill or its Python/model toolchain.

## What works

- **Findwhere search pipeline (Gemini):** choose **Findwhere search** in the analysis dialog.
  The server reads visible clues, plans at most three document/image queries and three individually named
  public-place lookups, retrieves records, selects up to three sourced hypotheses, resolves their OSM
  identities, and compares up to two available Wikimedia photos with the investigation photo. It orders
  mapped hypotheses by paired visual support; contradictions stay visible but off the map. No model-generated
  coordinate is used. Live progress follows actual server stages. Each run retains queries, citations,
  attribution, uncertainties, comparison findings and the number of attempted AI requests in the case,
  JSON backup and Markdown report. User notes and saved candidate coordinates are never supplied as input;
  optional context and selected investigator corrections are explicitly labelled.
  Text retrieval follows **Wikipedia → Tavily → Exa → SerpApi → optional Brave** for each query.
  Missing keys, exhausted allowances, errors and irrelevant results fall through. Useful records are retained
  across steps; two relevant distinct source URLs pause that query's chain for candidate selection.
  If no mapped hypothesis is found, remaining providers are searched once within the same eight-request
  budget. New records get one additional selection pass, leaving at most one AI reference comparison
  in that run. Duplicate-only results do not trigger another AI request. The retrieval threshold is
  not independent confirmation of a place. Without extra keys, Wikipedia, OpenStreetMap and Commons work.
  Missing sources, ambiguous branches and unavailable images remain unresolved rather
  than becoming invented coordinates. A run uses 1–4 AI requests, normally 2–4 when evidence is retrieved;
  every attempt, including a failed attempt, consumes the shared daily allowance. Search/provider failures
  after scene reading retain available partial evidence. References use allowlisted Commons hosts, bounded
  downloads and no redirects; arbitrary source URLs are citations, never crawl targets.
  This is automated text/POI retrieval and reference comparison, **not a reverse-image index**, and does
  not promise GeoSeeer-level recall, exact camera coordinates, or calibrated accuracy. Ordinary businesses
  and less documented scenes need broader source coverage and can still yield no specific hypothesis.
  Document relevance checks require exact quoted names or a leading query name when present, avoiding
  stemmed-word matches such as a station brand being confused with an unrelated article about shelling.
  Excluded results are counted in the evidence trail and report; if no usable records remain, the server
  skips candidate selection rather than spending another AI request on unrelated evidence.
  The evidence trail, backup and report record each fallback outcome. Text searches cache for one hour;
  failing providers enter a cooldown. A run sends at most eight keyed-provider requests across all searches.
  Optional Google Lens via SerpApi requires an explicit photo-upload checkbox. A metadata-free JPEG under
  500 KB is directly uploaded to SerpApi and its returned image ID is used for one Lens search. Visual
  matches are unverified source leads; external result images are not crawled. Reference-photo comparisons
  continue to use allowlisted Commons images. SerpApi and Google data-handling policies apply; image-ID
  expiration is not a promise of data deletion.
  [Brave API](https://api-dashboard.search.brave.com/documentation/quickstart),
  [MediaWiki search](https://www.mediawiki.org/wiki/API:Search),
  [Nominatim policy](https://operations.osmfoundation.org/policies/nominatim/).
- **Photo intake:** JPEG, PNG, and WebP upload or drag and drop; local EXIF extraction; automatic GPS candidates.
- **Photo inspection:** expand a stored preview, zoom up to 8× its fitted size, drag or use arrow keys to pan,
  rotate in 90° steps, and reset the view. Use + / −, R, and 0 while the image area is focused.
  These view controls do not alter the saved photo or reconstruct detail lost during resizing.
- **Reference comparison:** choose **Compare** beside the source image to add a local reference photo or screenshot.
  Inspect the two previews with separate controls, record a source URL and comparison notes, and save the details.
  The reference is saved with the investigation and included in JSON backups; its source and notes appear in reports.
  Replacing the reference clears its old source and notes. A removed reference can be restored with **Undo**
  while the dialog stays open. No candidate is automatically marked verified.
- **Reverse image research:** choose **Image search**, download a resized JPEG without embedded metadata,
  and open Google Lens or TinEye to upload it yourself. Save a useful result photo or screenshot and import
  it as the reference. This assisted workflow does not automatically upload images, scrape results, or use a paid search API.
  [Google's supported upload workflow](https://support.google.com/websearch/answer/1325808?hl=en).
- **Sourced reference discovery:** search Wikimedia Commons by place name or feature, inspect up to six
  raster previews with author, license, declared date and original file-page links, then choose **Use reference**.
  The preview and attribution are saved locally. Text search results are leads, not reverse-image matches.
- **AI image comparison:** after adding a reference, unlock AI, consent to sending the two resized images,
  and choose **Compare with AI**. Gemini (or the configured OpenAI alternative) reports paired observations,
  matches, contradictions and limits. A supported verdict requires at least two distinct model-reported features
  and no reported contradiction; ambiguous cases remain inconclusive. This does not verify a reference label,
  identify the exact camera position, or automatically change any candidate's status or coordinates.
  Comparison uses the same password, rate limits and daily allowance as scene analysis; both images count
  toward a combined request size limit. It can cost more image tokens than one-photo analysis. Source URLs,
  notes and investigator corrections are not sent in comparison requests. Results, attribution and timestamps
  survive backups and reports; replacing the reference clears the old comparison.
- **Investigation map:** interactive candidate markers, street/satellite layers, zoom, recentering, and external
  Google Maps/Street View links.
- **Location candidates:** search named places or enter WGS84 coordinates; refine names, points, confidence,
  and reasoning; mark hypotheses supported or ruled out. Refinements retain the original lead and source.
- **Candidate spacing:** choose **Distances** above the candidate list to compare separation and initial bearing
  from any candidate, sorted nearest first with statuses retained. Reports use the selected candidate as origin.
  Calculations use a sphere with a 6,371 km radius, ignore routes and terrain, and do not rank likelihood or
  indicate the camera viewing direction. [Calculation method](https://www.movable-type.co.uk/scripts/latlong.html).
- **Location context without AI credits:** select a candidate and expand **Check the surroundings**.
  Search a 500 m, 1 km or 2 km radius for public places and named roads, fuel stations, or landmarks and parks.
  Up to 20 returned OpenStreetMap records show straight-line distance and initial bearing; add a record as an
  explicitly unverified lead. Five terrain samples (center and cardinal directions) use SRTM90m with ASTER30m
  fallback through Open Topo Data. An optional photo date retrieves daily ERA5 temperature, precipitation,
  cloud cover and sunrise/sunset through Open-Meteo. These are comparison materials, not photo identification.
  Results retain their coordinates, sources and retrieval time in the case, backup and report; moving a candidate
  flags the saved results as stale. Each provider can fail independently without discarding the other checks.
  Services discovered through [API Vault](https://apivault.dev/) are integrated directly using their official APIs.
- **Evidence ledger:** record and edit observations with categories, source URLs, and reference dates; check
  evidence, inspect metadata, and write investigation notes. Editing evidence clears its checked status.
- **Saved investigations:** photos, candidates, and notes persist in IndexedDB on the current browser/device.
- **Portable backups:** download one investigation or the entire workspace as JSON, including photos and evidence;
  import on another browser without overwriting existing work.
- **Recoverable archive:** move investigations out of the active list and restore them anytime. Search titles,
  photo filenames, and notes across either view.
- **Editable sample:** save a copy of the Lisbon sample, or edit it to automatically create your own saved copy.
  Reference clues and image attribution remain attached.
- **Research library:** 24 attributed resources, with keyword/category filters and contextual map links.
- **Reports:** downloadable Markdown containing metadata, coordinates, evidence, sources, notes, and verification steps.
- **Optional real AI scene analysis:** the server calls Gemini (Google) or OpenAI, returning visible clues and unverified
  location hypotheses with qualitative confidence. A configured server API key is required.
- **Research leads when identification is uncertain:** possible places, regions, or visible-feature searches remain
  separate from map candidates, with their supporting observations and uncertainty. Low-confidence place proposals
  and unresolved map references are preserved as research leads rather than silently discarded. Choose **Find reference
  photos for this lead** to open image research with its query. When no geographic proposal is grounded in the photo,
  the app offers searches derived from visible clues; it does not fabricate locations to fill an empty list.
  Leads have no coordinates, survive backups/reports, and do not change candidate status. Older empty assessments
  can show feature searches from their saved AI clues; analyze again to request the new place/region lead output.
- **Responsive interface:** desktop workspace and mobile layouts, keyboard controls, dialogs, and reduced-motion support.

The initial Lisbon sample is explicitly labelled. Its main camera location comes from the published source;
its alternative viewpoints illustrate the investigation workflow. It is not an AI-generated result.

## Run locally

Requires **Node.js 22.12+** (or Node.js 24+) and npm.

```bash
git clone https://github.com/saad2jz/findwhere.git
cd findwhere
npm ci
npm run dev
```

Open **http://127.0.0.1:5173**. The dev script starts the Vite frontend and the API on port 8787.

For a production build served by Node:

```bash
npm run build
npm start
```

Open **http://127.0.0.1:8787**. The server binds to loopback by default. `HOST` and `PORT` configure its
production address; the dev proxy uses port 8787.

## Enable AI scene analysis

Copy `.env.example` to `.env` (`Copy-Item .env.example .env` in PowerShell), then set:

```dotenv
AI_PROVIDER=gemini
GEMINI_API_KEY=your-server-key
GEMINI_MODEL=gemini-3.5-flash-lite
AI_ACCESS_PASSWORD=choose-a-long-private-password
AI_DAILY_LIMIT=10
AI_USAGE_FILE=.data/ai-usage.json
```

Restart the server. Unlock AI access in **Your workspace**, upload a photo and choose **Search this photo**
(Gemini) or **Analyze scene** (OpenAI). The dialog offers Findwhere search or scene clues only and explains
the data transfer and request allowance before sending. No browser API key field is used and keys are never included in
the frontend bundle. Without a key, the rest of the app remains functional and the interface shows setup
instructions rather than simulated analysis.

Gemini is the default for new setups. Generate a Gemini API key in Google AI Studio and keep it server-side.
`GEMINI_MODEL` may select another image-capable model supporting structured output. The default is the stable
`gemini-3.5-flash-lite`; verify model access for your project when testing.
For the existing OpenAI integration, set `AI_PROVIDER=openai`, `OPENAI_API_KEY`, and optionally
`OPENAI_MODEL=gpt-4.1-mini`. The server never falls back to another provider if the selected one fails or lacks a key.

AI is a source of leads. It does not verify Street View matches, guarantee locations, or generate calibrated
probabilities. Generic scenes may return clues with no location candidates. Compare independent imagery and
record evidence before supporting a candidate. EXIF GPS is also a lead: metadata can be edited.

Use **Refine candidate** to adjust a lead and record your reasoning. The original coordinates, status,
confidence, and source remain available under **Original lead** and in exports. Moving the point resets
its current status to Hypothesis and confidence to Low until you check the new viewpoint. Investigator
refinements become manual leads and survive subsequent AI scene analyses.

Use **Add sourced evidence** to attach a URL and reference date, or the pencil beside an entry to edit it.
New evidence starts unchecked; changing its observation or source clears the check for a fresh review.
Reviewed and edited AI observations also survive later analyses. A reference date describes the source material and
does not claim the investigation photo was captured on that date.

Implementation references: Gemini [image input](https://ai.google.dev/gemini-api/docs/generate-content/image-understanding),
[structured output](https://ai.google.dev/gemini-api/docs/generate-content/structured-output), and
[default model](https://ai.google.dev/gemini-api/docs/models/gemini-3.5-flash-lite);
OpenAI [image input](https://developers.openai.com/api/docs/guides/images-vision) and
[structured output](https://developers.openai.com/api/docs/guides/structured-outputs?api-mode=responses).

## Data and external services

Original images are decoded locally. A resized JPEG preview (maximum dimension 1600 px), selected metadata,
notes, and candidates are saved in browser IndexedDB. The app does not save originals on the server. Export a
JSON backup for a restorable copy; browser storage is device-specific and may be cleared by browser settings.
Choose **Backup & import** on the Investigations page or **Backup** in the workspace. Backups contain resized
photos, metadata, candidates, evidence, notes, and archive status. Import supports version 1 Findwhere JSON,
up to 50 MB and 100 investigations per file. Imports validate the complete file before saving and assign fresh
case identities, so repeated imports make separate copies. Markdown reports remain useful for sharing a readable
summary, but cannot restore editable investigations. Archive preserves local data and is included in backups.

Only the explicit AI action sends the resized JPEG and optional context to the configured provider via the server.
The confirmation identifies Gemini (Google) or OpenAI before sending. The original file and its EXIF payload
are not sent. Gemini receives inline image bytes with no Files API upload; blocked, truncated, malformed and
invalid results are rejected. OpenAI requests use `store: false`. Provider data-handling policies still apply
to each API request. Photos are not automatically uploaded to reverse-image services.

Findwhere search also sends bounded text queries through its configured waterfall, Commons and the
configured geocoder. Retrieved snippets and the photo are sent to Gemini for candidate selection; up to two
allowlisted Commons previews are sent with the investigation photo for comparison. Cancelling stops subsequent
stages but does not refund attempted provider requests. Previous saved results remain intact when cancelled.

### Optional free-tier search configuration

Add any of `TAVILY_API_KEY`, `EXA_API_KEY`, and `SERPAPI_API_KEY` in Render's Environment tab, then
save and redeploy. Keys stay on the server. One key is enough to expand coverage; configure all three
to enable every free-tier fallback. A SerpApi key also enables the optional Lens checkbox.
Brave additionally needs a positive `BRAVE_MONTHLY_LIMIT` (default zero).

Separate shared UTC-month caps default to 900 Tavily requests, 300 Exa requests and 200 SerpApi requests.
Each attempted network request reserves budget before sending, including failures and Lens uploads.
Set `SEARCH_USAGE_FILE` for the ledger; by default it derives from `AI_USAGE_FILE`. Corrupt or unavailable
storage disables keyed searches while keyless research continues. The ledger serializes reservations within
one server process; it is not a distributed quota service. Render's free ephemeral filesystem can reset it.
Use provider free plans and dashboard spending limits with paid billing/top-ups disabled. Local request
caps cannot guarantee zero charges across restarts, other apps using the same keys or pricing changes.
Exa's allowance is denominated in dollars, so its request cap is deliberately conservative.

Provider API references: [Tavily Search](https://docs.tavily.com/documentation/api-reference/endpoint/search),
[Exa Search](https://exa.ai/docs/reference/search), [SerpApi Google Search](https://serpapi.com/search-api),
[Lens](https://serpapi.com/google-lens-api), [direct upload](https://serpapi.com/image-api).

The map requests tiles from OpenStreetMap or Esri. Map views reveal the viewed area to the tile provider.
Place searches send the typed query to Nominatim through the server, with an identifying User-Agent, a global
1.1-second request interval, and a bounded in-memory cache. There is no autocomplete. Configure `GEOCODER_URL`
and `GEOCODER_USER_AGENT` for another compatible service or a deployment with greater traffic. Follow the
[Nominatim usage policy](https://operations.osmfoundation.org/policies/nominatim/) and applicable map-provider terms.

Research links open external sites; contextual map links embed the selected candidate coordinates. Most
directory entries open a landing page for manual input, rather than claiming a native service integration.
Network failures show a useful fallback; manual coordinates and case notes still work.

Location-context checks send only the selected coordinates, radius/category and optional date through the
server to fixed Overpass (main service or Private.coffee), Open Topo Data and Open-Meteo endpoints. Photos and notes are not sent. Public
map coverage is incomplete; distances use geometry centers, not entrances or routes. Elevation is a raster
estimate at approximately 30–90 m resolution, not building height or a reconstructed skyline. Historical weather
is ERA5 reanalysis on an approximately 25 km grid and cannot establish conditions at the instant of a photo.
Dates must be from 1940 through seven days ago. Open-Meteo's free endpoint is for **non-commercial use**.
These checks need no API key or AI login; the app is intended for personal use. Shared public services may
be unavailable. The server caches complete results for six hours and partial results for one minute, spaces
new lookups by at least 1.5 seconds, allows one concurrent lookup and caps new lookups at 90 per UTC day.
These in-memory limits reset on restart and are not distributed quotas. A failed Overpass instance enters
a five-minute cooldown; the other documented public instance is tried at most once, without retrying the
failed endpoint. Complete empty results do not trigger fallback. Other providers have no automatic retries.
See [Overpass shared-service guidance](https://dev.overpass-api.de/overpass-doc/en/preface/commons.html),
[Open Topo Data API and limits](https://www.opentopodata.org/api/),
[Open-Meteo historical data](https://open-meteo.com/en/docs/historical-weather-api) and
[Open-Meteo terms](https://open-meteo.com/en/terms).

The server is intended for personal use. Production AI fails closed unless a 16–200 character
`AI_ACCESS_PASSWORD` and an HTTPS application origin are configured. The password unlocks only AI;
manual investigation stays public. Sessions use opaque server-side tokens and Secure, HttpOnly,
SameSite=Strict cookies, expire after 12 hours, and are revoked on logout or server restart.
Sign-in attempts are throttled. AI accepts same-origin requests, up to five attempts per minute globally,
two concurrent analyses, a bounded image/context, and at most 6,000 output tokens per provider request
(including Gemini thinking). One search run can make up to four provider requests, each charged separately.
The model is chosen by the server. Gemini uses high media resolution and medium thinking on supported
models; this can increase latency and token costs compared with the earlier minimal setting.

### Scene-only analysis quality and corrections

AI first describes visible features, then proposes at most three named public landmarks. The server
withholds low-confidence guesses, candidates with contradictions, and candidates without at least two
distinct referenced observations and a distinctive-match description. Retained points remain unverified,
landmark references; camera position and coordinate accuracy are unknown. Before placing a new AI
candidate on the map, the server searches its public landmark name and country in the configured geocoder.
It requires a matching landmark name and country, excludes administrative results, and rejects duplicate
names more than 250 m apart. The map uses the geocoder point, retaining the original model coordinate guess
for provenance. A missing, ambiguous or unavailable reference withholds that map point and explains why;
there is no fallback to model coordinates. **Resolve map point** applies the same matching rules to older
saved AI candidates without calling AI again. This resolves a named landmark, not the photographer's position,
and does not prove that the landmark was correctly recognized. Maps do not draw
an invented accuracy radius. Summary, limitations and next checks are visible in the investigation and reports.

These checks validate the structure of model-reported support, not the truth of that support. Scene analysis
does not run reverse-image searches or web grounding. The separate **Image search** workflow opens external
providers for manual uploads and discovers Wikimedia references by text query; **Compare with AI** evaluates
the supplied image pair, without independently verifying the reference's location. A retained candidate
can still be wrong; an undetermined result is preferable to weak guesses. Earlier results are labelled
as predating these checks rather than silently being treated as newly validated.

Use **Correct AI result** to record a known place and rule out untouched AI hypotheses without deleting
them. Corrections remain local until explicitly included in the next analysis dialog. The server excludes
previously rejected names; investigator-reported places are labelled as user supplied, never as AI recognition.
Corrections, visual support, map-reference provenance and the latest assessment survive JSON backup/import and Markdown export.
Offline tests cover these rules, including weak chateau guesses, but do not measure real recognition accuracy.

`AI_DAILY_LIMIT` defaults to 10 requests per UTC day across all sessions; 0 pauses AI. A reservation is
made before each provider request, so failed provider attempts also consume the allowance. With
`AI_USAGE_FILE`, reservations are written before contacting the provider and survive process restarts while the
file survives; corrupt or inaccessible state blocks analysis. Without a file, limits reset on restart.
This is a single-instance allowance, not a durable financial cap: deleting hosting storage, deploying
to an ephemeral filesystem, or running independent instances can reset/multiply it. Monitor spending
in the provider dashboard and keep the access password private. No automatic retries are made.

## Deploy on Render

Create a **Web Service** from this repository's `main` branch, runtime **Node**, free instance,
build command `npm ci --include=dev && npm run build`, start command `npm start`, and health path `/api/health`.
Set `NODE_VERSION=24.15.0`, `NODE_ENV=production`, `HOST=0.0.0.0`,
`AI_PROVIDER=gemini`, `GEMINI_MODEL=gemini-3.5-flash-lite`, `AI_DAILY_LIMIT=10`, and `AI_USAGE_FILE=.data/ai-usage.json`. Render supplies `PORT` and
`RENDER_EXTERNAL_URL`; for a custom domain set `APP_ORIGIN` to its exact HTTPS origin (no trailing slash).
Add `GEMINI_API_KEY` and `AI_ACCESS_PASSWORD` privately in Render's Environment settings, then redeploy.
Without either secret the public manual app still works and AI cannot spend credit.

The [free instance](https://render.com/docs/free) sleeps after 15 minutes without traffic and has
ephemeral storage. Its quota file can disappear on restart, redeploy, or spin-down. Browser investigations
remain on each device; export a backup before switching devices. Durable shared quotas require persistent
storage and coordinated reservations before scaling beyond one instance.

To verify the real integration, unlock AI, upload the included public `public/lisbon.jpg` sample,
and explicitly send one analysis. Check for real returned clues, unverified candidate labels, a decremented
allowance, and rejection after locking access. Local regression tests use mocks and do not prove provider access.

## Test and build

```bash
npm test
npm run build
# Both:
npm run check
```

Tests cover coordinate bounds/precision, contextual links, safe URLs, report exports, catalog attribution,
backup round trips, import validation and identity isolation, archive compatibility, sample copying,
evidence editing and source validation, candidate refinement and provenance, API
configuration, request/output validation, error handling, origin checks, rate limiting, and cached/throttled
geocoding. AI and geocoder API tests use mocks and make no paid API calls. Live AI verification requires a
configured key and model access.

## Container

```bash
docker build -t findwhere .
docker run --rm -p 8787:8787 --env-file .env findwhere
```

The container runs a production build and binds to `0.0.0.0`. It does not need a database volume because cases
belong to the browser. Supply `GEMINI_API_KEY` through your deployment's secret manager when applicable;
do not bake secrets into the image.

## Project layout

```text
src/App.jsx                 Investigation workspace, saved cases, and resource library
src/components/MapPanel.jsx Leaflet map and candidate markers
src/lib/domain.mjs          Validated cases, coordinates, reports, and analysis contracts
src/lib/photo.mjs           Local image resizing and EXIF extraction
src/lib/storage.mjs         IndexedDB persistence
src/lib/backup.mjs          Versioned JSON backups and validated imports
src/lib/investigation.mjs   Evidence validation and candidate refinement rules
src/data/resources.json     Curated and attributed OSINT resources
server/app.mjs              Health, geocoding, and optional AI endpoints
tests/                      Offline domain and API regression tests
```

## Credits and licenses

Application code: [MIT](LICENSE), copyright 2026 saad2jz.

Method inspiration: [marouane53/GeoINT](https://github.com/marouane53/GeoINT) (MIT). Resource discovery:
[OSINT4ALL](https://start.me/p/L1rEYQ/osint4all). Catalog descriptions and application implementation are original;
per-resource discovery attribution is retained in the catalog.

Sample photo: **“The rooftops of Lisbon”** by **Bert K. / Bert Kaufmann**, from
[Wikimedia Commons](https://commons.wikimedia.org/wiki/File:The_rooftops_of_Lisbon.jpg), licensed under
[CC BY 2.0](https://creativecommons.org/licenses/by/2.0/). Included as a 960px resized preview; cropped by the
interface for display. Camera coordinates and sample metadata are attributed to the same source page.
Map data and imagery retain their provider attribution in the map.
