/**
 * Mock content ported from the MATCH prototype (MatchApp.jsx). Used where the
 * backend has no data/feature yet (live rooms, stories, sample posts, events,
 * notifications) and to fill Discover/Matches while the user base is tiny.
 * Flip SHOW_DEMO_CONTENT off once there are enough real members.
 */
import { T } from '@/constants/theme';

export const SHOW_DEMO_CONTENT = true;

export const avatar = (id: number, size = 400) => `https://i.pravatar.cc/${size}?img=${id}`;

export const INTEREST_META: Record<string, { icon: string }> = {
  House: { icon: '🎵' }, Techno: { icon: '🎧' }, Indie: { icon: '🎸' }, Jazz: { icon: '🎷' },
  'Hip-Hop': { icon: '🎤' }, Pop: { icon: '🎶' }, Classical: { icon: '🎻' }, Reggaeton: { icon: '💃' },
  'R&B': { icon: '🎙️' }, Rock: { icon: '🤘' }, Electronic: { icon: '🎧' }, 'Live concerts': { icon: '🎫' },
  Sushi: { icon: '🍣' }, Italian: { icon: '🍝' }, Vegan: { icon: '🥗' }, 'Fine dining': { icon: '🍷' },
  'Street food': { icon: '🌮' }, Burgers: { icon: '🍔' }, Portuguese: { icon: '🐟' }, Mexican: { icon: '🌯' },
  Coffee: { icon: '☕' }, Wine: { icon: '🍷' },
  Travel: { icon: '✈️' }, Hiking: { icon: '🥾' }, Beach: { icon: '🏖️' }, Gym: { icon: '🏋️' },
  Gaming: { icon: '🎮' }, Nightlife: { icon: '🌃' }, Reading: { icon: '📚' }, Concerts: { icon: '🎫' },
  Cooking: { icon: '🍳' }, Fashion: { icon: '👗' }, Horror: { icon: '🎬' }, Comedy: { icon: '😂' },
  'Sci-Fi': { icon: '🛸' }, Romance: { icon: '💌' }, Documentary: { icon: '🎥' },
  Fitness: { icon: '🏋️' }, Yoga: { icon: '🧘' }, Pets: { icon: '🐶' }, Photography: { icon: '📷' },
  Cinema: { icon: '🎬' }, Documentaries: { icon: '🎥' },
};

export function interestIcon(label: string): string | undefined {
  if (INTEREST_META[label]) return INTEREST_META[label].icon;
  const key = Object.keys(INTEREST_META).find((k) => k.toLowerCase() === label.toLowerCase());
  return key ? INTEREST_META[key].icon : undefined;
}

export const BADGES = ['Travel Addict', 'Music Lover', 'Foodie', 'Social Butterfly', 'Night Owl', 'Early Bird'];

/** Prototype intention labels, in order, with their DB codes. */
export const INTENTIONS = [
  { code: 'serious', label: 'Serious relationship' },
  { code: 'casual', label: 'Casual dating' },
  { code: 'new_people', label: 'New people' },
  { code: 'friendship', label: 'Friendship' },
  { code: 'figuring_out', label: 'Still figuring it out' },
] as const;

export const intentionLabel = (code: string | null | undefined) =>
  INTENTIONS.find((i) => i.code === code)?.label ?? 'Still figuring it out';

export const ONBOARDING_POOLS: [string, string[]][] = [
  ['Music', ['Pop', 'Hip-Hop', 'R&B', 'Rock', 'Techno', 'House', 'Reggaeton', 'Classical', 'Jazz', 'Indie']],
  ['Food', ['Sushi', 'Italian', 'Burgers', 'Portuguese', 'Mexican', 'Vegan', 'Fine dining', 'Street food']],
  ['Lifestyle', ['Gym', 'Travel', 'Gaming', 'Fashion', 'Nightlife', 'Reading', 'Beach', 'Hiking', 'Concerts', 'Cooking']],
];

export const FRIDAY_OPTIONS = [
  'Rooftop bar with friends',
  'Cozy night in with a movie',
  'Live music or a concert',
  'Spontaneous — surprise me',
];

