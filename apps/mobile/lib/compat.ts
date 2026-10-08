/**
 * Client-side compatibility estimate for real profiles so the prototype's
 * MATCH %, 7-dimension breakdown, "why you match" and "potential differences"
 * can be shown. Deterministic per pair (stable across renders).
 */
import { BADGES, hash01, intentionLabel, ONBOARDING_POOLS, type Person } from './mock';
import type { DiscoverProfile } from './profile';

const MUSIC = new Set(
  [...ONBOARDING_POOLS[0][1], 'Electronic', 'Live concerts', 'Hip-hop'].map((s) => s.toLowerCase())
);
const FOOD = new Set(
  [...ONBOARDING_POOLS[1][1], 'Coffee', 'Wine', 'Cooking'].map((s) => s.toLowerCase())
);

const clamp = (n: number) => Math.max(58, Math.min(99, Math.round(n)));

export type Me = {
  id: string;
  interests: string[];
  intention: string | null;
};

export function computeCompat(me: Me, other: { id: string; interests: string[]; intention: string | null }) {
  const mine = new Set(me.interests.map((s) => s.toLowerCase()));
  const theirs = other.interests.map((s) => s.toLowerCase());
  const shared = other.interests.filter((s) => mine.has(s.toLowerCase()));
  const union = new Set([...mine, ...theirs]).size || 1;
  const jaccard = shared.length / union;
  const sameIntent = !!me.intention && me.intention === other.intention;
  const pair = [me.id, other.id].sort().join(':');
  const j = (salt: number, span = 10) => (hash01(pair, salt) - 0.5) * span;

  const overall = clamp(72 + jaccard * 40 + (sameIntent ? 8 : 0) + j(1, 8));
  const sharedMusic = shared.filter((s) => MUSIC.has(s.toLowerCase()));
  const sharedFood = shared.filter((s) => FOOD.has(s.toLowerCase()));
  const breakdown: Record<string, number> = {
    Interests: clamp(overall + jaccard * 12 + j(2)),
    Lifestyle: clamp(overall + j(3, 16)),
    Personality: clamp(overall + j(4, 14)),
    Music: clamp(overall - 6 + sharedMusic.length * 7 + j(5)),
    Food: clamp(overall - 6 + sharedFood.length * 7 + j(6)),
    'Relationship goals': clamp(sameIntent ? overall + 10 : overall - 8 + j(7)),
    Location: clamp(overall + j(8, 20)),
  };

  const why: string[] = shared.slice(0, 3).map((s) =>
    MUSIC.has(s.toLowerCase()) ? `You both listen to ${s.toLowerCase()}` : `You both love ${s.toLowerCase()}`
  );
  if (sameIntent) why.push(`You're both looking for ${intentionLabel(me.intention).toLowerCase()}`);
  if (!why.length) why.push('Your profiles complement each other', 'You both value real conversations');

  const diffs = [
    hash01(pair, 9) > 0.5 ? 'You prefer mornings, they prefer late nights' : 'You like quiet nights in, they love going out',
    hash01(pair, 10) > 0.5 ? 'They travel more spontaneously than you' : "You're more of a planner, they improvise",
  ];
  if (!sameIntent && other.intention && me.intention) {
    diffs.unshift(`They're looking for ${intentionLabel(other.intention).toLowerCase()}`);
  }
  return { overall, breakdown, why, diffs: diffs.slice(0, 2), shared };
}

export function personFromDiscover(me: Me, p: DiscoverProfile): Person {
  const c = computeCompat(me, { id: p.id, interests: p.interests, intention: p.intention });
  // Server-computed from coarse cells; null when they hide distance or either side has no location.
  const distance = p.distanceKm == null ? null : Math.max(1, Math.round(p.distanceKm));
  const b1 = Math.floor(hash01(p.id, 11) * BADGES.length);
  return {
    id: p.id,
    name: p.name,
    age: p.age,
    city: p.city,
    distance,
    photo: p.photoUrl,
    photos: p.photoUrl ? [p.photoUrl] : [],
    match: c.overall,
    breakdown: c.breakdown,
    tags: p.interests,
    bio: p.bio || '',
    intention: intentionLabel(p.intention),
    intentionCode: p.intention,
    why: c.why,
    diffs: c.diffs,
    verified: p.verified,
    online: false,
    badges: [BADGES[b1], BADGES[(b1 + 2) % BADGES.length]],
    real: true,
    boosted: !!p.boosted,
    superLikedMe: !!p.superLikedMe,
    fridayAnswer: p.fridayAnswer ?? null,
  };
}
