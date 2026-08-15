/**
 * data-store.test.js
 * Run with:  npm test    (or: node --test tests/)
 *
 * Exercises the same store.js module the website uses in the browser,
 * against an in-memory adapter, so the concurrency and matching logic
 * can be verified headlessly.
 *
 * NOTE ON "CONCURRENCY" IN A STATIC SITE:
 * store.js's real runtime adapter is the browser's localStorage, which
 * is single-tab / single-device — two different people never write to
 * the same storage at once, so classic race conditions do not occur
 * on GitHub Pages as shipped. The tests below still simulate 50
 * interleaved, out-of-order writers (via randomly-ordered microtask
 * scheduling) to prove the ID-generation and indexing logic has no
 * collisions or lost writes even under adversarial ordering — this is
 * the property you must re-verify if store.js is later pointed at a
 * shared backend (see README "Going beyond a single browser").
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const KampongStore = require('../site/js/store.js');

function freshStore() {
  return KampongStore.createStore(KampongStore.makeMemoryAdapter());
}

function jitter() {
  return new Promise((resolve) => setTimeout(resolve, Math.floor(Math.random() * 5)));
}

function sampleNeedItems(n, seed) {
  const names = ['Rice 5kg', 'Milk Powder', 'Cooking Oil', 'Diapers', 'Instant Noodles', 'Canned Sardines', 'Sugar', 'Eggs', 'Bread', 'Detergent'];
  const out = [];
  for (let i = 0; i < n; i++) {
    out.push({ name: names[(i + seed) % names.length], qty: `${i + 1} unit(s)` });
  }
  return out;
}

// -----------------------------------------------------------------
// 1. REQUESTERS (those in need) — 50 concurrent users x 10 items each
// -----------------------------------------------------------------
test('requesters: 50 concurrent users each submitting 10 items', async () => {
  const store = freshStore();
  const USERS = 50;
  const ITEMS_PER_USER = 10;

  const jobs = Array.from({ length: USERS }, (_, u) => (async () => {
    await jitter(); // interleave submission order unpredictably
    return store.addNeedRequest({
      requesterName: `Household ${u}`,
      contact: `9000${String(u).padStart(4, '0')}`,
      urgency: (u % 5) + 1,
      items: sampleNeedItems(ITEMS_PER_USER, u),
    });
  })());

  const results = await Promise.all(jobs);

  // All 50 requests succeeded
  assert.equal(results.length, USERS);

  // Every top-level reference ID is unique
  const refIds = results.map((r) => r.id);
  assert.equal(new Set(refIds).size, USERS, 'NEED reference IDs must be unique');

  // Every item across every request has a unique item ID and 10 items each
  const allItemIds = [];
  results.forEach((r) => {
    assert.equal(r.items.length, ITEMS_PER_USER);
    r.items.forEach((it) => allItemIds.push(it.itemId));
  });
  assert.equal(allItemIds.length, USERS * ITEMS_PER_USER);
  assert.equal(new Set(allItemIds).size, allItemIds.length, 'item IDs must be unique across all requesters');

  // The store's own index has exactly 50 needs — nothing lost, nothing duplicated
  const stored = store.listNeeds();
  assert.equal(stored.length, USERS);
  const storedTotalItems = stored.reduce((sum, n) => sum + n.items.length, 0);
  assert.equal(storedTotalItems, USERS * ITEMS_PER_USER);

  // Every item starts pending / greyed-out
  stored.forEach((n) => n.items.forEach((it) => assert.equal(it.status, 'pending')));

  // Each requester got a status-check message logged
  results.forEach((r) => {
    const msgs = store.getMessages(r.id);
    assert.ok(msgs.length >= 1);
  });
});

// -----------------------------------------------------------------
// 2. DONORS — 50 concurrent users x 10 items each
// -----------------------------------------------------------------
test('donors: 50 concurrent users each offering 10 items', async () => {
  const store = freshStore();
  const USERS = 50;
  const ITEMS_PER_USER = 10;

  const jobs = Array.from({ length: USERS }, (_, u) => (async () => {
    await jitter();
    return store.addDonation({
      donorName: `Donor ${u}`,
      contact: `8000${String(u).padStart(4, '0')}`,
      mode: u % 2 === 0 ? 'direct' : 'bulk',
      collectionAddress: `Block ${100 + u}, Void Deck`,
      items: sampleNeedItems(ITEMS_PER_USER, u),
    });
  })());

  const results = await Promise.all(jobs);

  assert.equal(results.length, USERS);

  const refIds = results.map((r) => r.id);
  assert.equal(new Set(refIds).size, USERS, 'DONOR reference IDs must be unique');

  const allItemIds = [];
  results.forEach((r) => {
    assert.equal(r.items.length, ITEMS_PER_USER);
    r.items.forEach((it) => allItemIds.push(it.itemId));
  });
  assert.equal(allItemIds.length, USERS * ITEMS_PER_USER);
  assert.equal(new Set(allItemIds).size, allItemIds.length, 'item IDs must be unique across all donors');

  const stored = store.listDonations();
  assert.equal(stored.length, USERS);
  stored.forEach((d) => d.items.forEach((it) => assert.equal(it.status, 'available')));

  // Reference IDs from requesters and donors never collide with each other
  // (different prefixes) — sanity check the prefixes are as expected.
  refIds.forEach((id) => assert.match(id, /^DONOR-\d{5}-[A-Z0-9]{4}$/));
});

// -----------------------------------------------------------------
// 3. VOLUNTEERS — matching correctness + messaging
// -----------------------------------------------------------------
test('volunteers: matching pairs correct items, never double-books, and messages both sides', async () => {
  const store = freshStore();

  // 5 needy households, mixed urgency, overlapping item names with donors
  const needSeeds = [
    { name: 'Household A', urgency: 5, items: [{ name: 'Rice 5kg' }, { name: 'Milk Powder' }] },
    { name: 'Household B', urgency: 2, items: [{ name: 'Rice 5kg' }] },
    { name: 'Household C', urgency: 4, items: [{ name: 'Diapers' }, { name: 'Eggs' }] },
    { name: 'Household D', urgency: 1, items: [{ name: 'Cooking Oil' }] },
    { name: 'Household E', urgency: 3, items: [{ name: 'Bread' }, { name: 'Sugar' }, { name: 'Rice 5kg' }] },
  ];
  const needRecords = needSeeds.map((s) => store.addNeedRequest({
    requesterName: s.name, contact: '90000000', urgency: s.urgency, items: s.items,
  }));

  // Donors offering a mix — deliberately fewer "Rice 5kg" than requested (3 needed, 2 available)
  const donorSeeds = [
    { name: 'Donor X', items: [{ name: 'Rice 5kg' }, { name: 'Eggs' }] },
    { name: 'Donor Y', items: [{ name: 'Rice 5kg' }, { name: 'Milk Powder' }, { name: 'Cooking Oil' }] },
    { name: 'Donor Z', items: [{ name: 'Diapers' }, { name: 'Bread' }] },
  ];
  const donorRecords = donorSeeds.map((s) => store.addDonation({
    donorName: s.name, contact: '80000000', mode: 'direct', collectionAddress: 'Blk 1', items: s.items,
  }));

  const result = store.runMatching();

  // Correctness: every match pairs items with the same (normalised) name
  result.matchesMade.forEach((m) => {
    const need = store.getNeed(m.needId);
    const needItem = need.items.find((i) => i.itemId === m.needItemId);
    const donation = store.getDonation(m.donationId);
    const donationItem = donation.items.find((i) => i.itemId === m.donationItemId);
    assert.equal(needItem.status, 'matched');
    assert.equal(donationItem.status, 'reserved');
    assert.equal(
      store._normName(needItem.name),
      store._normName(donationItem.name),
      'matched items must be the same product'
    );
    assert.equal(donationItem.reservedForNeedItemId, needItem.itemId);
    assert.equal(needItem.matchedDonationItemId, donationItem.itemId);
  });

  // No donation item was matched twice
  const usedDonationItemIds = result.matchesMade.map((m) => m.donationItemId);
  assert.equal(new Set(usedDonationItemIds).size, usedDonationItemIds.length, 'a donation item must not be double-booked');

  // No need item was matched twice
  const usedNeedItemIds = result.matchesMade.map((m) => m.needItemId);
  assert.equal(new Set(usedNeedItemIds).size, usedNeedItemIds.length, 'a need item must not be matched twice');

  // Urgency ordering: with only 2 "Rice 5kg" donations available for 3 requesters,
  // the two most urgent households asking for rice (A=5, E=3) should be served
  // before the least urgent (B=2).
  const riceMatches = result.matchesMade.filter((m) => store._normName(m.itemName) === store._normName('Rice 5kg'));
  assert.equal(riceMatches.length, 2, 'only as many rice matches as rice donations exist');
  const servedNeedIds = riceMatches.map((m) => m.needId);
  const householdA = needRecords[0].id;
  const householdB = needRecords[1].id;
  const householdE = needRecords[4].id;
  assert.ok(servedNeedIds.includes(householdA), 'most urgent household should be served first');
  assert.ok(servedNeedIds.includes(householdE), 'second most urgent household should be served next');
  assert.ok(!servedNeedIds.includes(householdB), 'least urgent household should wait when supply is short');

  // Messaging: both sides of every match received an update
  result.matchesMade.forEach((m) => {
    const needMsgs = store.getMessages(m.needId).map((x) => x.text).join(' ');
    const donorMsgs = store.getMessages(m.donationId).map((x) => x.text).join(' ');
    assert.match(needMsgs, /matched/i);
    assert.match(donorMsgs, /matched|Thank you/i);
  });

  // Fulfilment flow: mark one matched pair as collected, verify colour flip + messages
  const firstMatch = result.matchesMade[0];
  store.fulfil(firstMatch.needId, firstMatch.needItemId);
  const updatedNeed = store.getNeed(firstMatch.needId);
  const updatedItem = updatedNeed.items.find((i) => i.itemId === firstMatch.needItemId);
  assert.equal(updatedItem.status, 'fulfilled');
  const updatedDonation = store.getDonation(firstMatch.donationId);
  const updatedDonationItem = updatedDonation.items.find((i) => i.itemId === firstMatch.donationItemId);
  assert.equal(updatedDonationItem.status, 'delivered');

  const collectedMsg = store.getMessages(firstMatch.needId).map((x) => x.text).join(' ');
  assert.match(collectedMsg, /collected/i);
  const thankYouMsg = store.getMessages(firstMatch.donationId).map((x) => x.text).join(' ');
  assert.match(thankYouMsg, /delivered|Thank you/i);

  // Audit trail: full traceability from donation item -> need item
  const audit = store.auditTrail();
  const auditRow = audit.find((r) => r.donationItemId === firstMatch.donationItemId);
  assert.ok(auditRow, 'audited donation item must be present');
  assert.equal(auditRow.donationStatus, 'delivered');
  assert.equal(auditRow.reservedForNeedItemId, firstMatch.needItemId);
});

// -----------------------------------------------------------------
// 4. Reference ID / PIN checks (auth for status look-ups)
// -----------------------------------------------------------------
test('status lookup: correct ref + PIN succeeds, wrong PIN and unknown ref fail', () => {
  const store = freshStore();
  const record = store.addNeedRequest({
    requesterName: 'Test Household', contact: '90000000', pin: '4321',
    items: [{ name: 'Rice 5kg' }],
  });

  assert.equal(store.verifyPin(record.id, '4321'), true);
  assert.equal(store.verifyPin(record.id, '0000'), false);
  assert.equal(store.getStatus('NEED-99999-ZZZZ'), null);
  assert.equal(store.getStatus(record.id).type, 'need');
});

// -----------------------------------------------------------------
// 5. Combined load: 50 requesters + 50 donors + a matching pass, all
//    interleaved, to catch any cross-contamination between indices.
// -----------------------------------------------------------------
test('combined load: requesters and donors writing concurrently do not corrupt each other\'s indices', async () => {
  const store = freshStore();
  const N = 50;

  const needJobs = Array.from({ length: N }, (_, u) => (async () => {
    await jitter();
    return store.addNeedRequest({ requesterName: `H${u}`, contact: '9', urgency: (u % 5) + 1, items: sampleNeedItems(10, u) });
  })());
  const donorJobs = Array.from({ length: N }, (_, u) => (async () => {
    await jitter();
    return store.addDonation({ donorName: `D${u}`, contact: '8', mode: 'direct', collectionAddress: 'x', items: sampleNeedItems(10, u + 3) });
  })());

  const [needResults, donorResults] = await Promise.all([Promise.all(needJobs), Promise.all(donorJobs)]);

  assert.equal(store.listNeeds().length, N);
  assert.equal(store.listDonations().length, N);
  assert.equal(needResults.length, N);
  assert.equal(donorResults.length, N);

  const matchResult = store.runMatching();
  assert.ok(matchResult.matchedCount > 0, 'with 500 need items and 500 donation items drawn from the same 10 names, at least some should match');
});