/* ---------- deterministic pseudo-random so mock data is stable ---------- */
let seed = 20261008;
function rand() {
  seed = (seed * 1664525 + 1013904223) % 4294967296;
  return seed / 4294967296;
}
function rnd(a: number, b: number) {
  return Math.floor(rand() * (b - a + 1)) + a;
}
function clamp(n: number) {
  return Math.max(58, Math.min(99, n));
}
function pick<A>(arr: A[], n: number): A[] {
  return [...arr].sort(() => 0.5 - rand()).slice(0, n);
}

export type Person = {
  id: string;
  name: string;
  age: number | null;
  city: string | null;
  distance: number | null;
  photo: string | null;
  photos: string[];
  match: number;
  breakdown: Record<string, number>;
  tags: string[];
  bio: string;
  intention: string;
  intentionCode: string | null;
  why: string[];
  diffs: string[];
  verified: boolean;
  online: boolean;
  badges: string[];
  /** true when backed by a real Supabase profile (likes hit public.likes). */
  real: boolean;
};

const NAMES: [string, number, string][] = [
  ['Sarah', 27, 'Lisbon'], ['Alex', 29, 'Porto'], ['Daniel', 31, 'Lisbon'], ['Mia', 24, 'Cascais'],
  ['Leo', 28, 'Lisbon'], ['Ines', 26, 'Sintra'], ['Rui', 33, 'Lisbon'], ['Carla', 25, 'Almada'],
  ['Tomas', 30, 'Lisbon'], ['Beatriz', 23, 'Porto'], ['Marco', 32, 'Lisbon'], ['Nina', 27, 'Setubal'],
  ['Joao', 29, 'Lisbon'], ['Sofia', 26, 'Lisbon'], ['Diego', 31, 'Oeiras'], ['Laura', 28, 'Lisbon'],
  ['Pedro', 34, 'Lisbon'], ['Chloe', 24, 'Lisbon'], ['Bruno', 30, 'Porto'], ['Vera', 27, 'Lisbon'],
];

export const BIOS = [
  'Looking for someone spontaneous who loves traveling.',
  "Coffee in the morning, vinyl at night. Let's talk taste.",
  'Here for real conversations, not small talk.',
  'Currently obsessed with sourdough and sunsets.',
  'Will debate you on the best pastel de nata in town.',
  'Trying every rooftop bar in the city, one weekend at a time.',
  'Dog parent, plant parent, hopeless romantic.',
  'Looking for my partner in crime for spontaneous weekend trips.',
  'Ask me about the last concert I cried at.',
  'Slow mornings, loud music, good food. In that order.',
];

function makeProfile(i: number): Person {
  const [name, age, city] = NAMES[i];
  const musicPool = Object.keys(INTEREST_META).slice(0, 8);
  const foodPool = ['Sushi', 'Italian', 'Vegan', 'Fine dining', 'Street food', 'Burgers', 'Portuguese'];
  const lifePool = ['Travel', 'Hiking', 'Beach', 'Gym', 'Gaming', 'Nightlife', 'Reading', 'Concerts', 'Cooking', 'Fashion'];
  const tags = [...pick(musicPool, 2), ...pick(foodPool, 1), ...pick(lifePool, 2)];
  const overall = 78 + Math.floor(rand() * 20);
  const breakdown = {
    Interests: clamp(overall + rnd(-8, 10)),
    Lifestyle: clamp(overall + rnd(-10, 8)),
    Personality: clamp(overall + rnd(-6, 12)),
    Music: clamp(overall + rnd(-10, 10)),
    Food: clamp(overall + rnd(-8, 10)),
    'Relationship goals': clamp(overall + rnd(-4, 15)),
    Location: clamp(overall + rnd(-15, 10)),
  };
  const intention = INTENTIONS[i % INTENTIONS.length];
  const why = [
    `You both love ${pick(lifePool, 1)[0].toLowerCase()}`,
    `You both listen to ${pick(musicPool, 1)[0].toLowerCase()}`,
    `You both love ${pick(foodPool, 1)[0].toLowerCase()}`,
    `You're both looking for ${intention.label.toLowerCase()}`,
  ];
  const diffs = [
    rand() > 0.5 ? 'You prefer mornings, they prefer late nights' : 'You like quiet nights in, they love going out',
    rand() > 0.5 ? 'They travel more spontaneously than you' : "You're more of a planner, they improvise",
  ];
  return {
    id: `demo-${i + 1}`,
    name,
    age,
    city,
    distance: rnd(1, 14),
    photo: avatar(((i * 7) % 70) + 1),
    photos: [avatar(((i * 7) % 70) + 1), avatar(((i * 7 + 13) % 70) + 1), avatar(((i * 7 + 29) % 70) + 1)],
    match: overall,
    breakdown,
    tags,
    bio: BIOS[i % BIOS.length],
    intention: intention.label,
    intentionCode: intention.code,
    why,
    diffs,
    verified: rand() > 0.35,
    online: rand() > 0.5,
    badges: pick(BADGES, 2),
    real: false,
  };
}

