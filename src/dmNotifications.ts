import * as BackgroundTask from 'expo-background-task';
import * as Notifications from 'expo-notifications';
import Storage from 'expo-sqlite/kv-store';
import * as TaskManager from 'expo-task-manager';

// Instagram has no push for third-party apps, so a WorkManager job (~every
// 15 min, later in Doze) polls the same unread-badge endpoint the web inbox
// uses. On Android, React Native's fetch shares the WebView cookie jar, so the
// job is logged in as whichever account this app instance is logged in as.

export const DM_CHECK_TASK = 'dm-check';
const CHANNEL = 'dms';
const NOTIFICATION_ID = 'dms';

const IG = 'https://www.instagram.com';
const IG_APP_ID = '1217981644879628'; // instagram.com mobile web client
const KEY_LAST_BADGE = 'dm.lastBadge';
const KEY_USER_AGENT = 'dm.userAgent';

async function igGet<T>(path: string): Promise<T> {
  const ua = await Storage.getItem(KEY_USER_AGENT);
  const res = await fetch(IG + path, {
    headers: {
      Accept: 'application/json',
      'X-IG-App-ID': IG_APP_ID,
      'X-Requested-With': 'XMLHttpRequest',
      ...(ua ? { 'User-Agent': ua } : null),
    },
  });
  if (!res.ok) throw new Error(`${path} -> HTTP ${res.status}`);
  return res.json();
}

async function fetchBadgeCount(): Promise<number> {
  const { badge_count } = await igGet<{ badge_count?: number }>('/api/v1/direct_v2/get_badge_count/?no_raven=1');
  if (typeof badge_count !== 'number') throw new Error('no badge_count (logged out?)');
  return badge_count;
}

type Thread = {
  thread_title?: string;
  users?: { username?: string }[];
  last_seen_at?: Record<string, { timestamp?: string }>;
  items?: { user_id?: string | number; timestamp?: string }[];
};

// Names of chats whose newest message is from someone else and newer than our
// last-seen marker. Best effort: only used for the notification body.
async function unreadChatNames(): Promise<string[]> {
  const data = await igGet<{ viewer?: { pk?: string }; inbox: { threads: Thread[] } }>(
    '/api/v1/direct_v2/inbox/?limit=20&thread_message_limit=1',
  );
  const me = String(data.viewer?.pk ?? '');
  return data.inbox.threads
    .filter((t) => {
      const last = t.items?.[0];
      const seen = Number(t.last_seen_at?.[me]?.timestamp ?? 0);
      return last && String(last.user_id) !== me && Number(last.timestamp) > seen;
    })
    .map((t) => t.thread_title || t.users?.[0]?.username || '')
    .filter(Boolean);
}

export async function checkForNewDms(): Promise<void> {
  const badge = await fetchBadgeCount();
  const last = Number((await Storage.getItem(KEY_LAST_BADGE)) ?? 0);
  await Storage.setItem(KEY_LAST_BADGE, String(badge));
  if (badge <= last) return;

  const names = await unreadChatNames().catch(() => []);
  await Notifications.scheduleNotificationAsync({
    identifier: NOTIFICATION_ID, // replace, don't stack
    content: {
      title: badge === 1 ? '1 unread chat' : `${badge} unread chats`,
      body: names.length ? names.slice(0, 4).join(', ') : 'Tap to open your inbox',
    },
    trigger: { channelId: CHANNEL },
  });
}

// Must run at module scope (imported from index.ts) so headless runs find it.
TaskManager.defineTask(DM_CHECK_TASK, async () => {
  try {
    await checkForNewDms();
    return BackgroundTask.BackgroundTaskResult.Success;
  } catch {
    return BackgroundTask.BackgroundTaskResult.Failed;
  }
});

// The app is in front: the inbox is on screen, so stay quiet.
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldPlaySound: false,
    shouldSetBadge: false,
    shouldShowBanner: false,
    shouldShowList: false,
  }),
});

export async function setupDmNotifications(): Promise<void> {
  await Notifications.setNotificationChannelAsync(CHANNEL, {
    name: 'New messages',
    importance: Notifications.AndroidImportance.HIGH,
  });
  const { granted } = await Notifications.requestPermissionsAsync();
  if (!granted) return;
  if (!(await TaskManager.isTaskRegisteredAsync(DM_CHECK_TASK))) {
    await BackgroundTask.registerTaskAsync(DM_CHECK_TASK, { minimumInterval: 15 });
  }
}

// Leaving the app: whatever is unread now has been seen on screen, so only
// messages arriving after this point should notify.
export async function markInboxSeen(): Promise<void> {
  await Notifications.dismissAllNotificationsAsync().catch(() => {});
  await Storage.setItem(KEY_LAST_BADGE, String(await fetchBadgeCount()));
}

export async function rememberUserAgent(ua: string): Promise<void> {
  if ((await Storage.getItem(KEY_USER_AGENT)) !== ua) await Storage.setItem(KEY_USER_AGENT, ua);
}
