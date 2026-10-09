import type { useRouter } from 'expo-router';

type Router = ReturnType<typeof useRouter>;

import { ensureConversation } from './chat';

/**
 * Where a notification (push tap or in-app inbox row) should take the user.
 * `data` is the notification payload (push data = { type, notification_id, ...payload }).
 */
export async function openNotificationTarget(router: Router, type: string | undefined, data: Record<string, unknown>): Promise<void> {
  const str = (k: string) => (typeof data[k] === 'string' && (data[k] as string).length ? (data[k] as string) : null);
  switch (type) {
    case 'message':
    case 'missed_call':
    case 'chat_nudge':
    case 'match_expiring':
    case 'match_expired':
    case 'match_extended':
    case 'we_met':
    case 'date_feedback':
    case 'date_checkin': {
      const id = str('conversation_id');
      // "We met" / feedback prompts open the chat with the date sheet up.
      const focus = type === 'we_met' || type === 'date_feedback' ? { focus: 'date' } : {};
      if (id) return router.push({ pathname: '/chat/[conversationId]', params: { conversationId: id, ...focus } });
      return router.navigate('/(tabs)/messages');
    }
    case 'reward':
      return router.push('/wallet');
    case 'speed_night':
      return router.push('/speed');
    case 'live_invite':
      return router.push({ pathname: '/speed', params: { tab: 'group' } });
    case 'match': {
      const matchId = str('match_id');
      if (matchId) {
        const convId = await ensureConversation(matchId);
        return router.push({ pathname: '/chat/[conversationId]', params: { conversationId: convId } });
      }
      return router.navigate('/(tabs)/messages');
    }
    case 'post_like':
    case 'comment': {
      const id = str('post_id');
      if (id) return router.push({ pathname: '/post/[postId]', params: { postId: id } });
      return router.navigate('/(tabs)/social');
    }
    case 'story_reply':
    case 'story_like': {
      const id = str('story_id');
      if (id) return router.push({ pathname: '/story/[storyId]', params: { storyId: id } });
      return router.navigate('/(tabs)/social');
    }
    case 'event_update':
    case 'event_cancelled': {
      const id = str('event_id');
      if (id && !data.deleted) return router.push({ pathname: '/event/[eventId]', params: { eventId: id } });
      return router.navigate('/(tabs)/events');
    }
    case 'super_like':
      return router.navigate('/(tabs)/discover');
    default:
      return router.navigate('/(tabs)/home');
  }
}