export const PROFILES: Person[] = Array.from({ length: 20 }, (_, i) => makeProfile(i));
export const demoProfile = (n: number) => PROFILES[n - 1];

/** Prototype starts with these demo matches. */
export const DEMO_MATCHED_IDS = ['demo-3', 'demo-7', 'demo-12'];

export const DEMO_USER_PHOTO = avatar(47);

export const CHAT_PREVIEWS = [
  'Haha okay you have to tell me more about that 😂',
  'Sushi this weekend? I know a great spot',
  'That playlist you sent is actually so good',
  'What time works for you on Friday?',
];

export type StoryFrame =
  | { type: 'photo'; image: string; caption?: string }
  | { type: 'question'; question: string; bg: [string, string] }
  | { type: 'poll'; question: string; options: string[]; bg: [string, string] };

export type StoryUser = { id: string; name: string; photo: string | null; frames: StoryFrame[] };

export const STORY_USERS: StoryUser[] = PROFILES.slice(0, 8).map((p, i) => ({
  id: p.id,
  name: p.name,
  photo: p.photo,
  frames: [
    { type: 'photo', image: avatar(((i + 1) * 9) % 70 + 1, 600), caption: `${interestIcon(p.tags[0]) || '✨'} ${p.tags[0]} kind of night` },
    i % 2 === 0
      ? { type: 'question', question: 'Ask me anything about my last trip ✈️', bg: [T.violet, T.rose] }
      : {
          type: 'poll',
          question: `${p.tags[1] || 'Sushi'} or ${p.tags[2] || 'Pizza'} tonight?`,
          options: [p.tags[1] || 'Sushi', p.tags[2] || 'Pizza'],
          bg: [T.amber, T.rose],
        },
  ],
}));

export type SamplePost = {
  id: string;
  user: Person;
  type: 'text' | 'photo' | 'poll' | 'question';
  content: string;
  image?: string;
  options?: string[];
  votes?: number[];
  likes: number;
  comments: number;
};

export const POSTS: SamplePost[] = [
  { id: 'sample-1', user: PROFILES[2], type: 'text', content: 'Unpopular opinion: pineapple absolutely belongs on pizza. Fight me. 🍍', likes: 128, comments: 34 },
  { id: 'sample-2', user: PROFILES[5], type: 'photo', content: 'Sunday hike views hit different 🥾', image: avatar(35, 500), likes: 342, comments: 21 },
  { id: 'sample-3', user: PROFILES[9], type: 'poll', content: 'First date: coffee or drinks?', options: ['Coffee ☕', 'Drinks 🍸'], votes: [62, 38], likes: 88, comments: 47 },
  { id: 'sample-4', user: PROFILES[1], type: 'photo', content: 'Found the best ramen spot in the city, coming to fight me about it', image: avatar(52, 500), likes: 210, comments: 15 },
  { id: 'sample-5', user: PROFILES[13], type: 'question', content: "What's a song that instantly puts you in a good mood?", likes: 154, comments: 62 },
];

export type LiveRoom = {
  id: string;
  title: string;
  category: string;
  viewers: number;
  cover: string | null;
  host?: { name: string; photo: string | null };
  guest?: { name: string; photo: string | null };
  liveMatch?: boolean;
  isSelf?: boolean;
};

