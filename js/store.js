/**
 * store.js — Kampong Basket data layer
 * -------------------------------------------------
 * Pure, framework-free data logic so it can run:
 *   - in the browser (persisted to localStorage), and
 *   - in Node.js for automated / load testing (in-memory).
 *
 * IMPORTANT LIMITATION (read the README before deploying):
 * GitHub Pages only serves static files. localStorage is scoped to a
 * single browser on a single device — a donor on their phone and a
 * requester on their laptop do NOT share data. This module is written
 * against a small "adapter" interface (get/set/keys) specifically so
 * the localStorage adapter below can be swapped for a real backend
 * (e.g. Firebase Firestore, Supabase) without touching the logic in
 * this file. Search for "STORAGE ADAPTER" to see the swap point.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.KampongStore = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // ---------------------------------------------------------------
  // STORAGE ADAPTER — swap this block for a real backend if needed.
  // ---------------------------------------------------------------
  function makeMemoryAdapter() {
    const map = new Map();
    return {
      get(key) { return map.has(key) ? JSON.parse(map.get(key)) : null; },
      set(key, val) { map.set(key, JSON.stringify(val)); },
      keys(prefix) {
        return Array.from(map.keys()).filter((k) => k.indexOf(prefix) === 0);
      },
    };
  }

  function makeLocalStorageAdapter() {
    return {
      get(key) {
        const raw = localStorage.getItem(key);
        return raw ? JSON.parse(raw) : null;
      },
      set(key, val) { localStorage.setItem(key, JSON.stringify(val)); },
      keys(prefix) {
        const out = [];
        for (let i = 0; i < localStorage.length; i++) {
          const k = localStorage.key(i);
          if (k && k.indexOf(prefix) === 0) out.push(k);
        }
        return out;
      },
    };
  }

  // ---------------------------------------------------------------
  // ID generation
  // ---------------------------------------------------------------
  const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no 0/O/1/I ambiguity

  function randomToken(len) {
    let out = '';
    for (let i = 0; i < len; i++) {
      out += ALPHABET[Math.floor(Math.random() * ALPHABET.length)];
    }
    return out;
  }

  // Simple 4-digit PIN, stored as a naive hash (NOT cryptographically
  // secure — fine for a low-stakes "did you write this down" check on
  // a community prototype, not for anything sensitive).
  function hashPin(pin) {
    let h = 0;
    for (let i = 0; i < pin.length; i++) {
      h = (h * 31 + pin.charCodeAt(i)) >>> 0;
    }
    return h.toString(16);
  }

  // ---------------------------------------------------------------
  // Store factory
  // ---------------------------------------------------------------
  function createStore(adapter) {
    adapter = adapter || (typeof localStorage !== 'undefined' ? makeLocalStorageAdapter() : makeMemoryAdapter());

    const KEYS = {
      need: (id) => `need:${id}`,
      needIndex: 'index:needs',
      donation: (id) => `donation:${id}`,
      donationIndex: 'index:donations',
      messages: (ref) => `messages:${ref}`,
      seq: 'seq:counter',
    };

    function nextSeq() {
      const cur = adapter.get(KEYS.seq) || 0;
      const next = cur + 1;
      adapter.set(KEYS.seq, next);
      return next;
    }

    function pushIndex(indexKey, id) {
      const list = adapter.get(indexKey) || [];
      list.push(id);
      adapter.set(indexKey, list);
    }

    function log(ref, text) {
      const list = adapter.get(KEYS.messages(ref)) || [];
      list.push({ at: new Date().toISOString(), text });
      adapter.set(KEYS.messages(ref), list);
    }

    function getMessages(ref) {
      return adapter.get(KEYS.messages(ref)) || [];
    }

    // -- Needs ------------------------------------------------------
    // items: [{ name, qty, timeline, imageData, note }]
    function addNeedRequest({ requesterName, contact, notes, urgency, items, submittedBy, pin }) {
      if (!Array.isArray(items) || items.length === 0) {
        throw new Error('At least one item is required.');
      }
      const seq = nextSeq();
      const id = `NEED-${String(seq).padStart(5, '0')}-${randomToken(4)}`;
      const record = {
        id,
        pinHash: pin ? hashPin(pin) : null,
        requesterName: requesterName || '',
        contact: contact || '',
        notes: notes || '',
        urgency: Math.min(5, Math.max(1, urgency || 3)),
        submittedBy: submittedBy || 'self', // 'self' | 'volunteer'
        createdAt: new Date().toISOString(),
        items: items.map((it, idx) => ({
          itemId: `${id}-I${idx + 1}`,
          name: it.name,
          qty: it.qty || null,
          timeline: it.timeline || null,
          imageData: it.imageData || null,
          note: it.note || '',
          status: 'pending', // pending -> matched -> fulfilled
          matchedDonationItemId: null,
        })),
      };
      adapter.set(KEYS.need(id), record);
      pushIndex(KEYS.needIndex, id);
      log(id, `Request received. Reference ${id}. Keep this to check status.`);
      return record;
    }

    function getNeed(id) {
      return adapter.get(KEYS.need(id));
    }

    function listNeeds() {
      const ids = adapter.get(KEYS.needIndex) || [];
      return ids.map((id) => adapter.get(KEYS.need(id))).filter(Boolean);
    }

    // -- Donations ----------------------------------------------------
    // mode: 'direct' (drop off items as-is) | 'bulk' (bulk purchase / freebies,
    //        some items offered now, remainder to be delivered to a receiving point)
    // items: [{ name, qty, imageData, note }]
    function addDonation({ donorName, contact, mode, collectionAddress, notes, items, pin }) {
      if (!Array.isArray(items) || items.length === 0) {
        throw new Error('At least one item is required.');
      }
      const seq = nextSeq();
      const id = `DONOR-${String(seq).padStart(5, '0')}-${randomToken(4)}`;
      const record = {
        id,
        pinHash: pin ? hashPin(pin) : null,
        donorName: donorName || '',
        contact: contact || '',
        mode: mode === 'bulk' ? 'bulk' : 'direct',
        collectionAddress: collectionAddress || '',
        notes: notes || '',
        createdAt: new Date().toISOString(),
        items: items.map((it, idx) => ({
          itemId: `${id}-I${idx + 1}`,
          name: it.name,
          qty: it.qty || null,
          imageData: it.imageData || null,
          note: it.note || '',
          status: 'available', // available -> reserved -> delivered
          reservedForNeedItemId: null,
        })),
      };
      adapter.set(KEYS.donation(id), record);
      pushIndex(KEYS.donationIndex, id);
      log(id, `Offer received. Reference ${id}. Keep this to check status.`);
      return record;
    }

    function getDonation(id) {
      return adapter.get(KEYS.donation(id));
    }

    function listDonations() {
      const ids = adapter.get(KEYS.donationIndex) || [];
      return ids.map((id) => adapter.get(KEYS.donation(id))).filter(Boolean);
    }

    // -- Matching -----------------------------------------------------
    // Normalises an item name for fuzzy-ish matching (case/space/plural-insensitive).
    function normName(name) {
      return String(name || '')
        .toLowerCase()
        .trim()
        .replace(/\s+/g, ' ')
        .replace(/s$/, ''); // crude singular fold: "eggs" -> "egg"
    }

    /**
     * Runs the matching pass a volunteer triggers.
     * Strategy: sort pending need-items by (urgency desc, createdAt asc) —
     * most urgent / longest-waiting first — then greedily pair each with
     * the oldest available donation item that has a matching normalised name.
     * Returns a summary of matches made in this pass.
     */
    function runMatching() {
      const needs = listNeeds();
      const donations = listDonations();

      // Flatten pending need items with parent metadata, sorted by priority.
      const pendingNeedItems = [];
      needs.forEach((n) => {
        n.items.forEach((it) => {
          if (it.status === 'pending') {
            pendingNeedItems.push({ need: n, item: it });
          }
        });
      });
      pendingNeedItems.sort((a, b) => {
        if (b.need.urgency !== a.need.urgency) return b.need.urgency - a.need.urgency;
        return new Date(a.need.createdAt) - new Date(b.need.createdAt);
      });

      // Flatten available donation items, sorted oldest-first (FIFO).
      const availableDonationItems = [];
      donations.forEach((d) => {
        d.items.forEach((it) => {
          if (it.status === 'available') {
            availableDonationItems.push({ donation: d, item: it });
          }
        });
      });
      availableDonationItems.sort((a, b) => new Date(a.donation.createdAt) - new Date(b.donation.createdAt));

      const matchesMade = [];

      pendingNeedItems.forEach(({ need, item: needItem }) => {
        const target = normName(needItem.name);
        const donorIdx = availableDonationItems.findIndex(
          (d) => normName(d.item.name) === target && d.item.status === 'available'
        );
        if (donorIdx === -1) return;

        const { donation, item: donationItem } = availableDonationItems[donorIdx];

        // Mutate + persist need side
        needItem.status = 'matched';
        needItem.matchedDonationItemId = donationItem.itemId;
        adapter.set(KEYS.need(need.id), need);

        // Mutate + persist donation side
        donationItem.status = 'reserved';
        donationItem.reservedForNeedItemId = needItem.itemId;
        adapter.set(KEYS.donation(donation.id), donation);

        // Remove from the available pool so it can't be double-matched
        availableDonationItems.splice(donorIdx, 1);

        matchesMade.push({
          needId: need.id,
          needItemId: needItem.itemId,
          donationId: donation.id,
          donationItemId: donationItem.itemId,
          itemName: needItem.name,
        });

        log(
          need.id,
          `Good news — your item "${needItem.name}" (${needItem.itemId}) has been matched with a donor. A volunteer will confirm collection details.`
        );
        log(
          donation.id,
          `Thank you! Your item "${donationItem.name}" (${donationItem.itemId}) has been matched to a household in need.`
        );
      });

      return { matchesMade, matchedCount: matchesMade.length };
    }

    // Volunteer marks a matched pair as fully handed over.
    function fulfil(needId, needItemId) {
      const need = getNeed(needId);
      if (!need) throw new Error('Need not found: ' + needId);
      const needItem = need.items.find((i) => i.itemId === needItemId);
      if (!needItem) throw new Error('Need item not found: ' + needItemId);
      if (needItem.status !== 'matched') throw new Error('Item is not in matched state.');

      needItem.status = 'fulfilled';
      adapter.set(KEYS.need(needId), need);

      let donation = null;
      const donations = listDonations();
      for (const d of donations) {
        const di = d.items.find((i) => i.itemId === needItem.matchedDonationItemId);
        if (di) {
          di.status = 'delivered';
          adapter.set(KEYS.donation(d.id), d);
          donation = d;
          break;
        }
      }

      log(needId, `"${needItem.name}" (${needItem.itemId}) marked as collected. Thank you!`);
      if (donation) {
        log(donation.id, `Your item "${needItem.name}" was successfully delivered to a household. Thank you for your generosity!`);
      }
      return needItem;
    }

    // -- Status / audit lookups ---------------------------------------
    function getStatus(ref) {
      if (ref.startsWith('NEED-')) {
        const n = getNeed(ref);
        if (!n) return null;
        return { type: 'need', record: n, messages: getMessages(ref) };
      }
      if (ref.startsWith('DONOR-')) {
        const d = getDonation(ref);
        if (!d) return null;
        return { type: 'donation', record: d, messages: getMessages(ref) };
      }
      return null;
    }

    function verifyPin(ref, pin) {
      const status = getStatus(ref);
      if (!status) return false;
      if (!status.record.pinHash) return true; // no PIN was set
      return status.record.pinHash === hashPin(pin);
    }

    // Full audit trail: every donation item mapped to the need item (and
    // household reference) it ultimately fulfilled, for accountability.
    function auditTrail() {
      const rows = [];
      listDonations().forEach((d) => {
        d.items.forEach((di) => {
          rows.push({
            donationId: d.id,
            donationItemId: di.itemId,
            itemName: di.name,
            donationStatus: di.status,
            reservedForNeedItemId: di.reservedForNeedItemId || null,
          });
        });
      });
      return rows;
    }

    return {
      adapter,
      addNeedRequest,
      getNeed,
      listNeeds,
      addDonation,
      getDonation,
      listDonations,
      runMatching,
      fulfil,
      getStatus,
      verifyPin,
      getMessages,
      auditTrail,
      _normName: normName,
    };
  }

  return {
    createStore,
    makeMemoryAdapter,
    makeLocalStorageAdapter,
    hashPin,
  };
});
