import { ALLOWED_IG_PATHS, HOME_URL } from './policy';

// Instagram is a SPA: most route changes are history.pushState and never hit
// onShouldStartLoadWithRequest. This script runs before the page's own JS and
// guards client-side routing in three layers:
//   1. capture-phase click guard on links to blocked routes
//   2. Navigation API `navigate` interception (where supported)
//   3. a location watchdog (history patch + popstate + poll) that hard-bounces home
// Plus CSS that hides the nav entries / story rings leading to brainrot.
export const GUARD_SCRIPT = `
(function () {
  if (window.__antiBrainrot) return;
  window.__antiBrainrot = true;

  var ALLOWED = ${JSON.stringify(ALLOWED_IG_PATHS)};
  var HOME = ${JSON.stringify(HOME_URL)};
  var IG_HOST = /^(www\\.)?instagram\\.com$/i;

  function isBlocked(href) {
    try {
      var u = new URL(href, location.href);
      if (!IG_HOST.test(u.hostname)) return false; // native side handles other hosts
      for (var i = 0; i < ALLOWED.length; i++) if (u.pathname.indexOf(ALLOWED[i]) === 0) return false;
      return true;
    } catch (e) { return false; }
  }

  function report(href) {
    try { window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'blocked', url: String(href) })); } catch (e) {}
  }

  try { window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'ua', ua: navigator.userAgent })); } catch (e) {}

  // Full reload to the inbox: throws away anything Instagram's router already
  // rendered for the blocked route, even if the URL never changed.
  var bouncing = false;
  function bounceHome(href) {
    if (bouncing) return;
    bouncing = true;
    report(href);
    location.replace(HOME);
  }
  function enforce() {
    if (isBlocked(location.href)) bounceHome(location.href);
  }

  // 1. Clicks on links to blocked routes (or on shared-content bubbles, see 4.)
  //    never reach Instagram's router.
  window.addEventListener('click', function (e) {
    var t = e.target && e.target.closest ? e.target : null;
    if (t && t.closest('.__ab_shared')) {
      e.preventDefault();
      e.stopImmediatePropagation();
      report('https://www.instagram.com/shared/');
      return;
    }
    var a = t ? t.closest('a[href]') : null;
    if (a && isBlocked(a.href)) {
      // Always cancel the link's own navigation (router links skip
      // defaultPrevented clicks)...
      e.preventDefault();
      // ...but a button nested inside the link (e.g. the chat header's back
      // arrow lives inside the link to the contact's profile) still gets the tap.
      var inner = t.closest('a[href], button, [role="button"]');
      if (inner === a) {
        e.stopImmediatePropagation();
        report(a.href);
      }
    }
  }, true);

  // 2. Navigation API: catch blocked navigations started by buttons (pushState).
  //    Cancelling alone isn't enough: the router has usually rendered the new
  //    view already and would leave it on screen under the old URL.
  if (window.navigation && window.navigation.addEventListener) {
    window.navigation.addEventListener('navigate', function (e) {
      if (!isBlocked(e.destination.url)) return;
      if (e.cancelable) e.preventDefault();
      bounceHome(e.destination.url);
    });
  }

  // 3. Watchdog: whatever slipped through gets bounced home.
  ['pushState', 'replaceState'].forEach(function (m) {
    var orig = history[m];
    history[m] = function () {
      var r = orig.apply(this, arguments);
      enforce();
      return r;
    };
  });
  window.addEventListener('popstate', enforce);
  setInterval(enforce, 400);
  enforce();

  // 4. Reels/posts/stories that friends forward into a chat play in an in-thread
  //    viewer without any URL change. Their message bubbles always link to the
  //    original poster's profile (or /p/...), while photos/videos sent directly
  //    never contain links. Blur those bubbles and make them untappable.
  var SHARED_LABEL = /^(Clip|Reel|Collage|Story|Post)$/;
  function bubbleOf(media) {
    var bubble = null, h = media.getBoundingClientRect().height;
    for (var e = media.parentElement, i = 0; e && i < 12; e = e.parentElement, i++) {
      if (e.getAttribute('role') === 'button' && e.getBoundingClientRect().height < h * 2.5) bubble = e;
    }
    return bubble;
  }
  function isShared(bubble) {
    var links = bubble.querySelectorAll('a[href]');
    for (var i = 0; i < links.length; i++) if (isBlocked(links[i].href)) return true;
    var labelled = bubble.querySelectorAll('[aria-label]');
    for (var j = 0; j < labelled.length; j++) if (SHARED_LABEL.test(labelled[j].getAttribute('aria-label'))) return true;
    return false;
  }
  function markShared() {
    if (location.pathname.indexOf('/direct/t/') !== 0) return;
    var media = document.querySelectorAll('img, video');
    for (var i = 0; i < media.length; i++) {
      if (media[i].closest('.__ab_shared') || media[i].getBoundingClientRect().height < 100) continue;
      var bubble = bubbleOf(media[i]);
      if (bubble && isShared(bubble)) bubble.classList.add('__ab_shared');
    }
  }
  var scanQueued = false;
  function queueScan() {
    if (scanQueued) return;
    scanQueued = true;
    setTimeout(function () { scanQueued = false; markShared(); }, 150);
  }
  function observe() { new MutationObserver(queueScan).observe(document.body, { childList: true, subtree: true }); }
  if (document.body) observe(); else document.addEventListener('DOMContentLoaded', observe);
  document.addEventListener('load', queueScan, true); // images gaining their real size
  setInterval(markShared, 1000);

  // Hide the doors to the feed. Exact hrefs only, so chat content is untouched.
  var css = [
    'a[href="/"]', 'a[href="/explore/"]', 'a[href="/reels/"]',
    'a[href^="/stories/"]', 'a[href="/notifications/"]', 'a[href^="/create/"]',
    'a[href*="/reels/audio/"]'
  ].join(',') + '{display:none !important}' +
    '.__ab_shared{position:relative !important;overflow:hidden !important}' +
    '.__ab_shared *{pointer-events:none !important}' +
    '.__ab_shared img,.__ab_shared video{filter:blur(24px) grayscale(1) !important}' +
    '.__ab_shared::after{content:"\\\\01F9E0  blocked";position:absolute;inset:0;display:flex;' +
    'align-items:center;justify-content:center;background:rgba(0,0,0,.45);color:#fff;' +
    'font:600 14px -apple-system,system-ui,sans-serif;pointer-events:none}';
  function addStyle() {
    if (document.getElementById('__ab_css')) return;
    var s = document.createElement('style');
    s.id = '__ab_css';
    s.textContent = css;
    (document.head || document.documentElement).appendChild(s);
  }
  if (document.documentElement) addStyle();
  document.addEventListener('DOMContentLoaded', addStyle);
})();
true;
`;