export const LIVE_ROOMS: LiveRoom[] = [
  { id: 'live-1', title: 'Friday Night Speed Dating', host: PROFILES[3], category: 'Dating', viewers: 482, cover: avatar(23, 500) },
  { id: 'live-2', title: 'House music til 2am 🎧', host: PROFILES[6], category: 'Music', viewers: 921, cover: avatar(41, 500) },
  { id: 'live-3', title: 'Roast my dating profile', host: PROFILES[8], category: 'Entertainment', viewers: 356, cover: avatar(19, 500) },
  { id: 'live-4', title: 'Late night talk: red flags', host: PROFILES[11], category: 'Talk', viewers: 210, cover: avatar(58, 500) },
  { id: 'live-5', title: 'Ranked grind, come chat', host: PROFILES[14], category: 'Gaming', viewers: 640, cover: avatar(12, 500) },
  { id: 'live-6', title: 'LIVE MATCH: Rui & Ines', category: 'Dating', viewers: 1204, cover: avatar(30, 500), liveMatch: true, host: PROFILES[6], guest: PROFILES[5] },
];
export const LIVE_CATS = ['Trending', 'Dating', 'Music', 'Entertainment', 'Talk', 'Gaming'];
export const LIVE_CAT_LABEL: Record<string, string> = {
  Trending: '🔥 Trending', Dating: '💘 Dating', Music: '🎵 Music', Entertainment: '😂 Entertainment', Talk: '💬 Talk', Gaming: '🎮 Gaming',
};
export const LIVE_CHAT = [
  { user: 'Mia', text: 'okay this is actually so cute 🥹' },
  { user: 'Tomas', text: 'team yes!!' },
  { user: 'Nina', text: 'the chemistry is real ngl' },
  { user: 'Bruno', text: '🔥🔥🔥' },
];

export type EventItem = {
  id: string;
  title: string;
  date: string;
  location: string;
  cover: string | null;
  going: number;
  category: string;
  real: boolean;
};

export const EVENTS: EventItem[] = [
  { id: 'ev-1', title: 'Rooftop Sunset Mixer', date: 'Fri, Aug 21', location: 'Lisbon', cover: avatar(24, 500), going: 128, category: 'Nightlife', real: false },
  { id: 'ev-2', title: 'Indie & Vinyl Night', date: 'Sat, Aug 22', location: 'Porto', cover: avatar(63, 500), going: 76, category: 'Music', real: false },
  { id: 'ev-3', title: 'Singles Dinner Party', date: 'Sun, Aug 23', location: 'Lisbon', cover: avatar(37, 500), going: 54, category: 'Dating', real: false },
  { id: 'ev-4', title: 'Sunrise Beach Hike', date: 'Sat, Aug 29', location: 'Cascais', cover: avatar(15, 500), going: 41, category: 'Travel', real: false },
  { id: 'ev-5', title: 'Festival Weekend: NOS Alive', date: 'Sep 4–6', location: 'Lisbon', cover: avatar(48, 500), going: 980, category: 'Festival', real: false },
];

export const NOTIFS = [
  { icon: '❤️', text: 'Sarah liked your profile', time: '2m' },
  { icon: '🔥', text: "It's a match with Alex — 91%!", time: '18m' },
  { icon: '💬', text: 'Daniel sent you a message', time: '1h' },
  { icon: '🎥', text: 'Mia is going live now', time: '2h' },
  { icon: '🎉', text: '3 matches are attending Rooftop Sunset Mixer', time: '5h' },
  { icon: '✨', text: 'Your MATCH recommendations improved based on recent activity', time: '1d' },
];

export const DISCOVERY_MODES = ['Recommended', 'Near You', 'Similar Taste', 'Opposites Attract', 'New Users', 'Trending', 'Events'];

/** Stable 0..1 hash for a string id. */
export function hash01(s: string, salt = 0): number {
  let h = 2166136261 ^ salt;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return ((h >>> 0) % 10000) / 10000;
}

/** Pseudo map position (percent) — never a real location. */
export function pseudoPos(id: string, salt = 0) {
  return { x: 7 + hash01(id, salt) * 86, y: 10 + hash01(id, salt + 7) * 74 };
}
