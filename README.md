# Findwhere

**Find the place behind the picture.** A standalone web app for photo geolocation investigations: upload a
photo, inspect local metadata, map possible locations, collect evidence, and export a report.

Built with React, Vite, Leaflet, and a Node/Express server. Inspired by the investigation method in
[GeoINT](https://github.com/marouane53/GeoINT) and the resource discovery directory
[OSINT4ALL](https://start.me/p/L1rEYQ/osint4all). This is an independent application with a fresh Git history;
it does not bundle or run the upstream agent skill or its Python/model toolchain.

## What works

- **Photo intake:** JPEG, PNG, and WebP upload or drag and drop; local EXIF extraction; automatic GPS candidates.
- **Photo inspection:** expand a stored preview, zoom up to 8× its fitted size, drag or use arrow keys to pan,
  rotate in 90° steps, and reset the view. Use + / −, R, and 0 while the image area is focused.
  These view controls do not alter the saved photo or reconstruct detail lost during resizing.
- **Reference comparison:** choose **Compare** beside the source image to add a local reference photo or screenshot.
  Inspect the two previews with separate controls, record a source URL and comparison notes, and save the details.
  The reference is saved with the investigation and included in JSON backups; its source and notes appear in reports.
  Replacing the reference clears its old source and notes. A removed reference can be restored with **Undo**
  while the dialog stays open. No candidate is automatically marked verified.
- **Investigation map:** interactive candidate markers, street/satellite layers, zoom, recentering, and external
  Google Maps/Street View links.
- **Location candidates:** search named places or enter WGS84 coordinates; refine names, points, confidence,
  and reasoning; mark hypotheses supported or ruled out. Refinements retain the original lead and source.
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
- **Optional real AI scene analysis:** the server calls OpenAI's Responses API, returning visible clues and unverified
  location hypotheses with qualitative confidence. A configured server API key is required.
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
OPENAI_API_KEY=your-server-key
OPENAI_MODEL=gpt-4.1-mini
```

Restart the server. Upload a photo and choose **Analyze scene**. The app explains the data transfer before
the user chooses **Send photo & analyze**. No browser API key field is used and keys are never included in
the frontend bundle. Without a key, the rest of the app remains functional and the interface shows setup
instructions rather than simulated analysis.

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

Implementation references: [image input](https://developers.openai.com/api/docs/guides/images-vision) and
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

Only the explicit AI action sends the resized JPEG and optional context to OpenAI via the server. The original
file and its EXIF payload are not sent. The request uses `store: false`; this does not override the provider's
other applicable data-handling policies. Photos are not automatically uploaded to reverse-image services.

The map requests tiles from OpenStreetMap or Esri. Map views reveal the viewed area to the tile provider.
Place searches send the typed query to Nominatim through the server, with an identifying User-Agent, a global
1.1-second request interval, and a bounded in-memory cache. There is no autocomplete. Configure `GEOCODER_URL`
and `GEOCODER_USER_AGENT` for another compatible service or a deployment with greater traffic. Follow the
[Nominatim usage policy](https://operations.osmfoundation.org/policies/nominatim/) and applicable map-provider terms.

Research links open external sites; contextual map links embed the selected candidate coordinates. Most
directory entries open a landing page for manual input, rather than claiming a native service integration.
Network failures show a useful fallback; manual coordinates and case notes still work.

The server is intended for personal use. Before exposing a deployment that can spend your API credit, put it
behind authentication. Built-in origin checks, image-size validation, five AI requests per minute per client,
and a two-analysis concurrency limit are basic protections, not multi-user authentication or billing controls.

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
belong to the browser. Use `-e OPENAI_API_KEY=...` through your deployment's secret manager when applicable;
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
