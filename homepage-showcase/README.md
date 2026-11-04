# Homepage product-showcase assets

Replaces the three old homepage thumbnails (On-site capture / AI cross-check / Submit) with four screens of the real app:

1. `renders/hc-showcase-01-dashboard.png` — portfolio compliance health (RAG dashboard)
2. `renders/hc-showcase-02-landlords.png` — landlords linked to Rent Smart Wales + read-only landlord portal
3. `renders/hc-showcase-03-team.png` — full team with six roles
4. `renders/hc-showcase-04-wizard.png` — inspection wizard on phone + tablet (web and on site)

Spec: project doc `claude/housecomply-showcase-spec.md`.

## Data
Public marketing assets. Built from scratch with demo data only: invented names, fake addresses, fabricated Rent Smart Wales numbers, no emails. No real customer data, no reference to any client inspection asset. Pending Sgt ground-truth re-check before publish.

## Type (open item)
The PNGs render with **Lora / Inter** stand-ins because the Google Fonts CDN was blocked in the render sandbox. The final assets must render with **Newsreader** (serif) + **Hanken Grotesk** (sans), pullable from the `google/fonts` GitHub repo (`ofl/newsreader`, `ofl/hankengrotesk`) since the CDN is blocked. Only change needed: swap the `--serif` / `--sans` stacks in `build/app.css` and re-render `build/render.js`.

## Build files
- `build/app.css` — tokens (from the live site `:root`) + device frames + app UI
- `build/1-dashboard.html` … `build/4-wizard.html` — the four artboards
- `build/render.js` — Playwright render script (outputs the PNGs at 2x)

Bob builds the homepage section in `dom-3/housecomply-marketing` from these static PNGs; he does not rebuild the app screens. Never the app repo `housecomply-stage-b`.
