import * as BackgroundTask from 'expo-background-task';
import * as Notifications from 'expo-notifications';
import Storage from 'expo-sqlite/kv-store';
import * as TaskManager from 'expo-task-manager';

import { chatsWithNewMessages, newestTimestamp, type DmThread } from './dmFilter';

// Instagram has no push for third-party apps, so a WorkManager job (~every
// 15 min, later in Doze) polls the endpoints the web inbox uses. On Android,
// React Native's fetch shares the WebView cookie jar, so the job is logged in
// as whichever account this app instance is logged in as. It only notifies for
// messages people actually sent (see dmFilter.ts), not forwarded reels/posts.

export const DM_CHECK_TASK = 'dm-check';
const CHANNEL = 'dms';
const NOTIFICATION_ID = 'dms';

const IG = 'https://www.instagram.com';
const IG_APP_ID = '1217981644879628'; // instagram.com mobile web client
// Everything at or before this server timestamp (microseconds) is handled.
const KEY_HANDLED_THROUGH = 'dm.handledThroughUs';
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

const nowUs = () => Date.now() * 1000;

export async function checkForNewDms(): Promise<void> {
  const handledThrough = Number((await Storage.getItem(KEY_HANDLED_THROUGH)) ?? 0);
  if (!handledThrough) {
    // First run: only messages from now on are news.
    await Storage.setItem(KEY_HANDLED_THROUGH, String(nowUs()));
    return;
  }
  // Cheap gate: nothing unread means nothing to look at.
  if ((await fetchBadgeCount()) === 0) return;

  const data = await igGet<{ viewer?: { pk?: string }; inbox: { threads: DmThread[] } }>(
    '/api/v1/direct_v2/inbox/?limit=20&thread_message_limit=10',
  );
  const chats = chatsWithNewMessages(data.inbox.threads, String(data.viewer?.pk ?? ''), handledThrough);
  const newest = newestTimestamp(data.inbox.threads);
  if (newest > handledThrough) await Storage.setItem(KEY_HANDLED_THROUGH, String(newest));
  if (!chats.length) return; // only memes, reactions or things already seen

  const total = chats.reduce((n, c) => n + c.count, 0);
  const content =
    chats.length === 1
      ? {
          title: chats[0].name,
          body: chats[0].count > 1 ? `${chats[0].preview} (+${chats[0].count - 1} more)` : chats[0].preview,
        }
      : { title: `${total} new messages`, body: chats.slice(0, 4).map((c) => c.name).join(', ') };
  await Notifications.scheduleNotificationAsync({
    identifier: NOTIFICATION_ID, // replace, don't stack
    content,
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
  await Storage.setItem(KEY_HANDLED_THROUGH, String(nowUs()));
}

export async function rememberUserAgent(ua: string): Promise<void> {
  if ((await Storage.getItem(KEY_USER_AGENT)) !== ua) await Storage.setItem(KEY_USER_AGENT, ua);
}
