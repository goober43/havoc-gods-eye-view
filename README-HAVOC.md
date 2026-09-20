# HAVOC God View

Working tree is the MIT tip of [bilawalsidhu/gods-eye-view](https://github.com/bilawalsidhu/gods-eye-view) (`0d41b6b`, PR #626) plus HAVOC lane adapters. Do **not** use `goober43/mirror-gods-eye-view` (Aug 24 archival).

## Run

```bash
cp .env.example .env   # optional; install is keyless
npm ci
npm run dev            # http://127.0.0.1:4173
```

**Production / Cloudflare tunnel (required for acceptance):** Vite `dev`/`preview` enforce a Host allowlist and will show “Blocked request. This host is not allowed.” behind cloudflared. Do **not** paper over that with `preview.allowedHosts`. Build a static `dist` and serve it with the Node static host (no HMR, no Vite host check; `/api/havoc/*` and `/healthz` stay attached):

```bash
npm ci
npm run build
HOST=0.0.0.0 PORT=4173 npm run start
# then: cloudflared tunnel --url http://127.0.0.1:4173
```

`npm run start` is `node server/standalone/static-serve.mjs`. It refuses to boot if `dist/index.html` is missing.

Vite preview is local-only (`npm run preview`) and is not the tunnel path.

Docker:

```bash
docker build -t havoc-god-view .
docker run -p 4173:4173 -e HOST=0.0.0.0 havoc-god-view
# `npm run start` inside the image — GET /healthz → ok; no Vite host check
```

Node `>=24.14 <25 || >=26 <27`. Cesium ion is optional. The globe boots on **keyless Esri World Imagery** with OSM as the automatic fallback.

## Env

| Variable | Required | Purpose |
| --- | --- | --- |
| `HAVOC_SUPABASE_URL` | no | Supabase origin (`SUPABASE_URL`). Unset → `public/havoc/*.geojson` stubs. |
| `HAVOC_SUPABASE_KEY` | no | Service role (`SUPABASE_SERVICE_ROLE_KEY`). Anon RLS is empty on `vessel_history`, `aircraft_history`, `event_clusters`. |
| `CESIUM_ION_TOKEN` | no | Bing stacks + world terrain only. |
| `HOST` / `PORT` | no | Bind address. `0.0.0.0` for hosted preview. |

The proxy also reads `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` if the `HAVOC_*` names are unset. It never uses the anon key. Do not commit secrets.

Metered keys are **parked** (hidden from POWER UP, not required to install): Google Maps, TomTom, AISStream/MarineTraffic-class live ships, OpenSky. Do not add Google Maps / TomTom / MarineTraffic / AP keys.

## Layers

**Map-usable (PostgREST bbox/limit sample, 206 + `Prefer: count=exact`):**

- `lane_events` → `havoc-lane-events` — `location_lat`/`location_lon`, `map_eligible=eq.true`
- `havoc_intel` → `havoc-intel` — `geo_lat`/`geo_lon` (+ `geom`)
- `vessel_history` → `havoc-vessel-history` — `lat`/`lon`
- `aircraft_history` → `havoc-aircraft-history` **and** the Flights layer (OpenSky replaced) — `lat`/`lon`

**Limited geo (layer stays registered; live points empty / optional):**

- `event_clusters` — place string only
- `io_campaigns` — regions text
- `whale_movements` — geo mostly null; map rows that have coords
- `polymarket_signals` — no coords

Each `GET /api/havoc/<table>?bbox=west,south,east,north&limit=2000` hits `{SUPABASE_URL}/rest/v1/<table>` when env is set (206 + `Prefer: count=exact` is success), otherwise serves bundled stubs so a keyless install still boots. Toggle the **HAVOC** group in Data Layers. Acceptance priority: aircraft_history + lane_events + vessel_history + havoc_intel on keyless Esri.

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
