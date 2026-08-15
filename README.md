# Kampong Basket

A neighbourhood grocery-sharing site for a Singapore community: households
list what they need, neighbours offer groceries (direct drop-off, or bulk
purchase/freebies from supermarket deals), and volunteers match the two
sides and track everything through to collection. Available in English,
中文 (Simplified Chinese), Bahasa Melayu, and தமிழ் (Tamil).

## ⚠️ Read this before you deploy

GitHub Pages only serves **static files** — there is no server and no
shared database. This build stores all data in the browser's
`localStorage`, which is private to **one browser, on one device**. That
means, as shipped:

- A donor filling in the form on their phone and a requester checking
  status on their laptop **will not see each other's data** — they're
  different browsers.
- Data does not survive clearing browser data, and isn't backed up anywhere.

This is enough to **demo the full flow end-to-end on one device** (submit a
request, submit a matching donation, run matching as a volunteer, watch the
item turn from grey to colour, check status by reference number) and to
**test the matching/ID logic** (see `tests/`), but it is **not** yet a
real multi-user community tool. To make it real, you need a shared
backend. The good news: the app is already structured so this is a small
change, not a rewrite.

### Going beyond a single browser (recommended path)

`site/js/store.js` is written against a small adapter interface
(`get`, `set`, `keys`) — search for `STORAGE ADAPTER` in that file. To go
live for real, swap `makeLocalStorageAdapter()` for an adapter backed by:

- **Firebase Firestore** (free Spark tier is normally enough for a
  neighbourhood) — add the Firebase SDK `<script>` tag to `index.html`,
  write a small adapter whose `get`/`set` call Firestore instead of
  `localStorage`, and everything in `app.js` keeps working unchanged.
- **Supabase** (Postgres-backed, also has a free tier) — same idea, a thin
  adapter around its JS client.

For sending real SMS/WhatsApp messages to requesters and donors (this
build only logs an in-app message the person sees when they check their
reference number), pair the backend with a serverless function calling
Twilio or WhatsApp Business API when `runMatching()`/`fulfil()` fire.

## Project structure

```
site/                    ← this is what you publish to GitHub Pages
  index.html              single-page app: home, request, offer, track, volunteer board
  css/styles.css          design system (see "Design" below)
  js/i18n.js              EN/ZH/MS/TA translation strings
  js/store.js             data layer: IDs, needs, donations, matching, messaging, audit trail
  js/app.js               DOM wiring: forms, image/voice capture, routing, rendering
tests/
  data-store.test.js      automated tests (concurrency + matching correctness)
  TEST_PLAN.md            what the automated suite covers + manual browser checklist
package.json              `npm test` runner (Node's built-in test runner, no install needed)
```

## Deploying to GitHub Pages

1. Create a new GitHub repository and push this project to it.
2. In the repo, go to **Settings → Pages**.
3. Under "Build and deployment", set **Source** to "Deploy from a branch".
4. Choose your default branch and, since `index.html` sits inside `site/`,
   either:
   - set the folder to `/site` if your GitHub plan's Pages UI offers a
     folder picker for that branch, **or**
   - move the contents of `site/` to the repository root (simplest —
     `index.html` must be at the repo root for the default `/ (root)`
     option), keeping `tests/` and `package.json` outside if you like.
5. Save. GitHub will publish at `https://<your-username>.github.io/<repo-name>/`.

No build step, no `npm install` required to run the site itself — it's
plain HTML/CSS/JS. `npm test` is only for the automated test suite.

## Running the tests

```
npm test
```

Runs 5 suites, including 50-concurrent-user load simulations for
requesters and donors, and a volunteer-matching correctness check. See
`tests/TEST_PLAN.md` for exactly what's covered and a manual browser
checklist for the parts (image upload, voice recording, i18n rendering)
that need a real browser.

## Design

Palette and type choices live in `site/css/styles.css` as CSS custom
properties: Kampong Green (primary), Turmeric Gold (accent/CTA), Batik
Indigo (header/ink), Rice Cream (background), Peranakan Pink (urgent
accent/errors), and Basket Grey (the unfulfilled-item state). Type pairs
Noto Serif (display) with Noto Sans (body) — both loaded with their
Simplified Chinese and Tamil companion faces so every language renders
natively — plus Space Mono for reference IDs.

The signature element is the **item chip**: every needed or offered
grocery item renders as a small "basket" chip that is grey and
dashed-outline while pending, turns amber once matched, and turns full
green once collected/delivered — making the "grey until fulfilled, colour
when fulfilled" requirement the literal visual language of the whole site,
not just the shopping-cart view.

## Accountability / audit model

Every need item and every donation item gets its own identifier
(`NEED-00001-AB2C-I1`, `DONOR-00007-K9QZ-I2`, etc.), and a match links the
two by ID (`reservedForNeedItemId` / `matchedDonationItemId`). The
Volunteer board's "Full audit trail" table lists every donation item, its
status, and exactly which need item it was reserved for — so any donated
item can be traced end-to-end to the household it fulfilled.
