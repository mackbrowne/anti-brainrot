// Decides which new DMs deserve a notification: things people actually wrote
// or sent you, not reels/posts/stories they forwarded.

export type DmItem = {
  item_type?: string;
  user_id?: string | number;
  timestamp?: string | number; // microseconds
  text?: string;
  link?: { text?: string };
  reel_share?: { text?: string; type?: string };
};

export type DmThread = {
  thread_title?: string;
  muted?: boolean;
  users?: { username?: string }[];
  last_seen_at?: Record<string, { timestamp?: string }>;
  items?: DmItem[];
};

export type NewChat = { name: string; count: number; preview: string };

// Forwarded content ("memes") and system noise: never notify on their own.
const SHARED = /^(clip|media_share|story_share|felix_share|xma_.*|generic_xma)$/;
const NOISE = new Set(['action_log', 'placeholder', 'expired_placeholder', 'like', 'animated_media']);

/** A short preview for a message worth notifying about, or null if it isn't one. */
export function messagePreview(item: DmItem): string | null {
  const type = item.item_type ?? '';
  if (SHARED.test(type) || NOISE.has(type)) return null;
  switch (type) {
    case 'text':
      return item.text?.trim() || null;
    case 'link':
      return item.link?.text?.trim() || item.text?.trim() || 'Sent a link';
    case 'media':
    case 'raven_media':
      return '📷 Photo or video';
    case 'voice_media':
      return '🎤 Voice message';
    case 'video_call_event':
      return '📞 Call';
    case 'reel_share': {
      // Replies/reactions to a story: only a typed reply counts.
      const text = item.reel_share?.text?.trim();
      return item.reel_share?.type !== 'mention' && text ? text : null;
    }
    default:
      // Unknown new types: notify only if they carry typed text.
      return item.text?.trim() || null;
  }
}

/**
 * Chats with real messages from other people that are newer than both `sinceUs`
 * and what you've already seen in that chat. Muted chats are skipped.
 */
export function chatsWithNewMessages(threads: DmThread[], viewerId: string, sinceUs: number): NewChat[] {
  const chats: NewChat[] = [];
  for (const t of threads) {
    if (t.muted) continue;
    const seenUs = Math.max(sinceUs, Number(t.last_seen_at?.[viewerId]?.timestamp ?? 0));
    const previews = (t.items ?? [])
      .filter((i) => String(i.user_id) !== viewerId && Number(i.timestamp) > seenUs)
      .map(messagePreview)
      .filter((p): p is string => p !== null);
    if (previews.length) {
      chats.push({
        name: t.thread_title || t.users?.[0]?.username || 'Someone',
        count: previews.length,
        preview: previews[0], // items are newest first
      });
    }
  }
  return chats;
}

/** Newest item timestamp across all threads, so the next check only looks past it. */
export function newestTimestamp(threads: DmThread[]): number {
  let newest = 0;
  for (const t of threads) for (const i of t.items ?? []) newest = Math.max(newest, Number(i.timestamp) || 0);
  return newest;
}
