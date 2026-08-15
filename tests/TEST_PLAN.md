# Test plan — Kampong Basket

## 1. Automated tests (`tests/data-store.test.js`)

Run with:
```
npm test
```
(uses Node's built-in test runner — no install step needed, Node ≥18)

| # | Suite | What it does | What it asserts |
|---|-------|--------------|------------------|
| 1 | **Requesters — concurrency** | Simulates 50 households submitting a request at once, each listing 10 items, with randomised (jittered) scheduling so submissions interleave out of order. | Every `NEED-*` reference ID is unique; every one of the 500 item IDs is unique; nothing is lost or duplicated in the store's index; every item starts in the `pending` (grey) state; every requester receives a logged status message. |
| 2 | **Donors — concurrency** | Same shape, 50 donors each offering 10 items concurrently. | `DONOR-*` reference IDs and all 500 item IDs are unique; every donation item starts `available`; ID format is validated by regex. |
| 3 | **Volunteers — matching correctness & messaging** | Seeds 5 households (mixed urgency) and 3 donors with overlapping and deliberately *scarce* item names (2 "Rice 5kg" donations vs 3 requesters), then runs the matching pass. | Every match pairs items with the same normalised product name; no donation item is matched twice; no need item is matched twice; **the two most urgent households are served before the least urgent one when supply is short** (urgency-first allocation); both sides receive a message on match; marking an item collected flips it to `fulfilled`/`delivered` and logs a thank-you/confirmation to both sides; the audit trail correctly traces the donation item to the need item it fulfilled. |
| 4 | **Reference ID / PIN auth** | Creates a request with a PIN. | Correct ref + correct PIN succeeds; correct ref + wrong PIN fails; unknown ref returns no record. |
| 5 | **Combined load** | 50 requesters and 50 donors writing concurrently at the same time (not sequentially), 1,000 items total. | Neither index corrupts the other; a subsequent matching pass produces matches from the combined pool. |

All 5 suites currently pass (`npm test` → `# pass 5`, `# fail 0`).

### Why "concurrency" is simulated, not networked
This is a static site (GitHub Pages serves only files). The shipped storage adapter is the browser's own `localStorage`, which is private to one browser tab on one device — two different people are never writing to the same storage at the same instant, so there is no real race condition to reproduce in that configuration. The tests instead attack the **logic** (ID generation, index append, matching) with adversarially-interleaved async scheduling, which is the property that *would* matter the moment `store.js`'s adapter is pointed at a shared backend (see the README section "Going beyond a single browser"). If you do wire up Firebase/Supabase, re-run an equivalent load test against the real backend before relying on it.

## 2. Manual / browser test checklist

These require a real browser (image upload, microphone, language rendering) and aren't practical to script headlessly for a no-build static site:

- [ ] Submit a request in each of the 4 languages; confirm all labels, the urgency slider, and success message render correctly and the reference ID format is unaffected by language.
- [ ] Attach a photo to a needed item and confirm the thumbnail preview appears before submit.
- [ ] Record a voice note on a needed item (allow microphone permission) and confirm the "Recorded ✓" status appears.
- [ ] Submit an offer with "Direct offer" mode and again with "Bulk purchase / freebies" mode; confirm the collection address is required in both.
- [ ] Submit a request/offer with no items filled in — confirm the inline error message shows and nothing is saved.
- [ ] On the Volunteer board, click "Run matching now" with no data — confirm the "no matches" message shows.
- [ ] Create one request and one matching donation, run matching, confirm the item chip changes from the grey/outlined "pending" style to the amber "matched" style, then click "Mark as collected" and confirm it turns to the full-colour green "fulfilled" style (the grey → colour requirement).
- [ ] Use "Check status" with the request's reference number and no PIN when a PIN *was* set — confirm it is rejected; then with the correct PIN — confirm it succeeds and shows the update log.
- [ ] Resize to a mobile viewport (~375px) and confirm the nav, forms, and item chips remain usable.
- [ ] Tab through a form using only the keyboard and confirm every input/button shows a visible focus outline.

## 3. Suggested load test against a real backend (if you add one)

If `store.js`'s adapter is later pointed at Firebase/Supabase, adapt the same three concurrency suites to run against the live backend from a script using 50 real parallel HTTP/SDK calls (not just interleaved promises in one process), and re-check the same invariants: unique IDs, no lost writes, correct urgency-first allocation, and messages delivered to both sides exactly once.
