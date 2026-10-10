// Single source of truth for what the webview is allowed to show.
// Used natively (onShouldStartLoadWithRequest / onNavigationStateChange)
// and serialized into the injected page script (SPA route changes).

export const HOME_URL = 'https://www.instagram.com/direct/inbox/';

// Instagram paths that stay reachable. Everything else on instagram.com
// (feed "/", /reels, /reel, /stories, /explore, /p, profiles, ...) bounces home.
export const ALLOWED_IG_PATHS = [
  '/direct/', // inbox, threads (/direct/t/...), e2ee threads, requests, new message
  '/accounts/login',
  '/accounts/onetap', // "save your login info?"
  '/accounts/password/',
  '/accounts/logout',
  '/accounts/suspended',
  '/accounts/disabled',
  '/challenge/',
  '/two_factor',
  '/auth_platform/',
  '/consent/',
  '/call/', // DM audio/video calls
];

// Facebook is only reachable for "Continue with Facebook" login.
const ALLOWED_FB_PATHS = ['/login', '/dialog/', '/v', '/checkpoint', '/recover', '/oauth'];

const IG_HOSTS = new Set(['instagram.com', 'www.instagram.com']);
const IG_LINK_SHIM = 'l.instagram.com';

export type Verdict =
  | { action: 'allow' }
  | { action: 'block'; reason: string } // stay in the webview, bounce home
  | { action: 'external'; url: string }; // open outside the webview

export function isAllowedIgPath(pathname: string): boolean {
  return ALLOWED_IG_PATHS.some((p) => pathname.startsWith(p));
}

export function describeBlocked(pathname: string): string {
  const seg = pathname.split('/').filter(Boolean)[0];
  if (!seg) return 'feed';
  if (seg === 'reel' || seg === 'reels') return 'reels';
  if (seg === 'stories') return 'stories';
  if (seg === 'explore') return 'explore';
  if (seg === 'p' || seg === 'tv') return 'posts';
  if (seg === 'shared') return 'shared reels & posts';
  if (seg === 'accounts') return 'settings';
  return 'profiles';
}

export function judge(rawUrl: string, isTopFrame = true): Verdict {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return { action: 'block', reason: 'invalid url' };
  }

  const scheme = url.protocol;
  if (scheme === 'about:' || scheme === 'blob:' || scheme === 'data:') return { action: 'allow' };
  if (scheme === 'mailto:' || scheme === 'tel:' || scheme === 'sms:') return { action: 'external', url: rawUrl };
  // instagram://, intent://, fb:// etc. would just hand us to the real app.
  if (scheme !== 'https:' && scheme !== 'http:') return { action: 'block', reason: 'app link' };

  // iOS also reports iframe loads; those are page internals, not navigation.
  if (!isTopFrame) return { action: 'allow' };

  const host = url.hostname.toLowerCase();

  if (IG_HOSTS.has(host)) {
    return isAllowedIgPath(url.pathname)
      ? { action: 'allow' }
      : { action: 'block', reason: describeBlocked(url.pathname) };
  }

  // Outbound link shim: https://l.instagram.com/?u=<target>
  if (host === IG_LINK_SHIM) {
    const target = url.searchParams.get('u');
    return target ? judgeExternal(target) : { action: 'block', reason: 'link' };
  }

  if (host === 'facebook.com' || host.endsWith('.facebook.com')) {
    return ALLOWED_FB_PATHS.some((p) => url.pathname.startsWith(p))
      ? { action: 'allow' }
      : { action: 'block', reason: 'facebook' };
  }

  return judgeExternal(rawUrl);
}

// Links friends send you open in a sandboxed browser sheet, unless they're
// just an Instagram link in disguise.
function judgeExternal(rawUrl: string): Verdict {
  try {
    const host = new URL(rawUrl).hostname.toLowerCase();
    if (IG_HOSTS.has(host) || host.endsWith('.instagram.com')) {
      const path = new URL(rawUrl).pathname;
      return isAllowedIgPath(path) ? { action: 'allow' } : { action: 'block', reason: describeBlocked(path) };
    }
  } catch {
    return { action: 'block', reason: 'invalid url' };
  }
  return { action: 'external', url: rawUrl };
}
