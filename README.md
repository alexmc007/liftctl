# SetClock

Live: **https://alexmc007.github.io/liftctl/**

A weekly **set bank** for lifting. Not a program — you owe a number of sets per
muscle each week, you log them from any gym on any day, and the app tracks the
debt against a clock.

One self-contained `index.html`. No build step, no backend, no dependencies.
Data lives in the browser's `localStorage` on this origin.

## How it works

- **Effective sets** — a movement gives **1.0** to its primary muscle and **0.5**
  to each secondary, so benching feeds triceps without logging a pushdown.
- **Day allowance** — the weekly target divided by how many times a week you
  train that muscle (Plan → Schedule, 1–3×). At 1× a muscle gets its whole week
  in one session.
- **Traffic lights** — green: keep going · yellow: enough of that muscle for
  today · **red: weekly target met, done for the week**. Red means finished, not
  bad.
- **Groups** — Chest & Triceps, Back & Biceps, Shoulders & Abs, Legs. Tapping one
  builds a session for whichever gym you are standing in, pre-filled with the
  weights you used last time.
- **Weeks run Sunday → Saturday.** The weekly tally resets. Your history and
  personal records never do.

215 movements, per-gym equipment filtering, machine setup notes, rest timer,
soreness log, PR tracking, JSON export/import.

## Files

| Path | What |
| --- | --- |
| `index.html` | SetClock — the live app |

This site previously hosted LiftCtl and Camryn's companion app. Both were removed
on 2026-08-11. Every file — `liftctl.html`, `camryn.html`, `legacy/`, `sync.gs` —
is recoverable from the **`liftctl-v13-final`** tag:

```
git checkout liftctl-v13-final
```

## Backups

Storage is per-browser and is not synced anywhere. Plan → Data → **Export JSON**
writes a full backup; **Import JSON** restores one. Do it occasionally.
