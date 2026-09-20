# HAVOC God View

Working tree is the MIT tip of [bilawalsidhu/gods-eye-view](https://github.com/bilawalsidhu/gods-eye-view) (`0d41b6b`, PR #626) plus HAVOC lane adapters. Do **not** use `goober43/mirror-gods-eye-view` (Aug 24 archival).

## Run

```bash
cp .env.example .env   # optional; install is keyless
npm ci
npm run dev            # http://127.0.0.1:4173
```

Hosted / preview (API proxies stay live):

```bash
npm run build
npm run preview        # HOST=0.0.0.0 PORT=$PORT for Render/Docker
```

Docker:

```bash
docker build -t havoc-god-view .
docker run -p 4173:4173 -e HOST=0.0.0.0 havoc-god-view
# GET /healthz → ok
```

Node `>=24.14 <25 || >=26 <27`. Cesium ion is optional. The globe boots on **keyless Esri World Imagery** with OSM as the automatic fallback.

## Env

| Variable | Required | Purpose |
| --- | --- | --- |
| `HAVOC_SUPABASE_URL` | no | PostgREST/Supabase origin. Unset → sample GeoJSON stubs in `public/havoc/`. |
| `HAVOC_SUPABASE_KEY` | no | `apikey` / Bearer for PostgREST. |
| `CESIUM_ION_TOKEN` | no | Bing stacks + world terrain only. |
| `HOST` / `PORT` | no | Bind address. `0.0.0.0` for hosted preview. |

Metered keys are **parked** (hidden from POWER UP, not required to install): Google Maps, TomTom, AISStream/MarineTraffic-class live ships, OpenSky. Do not add Google Maps / TomTom / MarineTraffic / AP keys.

## Layers

**Live (adapter + stub, no secrets):**

- `lane_events` → `havoc-lane-events`
- `havoc_intel` → `havoc-intel`
- `event_clusters` → `havoc-event-clusters`
- `vessel_history` → `havoc-vessel-history`
- `aircraft_history` → `havoc-aircraft-history` **and** the Flights layer (OpenSky replaced)
- `io_campaigns` → `havoc-io-campaigns`
- `whale_movements` → `havoc-whale-movements`
- `polymarket_signals` → `havoc-polymarket-signals`

Each `GET /api/havoc/<table>?bbox=west,south,east,north&limit=2000` prefers PostgREST when both env vars are set, otherwise serves `public/havoc/<table>.geojson`. Toggle the **HAVOC** group in Data Layers.

**Removed / parked:**

- TeleGeography submarine cables (CC BY-NC-SA) — dataset deleted
- OpenSky — flights use `aircraft_history`
- Google News RSS — GDELT only
- `commercial_ok=false` hosts stay out: gdacs, energynow.com, konbriefing.com, bellingcat.com, opensky, who.int, www.nyse.com

## Cherry-picks (pieces only)

- ianborders: `render.yaml` + Vite `preview` host/`allowedHosts` so `/api` works on a public host
- Onesecondafter: `Dockerfile` + `/healthz`
- uhrichsam4: `markerBatch` + viewport culling for dense HAVOC points
- jazzjabu: custom GeoJSON FeatureCollection → globe points

No wholesale forks. No WorldPixelMap DRM.
