// Cinder — service worker. Keeps the toolbar badge in sync with the live tab count.
//
// MV3 service workers spin up on demand and may be torn down between events, so all
// listeners are registered top-level (synchronously at script load) and every call
// re-queries chrome.tabs to derive the truth — no in-memory counters that could drift.

'use strict';

const BADGE_BG = '#00f0ff'; // neon-cyan, matches popup palette
const BADGE_FG = '#0a0a0a'; // dark text for legibility on cyan

function formatCount(n) {
  if (!Number.isFinite(n) || n <= 0) return '';
  if (n > 999) return '999+';
  return String(n);
}

// Cheap re-entry guard so a flurry of events (e.g. window close cascading 30 onRemoved
// events) collapses into a single tabs.query instead of 30.
let pendingRefresh = null;
function refreshBadge() {
  if (pendingRefresh) return pendingRefresh;
  pendingRefresh = (async () => {
    try {
      const tabs = await chrome.tabs.query({});
      await chrome.action.setBadgeText({ text: formatCount(tabs.length) });
    } catch (_e) {
      // Service worker may be transitioning; the next event will trigger another refresh.
    } finally {
      pendingRefresh = null;
    }
  })();
  return pendingRefresh;
}

async function applyBadgeColors() {
  try {
    await chrome.action.setBadgeBackgroundColor({ color: BADGE_BG });
    // setBadgeTextColor exists from Chrome 110+ — guard for older Chromiums.
    if (chrome.action.setBadgeTextColor) {
      await chrome.action.setBadgeTextColor({ color: BADGE_FG });
    }
  } catch (_e) {}
}

chrome.runtime.onInstalled.addListener(async () => {
  await applyBadgeColors();
  refreshBadge();
});

chrome.runtime.onStartup.addListener(async () => {
  await applyBadgeColors();
  refreshBadge();
});

// chrome.tabs.onCreated/onRemoved fire for every tab. onAttached/onDetached cover the
// case where a tab moves between windows (no net change, but cheap to refresh).
chrome.tabs.onCreated.addListener(refreshBadge);
chrome.tabs.onRemoved.addListener(refreshBadge);
chrome.tabs.onAttached.addListener(refreshBadge);
chrome.tabs.onDetached.addListener(refreshBadge);
chrome.windows.onCreated.addListener(refreshBadge);
chrome.windows.onRemoved.addListener(refreshBadge);

// Expose a manual hook the popup can ping after restore — covers the edge case where
// windows.create fires events before the new tabs are queryable, by giving the popup
// a knob to force one more refresh after its own settle delay.
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg && msg.type === 'cinder:refreshBadge') {
    refreshBadge().then(() => sendResponse({ ok: true }));
    return true; // signal async response
  }
});

// Run once at script-load so an already-installed extension shows a count even on the
// first event after the worker wakes up.
applyBadgeColors().then(refreshBadge);
