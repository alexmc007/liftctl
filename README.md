# LiftCtl

Lifting tracker with an adaptive VO₂ cardio trainer. One self-contained
`index.html` — no build step, no dependencies, no service worker.

Live: https://alexmc007.github.io/liftctl/

| file | what it is |
|---|---|
| `index.html` | the app (phone for logging, desktop for reading) |
| `sync.gs` | Apps Script backend, so the phone and the desktop share one state |
| `legacy/index.html` | the previous light-theme build, kept as a fallback |
| `camryn.html` | separate build, untouched by the v11/v12 work |

## Turning sync on

State lives in a hidden `_State` sheet in your Google Sheet; the app reads and
writes it over HTTP.

1. Open the Sheet the old app used → **Extensions → Apps Script**.
2. Paste `sync.gs` over `Code.gs`.
3. **Deploy → New deployment → Web app**, *Execute as* **Me**, *Who has access*
   **Anyone**. Copy the `/exec` URL.
4. In LiftCtl → **Settings → Sync**, paste that URL and hit **Connect**. Do the
   same on the other device — same URL.

After editing `sync.gs` you must **Deploy → Manage deployments → edit → New
version**, otherwise the URL keeps serving the old code.

The endpoint URL is stored per device, outside the exported JSON, so an export
stays portable and never carries your endpoint with it.

## How syncing behaves

- Pulls on load, when a tab comes back to the front, and when the network
  returns; pushes about 2.5s after any change.
- Sessions, quick logs, per-line history, PRs and cardio history are **merged**,
  never replaced — a stale tab cannot delete what the other device logged.
- Goals, settings and the program carry their own timestamps, so logging on the
  phone never rolls back an edit made on the desktop.
- Writes use the revision the client last read; if the sheet moved on in
  between, the write is refused, merged and retried.
- The in-progress workout (`lc_run`) is deliberately **not** synced — it stays
  on the phone that is logging it.

## Data

Everything is in `localStorage` under `lc_state` (all history) and `lc_run`
(the workout in progress). Settings → **Download backup file** writes a JSON
snapshot; **Import everything** takes one back, including exports from the old
app.
