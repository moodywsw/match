import React, { useState, useRef, useEffect, useMemo, useCallback } from "react";
import {
  Home, Search, Plus, Heart, MessageCircle, User, Bell, MapPin, Radio,
  Calendar, Settings, Shield, Crown, Zap, Play, Users, ThumbsUp, Send,
  Camera, Image as ImageIcon, X, Check, Star, Flame, Sparkles, ChevronLeft,
  ChevronRight, Music4, UtensilsCrossed, Plane, Clapperboard, Dumbbell,
  Moon, Sun, Lock, Eye, EyeOff, MoreHorizontal, Bookmark, Share2, Mic,
  Wifi, BadgeCheck, ArrowLeft, RotateCcw, SlidersHorizontal, LogOut, Mail
} from "lucide-react";
import { supabase } from "./lib/supabase.js";
import {
  INTENTION_TO_DB,
  INTENTION_FROM_DB,
  ageFromBirthDate,
  birthDateFromAge,
  fetchOwnProfile,
  upsertOwnProfile,
  fetchDiscoverableProfiles,
  fetchPrimaryPhotos,
  sendLike,
  fetchMyMatches,
} from "./lib/profile.js";

/* ----------------------------------------------------------------
   MATCH — a taste & personality-first dating / social prototype
   React UI wired to Supabase Auth + profiles. Mock cards remain as empty-state fallback.
------------------------------------------------------------------- */

/* ---------------------------- THEME ---------------------------- */
const FONTS = `
@import url('https://fonts.googleapis.com/css2?family=Fraunces:ital,opsz,wght@0,9..144,300;0,9..144,500;0,9..144,600;0,9..144,700;1,9..144,500&family=Inter:wght@400;500;600;700;800&family=IBM+Plex+Mono:wght@400;500&display=swap');
`;

const T = {
  ink: "#15121C",
  surface: "#1E1928",
  surface2: "#26202F",
  surface3: "#2E2739",
  border: "rgba(255,255,255,0.09)",
  rose: "#FF5573",
  roseDim: "#B23B52",
  amber: "#FFB65C",
  violet: "#8B6BFF",
  mint: "#4DD9C0",
  text: "#F6F2FA",
  muted: "#AA9EC4",
  mutedDim: "#786C93",
};

const displayFont = { fontFamily: "'Fraunces', serif" };
const bodyFont = { fontFamily: "'Inter', sans-serif" };
const monoFont = { fontFamily: "'IBM Plex Mono', monospace" };

const GLOBAL_CSS = `
  .match-scope * { box-sizing: border-box; }
  .match-scope { -webkit-font-smoothing: antialiased; }
  .match-scope ::-webkit-scrollbar { display: none; }
  .match-scope { scrollbar-width: none; }
  @keyframes matchPulse { 0%{ transform: scale(0.85); opacity:0 } 55%{ transform: scale(1.06); opacity:1 } 100%{ transform: scale(1); opacity:1 } }
  @keyframes heartFloat { 0%{ transform: translateY(0) scale(0.6); opacity:0 } 15%{ opacity:1 } 100%{ transform: translateY(-140px) scale(1.1); opacity:0 } }
  @keyframes shimmer { 0%{ background-position: -200px 0 } 100%{ background-position: 200px 0 } }
  @keyframes ringSpin { from{ transform: rotate(0deg) } to{ transform: rotate(360deg) } }
  @keyframes fadeUp { from{ opacity:0; transform: translateY(10px) } to{ opacity:1; transform: translateY(0) } }
  @keyframes popIn { from{ opacity:0; transform: scale(0.92) } to{ opacity:1; transform: scale(1) } }
  @keyframes storyRing { 0%{ transform: rotate(0deg) } 100%{ transform: rotate(360deg) } }
  @keyframes flameFlicker {
    0%, 100% { transform: scaleY(1) scaleX(1) rotate(0deg); }
    25% { transform: scaleY(1.06) scaleX(0.96) rotate(-2deg); }
    50% { transform: scaleY(0.96) scaleX(1.04) rotate(1.5deg); }
    75% { transform: scaleY(1.03) scaleX(0.98) rotate(-1deg); }
  }
  .flame { transform-origin: 50% 100%; animation: flameFlicker 1.6s ease-in-out infinite; }
  .flame-outer { transform-origin: 50% 96%; animation: flameFlickerA 1.7s ease-in-out infinite; }
  .flame-mid { transform-origin: 50% 92%; animation: flameFlickerB 1.15s ease-in-out infinite; }
  .flame-inner { transform-origin: 50% 88%; animation: flameFlickerC 0.85s ease-in-out infinite; }
  @keyframes flameFlickerA {
    0%, 100% { transform: scaleY(1) scaleX(1) skewX(0deg); }
    30% { transform: scaleY(1.05) scaleX(0.95) skewX(-2deg); }
    60% { transform: scaleY(0.96) scaleX(1.03) skewX(1.5deg); }
  }
  @keyframes flameFlickerB {
    0%, 100% { transform: scaleY(1) scaleX(1) skewX(0deg); }
    40% { transform: scaleY(0.92) scaleX(1.06) skewX(2deg); }
    70% { transform: scaleY(1.06) scaleX(0.94) skewX(-1.5deg); }
  }
  @keyframes flameFlickerC {
    0%, 100% { transform: scale(1); }
    50% { transform: scale(1.14) translateY(-0.3px); }
  }
  @keyframes matchStrikeMotion {
    0% { transform: rotate(-22deg) translateY(3px); }
    35% { transform: rotate(14deg) translateY(-3px); }
    55% { transform: rotate(-8deg); }
    75% { transform: rotate(4deg); }
    100% { transform: rotate(0deg); }
  }
  @keyframes flameIgnite {
    0% { transform: scale(0.15); opacity: 0; }
    55% { transform: scale(1.25); opacity: 1; }
    100% { transform: scale(1); opacity: 1; }
  }
  @keyframes sparkBurst {
    0% { transform: translate(0,0) scale(1); opacity: 1; }
    100% { transform: translate(var(--sx), var(--sy)) scale(0); opacity: 0; }
  }
  @keyframes glowPulse {
    0%, 100% { opacity: 0.5; transform: scale(1); }
    50% { opacity: 0.9; transform: scale(1.15); }
  }
  @keyframes flashPop {
    0% { opacity: 0; transform: scale(0.5); }
    28% { opacity: 1; transform: scale(1.3); }
    100% { opacity: 0; transform: scale(2.4); }
  }
  @keyframes ignitePopOut {
    0% { transform: scale(1); opacity: 1; }
    100% { transform: scale(0.72); opacity: 0; }
  }
  @keyframes matchTextPop {
    0% { transform: scale(0.4) translateY(10px); opacity: 0; }
    55% { transform: scale(1.18) translateY(0); opacity: 1; }
    75% { transform: scale(0.94); }
    100% { transform: scale(1); opacity: 1; }
  }
  @keyframes storyProgress { from{ width: 0% } to{ width: 100% } }
  @keyframes shimmerMove { 0%{ background-position: -300px 0 } 100%{ background-position: 300px 0 } }
  .skeleton-shimmer {
    background: linear-gradient(90deg, #241E30 25%, #322A3E 37%, #241E30 63%);
    background-size: 600px 100%;
    animation: shimmerMove 1.4s linear infinite;
  }
  .fade-up { animation: fadeUp .35s ease both; }
  .pop-in { animation: popIn .28s cubic-bezier(.2,.9,.3,1.2) both; }
  .card-shadow { box-shadow: 0 18px 40px -14px rgba(0,0,0,0.55); }
  .glass { backdrop-filter: blur(18px) saturate(140%); background: rgba(30,25,40,0.72); }
  .no-scrollbar::-webkit-scrollbar{ display:none; }
`;

/* ---------------------------- HELPERS --------------------------- */
const avatar = (id, size = 400) => `https://i.pravatar.cc/${size}?img=${id}`;

const INTEREST_META = {
  House: { icon: "🎵" }, Techno: { icon: "🎧" }, Indie: { icon: "🎸" }, Jazz: { icon: "🎷" },
  "Hip-Hop": { icon: "🎤" }, Pop: { icon: "🎶" }, Classical: { icon: "🎻" }, Reggaeton: { icon: "💃" },
  Sushi: { icon: "🍣" }, Italian: { icon: "🍝" }, Vegan: { icon: "🥗" }, "Fine dining": { icon: "🍷" },
  "Street food": { icon: "🌮" }, Burgers: { icon: "🍔" }, Portuguese: { icon: "🐟" },
  Travel: { icon: "✈️" }, Hiking: { icon: "🥾" }, Beach: { icon: "🏖️" }, Gym: { icon: "🏋️" },
  Gaming: { icon: "🎮" }, Nightlife: { icon: "🌃" }, Reading: { icon: "📚" }, Concerts: { icon: "🎫" },
  Cooking: { icon: "🍳" }, Fashion: { icon: "👗" }, Horror: { icon: "🎬" }, Comedy: { icon: "😂" },
  "Sci-Fi": { icon: "🛸" }, Romance: { icon: "💌" }, Documentary: { icon: "🎥" },
};

const BADGES = ["Travel Addict", "Music Lover", "Foodie", "Social Butterfly", "Night Owl", "Early Bird"];

const NAMES = [
  ["Sarah", 27, "Lisbon"], ["Alex", 29, "Porto"], ["Daniel", 31, "Lisbon"], ["Mia", 24, "Cascais"],
  ["Leo", 28, "Lisbon"], ["Ines", 26, "Sintra"], ["Rui", 33, "Lisbon"], ["Carla", 25, "Almada"],
  ["Tomas", 30, "Lisbon"], ["Beatriz", 23, "Porto"], ["Marco", 32, "Lisbon"], ["Nina", 27, "Setubal"],
  ["Joao", 29, "Lisbon"], ["Sofia", 26, "Lisbon"], ["Diego", 31, "Oeiras"], ["Laura", 28, "Lisbon"],
  ["Pedro", 34, "Lisbon"], ["Chloe", 24, "Lisbon"], ["Bruno", 30, "Porto"], ["Vera", 27, "Lisbon"],
];

const INTENTIONS = ["Serious relationship", "Casual dating", "New people", "Friendship", "Still figuring it out"];

function makeProfile(i) {
  const [name, age, city] = NAMES[i];
  const musicPool = Object.keys(INTEREST_META).slice(0, 8);
  const foodPool = ["Sushi", "Italian", "Vegan", "Fine dining", "Street food", "Burgers", "Portuguese"];
  const lifePool = ["Travel", "Hiking", "Beach", "Gym", "Gaming", "Nightlife", "Reading", "Concerts", "Cooking", "Fashion"];
  const moviePool = ["Horror", "Comedy", "Sci-Fi", "Romance", "Documentary"];
  const pick = (arr, n) => [...arr].sort(() => 0.5 - Math.random()).slice(0, n);
  const tags = [...pick(musicPool, 2), ...pick(foodPool, 1), ...pick(lifePool, 2)];
  const overall = 78 + Math.floor(Math.random() * 20);
  const breakdown = {
    Interests: clamp(overall + rnd(-8, 10)),
    Lifestyle: clamp(overall + rnd(-10, 8)),
    Personality: clamp(overall + rnd(-6, 12)),
    Music: clamp(overall + rnd(-10, 10)),
    Food: clamp(overall + rnd(-8, 10)),
    "Relationship goals": clamp(overall + rnd(-4, 15)),
    Location: clamp(overall + rnd(-15, 10)),
  };
  const why = [
    `You both love ${pick(lifePool, 1)[0].toLowerCase()}`,
    `You both listen to ${pick(musicPool, 1)[0].toLowerCase()}`,
    `You both love ${pick(foodPool, 1)[0].toLowerCase()}`,
    `You're both looking for ${INTENTIONS[i % INTENTIONS.length].toLowerCase()}`,
  ];
  const diffs = [
    Math.random() > 0.5 ? "You prefer mornings, they prefer late nights" : "You like quiet nights in, they love going out",
    Math.random() > 0.5 ? "They travel more spontaneously than you" : "You're more of a planner, they improvise",
  ];
  return {
    id: i + 1,
    name, age, city,
    distance: rnd(1, 14),
    photo: avatar(((i * 7) % 70) + 1),
    photos: [avatar(((i * 7) % 70) + 1), avatar(((i * 7 + 13) % 70) + 1), avatar(((i * 7 + 29) % 70) + 1)],
    match: overall,
    breakdown,
    tags,
    bio: BIOS[i % BIOS.length],
    intention: INTENTIONS[i % INTENTIONS.length],
    why,
    diffs,
    verified: Math.random() > 0.35,
    online: Math.random() > 0.5,
    badges: pick(BADGES, 2),
  };
}
const BIOS = [
  "Looking for someone spontaneous who loves traveling.",
  "Coffee in the morning, vinyl at night. Let's talk taste.",
  "Here for real conversations, not small talk.",
  "Currently obsessed with sourdough and sunsets.",
  "Will debate you on the best pastel de nata in town.",
  "Trying every rooftop bar in the city, one weekend at a time.",
  "Dog parent, plant parent, hopeless romantic.",
  "Looking for my partner in crime for spontaneous weekend trips.",
  "Ask me about the last concert I cried at.",
  "Slow mornings, loud music, good food. In that order.",
];
function rnd(a, b) { return Math.floor(Math.random() * (b - a + 1)) + a; }
function clamp(n) { return Math.max(58, Math.min(99, n)); }

const PROFILES = Array.from({ length: 20 }, (_, i) => makeProfile(i));


function isUuid(id) {
  return typeof id === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id);
}

function mapDbProfileToCard(row, photoUrl, index = 0) {
  const age = ageFromBirthDate(row.birth_date) || 25;
  const intention = INTENTION_FROM_DB[row.intention] || row.intention || INTENTIONS[index % INTENTIONS.length];
  const photo = photoUrl || avatar(((index * 7) % 70) + 1);
  const overall = 72 + ((index * 11) % 23);
  return {
    id: row.id,
    name: row.name,
    age,
    city: row.city || "Nearby",
    distance: 1 + (index % 14),
    photo,
    photos: [photo, photo, photo],
    match: overall,
    breakdown: {
      Interests: overall,
      Lifestyle: Math.min(99, overall + 2),
      Personality: Math.max(58, overall - 3),
      Music: overall,
      Food: overall,
      "Relationship goals": overall,
      Location: Math.max(58, overall - 5),
    },
    tags: ["Taste match"],
    bio: row.bio || "New on MATCH — say hi.",
    intention,
    why: ["You're both exploring MATCH", " overlapping taste signals", "Nearby and discoverable"],
    diffs: ["Profiles are still filling out", "Chat to learn the rest"],
    verified: !!row.verified,
    online: false,
    badges: ["New"],
    fromDb: true,
  };
}

function mapOwnProfileToUser(row, photoUrl, onboard = {}) {
  if (!row) {
    return {
      ...DEMO_USER,
      name: onboard.name || DEMO_USER.name,
      intention: onboard.intention || DEMO_USER.intention,
      tags: onboard.interests?.length ? onboard.interests.slice(0, 5) : DEMO_USER.tags,
    };
  }
  return {
    id: row.id,
    name: row.name || onboard.name || DEMO_USER.name,
    age: ageFromBirthDate(row.birth_date) || DEMO_USER.age,
    city: row.city || DEMO_USER.city,
    photo: photoUrl || DEMO_USER.photo,
    tags: onboard.interests?.length ? onboard.interests.slice(0, 5) : DEMO_USER.tags,
    intention: INTENTION_FROM_DB[row.intention] || onboard.intention || DEMO_USER.intention,
    bio: row.bio || DEMO_USER.bio,
    badges: DEMO_USER.badges,
    verified: !!row.verified,
    raw: row,
  };
}

const DEMO_USER = {
  name: "Emma", age: 27, city: "Lisbon", photo: avatar(47),
  tags: ["House", "Sushi", "Travel", "Horror", "Gym"],
  intention: "Serious relationship",
  bio: "Sushi over swiping right. Let's see if our taste matches.",
  badges: ["Travel Addict", "Foodie"],
};

/* ---------------------------- APP ROOT --------------------------- */
export default function MatchApp() {
  const [session, setSession] = useState(null);
  const [authReady, setAuthReady] = useState(false);
  const [profile, setProfile] = useState(null);
  const [profileReady, setProfileReady] = useState(false);
  const [discovery, setDiscovery] = useState([]);
  const [stage, setStage] = useState("landing"); // landing | auth | onboarding | building | app
  const [onboard, setOnboard] = useState({ interests: [], intention: null, name: "", city: "Lisbon", birthAge: 25, bio: "" });
  const [authError, setAuthError] = useState("");
  const [busy, setBusy] = useState(false);

  const userId = session?.user?.id;

  const loadProfileAndDiscovery = useCallback(async (uid) => {
    if (!uid) {
      setProfile(null);
      setDiscovery([]);
      setProfileReady(true);
      return;
    }
    setProfileReady(false);
    try {
      const own = await fetchOwnProfile(uid);
      setProfile(own);
      const rows = await fetchDiscoverableProfiles(uid);
      const photos = await fetchPrimaryPhotos(rows.map((r) => r.id));
      setDiscovery(rows.map((r, i) => mapDbProfileToCard(r, photos[r.id], i)));
      if (own?.onboarding_complete) {
        setStage("app");
      } else if (own) {
        setOnboard((d) => ({
          ...d,
          name: own.name || d.name,
          intention: INTENTION_FROM_DB[own.intention] || d.intention,
          city: own.city || d.city,
          bio: own.bio || d.bio,
          birthAge: ageFromBirthDate(own.birth_date) || d.birthAge,
        }));
        setStage("onboarding");
      } else {
        setStage((s) => (s === "app" || s === "building" ? s : "onboarding"));
      }
    } catch (err) {
      console.error(err);
      setAuthError(err.message || "Failed to load profile");
    } finally {
      setProfileReady(true);
    }
  }, []);

  useEffect(() => {
    let mounted = true;
    supabase.auth.getSession().then(({ data }) => {
      if (!mounted) return;
      setSession(data.session);
      setAuthReady(true);
      if (data.session) {
        setStage("building");
        loadProfileAndDiscovery(data.session.user.id);
      }
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_event, next) => {
      setSession(next);
      if (next?.user?.id) {
        loadProfileAndDiscovery(next.user.id);
      } else {
        setProfile(null);
        setDiscovery([]);
        setStage("landing");
        setProfileReady(true);
      }
    });
    return () => {
      mounted = false;
      sub.subscription.unsubscribe();
    };
  }, [loadProfileAndDiscovery]);

  const goToApp = () => {
    setStage("building");
    setTimeout(() => setStage("app"), 900);
  };

  const persistOnboarding = async (data, { complete = true } = {}) => {
    if (!userId) {
      goToApp();
      return;
    }
    setBusy(true);
    setAuthError("");
    try {
      const intentionDb = INTENTION_TO_DB[data.intention] || "figuring_out";
      const saved = await upsertOwnProfile(userId, {
        name: (data.name || "Member").trim() || "Member",
        birth_date: birthDateFromAge(data.birthAge || 25),
        city: data.city || "Lisbon",
        bio: data.bio || DEMO_USER.bio,
        intention: intentionDb,
        onboarding_complete: complete,
        is_discoverable: true,
      });
      setProfile(saved);
      await loadProfileAndDiscovery(userId);
      goToApp();
    } catch (err) {
      console.error(err);
      setAuthError(err.message || "Could not save profile");
      // Still enter app so UI stays usable offline/empty
      goToApp();
    } finally {
      setBusy(false);
    }
  };

  const handleAuth = async ({ mode, email, password }) => {
    setBusy(true);
    setAuthError("");
    try {
      if (mode === "signup") {
        const { error } = await supabase.auth.signUp({ email, password });
        if (error) throw error;
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
      }
      setStage("building");
    } catch (err) {
      setAuthError(err.message || "Authentication failed");
    } finally {
      setBusy(false);
    }
  };

  const handleSignOut = async () => {
    await supabase.auth.signOut();
    setOnboard({ interests: [], intention: null, name: "", city: "Lisbon", birthAge: 25, bio: "" });
    setStage("landing");
  };

  if (!authReady) {
    return (
      <div className="match-scope" style={{ ...bodyFont, minHeight: "100vh", background: T.ink, color: T.text, display: "flex", alignItems: "center", justifyContent: "center" }}>
        <style>{FONTS + GLOBAL_CSS}</style>
        <BuildingScreen name="" />
      </div>
    );
  }

  return (
    <div
      className="match-scope"
      style={{
        ...bodyFont,
        minHeight: "600px",
        width: "100%",
        background: `radial-gradient(1200px 600px at 50% -10%, #241C33 0%, ${T.ink} 55%)`,
        color: T.text,
        display: "flex",
        justifyContent: "center",
      }}
    >
      <style>{FONTS + GLOBAL_CSS}</style>
      <div style={{ width: "100%", maxWidth: 460, position: "relative", minHeight: 700 }}>
        {stage === "landing" && (
          <Landing
            onEnter={() => setStage("auth")}
            onDemo={() => {
              setOnboard({ interests: DEMO_USER.tags, intention: DEMO_USER.intention, name: DEMO_USER.name, city: DEMO_USER.city, birthAge: DEMO_USER.age, bio: DEMO_USER.bio });
              goToApp();
            }}
          />
        )}
        {stage === "auth" && (
          <AuthScreen
            busy={busy}
            error={authError}
            onBack={() => setStage("landing")}
            onSubmit={handleAuth}
          />
        )}
        {stage === "onboarding" && (
          <Onboarding
            data={onboard}
            setData={setOnboard}
            busy={busy}
            onFinish={() => persistOnboarding(onboard, { complete: true })}
            onSkip={() => persistOnboarding({ ...onboard, name: onboard.name || DEMO_USER.name, intention: onboard.intention || DEMO_USER.intention, bio: DEMO_USER.bio }, { complete: true })}
          />
        )}
        {stage === "building" && <BuildingScreen name={onboard.name || profile?.name} />}
        {stage === "app" && profileReady && (
          <MainApp
            onboard={onboard}
            profile={profile}
            session={session}
            discovery={discovery}
            onSignOut={handleSignOut}
            onRefreshDiscovery={() => userId && loadProfileAndDiscovery(userId)}
          />
        )}
        {authError && stage !== "auth" && (
          <div style={{ position: "absolute", bottom: 16, left: 16, right: 16, background: T.surface3, border: `1px solid ${T.border}`, borderRadius: 12, padding: "10px 12px", fontSize: 12, color: T.muted, zIndex: 80 }}>
            {authError}
          </div>
        )}
      </div>
    </div>
  );
}

function AuthScreen({ busy, error, onBack, onSubmit }) {
  const [mode, setMode] = useState("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPw, setShowPw] = useState(false);

  return (
    <div style={{ minHeight: 700, display: "flex", flexDirection: "column", padding: "28px 24px" }} className="fade-up">
      <button onClick={onBack} style={{ ...ghostBtn, width: 44, marginBottom: 18 }} aria-label="Back">
        <ArrowLeft size={18} />
      </button>
      <h2 style={{ ...displayFont, fontSize: 30, margin: "0 0 6px" }}>{mode === "signin" ? "Welcome back" : "Create account"}</h2>
      <p style={{ color: T.muted, fontSize: 14, marginBottom: 22 }}>
        {mode === "signin" ? "Sign in to sync your profile with Supabase." : "Sign up — your profile is stored securely in Supabase."}
      </p>
      <label style={{ fontSize: 12, color: T.mutedDim, marginBottom: 6 }}>Email</label>
      <div style={{ position: "relative", marginBottom: 14 }}>
        <Mail size={16} color={T.muted} style={{ position: "absolute", left: 14, top: 17 }} />
        <input
          type="email"
          autoComplete="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="you@email.com"
          style={{
            width: "100%", padding: "16px 18px 16px 40px", borderRadius: 16, border: `1px solid ${T.border}`,
            background: T.surface2, color: T.text, fontSize: 15, outline: "none", ...bodyFont
          }}
        />
      </div>
      <label style={{ fontSize: 12, color: T.mutedDim, marginBottom: 6 }}>Password</label>
      <div style={{ position: "relative", marginBottom: 10 }}>
        <Lock size={16} color={T.muted} style={{ position: "absolute", left: 14, top: 17 }} />
        <input
          type={showPw ? "text" : "password"}
          autoComplete={mode === "signin" ? "current-password" : "new-password"}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="••••••••"
          style={{
            width: "100%", padding: "16px 44px 16px 40px", borderRadius: 16, border: `1px solid ${T.border}`,
            background: T.surface2, color: T.text, fontSize: 15, outline: "none", ...bodyFont
          }}
        />
        <button type="button" onClick={() => setShowPw((s) => !s)} style={{ position: "absolute", right: 10, top: 10, background: "none", border: "none", color: T.muted, cursor: "pointer", padding: 6 }}>
          {showPw ? <EyeOff size={16} /> : <Eye size={16} />}
        </button>
      </div>
      {error && <p style={{ color: "#FF8A7A", fontSize: 13, margin: "4px 0 10px" }}>{error}</p>}
      <button
        disabled={busy || !email || password.length < 6}
        onClick={() => onSubmit({ mode, email: email.trim(), password })}
        style={{ ...primaryBtn, opacity: busy || !email || password.length < 6 ? 0.55 : 1, marginTop: 8 }}
      >
        {busy ? "Please wait…" : mode === "signin" ? "Sign in" : "Sign up"}
      </button>
      <button
        onClick={() => setMode((m) => (m === "signin" ? "signup" : "signin"))}
        style={{ background: "none", border: "none", color: T.muted, fontSize: 13, marginTop: 16, cursor: "pointer", ...bodyFont }}
      >
        {mode === "signin" ? "New here? Create an account" : "Already have an account? Sign in"}
      </button>
    </div>
  );
}

/* ------------------------------ BUILDING SCREEN ------------------------------ */
/* ------------------------------ BUILDING SCREEN ------------------------------ */
function BuildingScreen({ name }) {
  const [step, setStep] = useState(0);
  const lines = ["Reading your taste…", "Finding your best matches…", `Almost ready, ${name || "welcome"}…`];
  useEffect(() => {
    const t = setInterval(() => setStep((s) => Math.min(s + 1, lines.length - 1)), 480);
    return () => clearInterval(t);
  }, []); // eslint-disable-line

  return (
    <div style={{ minHeight: 700, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: 32 }}>
      <div style={{ position: "relative", width: 64, height: 64, marginBottom: 22 }}>
        <div style={{ position: "absolute", inset: 0, borderRadius: "50%", border: `3px solid ${T.surface3}` }} />
        <div style={{ position: "absolute", inset: 0, borderRadius: "50%", border: "3px solid transparent", borderTopColor: T.rose, borderRightColor: T.amber, animation: "ringSpin 0.9s linear infinite" }} />
        <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center" }}>
          <LitMatch size={22} />
        </div>
      </div>
      <p style={{ ...displayFont, fontSize: 17, marginBottom: 28, color: T.text }}>{lines[step]}</p>

      <div style={{ width: "100%", maxWidth: 320, display: "flex", flexDirection: "column", gap: 12 }}>
        {[0, 1, 2].map((i) => (
          <div key={i} style={{ display: "flex", alignItems: "center", gap: 12, opacity: 0.9 }}>
            <div className="skeleton-shimmer" style={{ width: 44, height: 44, borderRadius: "50%", flexShrink: 0 }} />
            <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 6 }}>
              <div className="skeleton-shimmer" style={{ width: `${70 - i * 10}%`, height: 12, borderRadius: 6 }} />
              <div className="skeleton-shimmer" style={{ width: `${45 - i * 5}%`, height: 10, borderRadius: 6 }} />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}


function Landing({ onEnter, onDemo }) {
  return (
    <div
      className="fade-up"
      style={{
        minHeight: 700,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        textAlign: "center",
        padding: "40px 32px",
        position: "relative",
        overflow: "hidden",
      }}
    >
      <div style={{
        position: "absolute", top: -80, right: -60, width: 260, height: 260, borderRadius: "50%",
        background: `radial-gradient(circle, ${T.rose}55, transparent 70%)`, filter: "blur(10px)"
      }} />
      <div style={{
        position: "absolute", bottom: -60, left: -60, width: 240, height: 240, borderRadius: "50%",
        background: `radial-gradient(circle, ${T.violet}44, transparent 70%)`, filter: "blur(10px)"
      }} />
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 6 }}>
        <h1 style={{ ...displayFont, fontSize: 64, fontWeight: 600, letterSpacing: -2, margin: 0, lineHeight: 1 }}>
          MATCH
        </h1>
        <LitMatch size={30} />
      </div>
      <p style={{ ...displayFont, fontStyle: "normal", fontWeight: 500, fontSize: 21, color: T.text, marginTop: 22, maxWidth: 320 }}>
        Meet people who match your vibe.
      </p>

      <div style={{ display: "flex", gap: 10, marginTop: 36 }}>
        {["🎵", "🍣", "✈️", "🎬", "🏋️"].map((e, i) => (
          <div key={i} style={{
            width: 42, height: 42, borderRadius: 14, background: T.surface2, border: `1px solid ${T.border}`,
            display: "flex", alignItems: "center", justifyContent: "center", fontSize: 18,
            animation: `popIn .4s ${i * 0.08}s both`
          }}>{e}</div>
        ))}
      </div>

      <button
        onClick={onEnter}
        style={{
          marginTop: 44, width: "100%", maxWidth: 280, padding: "16px 20px", borderRadius: 999,
          border: "none", cursor: "pointer", ...bodyFont, fontWeight: 700, fontSize: 15, color: "#fff",
          background: `linear-gradient(90deg, ${T.rose}, #FF7A63)`, boxShadow: `0 12px 30px -8px ${T.rose}88`,
        }}
      >
        Sign in / Sign up
      </button>
      <button
        onClick={onDemo}
        style={{
          marginTop: 12, width: "100%", maxWidth: 280, padding: "12px 20px", borderRadius: 999,
          border: `1px solid ${T.border}`, cursor: "pointer", ...bodyFont, fontWeight: 600, fontSize: 13.5,
          color: T.muted, background: "transparent",
        }}
      >
        Continue with demo UI
      </button>
    </div>
  );
}

/* ------------------------------ ONBOARDING ------------------------------ */
function Onboarding({ data, setData, onFinish, onSkip, busy }) {
  const [step, setStep] = useState(0);
  const steps = ["name", "intention", "interests", "personality"];
  const total = steps.length;

  const musicPool = ["Pop", "Hip-Hop", "R&B", "Rock", "Techno", "House", "Reggaeton", "Classical", "Jazz", "Indie"];
  const foodPool = ["Sushi", "Italian", "Burgers", "Portuguese", "Mexican", "Vegan", "Fine dining", "Street food"];
  const lifePool = ["Gym", "Travel", "Gaming", "Fashion", "Nightlife", "Reading", "Beach", "Hiking", "Concerts", "Cooking"];

  const toggleInterest = (t) => {
    setData((d) => ({
      ...d,
      interests: d.interests.includes(t) ? d.interests.filter((x) => x !== t) : [...d.interests, t],
    }));
  };

  return (
    <div style={{ minHeight: 700, display: "flex", flexDirection: "column", padding: "28px 24px" }}>
      <div style={{ display: "flex", gap: 6, marginBottom: 28 }}>
        {steps.map((_, i) => (
          <div key={i} style={{
            flex: 1, height: 4, borderRadius: 4,
            background: i <= step ? `linear-gradient(90deg, ${T.rose}, ${T.amber})` : T.surface2,
            transition: "background .3s"
          }} />
        ))}
      </div>

      <div style={{ flex: 1 }} className="fade-up" key={step}>
        {step === 0 && (
          <div>
            <h2 style={{ ...displayFont, fontSize: 30, marginBottom: 6 }}>What's your name?</h2>
            <p style={{ color: T.muted, fontSize: 14, marginBottom: 26 }}>Let's start with the basics.</p>
            <input
              value={data.name}
              onChange={(e) => setData((d) => ({ ...d, name: e.target.value }))}
              placeholder="Your first name"
              style={{
                width: "100%", padding: "16px 18px", borderRadius: 16, border: `1px solid ${T.border}`,
                background: T.surface2, color: T.text, fontSize: 16, outline: "none", ...bodyFont, marginBottom: 12
              }}
            />
            <div style={{ display: "flex", gap: 10 }}>
              <input
                type="number"
                min={18}
                max={99}
                value={data.birthAge || 25}
                onChange={(e) => setData((d) => ({ ...d, birthAge: Number(e.target.value) || 25 }))}
                placeholder="Age"
                style={{
                  width: "35%", padding: "16px 18px", borderRadius: 16, border: `1px solid ${T.border}`,
                  background: T.surface2, color: T.text, fontSize: 16, outline: "none", ...bodyFont
                }}
              />
              <input
                value={data.city || ""}
                onChange={(e) => setData((d) => ({ ...d, city: e.target.value }))}
                placeholder="City"
                style={{
                  flex: 1, padding: "16px 18px", borderRadius: 16, border: `1px solid ${T.border}`,
                  background: T.surface2, color: T.text, fontSize: 16, outline: "none", ...bodyFont
                }}
              />
            </div>
            <p style={{ color: T.mutedDim, fontSize: 12, marginTop: 22 }}>
              Saved to your Supabase profile (birth date is derived from age; exact DOB stays private via RLS).
            </p>
          </div>
        )}

        {step === 1 && (
          <div>
            <h2 style={{ ...displayFont, fontSize: 30, marginBottom: 6 }}>What are you looking for?</h2>
            <p style={{ color: T.muted, fontSize: 14, marginBottom: 22 }}>Be honest — it helps your matches.</p>
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {INTENTIONS.map((opt) => (
                <button
                  key={opt}
                  onClick={() => setData((d) => ({ ...d, intention: opt }))}
                  style={{
                    textAlign: "left", padding: "16px 18px", borderRadius: 16, cursor: "pointer",
                    border: `1px solid ${data.intention === opt ? T.rose : T.border}`,
                    background: data.intention === opt ? `${T.rose}22` : T.surface2,
                    color: T.text, fontSize: 15, fontWeight: 500, ...bodyFont,
                    display: "flex", justifyContent: "space-between", alignItems: "center"
                  }}
                >
                  {opt}
                  {data.intention === opt && <Check size={18} color={T.rose} />}
                </button>
              ))}
            </div>
          </div>
        )}

        {step === 2 && (
          <div>
            <h2 style={{ ...displayFont, fontSize: 30, marginBottom: 6 }}>Your taste, in a few taps</h2>
            <p style={{ color: T.muted, fontSize: 14, marginBottom: 18 }}>Pick what sounds like you. Choose as many as you like.</p>
            {[["Music", musicPool], ["Food", foodPool], ["Lifestyle", lifePool]].map(([label, pool]) => (
              <div key={label} style={{ marginBottom: 18 }}>
                <p style={{ ...monoFont, fontSize: 11, letterSpacing: 1, color: T.mutedDim, marginBottom: 8 }}>{label.toUpperCase()}</p>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                  {pool.map((t) => (
                    <Chip key={t} label={t} active={data.interests.includes(t)} onClick={() => toggleInterest(t)} />
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}

        {step === 3 && (
          <div>
            <h2 style={{ ...displayFont, fontSize: 30, marginBottom: 6 }}>One more thing</h2>
            <p style={{ color: T.muted, fontSize: 14, marginBottom: 22 }}>Perfect Friday night?</p>
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {["Rooftop bar with friends", "Cozy night in with a movie", "Live music or a concert", "Spontaneous — surprise me"].map((opt) => (
                <button
                  key={opt}
                  onClick={() => setData((d) => ({ ...d, friday: opt }))}
                  style={{
                    textAlign: "left", padding: "16px 18px", borderRadius: 16, cursor: "pointer",
                    border: `1px solid ${data.friday === opt ? T.violet : T.border}`,
                    background: data.friday === opt ? `${T.violet}22` : T.surface2,
                    color: T.text, fontSize: 15, ...bodyFont,
                  }}
                >{opt}</button>
              ))}
            </div>
            <div style={{
              marginTop: 24, padding: 16, borderRadius: 16, border: `1px dashed ${T.border}`, background: T.surface,
              display: "flex", gap: 12, alignItems: "center"
            }}>
              <Sparkles size={18} color={T.amber} />
              <p style={{ fontSize: 13, color: T.muted, margin: 0 }}>
                We're building your compatibility profile from everything you share here.
              </p>
            </div>
          </div>
        )}
      </div>

      <div style={{ display: "flex", gap: 10, marginTop: 20 }}>
        {step > 0 && (
          <button onClick={() => setStep((s) => s - 1)} style={ghostBtn}>
            <ChevronLeft size={18} />
          </button>
        )}
        <button
          disabled={busy}
          onClick={() => (step === total - 1 ? onFinish() : setStep((s) => s + 1))}
          style={{ ...primaryBtn, flex: 1, opacity: busy ? 0.6 : 1 }}
        >
          {busy ? "Saving…" : step === total - 1 ? "Build my profile" : "Continue"}
        </button>
      </div>
      <button onClick={onSkip} style={{ background: "none", border: "none", color: T.mutedDim, fontSize: 13, marginTop: 14, cursor: "pointer", ...bodyFont }}>
        Skip — use demo profile (Emma)
      </button>
    </div>
  );
}

const primaryBtn = {
  padding: "16px 20px", borderRadius: 999, border: "none", cursor: "pointer",
  fontWeight: 700, fontSize: 15, color: "#fff", ...bodyFont,
  background: `linear-gradient(90deg, ${T.rose}, #FF7A63)`,
};
const ghostBtn = {
  padding: "14px 18px", borderRadius: 999, border: `1px solid ${T.border}`, cursor: "pointer",
  background: T.surface2, color: T.text,
};

function Chip({ label, active, onClick }) {
  const icon = INTEREST_META[label]?.icon;
  return (
    <button
      onClick={onClick}
      style={{
        padding: "9px 14px", borderRadius: 999, cursor: "pointer", fontSize: 13.5, ...bodyFont, fontWeight: 500,
        border: `1px solid ${active ? T.rose : T.border}`,
        background: active ? `${T.rose}22` : T.surface2,
        color: active ? "#fff" : T.muted,
        display: "inline-flex", alignItems: "center", gap: 6, transition: "all .15s"
      }}
    >
      {icon && <span>{icon}</span>}{label}
    </button>
  );
}

function FlameShape({ gid }) {
  return (
    <>
      <defs>
        <linearGradient id={`${gid}-outer`} x1="0%" y1="100%" x2="10%" y2="0%">
          <stop offset="0%" stopColor="#C23A3F" />
          <stop offset="45%" stopColor={T.rose} />
          <stop offset="100%" stopColor={T.amber} />
        </linearGradient>
        <linearGradient id={`${gid}-mid`} x1="0%" y1="100%" x2="0%" y2="0%">
          <stop offset="0%" stopColor={T.amber} />
          <stop offset="100%" stopColor="#FFF2CE" />
        </linearGradient>
        <radialGradient id={`${gid}-core`} cx="50%" cy="75%" r="55%">
          <stop offset="0%" stopColor="#FFFDF5" />
          <stop offset="100%" stopColor="#FFE9B0" stopOpacity="0.35" />
        </radialGradient>
      </defs>
      <g className="flame-outer">
        <path
          d="M12 1C9.2 4.5 7.6 7.7 7.8 10.3C7.95 12.6 9.8 14.2 12 14.2C14.2 14.2 16.05 12.6 16.2 10.3C16.4 7.7 14.8 4.5 12 1Z"
          fill={`url(#${gid}-outer)`}
        />
      </g>
      <g className="flame-mid">
        <path
          d="M12 3.4C10.5 5.6 9.6 7.5 9.85 9.4C10 10.8 11 11.7 12 11.7C13 11.7 14 10.8 14.15 9.4C14.4 7.5 13.5 5.6 12 3.4Z"
          fill={`url(#${gid}-mid)`}
        />
      </g>
      <g className="flame-inner">
        <path
          d="M12 7.2C11.3 8.2 11 9 11.05 9.7C11.1 10.5 11.5 11 12 11C12.5 11 12.9 10.5 12.95 9.7C13 9 12.7 8.2 12 7.2Z"
          fill={`url(#${gid}-core)`}
        />
      </g>
    </>
  );
}

function LitMatch({ size = 30 }) {
  const gid = useRef(`flame-${Math.random().toString(36).slice(2)}`).current;
  const w = size;
  const h = size * 1.5;
  return (
    <svg width={w} height={h} viewBox="0 0 24 36" style={{ overflow: "visible", flexShrink: 0 }}>
      <defs>
        <linearGradient id={`${gid}-wood`} x1="0%" y1="0%" x2="100%" y2="0%">
          <stop offset="0%" stopColor="#B99566" />
          <stop offset="50%" stopColor="#E2C393" />
          <stop offset="100%" stopColor="#B99566" />
        </linearGradient>
        <radialGradient id={`${gid}-glow`} cx="50%" cy="48%" r="50%">
          <stop offset="0%" stopColor={T.amber} stopOpacity="0.5" />
          <stop offset="100%" stopColor={T.amber} stopOpacity="0" />
        </radialGradient>
      </defs>
      {/* soft glow */}
      <circle cx="12" cy="9" r="12" fill={`url(#${gid}-glow)`} />
      {/* wooden stick */}
      <rect x="10.7" y="14.5" width="2.6" height="19.5" rx="1.3" fill={`url(#${gid}-wood)`} />
      {/* charred base of the tip */}
      <path d="M8.9 13.6c0-2.1 1.4-3.4 3.1-3.4s3.1 1.3 3.1 3.4c0 1.9-1.3 3.4-3.1 3.4s-3.1-1.5-3.1-3.4z" fill="#2E2119" />
      {/* ember glint where wood meets flame */}
      <circle cx="12" cy="12.8" r="0.9" fill="#FF9A4D" opacity="0.85" />
      {/* flame */}
      <g className="flame">
        <FlameShape gid={gid} />
      </g>
    </svg>
  );
}


function MainApp({ onboard, profile, session, discovery, onSignOut, onRefreshDiscovery }) {
  const [history, setHistory] = useState(["home"]);
  const tab = history[history.length - 1];
  const navigate = (t) => setHistory((h) => (h[h.length - 1] === t ? h : [...h, t]));
  const goBack = () => setHistory((h) => (h.length > 1 ? h.slice(0, -1) : h));
  const [chatId, setChatId] = useState(null);
  const [liveRoom, setLiveRoom] = useState(null);
  const [notifOpen, setNotifOpen] = useState(false);
  const [premiumOpen, setPremiumOpen] = useState(false);
  const [matchOverlay, setMatchOverlay] = useState(null);
  const [likedIds, setLikedIds] = useState([]);
  const [matchedIds, setMatchedIds] = useState([]);
  const [matchedProfiles, setMatchedProfiles] = useState([]);
  const [toast, setToast] = useState(null);
  const [savingBio, setSavingBio] = useState(false);

  const deckProfiles = discovery.length > 0 ? discovery : PROFILES;
  const user = mapOwnProfileToUser(profile, null, onboard);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!session?.user?.id) {
        setMatchedIds([3, 7, 12]);
        setMatchedProfiles(PROFILES.filter((p) => [3, 7, 12].includes(p.id)));
        return;
      }
      try {
        const rows = await fetchMyMatches(session.user.id);
        if (cancelled) return;
        const otherIds = rows.map((m) => (m.user_a === session.user.id ? m.user_b : m.user_a));
        setMatchedIds(otherIds);
        const fromDiscovery = deckProfiles.filter((p) => otherIds.includes(p.id));
        if (fromDiscovery.length) {
          setMatchedProfiles(fromDiscovery);
        } else if (otherIds.length) {
          const photos = await fetchPrimaryPhotos(otherIds);
          const { data } = await supabase.from("profiles").select("id, name, birth_date, city, bio, intention, verified").in("id", otherIds);
          setMatchedProfiles((data || []).map((r, i) => mapDbProfileToCard(r, photos[r.id], i)));
        } else {
          setMatchedProfiles([]);
        }
      } catch (err) {
        console.error(err);
      }
    })();
    return () => { cancelled = true; };
  }, [session?.user?.id, discovery]);

  const showToast = (msg) => {
    setToast(msg);
    setTimeout(() => setToast(null), 2200);
  };

  const handleLike = async (card) => {
    setLikedIds((l) => [...l, card.id]);
    if (session?.user?.id && isUuid(card.id)) {
      try {
        const { match } = await sendLike(session.user.id, card.id);
        if (match) {
          setMatchedIds((m) => [...new Set([...m, card.id])]);
          setMatchedProfiles((list) => (list.some((p) => p.id === card.id) ? list : [...list, card]));
          setMatchOverlay(card);
        } else {
          showToast(`Like sent to ${card.name} 💫`);
        }
        onRefreshDiscovery && onRefreshDiscovery();
      } catch (err) {
        console.error(err);
        showToast(err.message || "Could not send like");
      }
      return;
    }
    const isMatch = Math.random() > 0.35;
    if (isMatch) {
      setMatchedIds((m) => [...new Set([...m, card.id])]);
      setMatchedProfiles((list) => (list.some((p) => p.id === card.id) ? list : [...list, card]));
      setMatchOverlay(card);
    } else {
      showToast(`Like sent to ${card.name} 💫`);
    }
  };

  const handleSaveProfile = async (patch) => {
    if (!session?.user?.id) {
      showToast("Sign in to save your profile");
      return;
    }
    setSavingBio(true);
    try {
      const saved = await upsertOwnProfile(session.user.id, {
        name: patch.name || user.name,
        bio: patch.bio ?? user.bio,
        city: patch.city || user.city,
        intention: INTENTION_TO_DB[patch.intention || user.intention] || profile?.intention || "figuring_out",
        birth_date: profile?.birth_date || birthDateFromAge(user.age),
        onboarding_complete: true,
      });
      showToast("Profile saved ✓");
      onRefreshDiscovery && onRefreshDiscovery();
      return saved;
    } catch (err) {
      showToast(err.message || "Save failed");
    } finally {
      setSavingBio(false);
    }
  };

  const activeChat = matchedProfiles.find((p) => p.id === chatId) || deckProfiles.find((p) => p.id === chatId);

  return (
    <div style={{ minHeight: 700, position: "relative", paddingBottom: 84 }}>
      <TopBar
        user={user}
        onBell={() => setNotifOpen(true)}
        onAvatar={() => navigate("profile")}
        onLive={() => navigate("live")}
        canGoBack={history.length > 1 && tab !== "__chat"}
        onBack={goBack}
      />

      <div style={{ padding: "0 18px" }}>
        {tab === "home" && (
          <HomeTab
            user={user}
            onLike={handleLike}
            onOpenChat={(id) => { setChatId(id); navigate("__chat"); }}
            onOpenProfileTab={() => navigate("discover")}
            onOpenLive={(room) => setLiveRoom(room)}
            onOpenEvents={() => navigate("events")}
            deckProfiles={deckProfiles}
          />
        )}
        {tab === "discover" && (
          <DiscoverTab
            onLike={handleLike}
            onPass={() => {}}
            profiles={deckProfiles}
            usingLiveData={discovery.length > 0}
          />
        )}
        {tab === "matches" && (
          <MatchesTab
            profiles={matchedProfiles}
            onOpen={(id) => { setChatId(id); navigate("__chat"); }}
          />
        )}
        {tab === "messages" && (
          <MessagesTab
            profiles={matchedProfiles}
            onOpen={(id) => { setChatId(id); navigate("__chat"); }}
          />
        )}
        {tab === "__chat" && activeChat && (
          <ChatView profile={activeChat} onBack={goBack} />
        )}
        {tab === "social" && <SocialTab user={user} showToast={showToast} />}
        {tab === "live" && <LiveTab onOpen={setLiveRoom} />}
        {tab === "events" && <EventsTab showToast={showToast} />}
        {tab === "profile" && (
          <ProfileTab
            user={user}
            onPremium={() => setPremiumOpen(true)}
            onOpenSocial={() => navigate("social")}
            showToast={showToast}
            onSignOut={onSignOut}
            onSaveProfile={handleSaveProfile}
            saving={savingBio}
            signedIn={!!session}
          />
        )}
      </div>

      {tab !== "__chat" && (
        <BottomNav
          tab={tab}
          setTab={navigate}
          onCreate={() => navigate("social")}
        />
      )}

      {matchOverlay && (
        <MatchOverlay
          profile={matchOverlay}
          onClose={() => setMatchOverlay(null)}
          onMessage={() => { setChatId(matchOverlay.id); setMatchOverlay(null); navigate("__chat"); }}
        />
      )}

      {liveRoom && <LiveRoomView room={liveRoom} onClose={() => setLiveRoom(null)} />}
      {notifOpen && <NotificationsPanel onClose={() => setNotifOpen(false)} />}
      {premiumOpen && <PremiumModal onClose={() => setPremiumOpen(false)} />}

      {toast && (
        <div style={{
          position: "absolute", bottom: 96, left: "50%", transform: "translateX(-50%)",
          background: T.surface3, border: `1px solid ${T.border}`, padding: "10px 18px", borderRadius: 999,
          fontSize: 13, color: T.text, whiteSpace: "nowrap", zIndex: 60,
        }} className="pop-in">{toast}</div>
      )}
    </div>
  );
}

/* ------------------------------ TOP BAR ------------------------------ */
function TopBar({ user, onBell, onAvatar, onLive, canGoBack, onBack }) {
  return (
    <div className="glass" style={{
      position: "sticky", top: 0, zIndex: 40, display: "flex", alignItems: "center",
      justifyContent: "space-between", padding: "16px 18px", borderBottom: `1px solid ${T.border}`,
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        {canGoBack && (
          <button onClick={onBack} style={{
            width: 32, height: 32, borderRadius: "50%", border: `1px solid ${T.border}`, background: T.surface2,
            display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", color: T.text, flexShrink: 0
          }}>
            <ArrowLeft size={16} />
          </button>
        )}
        <span style={{ ...displayFont, fontSize: 22, fontWeight: 600, letterSpacing: -0.5, display: "flex", alignItems: "center", gap: 3 }}>
          MATCH <LitMatch size={16} />
        </span>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <IconBtn onClick={onLive}><Radio size={18} color={T.rose} /></IconBtn>
        <IconBtn onClick={onBell}><Bell size={18} /></IconBtn>
        <button onClick={onAvatar} style={{ border: "none", background: "none", cursor: "pointer", padding: 0 }}>
          <img src={user.photo} alt="me" style={{ width: 34, height: 34, borderRadius: "50%", objectFit: "cover", border: `2px solid ${T.rose}` }} />
        </button>
      </div>
    </div>
  );
}
function IgnitingMatch({ size = 40, delay = 400, onIgnite, steady = false }) {
  const [lit, setLit] = useState(false);
  const gid = useRef(`ig-${Math.random().toString(36).slice(2)}`).current;
  useEffect(() => {
    const t = setTimeout(() => { setLit(true); onIgnite && onIgnite(); }, delay);
    return () => clearTimeout(t);
  }, [delay]); // eslint-disable-line

  const w = size;
  const h = size * 1.5;

  return (
    <div style={{ position: "relative", width: w, height: h }}>
      {/* the stick "strikes" against an invisible surface, then settles — skipped for a steady, already-lit badge */}
      <div style={{
        width: "100%", height: "100%", transformOrigin: "50% 92%",
        animation: steady ? undefined : `matchStrikeMotion 0.55s ease ${delay}ms both`,
      }}>
        <svg width={w} height={h} viewBox="0 0 24 36" style={{ overflow: "visible" }}>
          <defs>
            <linearGradient id={`${gid}-wood`} x1="0%" y1="0%" x2="100%" y2="0%">
              <stop offset="0%" stopColor="#B99566" />
              <stop offset="50%" stopColor="#E2C393" />
              <stop offset="100%" stopColor="#B99566" />
            </linearGradient>

            <radialGradient id={`${gid}-glow`} cx="50%" cy="48%" r="50%">
              <stop offset="0%" stopColor={T.amber} stopOpacity="0.6" />
              <stop offset="100%" stopColor={T.amber} stopOpacity="0" />
            </radialGradient>
          </defs>

          {lit && (
            <circle cx="12" cy="9" r="12" fill={`url(#${gid}-glow)`} style={{ animation: "glowPulse 1.8s ease-in-out infinite" }} />
          )}

          {/* wooden stick */}
          <rect x="10.7" y="14.5" width="2.6" height="19.5" rx="1.3" fill={`url(#${gid}-wood)`} />
          {/* tip — charred once lit, glowing red before */}
          <path
            d="M8.9 13.6c0-2.1 1.4-3.4 3.1-3.4s3.1 1.3 3.1 3.4c0 1.9-1.3 3.4-3.1 3.4s-3.1-1.5-3.1-3.4z"
            fill={lit ? "#2E2119" : "#B4453B"}
            style={{ transition: "fill .25s ease" }}
          />
          {lit && <circle cx="12" cy="12.8" r="0.9" fill="#FF9A4D" opacity="0.85" />}

          {lit && (
            <g style={{ transformOrigin: "12px 13px", animation: "flameIgnite 0.4s ease both" }}>
              <g className="flame">
                <FlameShape gid={gid} />
              </g>
            </g>
          )}
        </svg>
      </div>

      {/* tiny sparks at the moment of ignition */}
      {lit && [
        [-14, -10], [12, -14], [-6, -18], [16, -4],
      ].map(([sx, sy], i) => (
        <span
          key={i}
          style={{
            position: "absolute", left: "52%", top: "26%", width: 3, height: 3, borderRadius: "50%",
            background: T.amber, "--sx": `${sx}px`, "--sy": `${sy}px`,
            animation: `sparkBurst 0.5s ease-out both`,
          }}
        />
      ))}
    </div>
  );
}


function IconBtn({ children, onClick }) {
  return (
    <button onClick={onClick} style={{
      width: 36, height: 36, borderRadius: "50%", border: `1px solid ${T.border}`, background: T.surface2,
      display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", color: T.text,
    }}>{children}</button>
  );
}

/* ------------------------------ MATCH RING ------------------------------ */
function MatchRing({ percent, size = 56, stroke = 5 }) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const offset = c - (percent / 100) * c;
  const id = useRef(`grad-${Math.random().toString(36).slice(2)}`).current;
  return (
    <div style={{ position: "relative", width: size, height: size }}>
      <svg width={size} height={size}>
        <defs>
          <linearGradient id={id} x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor={T.rose} />
            <stop offset="55%" stopColor={T.amber} />
            <stop offset="100%" stopColor={T.violet} />
          </linearGradient>
        </defs>
        <circle cx={size / 2} cy={size / 2} r={r} stroke={T.surface3} strokeWidth={stroke} fill="none" />
        <circle
          cx={size / 2} cy={size / 2} r={r} stroke={`url(#${id})`} strokeWidth={stroke} fill="none"
          strokeDasharray={c} strokeDashoffset={offset} strokeLinecap="round"
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
          style={{ transition: "stroke-dashoffset 1s ease" }}
        />
      </svg>
      <div style={{
        position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center",
        flexDirection: "column"
      }}>
        <span style={{ ...monoFont, fontSize: size * 0.24, fontWeight: 600 }}>{percent}%</span>
      </div>
    </div>
  );
}

/* ------------------------------ HOME TAB ------------------------------ */
function HomeTab({ user, onLike, onOpenChat, onOpenLive, onOpenEvents, onOpenProfileTab, deckProfiles }) {
  const pool = deckProfiles?.length ? deckProfiles : PROFILES;
  const top = useMemo(() => [...pool].sort((a, b) => b.match - a.match).slice(0, 3), [pool]);
  const trending = useMemo(() => [...pool].sort(() => 0.5 - Math.random()).slice(0, 6), [pool]);
  const hour = new Date().getHours();
  const greeting = hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";

  return (
    <div className="fade-up" style={{ paddingTop: 18, paddingBottom: 10 }}>
      <h2 style={{ ...displayFont, fontSize: 24, margin: "0 0 2px" }}>{greeting}, {user.name} 👋</h2>
      <p style={{ color: T.muted, fontSize: 13.5, margin: "0 0 20px" }}>Here's who matches your vibe today.</p>

      <SectionTitle title="Your top matches" />
      <div style={{ display: "flex", gap: 12, overflowX: "auto", paddingBottom: 4 }} className="no-scrollbar">
        {top.map((p) => (
          <div key={p.id} style={{
            minWidth: 150, background: T.surface, borderRadius: 20, overflow: "hidden",
            border: `1px solid ${T.border}`,
          }} className="card-shadow">
            <div style={{ position: "relative", height: 130 }}>
              <img src={p.photo} alt={p.name} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
              <div style={{ position: "absolute", top: 8, right: 8, background: "rgba(20,16,26,0.75)", borderRadius: 12, padding: "3px 8px", display: "flex", alignItems: "center", gap: 4 }}>
                <span style={{ fontSize: 11 }}>❤️</span>
                <span style={{ ...monoFont, fontSize: 11, fontWeight: 600 }}>{p.match}%</span>
              </div>
            </div>
            <div style={{ padding: "10px 12px 14px" }}>
              <p style={{ fontWeight: 700, fontSize: 14, margin: 0 }}>{p.name}, {p.age}</p>
              <p style={{ color: T.muted, fontSize: 11.5, margin: "2px 0 8px" }}>{p.city}</p>
              <button onClick={() => onLike(p)} style={{
                width: "100%", padding: "7px 0", borderRadius: 999, border: "none", cursor: "pointer",
                background: `linear-gradient(90deg, ${T.rose}, #FF7A63)`, color: "#fff", fontSize: 12, fontWeight: 700
              }}>Like</button>
            </div>
          </div>
        ))}
      </div>

      <SectionTitle title="Because you like" sub={user.tags.slice(0, 3).map((t) => INTEREST_META[t]?.icon).join(" ")} />
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 22 }}>
        {user.tags.map((t) => <Chip key={t} label={t} active onClick={() => {}} />)}
      </div>

      <SectionTitle title="Live now" action="See all" onAction={onOpenEvents} />
      <div style={{ display: "flex", gap: 12, overflowX: "auto", paddingBottom: 4, marginBottom: 22 }} className="no-scrollbar">
        {LIVE_ROOMS.slice(0, 4).map((r) => (
          <button key={r.id} onClick={() => onOpenLive(r)} style={{
            minWidth: 120, border: `1px solid ${T.border}`, borderRadius: 18, background: T.surface, cursor: "pointer",
            padding: 0, overflow: "hidden", textAlign: "left"
          }}>
            <div style={{ position: "relative", height: 90 }}>
              <img src={r.cover} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
              <span style={{
                position: "absolute", top: 6, left: 6, background: T.rose, fontSize: 9.5, fontWeight: 700,
                padding: "2px 6px", borderRadius: 6, ...monoFont
              }}>● LIVE</span>
            </div>
            <div style={{ padding: "8px 10px" }}>
              <p style={{ fontSize: 12, fontWeight: 700, margin: 0 }}>{r.title}</p>
              <p style={{ fontSize: 10.5, color: T.muted, margin: "2px 0 0" }}>{r.viewers} watching</p>
            </div>
          </button>
        ))}
      </div>

      <SectionTitle title="Trending people" />
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 22 }}>
        {trending.map((p) => (
          <div key={p.id} style={{ background: T.surface, borderRadius: 16, overflow: "hidden", border: `1px solid ${T.border}` }}>
            <div style={{ position: "relative", height: 100 }}>
              <img src={p.photo} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
              <div style={{ position: "absolute", bottom: 6, left: 6, background: "rgba(20,16,26,0.75)", borderRadius: 10, padding: "2px 7px", ...monoFont, fontSize: 10.5 }}>
                {p.match}% match
              </div>
            </div>
            <div style={{ padding: "8px 10px" }}>
              <p style={{ fontSize: 12.5, fontWeight: 700, margin: 0 }}>{p.name}, {p.age}</p>
            </div>
          </div>
        ))}
      </div>

      <SectionTitle title="Events near you" action="See all" onAction={onOpenEvents} />
      <div style={{ display: "flex", gap: 12, overflowX: "auto", paddingBottom: 20 }} className="no-scrollbar">
        {EVENTS.slice(0, 3).map((e) => (
          <div key={e.id} style={{ minWidth: 190, background: T.surface, borderRadius: 18, overflow: "hidden", border: `1px solid ${T.border}` }}>
            <img src={e.cover} style={{ width: "100%", height: 90, objectFit: "cover" }} />
            <div style={{ padding: "10px 12px" }}>
              <p style={{ fontSize: 13, fontWeight: 700, margin: 0 }}>{e.title}</p>
              <p style={{ fontSize: 11, color: T.muted, margin: "3px 0 0" }}>{e.date} · {e.location}</p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function SectionTitle({ title, sub, action, onAction }) {
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", margin: "6px 0 10px" }}>
      <p style={{ fontWeight: 700, fontSize: 15, margin: 0 }}>{title} {sub && <span style={{ fontSize: 13 }}>{sub}</span>}</p>
      {action && (
        <button onClick={onAction} style={{ background: "none", border: "none", color: T.rose, fontSize: 12.5, fontWeight: 600, cursor: "pointer" }}>
          {action}
        </button>
      )}
    </div>
  );
}

/* ------------------------------ DISCOVER TAB ------------------------------ */
const DISCOVERY_MODES = ["Recommended", "Near You", "Similar Taste", "Opposites Attract", "New Users", "Trending", "Events"];

function DiscoverTab({ onLike, onPass, profiles: liveProfiles, usingLiveData }) {
  const [mode, setMode] = useState("Recommended");
  const [view, setView] = useState("cards");
  const source = (liveProfiles && liveProfiles.length ? liveProfiles : PROFILES);
  const [deck, setDeck] = useState(() => [...source].sort(() => 0.5 - Math.random()));
  useEffect(() => { setDeck([...source].sort(() => 0.5 - Math.random())); }, [liveProfiles]);
  const [drag, setDrag] = useState({ x: 0, active: false });
  const [showDetail, setShowDetail] = useState(false);
  const [showFilters, setShowFilters] = useState(false);
  const [filters, setFilters] = useState({ maxDistance: 15, verifiedOnly: false, intention: null });
  const startX = useRef(0);

  const current = deck[0];

  const applyFilters = (base, f) => base.filter((p) =>
    p.distance <= f.maxDistance &&
    (!f.verifiedOnly || p.verified) &&
    (!f.intention || p.intention === f.intention)
  );

  const advance = (dir) => {
    if (!current) return;
    if (dir === "like") onLike(current);
    else onPass(current);
    setDeck((d) => d.slice(1));
    setDrag({ x: 0, active: false });
  };

  const onPointerDown = (e) => { startX.current = e.clientX ?? e.touches?.[0]?.clientX; setDrag({ x: 0, active: true }); };
  const onPointerMove = (e) => {
    if (!drag.active) return;
    const x = (e.clientX ?? e.touches?.[0]?.clientX) - startX.current;
    setDrag({ x, active: true });
  };
  const onPointerUp = () => {
    if (drag.x > 110) advance("like");
    else if (drag.x < -110) advance("pass");
    else setDrag({ x: 0, active: false });
  };

  return (
    <div className="fade-up" style={{ paddingTop: 14 }}>
      <p style={{ fontSize: 11.5, color: T.mutedDim, margin: "0 0 10px", ...monoFont }}>
        {usingLiveData ? "LIVE · profiles from Supabase" : "DEMO · mock cards (no discoverable profiles yet)"}
      </p>
      <div style={{ display: "flex", gap: 8, overflowX: "auto", paddingBottom: 10 }} className="no-scrollbar">
        {DISCOVERY_MODES.map((m) => (
          <button key={m} onClick={() => { setMode(m); setDeck(applyFilters([...source].sort(() => 0.5 - Math.random()), filters)); }} style={{
            padding: "8px 14px", borderRadius: 999, whiteSpace: "nowrap", fontSize: 12.5, cursor: "pointer",
            border: `1px solid ${mode === m ? T.rose : T.border}`,
            background: mode === m ? `${T.rose}22` : T.surface2, color: mode === m ? "#fff" : T.muted, fontWeight: 600
          }}>{m}</button>
        ))}
      </div>

      <div style={{ display: "flex", gap: 4, background: T.surface2, borderRadius: 999, padding: 4, marginBottom: 4, width: "fit-content" }}>
        {[["cards", "Cards"], ["map", "Map"]].map(([key, label]) => (
          <button key={key} onClick={() => setView(key)} style={{
            padding: "7px 16px", borderRadius: 999, border: "none", cursor: "pointer", fontSize: 12.5, fontWeight: 700,
            background: view === key ? T.surface : "transparent", color: view === key ? T.text : T.muted,
            display: "flex", alignItems: "center", gap: 5,
          }}>{key === "map" ? <MapPin size={13} /> : <Sparkles size={13} />} {label}</button>
        ))}
      </div>

      {view === "map" ? (
        <MapView profiles={source} onLike={onLike} />
      ) : (
      <>
      <div style={{ position: "relative", height: 500, marginTop: 6 }}>
        {!current && (
          <div style={{
            height: "100%", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
            border: `1px dashed ${T.border}`, borderRadius: 24, color: T.muted, gap: 10
          }}>
            <RotateCcw size={26} />
            <p>You've seen everyone for now.</p>
            <button onClick={() => setDeck(applyFilters([...source].sort(() => 0.5 - Math.random()), filters))} style={{ ...primaryBtn, padding: "10px 18px" }}>Refresh deck</button>
          </div>
        )}
        {deck.slice(0, 3).reverse().map((p, idx, arr) => {
          const isTop = idx === arr.length - 1;
          const stackOffset = (arr.length - 1 - idx) * 6;
          return (
            <div
              key={p.id}
              onMouseDown={isTop ? onPointerDown : undefined}
              onMouseMove={isTop ? onPointerMove : undefined}
              onMouseUp={isTop ? onPointerUp : undefined}
              onMouseLeave={isTop && drag.active ? onPointerUp : undefined}
              onTouchStart={isTop ? onPointerDown : undefined}
              onTouchMove={isTop ? onPointerMove : undefined}
              onTouchEnd={isTop ? onPointerUp : undefined}
              style={{
                position: "absolute", inset: 0, top: stackOffset, borderRadius: 26, overflow: "hidden",
                border: `1px solid ${T.border}`, background: T.surface, cursor: isTop ? "grab" : "default",
                transform: isTop ? `translateX(${drag.x}px) rotate(${drag.x / 18}deg)` : `scale(${1 - stackOffset / 120})`,
                transition: drag.active ? "none" : "transform .35s ease",
                userSelect: "none",
              }}
              className="card-shadow"
            >
              <div style={{ position: "relative", height: "72%" }}>
                <img src={p.photo} alt={p.name} style={{ width: "100%", height: "100%", objectFit: "cover" }} draggable={false} />
                <div style={{ position: "absolute", inset: 0, background: "linear-gradient(to top, rgba(15,12,20,0.9), transparent 45%)" }} />
                {isTop && drag.x > 40 && (
                  <div style={{ position: "absolute", top: 24, left: 20, border: `3px solid ${T.mint}`, color: T.mint, padding: "4px 12px", borderRadius: 10, fontWeight: 800, transform: "rotate(-12deg)", fontSize: 20 }}>LIKE</div>
                )}
                {isTop && drag.x < -40 && (
                  <div style={{ position: "absolute", top: 24, right: 20, border: `3px solid ${T.mutedDim}`, color: T.mutedDim, padding: "4px 12px", borderRadius: 10, fontWeight: 800, transform: "rotate(12deg)", fontSize: 20 }}>PASS</div>
                )}
                <div style={{ position: "absolute", top: 14, right: 14 }}>
                  <MatchRing percent={p.match} size={54} />
                </div>
                <div style={{ position: "absolute", bottom: 14, left: 16, right: 16 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    <h3 style={{ ...displayFont, fontSize: 24, margin: 0 }}>{p.name}, {p.age}</h3>
                    {p.verified && <BadgeCheck size={16} color={T.mint} />}
                  </div>
                  <p style={{ fontSize: 12.5, color: "#E4DAF2", margin: "2px 0 0", display: "flex", alignItems: "center", gap: 4 }}>
                    <MapPin size={12} /> {p.city} · {p.distance} km away
                  </p>
                </div>
              </div>
              <div style={{ padding: "12px 16px" }}>
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 8 }}>
                  {p.tags.slice(0, 5).map((t) => (
                    <span key={t} style={{ fontSize: 11, background: T.surface2, borderRadius: 999, padding: "4px 9px", border: `1px solid ${T.border}` }}>
                      {INTEREST_META[t]?.icon} {t}
                    </span>
                  ))}
                </div>
                <p style={{ fontSize: 12.5, color: T.muted, margin: 0, lineHeight: 1.4 }}>"{p.bio}"</p>
                {isTop && (
                  <button onClick={() => setShowDetail(true)} style={{ background: "none", border: "none", color: T.rose, fontSize: 11.5, fontWeight: 700, marginTop: 6, padding: 0, cursor: "pointer" }}>
                    Why you match →
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {current && (
        <div style={{ display: "flex", justifyContent: "center", gap: 18, marginTop: 18 }}>
          <RoundBtn onClick={() => advance("pass")} color={T.mutedDim}><X size={24} /></RoundBtn>
          <RoundBtn onClick={() => setShowFilters(true)} color={T.violet} small>
            <SlidersHorizontal size={16} />
          </RoundBtn>
          <RoundBtn onClick={() => advance("like")} color={T.rose} big><Heart size={26} fill={T.rose} /></RoundBtn>
          <RoundBtn onClick={() => advance("like")} color={T.amber} small><Star size={16} fill={T.amber} /></RoundBtn>
        </div>
      )}

      {showDetail && current && (
        <CompatibilitySheet profile={current} onClose={() => setShowDetail(false)} />
      )}
      {showFilters && (
        <FiltersSheet
          filters={filters}
          onClose={() => setShowFilters(false)}
          onApply={(f) => {
            setFilters(f);
            setDeck(applyFilters([...source].sort(() => 0.5 - Math.random()), f));
            setShowFilters(false);
          }}
        />
      )}
      </>
      )}
    </div>
  );
}

function FiltersSheet({ filters, onClose, onApply }) {
  const [local, setLocal] = useState(filters);
  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 72, display: "flex", alignItems: "flex-end", justifyContent: "center" }}>
      <div onClick={onClose} style={{ position: "absolute", inset: 0, background: "rgba(10,8,14,0.72)" }} />
      <div className="pop-in" style={{
        position: "relative", width: "100%", maxWidth: 460, background: T.surface, borderTopLeftRadius: 28,
        borderTopRightRadius: 28, padding: "22px 22px 32px", border: `1px solid ${T.border}`
      }}>
        <div style={{ width: 40, height: 4, background: T.border, borderRadius: 4, margin: "0 auto 18px" }} />
        <h3 style={{ ...displayFont, fontSize: 19, margin: "0 0 18px", display: "flex", alignItems: "center", gap: 8 }}>
          <SlidersHorizontal size={17} /> Filters
        </h3>

        <p style={{ fontSize: 12.5, color: T.muted, marginBottom: 8, display: "flex", justifyContent: "space-between" }}>
          <span>Maximum distance</span><span style={{ ...monoFont, color: T.text }}>{local.maxDistance} km</span>
        </p>
        <input
          type="range" min="1" max="15" value={local.maxDistance}
          onChange={(e) => setLocal((l) => ({ ...l, maxDistance: Number(e.target.value) }))}
          style={{ width: "100%", marginBottom: 18, accentColor: T.rose }}
        />

        <p style={{ fontWeight: 700, fontSize: 13, marginBottom: 8, color: T.muted }}>LOOKING FOR</p>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 18 }}>
          <Chip label="Any" active={!local.intention} onClick={() => setLocal((l) => ({ ...l, intention: null }))} />
          {INTENTIONS.map((i) => (
            <Chip key={i} label={i} active={local.intention === i} onClick={() => setLocal((l) => ({ ...l, intention: i }))} />
          ))}
        </div>

        <SettingRow icon={<BadgeCheck size={16} />} label="Verified profiles only" active={local.verifiedOnly} onClick={() => setLocal((l) => ({ ...l, verifiedOnly: !l.verifiedOnly }))} />

        <button onClick={() => onApply(local)} style={{ ...primaryBtn, width: "100%", marginTop: 20 }}>Apply filters</button>
      </div>
    </div>
  );
}

/* ------------------------------ MAP VIEW ------------------------------ */
function pseudoPos(id, salt = 0) {
  const x = ((id * 53 + salt * 17) % 86) + 7;
  const y = ((id * 31 + salt * 11) % 74) + 10;
  return { x, y };
}

function MapView({ profiles, onLike }) {
  const [layer, setLayer] = useState("people");
  const [selected, setSelected] = useState(null);
  const list = layer === "people" ? profiles.slice(0, 12) : EVENTS;

  return (
    <div className="fade-up" style={{ marginTop: 4 }}>
      <div style={{ display: "flex", gap: 8, marginBottom: 10 }}>
        {[["people", "👤 People"], ["events", "🎉 Events"]].map(([k, l]) => (
          <button key={k} onClick={() => { setLayer(k); setSelected(null); }} style={{
            padding: "7px 14px", borderRadius: 999, fontSize: 12.5, cursor: "pointer", fontWeight: 600,
            border: `1px solid ${layer === k ? T.rose : T.border}`,
            background: layer === k ? `${T.rose}22` : T.surface2, color: layer === k ? "#fff" : T.muted,
          }}>{l}</button>
        ))}
      </div>

      <div style={{
        position: "relative", height: 440, borderRadius: 24, overflow: "hidden", border: `1px solid ${T.border}`,
        background: `
          radial-gradient(circle at 30% 20%, rgba(255,85,115,0.10), transparent 40%),
          radial-gradient(circle at 75% 65%, rgba(139,107,255,0.14), transparent 45%),
          linear-gradient(160deg, #221C2E 0%, #17131F 100%)
        `,
      }}>
        {/* decorative street grid */}
        <svg width="100%" height="100%" style={{ position: "absolute", inset: 0, opacity: 0.35 }}>
          {Array.from({ length: 7 }).map((_, i) => (
            <line key={`h${i}`} x1="0" y1={`${(i + 1) * 12.5}%`} x2="100%" y2={`${(i + 1) * 12.5}%`} stroke={T.border} strokeWidth="1" />
          ))}
          {Array.from({ length: 6 }).map((_, i) => (
            <line key={`v${i}`} x1={`${(i + 1) * 14}%`} y1="0" x2={`${(i + 1) * 14}%`} y2="100%" stroke={T.border} strokeWidth="1" />
          ))}
        </svg>

        {/* approximate-location rings around "you" — never an exact pin */}
        <div style={{ position: "absolute", left: "50%", top: "50%", transform: "translate(-50%,-50%)" }}>
          {[110, 75, 40].map((s, i) => (
            <div key={i} style={{
              position: "absolute", left: "50%", top: "50%", width: s, height: s, borderRadius: "50%",
              transform: "translate(-50%,-50%)", border: `1px solid ${T.rose}55`, background: i === 2 ? `${T.rose}22` : "transparent",
            }} />
          ))}
          <div style={{
            position: "absolute", left: "50%", top: "50%", width: 12, height: 12, borderRadius: "50%",
            transform: "translate(-50%,-50%)", background: T.rose, border: `2px solid ${T.ink}`, boxShadow: `0 0 0 4px ${T.rose}33`
          }} />
          <span style={{
            position: "absolute", left: "50%", top: "calc(50% + 14px)", transform: "translateX(-50%)",
            fontSize: 10, color: T.muted, whiteSpace: "nowrap", ...monoFont
          }}>YOU (approximate)</span>
        </div>

        {layer === "people" && list.map((p) => {
          const pos = pseudoPos(p.id);
          return (
            <button key={p.id} onClick={() => setSelected(p)} style={{
              position: "absolute", left: `${pos.x}%`, top: `${pos.y}%`, transform: "translate(-50%,-50%)",
              border: "none", background: "none", cursor: "pointer", padding: 0,
            }}>
              <div style={{
                width: 38, height: 38, borderRadius: "50%", overflow: "hidden",
                border: `2px solid ${selected?.id === p.id ? T.amber : T.rose}`, boxShadow: "0 4px 10px rgba(0,0,0,0.4)",
              }}>
                <img src={p.photo} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
              </div>
            </button>
          );
        })}

        {layer === "events" && list.map((e, i) => {
          const pos = pseudoPos(e.id, 40);
          return (
            <button key={e.id} onClick={() => setSelected(e)} style={{
              position: "absolute", left: `${pos.x}%`, top: `${pos.y}%`, transform: "translate(-50%,-100%)",
              border: "none", background: "none", cursor: "pointer", padding: 0, display: "flex", flexDirection: "column", alignItems: "center"
            }}>
              <div style={{
                width: 30, height: 30, borderRadius: "50% 50% 50% 0", transform: "rotate(45deg)",
                background: T.violet, border: `2px solid ${T.ink}`, display: "flex", alignItems: "center", justifyContent: "center",
                boxShadow: "0 4px 10px rgba(0,0,0,0.4)"
              }}>
                <Calendar size={13} color="#fff" style={{ transform: "rotate(-45deg)" }} />
              </div>
            </button>
          );
        })}

        {selected && (
          <div className="pop-in" style={{
            position: "absolute", left: 12, right: 12, bottom: 12, background: T.surface, border: `1px solid ${T.border}`,
            borderRadius: 18, padding: 14, display: "flex", gap: 12, alignItems: "center"
          }}>
            {layer === "people" ? (
              <>
                <img src={selected.photo} style={{ width: 52, height: 52, borderRadius: 14, objectFit: "cover" }} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <p style={{ fontWeight: 700, fontSize: 13.5, margin: 0 }}>{selected.name}, {selected.age}</p>
                  <p style={{ fontSize: 11.5, color: T.muted, margin: "2px 0 0" }}>~{selected.distance} km away · {selected.match}% match</p>
                </div>
                <button onClick={() => { onLike(selected); setSelected(null); }} style={{
                  width: 40, height: 40, borderRadius: "50%", border: "none", cursor: "pointer",
                  background: `linear-gradient(135deg, ${T.rose}, #FF7A63)`, color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0
                }}><Heart size={17} /></button>
              </>
            ) : (
              <>
                <img src={selected.cover} style={{ width: 52, height: 52, borderRadius: 14, objectFit: "cover" }} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <p style={{ fontWeight: 700, fontSize: 13.5, margin: 0 }}>{selected.title}</p>
                  <p style={{ fontSize: 11.5, color: T.muted, margin: "2px 0 0" }}>{selected.date} · {selected.going} going</p>
                </div>
              </>
            )}
            <button onClick={() => setSelected(null)} style={{ background: "none", border: "none", color: T.mutedDim, cursor: "pointer", flexShrink: 0 }}>
              <X size={16} />
            </button>
          </div>
        )}
      </div>

      <p style={{ fontSize: 11, color: T.mutedDim, marginTop: 10, display: "flex", alignItems: "center", gap: 6 }}>
        <Shield size={12} /> Exact locations are never shown — only approximate distance.
      </p>
    </div>
  );
}

function RoundBtn({ children, onClick, color, big, small }) {
  const size = big ? 66 : small ? 44 : 56;
  return (
    <button onClick={onClick} style={{
      width: size, height: size, borderRadius: "50%", border: `1px solid ${T.border}`, background: T.surface,
      color, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer",
      boxShadow: `0 8px 20px -8px ${color}66`,
    }}>{children}</button>
  );
}

function CompatibilitySheet({ profile, onClose }) {
  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 70, display: "flex", alignItems: "flex-end", justifyContent: "center" }}>
      <div onClick={onClose} style={{ position: "absolute", inset: 0, background: "rgba(10,8,14,0.72)" }} />
      <div className="pop-in" style={{
        position: "relative", width: "100%", maxWidth: 460, maxHeight: "82%", overflowY: "auto",
        background: T.surface, borderTopLeftRadius: 28, borderTopRightRadius: 28, padding: "22px 22px 32px",
        border: `1px solid ${T.border}`
      }}>
        <div style={{ width: 40, height: 4, background: T.border, borderRadius: 4, margin: "0 auto 18px" }} />
        <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 18 }}>
          <MatchRing percent={profile.match} size={72} />
          <div>
            <h3 style={{ ...displayFont, fontSize: 22, margin: 0 }}>{profile.match}% MATCH 🔥</h3>
            <p style={{ color: T.muted, fontSize: 12.5, margin: "2px 0 0" }}>with {profile.name}</p>
          </div>
        </div>

        {Object.entries(profile.breakdown).map(([k, v]) => (
          <div key={k} style={{ marginBottom: 10 }}>
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12.5, marginBottom: 4 }}>
              <span style={{ color: T.muted }}>{k}</span>
              <span style={{ ...monoFont, fontWeight: 600 }}>{v}%</span>
            </div>
            <div style={{ height: 6, borderRadius: 6, background: T.surface2, overflow: "hidden" }}>
              <div style={{ width: `${v}%`, height: "100%", background: `linear-gradient(90deg, ${T.rose}, ${T.amber})`, borderRadius: 6 }} />
            </div>
          </div>
        ))}

        <p style={{ fontWeight: 700, fontSize: 13.5, marginTop: 18, marginBottom: 8 }}>Why you match</p>
        {profile.why.map((w, i) => (
          <p key={i} style={{ fontSize: 13, color: T.text, margin: "4px 0", display: "flex", gap: 8 }}>
            <Check size={15} color={T.mint} style={{ flexShrink: 0, marginTop: 1 }} /> {w}
          </p>
        ))}

        <p style={{ fontWeight: 700, fontSize: 13.5, marginTop: 16, marginBottom: 8 }}>Potential differences</p>
        {profile.diffs.map((d, i) => (
          <p key={i} style={{ fontSize: 13, color: T.muted, margin: "4px 0", display: "flex", gap: 8 }}>
            <span style={{ flexShrink: 0 }}>•</span> {d}
          </p>
        ))}

        <button onClick={onClose} style={{ ...primaryBtn, width: "100%", marginTop: 20 }}>Close</button>
      </div>
    </div>
  );
}

/* ------------------------------ MATCH OVERLAY ------------------------------ */
function MatchOverlay({ profile, onClose, onMessage }) {
  const [phase, setPhase] = useState("ignite"); // ignite | reveal
  const [flash, setFlash] = useState(false);
  const IGNITE_DELAY = 700;
  const SPECTACLE_TOTAL = 6000;

  const handleIgnite = () => {
    setFlash(true);
    setTimeout(() => setFlash(false), 650);
  };

  useEffect(() => {
    const t = setTimeout(() => setPhase("reveal"), SPECTACLE_TOTAL);
    return () => clearTimeout(t);
  }, []); // eslint-disable-line

  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 80, display: "flex", alignItems: phase === "reveal" ? "flex-start" : "center", justifyContent: "center", overflow: "hidden" }}>
      <div style={{ position: "absolute", inset: 0, background: `radial-gradient(circle at 50% 40%, #3A2050 0%, rgba(10,8,14,0.95) 70%)` }} />

      {flash && (
        <div style={{
          position: "absolute", inset: 0, zIndex: 2, pointerEvents: "none",
          background: `radial-gradient(circle at 50% 42%, #FFE9B0 0%, ${T.amber} 35%, ${T.rose} 55%, transparent 72%)`,
          animation: "flashPop 0.6s ease-out forwards",
        }} />
      )}

      {phase === "reveal" && ["10%", "25%", "70%", "85%", "45%", "60%"].map((l, i) => (
        <span key={i} style={{
          position: "absolute", left: l, bottom: 40, fontSize: 22, zIndex: 1,
          animation: `heartFloat ${2 + (i % 3)}s ${i * 0.25}s infinite ease-in`
        }}>❤️</span>
      ))}

      {phase === "ignite" && (
        <div style={{
          position: "relative", zIndex: 3, display: "flex", flexDirection: "column", alignItems: "center", gap: 22,
          animation: `ignitePopOut 0.35s ease ${SPECTACLE_TOTAL - 350}ms both`
        }}>
          <p style={{
            ...displayFont, fontSize: 46, fontWeight: 700, margin: 0, letterSpacing: 1,
            background: `linear-gradient(90deg, ${T.rose}, ${T.amber})`, WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent",
            animation: `matchTextPop 0.55s cubic-bezier(.22,.9,.3,1.3) ${IGNITE_DELAY + 220}ms both`,
          }}>MATCH!</p>
          <IgnitingMatch size={96} delay={IGNITE_DELAY} onIgnite={handleIgnite} />
        </div>
      )}

      {phase === "reveal" && (
        <div className="pop-in" style={{ position: "relative", zIndex: 3, textAlign: "center", padding: "56px 24px 24px", width: "100%", maxWidth: 380 }}>
          <h2 style={{ ...displayFont, fontSize: 34, margin: "0 0 32px", lineHeight: 1.15 }}>You and {profile.name}<br />liked each other</h2>
          <div style={{ display: "flex", justifyContent: "center", marginBottom: 52 }}>
            <div style={{ position: "relative", width: 150, height: 84 }}>
              <img src={DEMO_USER.photo} style={{ position: "absolute", left: 0, width: 84, height: 84, borderRadius: "50%", border: `3px solid ${T.ink}`, objectFit: "cover", animation: "matchPulse .6s ease" }} />
              <img src={profile.photo} style={{ position: "absolute", right: 0, width: 84, height: 84, borderRadius: "50%", border: `3px solid ${T.ink}`, objectFit: "cover", animation: "matchPulse .6s .1s ease both" }} />
              <div style={{ position: "absolute", top: "50%", left: "50%", transform: "translate(-50%, -62%)", zIndex: 2 }} className="pop-in">
                <IgnitingMatch size={30} delay={80} steady />
              </div>
            </div>
          </div>
          <button onClick={onMessage} style={{ ...primaryBtn, width: "100%", marginBottom: 10 }}>Start the conversation</button>
          <button onClick={onClose} style={{ background: "none", border: "none", color: T.muted, fontSize: 13.5, cursor: "pointer" }}>Keep discovering</button>
        </div>
      )}
    </div>
  );
}

/* ------------------------------ MATCHES TAB ------------------------------ */
function MatchesTab({ profiles, onOpen }) {
  return (
    <div className="fade-up" style={{ paddingTop: 16 }}>
      <h2 style={{ ...displayFont, fontSize: 22, margin: "0 0 4px" }}>Your Matches</h2>
      <p style={{ color: T.muted, fontSize: 13, marginBottom: 18 }}>{profiles.length} people matched with you</p>
      {profiles.length === 0 && <EmptyState text="No matches yet — keep discovering!" />}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
        {profiles.map((p) => (
          <button key={p.id} onClick={() => onOpen(p.id)} style={{
            border: `1px solid ${T.border}`, background: T.surface, borderRadius: 18, overflow: "hidden",
            cursor: "pointer", padding: 0, textAlign: "left"
          }}>
            <div style={{ position: "relative", height: 140 }}>
              <img src={p.photo} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
              {p.online && <span style={{ position: "absolute", top: 8, left: 8, width: 9, height: 9, borderRadius: "50%", background: T.mint, border: `2px solid ${T.surface}` }} />}
              <div style={{ position: "absolute", bottom: 6, right: 6, background: "rgba(20,16,26,0.75)", borderRadius: 10, padding: "2px 7px", ...monoFont, fontSize: 10.5 }}>{p.match}%</div>
            </div>
            <div style={{ padding: "9px 11px" }}>
              <p style={{ fontSize: 13, fontWeight: 700, margin: 0 }}>{p.name}, {p.age}</p>
              <p style={{ fontSize: 11, color: T.muted, margin: "2px 0 0" }}>Say hi 👋</p>
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}

/* ------------------------------ MESSAGES TAB ------------------------------ */
function MessagesTab({ profiles, onOpen }) {
  return (
    <div className="fade-up" style={{ paddingTop: 16 }}>
      <h2 style={{ ...displayFont, fontSize: 22, margin: "0 0 16px" }}>Messages</h2>
      {profiles.length === 0 && <EmptyState text="Match with someone to start chatting." />}
      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        {profiles.map((p, i) => (
          <button key={p.id} onClick={() => onOpen(p.id)} style={{
            display: "flex", alignItems: "center", gap: 12, padding: "10px 6px", border: "none",
            background: "none", cursor: "pointer", textAlign: "left", borderBottom: i < profiles.length - 1 ? `1px solid ${T.border}` : "none"
          }}>
            <div style={{ position: "relative" }}>
              <img src={p.photo} style={{ width: 52, height: 52, borderRadius: "50%", objectFit: "cover" }} />
              {p.online && <span style={{ position: "absolute", bottom: 1, right: 1, width: 11, height: 11, borderRadius: "50%", background: T.mint, border: `2px solid ${T.ink}` }} />}
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: "flex", justifyContent: "space-between" }}>
                <span style={{ fontWeight: 700, fontSize: 14.5 }}>{p.name}</span>
                <span style={{ fontSize: 11, color: T.mutedDim }}>{i === 0 ? "now" : `${i}h`}</span>
              </div>
              <p style={{ fontSize: 12.5, color: T.muted, margin: "2px 0 0", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                {CHAT_PREVIEWS[i % CHAT_PREVIEWS.length]}
              </p>
            </div>
            {i < 2 && <span style={{ width: 9, height: 9, borderRadius: "50%", background: T.rose }} />}
          </button>
        ))}
      </div>
    </div>
  );
}
const CHAT_PREVIEWS = [
  "Haha okay you have to tell me more about that 😂",
  "Sushi this weekend? I know a great spot",
  "That playlist you sent is actually so good",
  "What time works for you on Friday?",
];

/* ------------------------------ CHAT VIEW ------------------------------ */
function ChatView({ profile, onBack }) {
  const [messages, setMessages] = useState(() => ([
    { from: "them", text: `Hey! I saw we're both into ${profile.tags[0]?.toLowerCase()} 🎵` },
    { from: "me", text: "Right?! Been obsessed lately, what have you been listening to?" },
    { from: "them", text: CHAT_PREVIEWS[profile.id % CHAT_PREVIEWS.length] },
  ]));
  const [input, setInput] = useState("");
  const endRef = useRef(null);

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages]);

  const [typing, setTyping] = useState(false);

  const send = () => {
    if (!input.trim()) return;
    setMessages((m) => [...m, { from: "me", text: input }]);
    setInput("");
    setTyping(true);
    setTimeout(() => {
      setTyping(false);
      setMessages((m) => [...m, { from: "them", text: "That's really sweet, tell me more 😊" }]);
    }, 1100);
  };

  const sendImage = () => {
    setMessages((m) => [...m, { from: "me", type: "image", image: avatar(((profile.id * 5) % 70) + 1, 400) }]);
  };
  const sendVoice = () => {
    setMessages((m) => [...m, { from: "me", type: "voice", duration: `0:${rnd(8, 34).toString().padStart(2, "0")}` }]);
  };

  const icebreakers = [
    `Ask ${profile.name} about her love of ${profile.tags[3]?.toLowerCase() || "travel"}.`,
    `You both picked ${profile.intention.toLowerCase()} — ask what that looks like for them.`,
  ];

  return (
    <div className="fade-up" style={{ display: "flex", flexDirection: "column", height: 640, marginTop: -6 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 4px", borderBottom: `1px solid ${T.border}` }}>
        <IconBtn onClick={onBack}><ArrowLeft size={17} /></IconBtn>
        <img src={profile.photo} style={{ width: 38, height: 38, borderRadius: "50%", objectFit: "cover" }} />
        <div style={{ flex: 1 }}>
          <p style={{ fontWeight: 700, fontSize: 14, margin: 0 }}>{profile.name}</p>
          <p style={{ fontSize: 11, color: profile.online ? T.mint : T.mutedDim, margin: 0 }}>{profile.online ? "Online now" : "Active recently"}</p>
        </div>
        <span style={{ ...monoFont, fontSize: 11, background: T.surface2, padding: "3px 8px", borderRadius: 999 }}>{profile.match}% 🔥</span>
      </div>

      <div style={{ padding: "12px 4px", background: T.surface, border: `1px solid ${T.border}`, borderRadius: 16, margin: "12px 4px" }}>
        <p style={{ ...monoFont, fontSize: 10, color: T.amber, letterSpacing: 1, padding: "0 10px", marginBottom: 6 }}>QUESTIONS YOU HAVE IN COMMON</p>
        {icebreakers.map((q, i) => (
          <button key={i} onClick={() => setInput(q)} style={{
            display: "block", width: "100%", textAlign: "left", background: "none", border: "none", cursor: "pointer",
            padding: "6px 10px", fontSize: 12.5, color: T.text,
          }}>💬 {q}</button>
        ))}
      </div>

      <div style={{ flex: 1, overflowY: "auto", padding: "6px 4px", display: "flex", flexDirection: "column", gap: 8 }}>
        {messages.map((m, i) => (
          <div key={i} style={{
            alignSelf: m.from === "me" ? "flex-end" : "flex-start", maxWidth: "78%",
            background: m.type ? "transparent" : (m.from === "me" ? `linear-gradient(135deg, ${T.rose}, #FF7A63)` : T.surface2),
            color: m.from === "me" ? "#fff" : T.text,
            padding: m.type ? 0 : "10px 14px", borderRadius: 18,
            borderBottomRightRadius: m.from === "me" ? 4 : 18, borderBottomLeftRadius: m.from === "me" ? 18 : 4,
            fontSize: 13.5, overflow: "hidden",
          }}>
            {m.type === "image" && <img src={m.image} style={{ width: 180, height: 180, objectFit: "cover", borderRadius: 16, display: "block" }} />}
            {m.type === "voice" && (
              <div style={{
                display: "flex", alignItems: "center", gap: 8, padding: "10px 14px", borderRadius: 18,
                background: m.from === "me" ? `linear-gradient(135deg, ${T.rose}, #FF7A63)` : T.surface2,
              }}>
                <div style={{
                  width: 26, height: 26, borderRadius: "50%", background: "rgba(255,255,255,0.25)",
                  display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0
                }}><Play size={12} fill="currentColor" /></div>
                <div style={{ display: "flex", alignItems: "center", gap: 2 }}>
                  {Array.from({ length: 16 }).map((_, bi) => (
                    <span key={bi} style={{ width: 2, height: 4 + ((bi * 7) % 14), background: "currentColor", opacity: 0.7, borderRadius: 2 }} />
                  ))}
                </div>
                <span style={{ ...monoFont, fontSize: 10.5, opacity: 0.85 }}>{m.duration}</span>
              </div>
            )}
            {!m.type && m.text}
          </div>
        ))}
        {typing && (
          <div style={{ alignSelf: "flex-start", background: T.surface2, padding: "12px 16px", borderRadius: 18, borderBottomLeftRadius: 4, display: "flex", gap: 4 }}>
            {[0, 1, 2].map((d) => (
              <span key={d} style={{
                width: 6, height: 6, borderRadius: "50%", background: T.muted,
                animation: `flameFlicker 1s ${d * 0.15}s ease-in-out infinite`
              }} />
            ))}
          </div>
        )}
        <div ref={endRef} />
      </div>

      <div style={{ display: "flex", gap: 8, padding: "10px 4px 0", alignItems: "center" }}>
        <IconBtn onClick={sendImage}><ImageIcon size={16} /></IconBtn>
        <IconBtn onClick={sendVoice}><Mic size={16} /></IconBtn>
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && send()}
          placeholder="Type a message…"
          style={{ flex: 1, padding: "12px 16px", borderRadius: 999, border: `1px solid ${T.border}`, background: T.surface2, color: T.text, outline: "none", fontSize: 13.5, ...bodyFont }}
        />
        <button onClick={send} style={{
          width: 42, height: 42, borderRadius: "50%", border: "none", background: `linear-gradient(135deg, ${T.rose}, #FF7A63)`,
          color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", flexShrink: 0
        }}><Send size={16} /></button>
      </div>
    </div>
  );
}

/* ------------------------------ SOCIAL TAB ------------------------------ */
const STORY_USERS = PROFILES.slice(0, 8).map((p, i) => ({
  ...p,
  frames: [
    { type: "photo", image: avatar(((p.id * 9) % 70) + 1, 600), caption: `${INTEREST_META[p.tags[0]]?.icon || "✨"} ${p.tags[0]} kind of night` },
    i % 2 === 0
      ? { type: "question", question: "Ask me anything about my last trip ✈️", bg: [T.violet, T.rose] }
      : { type: "poll", question: `${p.tags[1] || "Sushi"} or ${p.tags[2] || "Pizza"} tonight?`, options: [p.tags[1] || "Sushi", p.tags[2] || "Pizza"], bg: [T.amber, T.rose] },
  ],
}));

const POSTS = [
  { id: 1, user: PROFILES[2], type: "text", content: "Unpopular opinion: pineapple absolutely belongs on pizza. Fight me. 🍍", likes: 128, comments: 34 },
  { id: 2, user: PROFILES[5], type: "photo", content: "Sunday hike views hit different 🥾", image: avatar(35, 500), likes: 342, comments: 21 },
  { id: 3, user: PROFILES[9], type: "poll", content: "First date: coffee or drinks?", options: ["Coffee ☕", "Drinks 🍸"], votes: [62, 38], likes: 88, comments: 47 },
  { id: 4, user: PROFILES[1], type: "photo", content: "Found the best ramen spot in the city, coming to fight me about it", image: avatar(52, 500), likes: 210, comments: 15 },
  { id: 5, user: PROFILES[13], type: "question", content: "What's a song that instantly puts you in a good mood?", likes: 154, comments: 62 },
];

function SocialTab({ user, showToast }) {
  const [feedMode, setFeedMode] = useState("For You");
  const [likes, setLikes] = useState({});
  const [saves, setSaves] = useState({});
  const [voted, setVoted] = useState({});
  const [storyIndex, setStoryIndex] = useState(null);
  const [myStory, setMyStory] = useState(null);
  const [showCreateStory, setShowCreateStory] = useState(false);
  const [seenStories, setSeenStories] = useState([]);
  const [postMenuId, setPostMenuId] = useState(null);
  const [commentsPostId, setCommentsPostId] = useState(null);

  const toggleLike = (id) => setLikes((l) => ({ ...l, [id]: !l[id] }));
  const toggleSave = (id) => {
    setSaves((s) => ({ ...s, [id]: !s[id] }));
    showToast(saves[id] ? "Removed from saved" : "Saved post 🔖");
  };

  const allStoryUsers = myStory ? [{ ...myStory, id: "me", name: "You" }, ...STORY_USERS] : STORY_USERS;

  return (
    <div className="fade-up" style={{ paddingTop: 14 }}>
      <div style={{ display: "flex", gap: 16, overflowX: "auto", marginBottom: 14 }} className="no-scrollbar">
        <button
          onClick={() => (myStory ? setStoryIndex(0) : setShowCreateStory(true))}
          style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 4, flexShrink: 0, background: "none", border: "none", cursor: "pointer" }}
        >
          <div style={{ position: "relative", width: 56, height: 56 }}>
            <img src={user.photo} style={{
              width: 56, height: 56, borderRadius: "50%", objectFit: "cover",
              border: `2px ${myStory ? "solid " + T.mint : "dashed " + T.border}`, padding: 2
            }} />
            {!myStory && (
              <div style={{
                position: "absolute", bottom: -2, right: -2, width: 18, height: 18, borderRadius: "50%",
                background: T.rose, display: "flex", alignItems: "center", justifyContent: "center", border: `2px solid ${T.ink}`
              }}><Plus size={11} color="#fff" /></div>
            )}
          </div>
          <span style={{ fontSize: 10, color: T.muted }}>Your story</span>
        </button>
        {STORY_USERS.map((p, i) => (
          <button key={p.id} onClick={() => setStoryIndex(i + (myStory ? 1 : 0))} style={{
            display: "flex", flexDirection: "column", alignItems: "center", gap: 4, flexShrink: 0,
            background: "none", border: "none", cursor: "pointer"
          }}>
            <div style={{
              width: 56, height: 56, borderRadius: "50%", padding: 2,
              background: seenStories.includes(p.id) ? T.surface3 : `conic-gradient(${T.rose}, ${T.amber}, ${T.violet}, ${T.rose})`
            }}>
              <img src={p.photo} style={{ width: "100%", height: "100%", borderRadius: "50%", objectFit: "cover", border: `2px solid ${T.ink}` }} />
            </div>
            <span style={{ fontSize: 10, color: T.muted }}>{p.name}</span>
          </button>
        ))}
      </div>

      {storyIndex !== null && (
        <StoryViewer
          users={allStoryUsers}
          startIndex={storyIndex}
          onClose={() => setStoryIndex(null)}
          onViewed={(id) => setSeenStories((s) => (s.includes(id) ? s : [...s, id]))}
          showToast={showToast}
        />
      )}

      {showCreateStory && (
        <CreateStorySheet
          onClose={() => setShowCreateStory(false)}
          onCreate={(frame) => {
            setMyStory({ photo: user.photo, frames: [frame] });
            setShowCreateStory(false);
            showToast("Your story is live for 24h ✨");
          }}
        />
      )}

      <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
        {["Following", "For You", "Trending"].map((m) => (
          <button key={m} onClick={() => setFeedMode(m)} style={{
            padding: "7px 14px", borderRadius: 999, fontSize: 12.5, cursor: "pointer", fontWeight: 600,
            border: `1px solid ${feedMode === m ? T.rose : T.border}`,
            background: feedMode === m ? `${T.rose}22` : "transparent", color: feedMode === m ? "#fff" : T.muted,
          }}>{m}</button>
        ))}
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        {POSTS.map((p) => (
          <div key={p.id} style={{ background: T.surface, border: `1px solid ${T.border}`, borderRadius: 20, overflow: "hidden" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "12px 14px", position: "relative" }}>
              <img src={p.user.photo} style={{ width: 36, height: 36, borderRadius: "50%", objectFit: "cover" }} />
              <div style={{ flex: 1 }}>
                <p style={{ fontSize: 13, fontWeight: 700, margin: 0 }}>{p.user.name}</p>
                <p style={{ fontSize: 10.5, color: T.mutedDim, margin: 0 }}>{p.user.city} · 2h</p>
              </div>
              <button onClick={() => setPostMenuId(postMenuId === p.id ? null : p.id)} style={{ background: "none", border: "none", cursor: "pointer", padding: 4 }}>
                <MoreHorizontal size={16} color={T.mutedDim} />
              </button>
              {postMenuId === p.id && (
                <div style={{
                  position: "absolute", top: 40, right: 12, background: T.surface3, border: `1px solid ${T.border}`,
                  borderRadius: 14, overflow: "hidden", zIndex: 10, minWidth: 160
                }} className="pop-in">
                  {[
                    { label: "Hide post", fn: () => showToast("Post hidden") },
                    { label: "Report post", fn: () => showToast("Report submitted") },
                    { label: "Copy link", fn: () => showToast("Link copied") },
                  ].map((opt) => (
                    <button key={opt.label} onClick={() => { opt.fn(); setPostMenuId(null); }} style={{
                      display: "block", width: "100%", textAlign: "left", padding: "10px 14px", fontSize: 12.5,
                      background: "none", border: "none", color: T.text, cursor: "pointer"
                    }}>{opt.label}</button>
                  ))}
                </div>
              )}
            </div>
            <p style={{ padding: "0 14px 10px", fontSize: 13.5, margin: 0, lineHeight: 1.45 }}>{p.content}</p>
            {p.type === "photo" && <img src={p.image} style={{ width: "100%", maxHeight: 260, objectFit: "cover" }} />}
            {p.type === "poll" && (
              <div style={{ padding: "0 14px 12px", display: "flex", flexDirection: "column", gap: 8 }}>
                {p.options.map((o, i) => (
                  <button key={o} onClick={() => setVoted((v) => ({ ...v, [p.id]: i }))} style={{
                    position: "relative", textAlign: "left", padding: "10px 14px", borderRadius: 12, cursor: "pointer",
                    border: `1px solid ${T.border}`, background: T.surface2, overflow: "hidden", color: T.text, fontSize: 13
                  }}>
                    {voted[p.id] !== undefined && (
                      <div style={{ position: "absolute", inset: 0, width: `${p.votes[i]}%`, background: `${T.rose}33`, zIndex: 0 }} />
                    )}
                    <span style={{ position: "relative", zIndex: 1, display: "flex", justifyContent: "space-between" }}>
                      {o} {voted[p.id] !== undefined && <span style={{ ...monoFont }}>{p.votes[i]}%</span>}
                    </span>
                  </button>
                ))}
              </div>
            )}
            <div style={{ display: "flex", alignItems: "center", gap: 18, padding: "10px 14px", borderTop: `1px solid ${T.border}` }}>
              <button onClick={() => toggleLike(p.id)} style={iconRow}>
                <Heart size={17} color={likes[p.id] ? T.rose : T.muted} fill={likes[p.id] ? T.rose : "none"} />
                <span style={{ fontSize: 12, color: T.muted }}>{p.likes + (likes[p.id] ? 1 : 0)}</span>
              </button>
              <button onClick={() => setCommentsPostId(p.id)} style={iconRow}><MessageCircle size={17} color={T.muted} /><span style={{ fontSize: 12, color: T.muted }}>{p.comments}</span></button>
              <button onClick={() => showToast("Shared!")} style={iconRow}><Share2 size={16} color={T.muted} /></button>
              <div style={{ flex: 1 }} />
              <button onClick={() => toggleSave(p.id)} style={iconRow}><Bookmark size={16} color={saves[p.id] ? T.amber : T.muted} fill={saves[p.id] ? T.amber : "none"} /></button>
            </div>
          </div>
        ))}
      </div>
      {commentsPostId !== null && (
        <CommentsSheet post={POSTS.find((p) => p.id === commentsPostId)} onClose={() => setCommentsPostId(null)} showToast={showToast} />
      )}
    </div>
  );
}
const iconRow = { display: "flex", alignItems: "center", gap: 5, background: "none", border: "none", cursor: "pointer", padding: 0 };

function CommentsSheet({ post, onClose, showToast }) {
  const seed = [
    { user: PROFILES[(post.id * 3) % 20], text: "This is so real 😂" },
    { user: PROFILES[(post.id * 3 + 1) % 20], text: "Okay I need the details" },
    { user: PROFILES[(post.id * 3 + 2) % 20], text: "Same energy honestly" },
  ];
  const [comments, setComments] = useState(seed);
  const [input, setInput] = useState("");
  const add = () => {
    if (!input.trim()) return;
    setComments((c) => [...c, { user: { name: "You", photo: DEMO_USER.photo }, text: input }]);
    setInput("");
  };
  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 74, display: "flex", alignItems: "flex-end", justifyContent: "center" }}>
      <div onClick={onClose} style={{ position: "absolute", inset: 0, background: "rgba(10,8,14,0.72)" }} />
      <div className="pop-in" style={{
        position: "relative", width: "100%", maxWidth: 460, height: "70%", display: "flex", flexDirection: "column",
        background: T.surface, borderTopLeftRadius: 28, borderTopRightRadius: 28, padding: "18px 18px 20px", border: `1px solid ${T.border}`
      }}>
        <div style={{ width: 40, height: 4, background: T.border, borderRadius: 4, margin: "0 auto 14px" }} />
        <h3 style={{ ...displayFont, fontSize: 17, margin: "0 0 14px", textAlign: "center" }}>Comments</h3>
        <div style={{ flex: 1, overflowY: "auto", display: "flex", flexDirection: "column", gap: 12 }}>
          {comments.map((c, i) => (
            <div key={i} style={{ display: "flex", gap: 10 }}>
              <img src={c.user.photo} style={{ width: 30, height: 30, borderRadius: "50%", objectFit: "cover", flexShrink: 0 }} />
              <div>
                <p style={{ fontSize: 12.5, fontWeight: 700, margin: 0 }}>{c.user.name}</p>
                <p style={{ fontSize: 13, margin: "2px 0 0", color: T.text }}>{c.text}</p>
              </div>
            </div>
          ))}
        </div>
        <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && add()}
            placeholder="Add a comment…"
            style={{ flex: 1, padding: "12px 16px", borderRadius: 999, border: `1px solid ${T.border}`, background: T.surface2, color: T.text, outline: "none", fontSize: 13, ...bodyFont }}
          />
          <button onClick={add} style={{
            width: 40, height: 40, borderRadius: "50%", border: "none", background: `linear-gradient(135deg, ${T.rose}, #FF7A63)`,
            color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", flexShrink: 0
          }}><Send size={16} /></button>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------ STORY VIEWER ------------------------------ */
function StoryViewer({ users, startIndex, onClose, onViewed, showToast }) {
  const [userIdx, setUserIdx] = useState(startIndex);
  const [frameIdx, setFrameIdx] = useState(0);
  const [paused, setPaused] = useState(false);
  const [reply, setReply] = useState("");
  const [voted, setVoted] = useState(null);
  const DURATION = 4500;

  const user = users[userIdx];
  const frame = user?.frames?.[frameIdx];

  useEffect(() => { if (user) onViewed && onViewed(user.id); }, [userIdx]); // eslint-disable-line

  const nextFrame = () => {
    if (!user) return;
    if (frameIdx < user.frames.length - 1) { setFrameIdx((f) => f + 1); setVoted(null); }
    else if (userIdx < users.length - 1) { setUserIdx((u) => u + 1); setFrameIdx(0); setVoted(null); }
    else onClose();
  };
  const prevFrame = () => {
    if (frameIdx > 0) setFrameIdx((f) => f - 1);
    else if (userIdx > 0) { setUserIdx((u) => u - 1); setFrameIdx(0); }
    setVoted(null);
  };

  useEffect(() => {
    if (paused) return;
    const t = setTimeout(nextFrame, DURATION);
    return () => clearTimeout(t);
  }, [userIdx, frameIdx, paused]); // eslint-disable-line

  if (!user || !frame) return null;
  const bg = frame.bg ? `linear-gradient(135deg, ${frame.bg[0]}, ${frame.bg[1]})` : null;

  const sendReply = () => {
    if (!reply.trim()) return;
    showToast && showToast(`Reply sent to ${user.name} 💬`);
    setReply("");
  };

  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 90, background: "#000", display: "flex", justifyContent: "center" }}>
      <div style={{ width: "100%", maxWidth: 460, position: "relative", overflow: "hidden" }}>
        {frame.type === "photo" ? (
          <img src={frame.image} style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover" }} />
        ) : (
          <div style={{ position: "absolute", inset: 0, background: bg || T.surface2 }} />
        )}
        <div style={{ position: "absolute", inset: 0, background: "linear-gradient(to bottom, rgba(0,0,0,0.55), rgba(0,0,0,0.05) 25%, rgba(0,0,0,0.05) 65%, rgba(0,0,0,0.75))" }} />

        {/* progress bars */}
        <div style={{ position: "relative", display: "flex", gap: 4, padding: "12px 12px 0" }}>
          {user.frames.map((_, i) => (
            <div key={i} style={{ flex: 1, height: 3, borderRadius: 3, background: "rgba(255,255,255,0.3)", overflow: "hidden" }}>
              <div style={{
                height: "100%", background: "#fff", borderRadius: 3,
                width: i < frameIdx ? "100%" : i > frameIdx ? "0%" : undefined,
                animation: i === frameIdx && !paused ? `storyProgress ${DURATION}ms linear forwards` : undefined,
              }} />
            </div>
          ))}
        </div>

        <div style={{ position: "relative", display: "flex", alignItems: "center", gap: 10, padding: "10px 14px" }}>
          <img src={user.photo} style={{ width: 32, height: 32, borderRadius: "50%", objectFit: "cover", border: "1px solid rgba(255,255,255,0.5)" }} />
          <span style={{ color: "#fff", fontWeight: 700, fontSize: 13.5 }}>{user.name}</span>
          <span style={{ color: "rgba(255,255,255,0.7)", fontSize: 11 }}>2h</span>
          <div style={{ flex: 1 }} />
          <button onClick={onClose} style={{ background: "none", border: "none", color: "#fff", cursor: "pointer" }}><X size={20} /></button>
        </div>

        {/* tap zones */}
        <button onClick={prevFrame} onMouseDown={() => setPaused(true)} onMouseUp={() => setPaused(false)} style={{ position: "absolute", left: 0, top: 60, bottom: 90, width: "32%", background: "none", border: "none", cursor: "pointer" }} />
        <button onClick={nextFrame} onMouseDown={() => setPaused(true)} onMouseUp={() => setPaused(false)} style={{ position: "absolute", right: 0, top: 60, bottom: 90, width: "68%", background: "none", border: "none", cursor: "pointer" }} />

        <div style={{ position: "relative", minHeight: 560, display: "flex", flexDirection: "column", justifyContent: "flex-end", padding: "0 18px 22px", pointerEvents: "none" }}>
          {frame.type === "photo" && frame.caption && (
            <p style={{ color: "#fff", fontSize: 15, fontWeight: 600, marginBottom: 16, textShadow: "0 2px 8px rgba(0,0,0,0.5)" }}>{frame.caption}</p>
          )}
          {frame.type === "question" && (
            <div style={{ background: "rgba(0,0,0,0.28)", borderRadius: 18, padding: 18, marginBottom: 16, pointerEvents: "auto" }}>
              <p style={{ color: "#fff", fontSize: 16, fontWeight: 700, margin: 0, textAlign: "center" }}>{frame.question}</p>
            </div>
          )}
          {frame.type === "poll" && (
            <div style={{ marginBottom: 16, pointerEvents: "auto" }}>
              <p style={{ color: "#fff", fontSize: 16, fontWeight: 700, marginBottom: 12, textAlign: "center", textShadow: "0 2px 8px rgba(0,0,0,0.5)" }}>{frame.question}</p>
              <div style={{ display: "flex", gap: 8 }}>
                {frame.options.map((o) => (
                  <button key={o} onClick={() => { setVoted(o); showToast && showToast(`Voted "${o}"`); }} style={{
                    flex: 1, padding: "12px", borderRadius: 14, cursor: "pointer", fontWeight: 700, fontSize: 13,
                    border: `1.5px solid ${voted === o ? "#fff" : "rgba(255,255,255,0.6)"}`,
                    background: voted === o ? "rgba(255,255,255,0.25)" : "rgba(0,0,0,0.2)", color: "#fff",
                  }}>{o}</button>
                ))}
              </div>
            </div>
          )}

          <div style={{ display: "flex", gap: 8, alignItems: "center", pointerEvents: "auto" }}>
            <input
              value={reply}
              onChange={(e) => setReply(e.target.value)}
              onFocus={() => setPaused(true)}
              onBlur={() => setPaused(false)}
              onKeyDown={(e) => e.key === "Enter" && sendReply()}
              placeholder={`Reply to ${user.name}…`}
              style={{
                flex: 1, padding: "12px 16px", borderRadius: 999, border: "1px solid rgba(255,255,255,0.4)",
                background: "rgba(0,0,0,0.3)", color: "#fff", outline: "none", fontSize: 13, ...bodyFont
              }}
            />
            <button onClick={sendReply} style={{
              width: 40, height: 40, borderRadius: "50%", border: "none", background: "rgba(255,255,255,0.2)",
              color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", flexShrink: 0
            }}><Send size={16} /></button>
            <button style={{
              width: 40, height: 40, borderRadius: "50%", border: "none", background: "rgba(255,255,255,0.2)",
              color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", flexShrink: 0
            }}><Heart size={17} /></button>
          </div>
        </div>
      </div>
    </div>
  );
}

function CreateStorySheet({ onClose, onCreate }) {
  const [text, setText] = useState("");
  const options = [
    { type: "photo", label: "Photo", icon: Camera, image: avatar(66, 600) },
    { type: "question", label: "Question", icon: MessageCircle, bg: [T.violet, T.rose] },
    { type: "poll", label: "Poll", icon: Sparkles, bg: [T.amber, T.rose] },
  ];
  const [picked, setPicked] = useState(null);

  const create = () => {
    if (picked === "photo") onCreate({ type: "photo", image: avatar(66, 600), caption: text || "New moment ✨" });
    else if (picked === "question") onCreate({ type: "question", question: text || "Ask me anything!", bg: [T.violet, T.rose] });
    else if (picked === "poll") onCreate({ type: "poll", question: text || "This or that?", options: ["Option A", "Option B"], bg: [T.amber, T.rose] });
  };

  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 92, display: "flex", alignItems: "flex-end", justifyContent: "center" }}>
      <div onClick={onClose} style={{ position: "absolute", inset: 0, background: "rgba(10,8,14,0.78)" }} />
      <div className="pop-in" style={{
        position: "relative", width: "100%", maxWidth: 460, background: T.surface, borderTopLeftRadius: 28,
        borderTopRightRadius: 28, padding: "22px 22px 32px", border: `1px solid ${T.border}`
      }}>
        <div style={{ width: 40, height: 4, background: T.border, borderRadius: 4, margin: "0 auto 18px" }} />
        <h3 style={{ ...displayFont, fontSize: 19, margin: "0 0 16px" }}>Add to your story</h3>

        <div style={{ display: "flex", gap: 10, marginBottom: 16 }}>
          {options.map((o) => {
            const Icon = o.icon;
            return (
              <button key={o.type} onClick={() => setPicked(o.type)} style={{
                flex: 1, padding: "16px 8px", borderRadius: 16, cursor: "pointer", textAlign: "center",
                border: `1.5px solid ${picked === o.type ? T.rose : T.border}`,
                background: picked === o.type ? `${T.rose}22` : T.surface2, color: T.text,
              }}>
                <Icon size={20} style={{ marginBottom: 6 }} />
                <p style={{ fontSize: 11.5, fontWeight: 600, margin: 0 }}>{o.label}</p>
              </button>
            );
          })}
        </div>

        {picked && (
          <input
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={picked === "photo" ? "Add a caption…" : picked === "question" ? "What do you want to ask?" : "This or that?"}
            style={{
              width: "100%", padding: "14px 16px", borderRadius: 14, border: `1px solid ${T.border}`,
              background: T.surface2, color: T.text, outline: "none", fontSize: 13.5, marginBottom: 16, ...bodyFont
            }}
          />
        )}

        <button onClick={create} disabled={!picked} style={{ ...primaryBtn, width: "100%", opacity: picked ? 1 : 0.45, cursor: picked ? "pointer" : "not-allowed" }}>
          Share to story
        </button>
      </div>
    </div>
  );
}

/* ------------------------------ LIVE TAB ------------------------------ */
const LIVE_ROOMS = [
  { id: 1, title: "Friday Night Speed Dating", host: PROFILES[3], category: "Dating", viewers: 482, cover: avatar(23, 500) },
  { id: 2, title: "House music til 2am 🎧", host: PROFILES[6], category: "Music", viewers: 921, cover: avatar(41, 500) },
  { id: 3, title: "Roast my dating profile", host: PROFILES[8], category: "Entertainment", viewers: 356, cover: avatar(19, 500) },
  { id: 4, title: "Late night talk: red flags", host: PROFILES[11], category: "Talk", viewers: 210, cover: avatar(58, 500) },
  { id: 5, title: "Ranked grind, come chat", host: PROFILES[14], category: "Gaming", viewers: 640, cover: avatar(12, 500) },
  { id: 6, title: "LIVE MATCH: Rui & Ines", category: "Dating", viewers: 1204, cover: avatar(30, 500), liveMatch: true, host: PROFILES[6], guest: PROFILES[5] },
];
const LIVE_CATS = ["Trending", "Dating", "Music", "Entertainment", "Talk", "Gaming"];

function LiveTab({ onOpen }) {
  const [cat, setCat] = useState("Trending");
  const [showGoLive, setShowGoLive] = useState(false);
  const filtered = cat === "Trending" ? LIVE_ROOMS : LIVE_ROOMS.filter((r) => r.category === cat);
  return (
    <div className="fade-up" style={{ paddingTop: 14 }}>
      <h2 style={{ ...displayFont, fontSize: 22, margin: "0 0 4px" }}>Live</h2>
      <p style={{ color: T.muted, fontSize: 13, marginBottom: 14 }}>Jump into a room, or start your own.</p>
      <div style={{ display: "flex", gap: 8, overflowX: "auto", marginBottom: 16 }} className="no-scrollbar">
        {LIVE_CATS.map((c) => (
          <button key={c} onClick={() => setCat(c)} style={{
            padding: "7px 14px", borderRadius: 999, fontSize: 12.5, whiteSpace: "nowrap", cursor: "pointer", fontWeight: 600,
            border: `1px solid ${cat === c ? T.rose : T.border}`, background: cat === c ? `${T.rose}22` : "transparent",
            color: cat === c ? "#fff" : T.muted,
          }}>{c === "Trending" ? "🔥 Trending" : c === "Dating" ? "💘 Dating" : c === "Music" ? "🎵 Music" : c === "Entertainment" ? "😂 Entertainment" : c === "Talk" ? "💬 Talk" : "🎮 Gaming"}</button>
        ))}
      </div>

      <button onClick={() => setShowGoLive(true)} style={{
        width: "100%", padding: "14px", borderRadius: 18, border: `1px dashed ${T.rose}88`, background: `${T.rose}11`,
        color: T.rose, fontWeight: 700, fontSize: 13.5, marginBottom: 18, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: 8
      }}>
        <Radio size={16} /> Go Live
      </button>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
        {filtered.map((r) => (
          <button key={r.id} onClick={() => onOpen(r)} style={{
            border: `1px solid ${r.liveMatch ? T.violet : T.border}`, borderRadius: 18, overflow: "hidden", background: T.surface,
            cursor: "pointer", padding: 0, textAlign: "left"
          }}>
            <div style={{ position: "relative", height: 130 }}>
              <img src={r.cover} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
              <span style={{ position: "absolute", top: 8, left: 8, background: T.rose, fontSize: 9.5, fontWeight: 700, padding: "2px 7px", borderRadius: 6, ...monoFont }}>● LIVE</span>
              <span style={{ position: "absolute", top: 8, right: 8, background: "rgba(20,16,26,0.75)", fontSize: 10, padding: "2px 7px", borderRadius: 6, display: "flex", alignItems: "center", gap: 3 }}>
                <Users size={10} /> {r.viewers}
              </span>
              {r.liveMatch && (
                <span style={{ position: "absolute", bottom: 8, left: 8, background: T.violet, fontSize: 10.5, fontWeight: 700, padding: "3px 8px", borderRadius: 8 }}>💘 LIVE MATCH</span>
              )}
            </div>
            <div style={{ padding: "9px 10px" }}>
              <p style={{ fontSize: 12, fontWeight: 700, margin: 0 }}>{r.title}</p>
              <p style={{ fontSize: 10.5, color: T.muted, margin: "3px 0 0" }}>{r.host?.name}{r.guest ? ` & ${r.guest.name}` : ""}</p>
            </div>
          </button>
        ))}
      </div>

      {showGoLive && (
        <GoLiveSheet
          onClose={() => setShowGoLive(false)}
          onStart={(title, category) => {
            setShowGoLive(false);
            onOpen({ id: "you", title, category, host: { name: "You", photo: DEMO_USER.photo }, cover: DEMO_USER.photo, viewers: 1, isSelf: true });
          }}
        />
      )}
    </div>
  );
}

function GoLiveSheet({ onClose, onStart }) {
  const [title, setTitle] = useState("");
  const [category, setCategory] = useState("Talk");
  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 88, display: "flex", alignItems: "flex-end", justifyContent: "center" }}>
      <div onClick={onClose} style={{ position: "absolute", inset: 0, background: "rgba(10,8,14,0.78)" }} />
      <div className="pop-in" style={{
        position: "relative", width: "100%", maxWidth: 460, background: T.surface, borderTopLeftRadius: 28,
        borderTopRightRadius: 28, padding: "22px 22px 32px", border: `1px solid ${T.border}`
      }}>
        <div style={{ width: 40, height: 4, background: T.border, borderRadius: 4, margin: "0 auto 18px" }} />
        <h3 style={{ ...displayFont, fontSize: 19, margin: "0 0 4px", display: "flex", alignItems: "center", gap: 8 }}>
          <Radio size={17} color={T.rose} /> Go Live
        </h3>
        <p style={{ fontSize: 12.5, color: T.muted, marginBottom: 18 }}>Set a title and category — you can start whenever you're ready.</p>
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="What's this live about?"
          style={{
            width: "100%", padding: "14px 16px", borderRadius: 14, border: `1px solid ${T.border}`,
            background: T.surface2, color: T.text, outline: "none", fontSize: 13.5, marginBottom: 14, ...bodyFont
          }}
        />
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 20 }}>
          {LIVE_CATS.filter((c) => c !== "Trending").map((c) => (
            <Chip key={c} label={c} active={category === c} onClick={() => setCategory(c)} />
          ))}
        </div>
        <button
          onClick={() => onStart(title || "Untitled live", category)}
          style={{ ...primaryBtn, width: "100%", background: `linear-gradient(90deg, ${T.rose}, #FF7A63)` }}
        >
          Start streaming
        </button>
        <button onClick={onClose} style={{ background: "none", border: "none", color: T.muted, fontSize: 13, marginTop: 12, cursor: "pointer", width: "100%" }}>Cancel</button>
      </div>
    </div>
  );
}

function LiveRoomView({ room, onClose }) {
  const [reactions, setReactions] = useState(0);
  const [votes, setVotes] = useState({ yes: 61, no: 39 });
  const [chatLog, setChatLog] = useState(LIVE_CHAT);
  const [chatInput, setChatInput] = useState("");
  const [viewers, setViewers] = useState(room.viewers);

  useEffect(() => {
    if (!room.isSelf) return;
    const t = setInterval(() => setViewers((v) => v + rnd(1, 6)), 1800);
    return () => clearInterval(t);
  }, [room.isSelf]);

  const sendChat = () => {
    if (!chatInput.trim()) return;
    setChatLog((c) => [...c, { user: "You", text: chatInput, you: true }]);
    setChatInput("");
  };

  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 90, background: T.ink, display: "flex", justifyContent: "center" }}>
      <div style={{ width: "100%", maxWidth: 460, position: "relative", overflow: "hidden" }}>
        <img src={room.cover} style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover", filter: "brightness(0.55)" }} />
        <div style={{ position: "absolute", inset: 0, background: "linear-gradient(to bottom, rgba(10,8,14,0.5), rgba(10,8,14,0.2) 40%, rgba(10,8,14,0.9))" }} />

        <div style={{ position: "relative", padding: "18px 16px", display: "flex", alignItems: "center", gap: 10 }}>
          <IconBtn onClick={onClose}><X size={17} /></IconBtn>
          <span style={{ background: T.rose, fontSize: 10.5, fontWeight: 700, padding: "3px 8px", borderRadius: 6, ...monoFont }}>● LIVE</span>
          <span style={{ fontSize: 12, display: "flex", alignItems: "center", gap: 4, color: "#fff" }}><Users size={13} /> {viewers}</span>
          <div style={{ flex: 1 }} />
          {room.host && <img src={room.host.photo} style={{ width: 32, height: 32, borderRadius: "50%", border: `2px solid ${T.rose}` }} />}
          {room.guest && <img src={room.guest.photo} style={{ width: 32, height: 32, borderRadius: "50%", border: `2px solid ${T.violet}`, marginLeft: -14 }} />}
        </div>

        <div style={{ position: "relative", minHeight: 500, display: "flex", flexDirection: "column", justifyContent: "flex-end", padding: "0 16px 20px" }}>
          <h3 style={{ ...displayFont, fontSize: 20, color: "#fff", margin: "0 0 4px" }}>{room.title}</h3>
          {room.isSelf && (
            <p style={{ fontSize: 12, color: T.mint, margin: "0 0 10px", display: "flex", alignItems: "center", gap: 6 }}>
              <Radio size={13} /> You're live — viewers are joining
            </p>
          )}

          {room.liveMatch && (
            <div style={{ background: "rgba(30,25,40,0.75)", border: `1px solid ${T.border}`, borderRadius: 18, padding: 16, margin: "10px 0" }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 10, marginBottom: 10 }}>
                <MatchRing percent={78} size={70} />
              </div>
              <p style={{ textAlign: "center", fontSize: 12.5, color: T.muted, marginBottom: 12 }}>Should {room.host?.name} & {room.guest?.name} match?</p>
              <div style={{ display: "flex", gap: 8 }}>
                <button onClick={() => setVotes((v) => ({ ...v, yes: v.yes + 1 }))} style={{ flex: 1, padding: "10px", borderRadius: 12, border: "none", background: `linear-gradient(90deg, ${T.rose}, #FF7A63)`, color: "#fff", fontWeight: 700, cursor: "pointer" }}>
                  ❤️ Yes {votes.yes}%
                </button>
                <button onClick={() => setVotes((v) => ({ ...v, no: v.no + 1 }))} style={{ flex: 1, padding: "10px", borderRadius: 12, border: `1px solid ${T.border}`, background: "transparent", color: "#fff", fontWeight: 700, cursor: "pointer" }}>
                  No {votes.no}%
                </button>
              </div>
            </div>
          )}

          <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 14, maxHeight: 130, overflowY: "auto" }}>
            {chatLog.map((c, i) => (
              <p key={i} style={{ fontSize: 12.5, color: "#EDE7F5", margin: 0 }}><b style={{ color: c.you ? T.mint : T.amber }}>{c.user}</b> {c.text}</p>
            ))}
          </div>

          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <input
              value={chatInput}
              onChange={(e) => setChatInput(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && sendChat()}
              placeholder="Say something…" style={{
              flex: 1, padding: "12px 16px", borderRadius: 999, border: `1px solid ${T.border}`,
              background: "rgba(38,32,47,0.8)", color: "#fff", outline: "none", fontSize: 13, ...bodyFont
            }} />
            <button onClick={sendChat} style={{
              width: 42, height: 42, borderRadius: "50%", border: "none", background: "rgba(255,255,255,0.18)", color: "#fff",
              display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", flexShrink: 0
            }}><Send size={16} /></button>
            <button onClick={() => setReactions((r) => r + 1)} style={{
              width: 42, height: 42, borderRadius: "50%", border: "none", background: `${T.rose}`, color: "#fff",
              display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", flexShrink: 0, position: "relative"
            }}>
              <Heart size={18} fill="#fff" />
              {reactions > 0 && <span style={{ position: "absolute", top: -6, right: -6, background: T.amber, color: "#1a1a1a", fontSize: 9, fontWeight: 700, borderRadius: 999, padding: "1px 5px" }}>{reactions}</span>}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
const LIVE_CHAT = [
  { user: "Mia", text: "okay this is actually so cute 🥹" },
  { user: "Tomas", text: "team yes!!" },
  { user: "Nina", text: "the chemistry is real ngl" },
  { user: "Bruno", text: "🔥🔥🔥" },
];

/* ------------------------------ EVENTS TAB ------------------------------ */
const EVENTS = [
  { id: 1, title: "Rooftop Sunset Mixer", date: "Fri, Aug 21", location: "Lisbon", cover: avatar(24, 500), going: 128, category: "Nightlife" },
  { id: 2, title: "Indie & Vinyl Night", date: "Sat, Aug 22", location: "Porto", cover: avatar(63, 500), going: 76, category: "Music" },
  { id: 3, title: "Singles Dinner Party", date: "Sun, Aug 23", location: "Lisbon", cover: avatar(37, 500), going: 54, category: "Dating" },
  { id: 4, title: "Sunrise Beach Hike", date: "Sat, Aug 29", location: "Cascais", cover: avatar(15, 500), going: 41, category: "Travel" },
  { id: 5, title: "Festival Weekend: NOS Alive", date: "Sep 4–6", location: "Lisbon", cover: avatar(48, 500), going: 980, category: "Festival" },
];

function EventsTab({ showToast }) {
  const [going, setGoing] = useState({ 1: true });
  const toggle = (id, title) => {
    setGoing((g) => ({ ...g, [id]: !g[id] }));
    showToast(!going[id] ? `You're going to ${title} 🎉` : "Removed from your events");
  };
  return (
    <div className="fade-up" style={{ paddingTop: 14 }}>
      <h2 style={{ ...displayFont, fontSize: 22, margin: "0 0 4px" }}>Events</h2>
      <p style={{ color: T.muted, fontSize: 13, marginBottom: 16 }}>Real-world ways to meet your matches.</p>
      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        {EVENTS.map((e) => (
          <div key={e.id} style={{ background: T.surface, border: `1px solid ${T.border}`, borderRadius: 20, overflow: "hidden" }}>
            <div style={{ position: "relative", height: 130 }}>
              <img src={e.cover} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
              <span style={{ position: "absolute", top: 10, left: 10, background: "rgba(20,16,26,0.75)", fontSize: 11, padding: "3px 9px", borderRadius: 999 }}>{e.category}</span>
            </div>
            <div style={{ padding: "12px 14px" }}>
              <p style={{ fontSize: 15, fontWeight: 700, margin: 0 }}>{e.title}</p>
              <p style={{ fontSize: 12, color: T.muted, margin: "3px 0 8px" }}>{e.date} · {e.location}</p>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
                <div style={{ display: "flex" }}>
                  {PROFILES.slice(e.id, e.id + 3).map((p, i) => (
                    <img key={p.id} src={p.photo} style={{ width: 24, height: 24, borderRadius: "50%", border: `2px solid ${T.surface}`, marginLeft: i ? -8 : 0, objectFit: "cover" }} />
                  ))}
                </div>
                <span style={{ fontSize: 11.5, color: T.muted }}>{e.going} going · incl. {PROFILES[e.id]?.name} ({PROFILES[e.id]?.match}% match)</span>
              </div>
              <button onClick={() => toggle(e.id, e.title)} style={{
                width: "100%", padding: "10px", borderRadius: 999, cursor: "pointer", fontWeight: 700, fontSize: 13,
                border: going[e.id] ? `1px solid ${T.mint}` : "none",
                background: going[e.id] ? "transparent" : `linear-gradient(90deg, ${T.rose}, #FF7A63)`,
                color: going[e.id] ? T.mint : "#fff",
              }}>{going[e.id] ? "✓ I'm going" : "I'm going"}</button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ------------------------------ PROFILE TAB ------------------------------ */
function ProfileTab({ user, onPremium, onOpenSocial, showToast, onSignOut, onSaveProfile, saving, signedIn }) {
  const [visibility, setVisibility] = useState(true);
  const [showSettings, setShowSettings] = useState(false);
  const [verified, setVerified] = useState(false);

  return (
    <div className="fade-up" style={{ paddingTop: 14, paddingBottom: 10 }}>
      <div style={{ textAlign: "center", marginBottom: 18 }}>
        <div style={{ position: "relative", display: "inline-block" }}>
          <img src={user.photo} style={{ width: 96, height: 96, borderRadius: "50%", objectFit: "cover", border: `3px solid ${T.rose}` }} />
          {verified && (
            <div style={{ position: "absolute", bottom: 0, right: 0, background: T.mint, borderRadius: "50%", width: 26, height: 26, display: "flex", alignItems: "center", justifyContent: "center", border: `2px solid ${T.ink}` }}>
              <BadgeCheck size={15} color={T.ink} />
            </div>
          )}
        </div>
        <h2 style={{ ...displayFont, fontSize: 22, margin: "10px 0 2px", display: "flex", alignItems: "center", justifyContent: "center", gap: 6 }}>
          {user.name}, {user.age}
        </h2>
        <p style={{ color: T.muted, fontSize: 13, margin: 0 }}>{user.city} · {user.intention}</p>
        <p style={{ color: T.mutedDim, fontSize: 12.5, marginTop: 8, fontStyle: "italic" }}>"{user.bio}"</p>
        {!verified && (
          <p style={{ fontSize: 11.5, color: T.mutedDim, marginTop: 6 }}>Not verified yet</p>
        )}
      </div>

      <div style={{ display: "flex", justifyContent: "center", marginBottom: 20 }}>
        <div style={{ background: T.surface, border: `1px solid ${T.border}`, borderRadius: 22, padding: 20, textAlign: "center", width: "100%" }}>
          <MatchRing percent={92} size={90} />
          <p style={{ fontSize: 12.5, color: T.muted, marginTop: 10 }}>Average compatibility with people you like</p>
        </div>
      </div>

      <div style={{ display: "flex", gap: 10, marginBottom: 20 }}>
        <StatCard label="Profile" value="86%" sub="complete" />
        <StatCard label="Matches" value="12" sub="this week" />
        <StatCard label="Streak" value="5" sub="days chatting" />
      </div>

      <SectionTitle title="Your taste" />
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 20 }}>
        {(user.tags || DEMO_USER.tags).map((t) => <Chip key={t} label={t} active onClick={() => {}} />)}
      </div>

      <SectionTitle title="Badges" />
      <div style={{ display: "flex", gap: 10, marginBottom: 22 }}>
        {(user.badges || DEMO_USER.badges).map((b) => (
          <div key={b} style={{ background: T.surface, border: `1px solid ${T.border}`, borderRadius: 16, padding: "12px 14px", textAlign: "center", flex: 1 }}>
            <Flame size={18} color={T.amber} style={{ marginBottom: 6 }} />
            <p style={{ fontSize: 11, fontWeight: 600, margin: 0 }}>{b}</p>
          </div>
        ))}
      </div>

      <button onClick={onPremium} style={{
        width: "100%", padding: "16px", borderRadius: 20, border: "none", cursor: "pointer", marginBottom: 12,
        background: `linear-gradient(120deg, ${T.violet}, #5D3FE0)`, color: "#fff", display: "flex", alignItems: "center", gap: 12, textAlign: "left"
      }}>
        <Crown size={26} />
        <div>
          <p style={{ fontWeight: 800, fontSize: 14, margin: 0 }}>Upgrade to MATCH+</p>
          <p style={{ fontSize: 11.5, margin: "2px 0 0", opacity: 0.85 }}>See who liked you, unlimited likes & more</p>
        </div>
      </button>

      <button onClick={onOpenSocial} style={{
        width: "100%", padding: "14px", borderRadius: 18, border: `1px solid ${T.border}`, background: T.surface,
        color: T.text, cursor: "pointer", marginBottom: 10, display: "flex", alignItems: "center", justifyContent: "space-between"
      }}>
        <span style={{ fontSize: 13.5, fontWeight: 600 }}>View your social posts</span>
        <ChevronRight size={16} />
      </button>

      <button
        disabled={saving || !signedIn}
        onClick={() => onSaveProfile && onSaveProfile({ name: user.name, bio: user.bio, city: user.city, intention: user.intention })}
        style={{
          width: "100%", padding: "14px", borderRadius: 18, border: "none",
          background: `linear-gradient(90deg, ${T.rose}, #FF7A63)`, color: "#fff",
          cursor: signedIn ? "pointer" : "not-allowed", marginBottom: 10, opacity: saving || !signedIn ? 0.55 : 1,
          fontWeight: 700, fontSize: 13.5, ...bodyFont
        }}
      >
        {signedIn ? (saving ? "Saving…" : "Save profile to Supabase") : "Sign in to sync profile"}
      </button>

      <button onClick={() => setShowSettings(true)} style={{
        width: "100%", padding: "14px", borderRadius: 18, border: `1px solid ${T.border}`, background: T.surface,
        color: T.text, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10
      }}>
        <span style={{ fontSize: 13.5, fontWeight: 600, display: "flex", alignItems: "center", gap: 8 }}><Settings size={16} /> Settings & privacy</span>
        <ChevronRight size={16} />
      </button>

      {onSignOut && (
        <button onClick={onSignOut} style={{
          width: "100%", padding: "14px", borderRadius: 18, border: `1px solid ${T.border}`, background: T.surface,
          color: T.muted, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: 8
        }}>
          <LogOut size={16} /> Sign out
        </button>
      )}

      {showSettings && (
        <SettingsSheet
          onClose={() => setShowSettings(false)}
          verified={verified}
          onVerified={() => { setVerified(true); showToast && showToast("Profile verified ✓"); }}
        />
      )}
    </div>
  );
}
function StatCard({ label, value, sub }) {
  return (
    <div style={{ flex: 1, background: T.surface, border: `1px solid ${T.border}`, borderRadius: 16, padding: "12px 8px", textAlign: "center" }}>
      <p style={{ ...displayFont, fontSize: 20, margin: 0 }}>{value}</p>
      <p style={{ fontSize: 10.5, color: T.muted, margin: "2px 0 0" }}>{sub}</p>
    </div>
  );
}

function SettingsSheet({ onClose, verified, onVerified }) {
  const [toggles, setToggles] = useState({
    onlineStatus: true, distance: true, readReceipts: true, incognito: false,
    whoCanMessage: "Matches only", discoverable: true,
  });
  const [showVerify, setShowVerify] = useState(false);
  const [showBlocked, setShowBlocked] = useState(false);
  const [showReport, setShowReport] = useState(false);
  const flip = (k) => setToggles((t) => ({ ...t, [k]: !t[k] }));
  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 70, display: "flex", alignItems: "flex-end", justifyContent: "center" }}>
      <div onClick={onClose} style={{ position: "absolute", inset: 0, background: "rgba(10,8,14,0.72)" }} />
      <div className="pop-in" style={{
        position: "relative", width: "100%", maxWidth: 460, maxHeight: "85%", overflowY: "auto",
        background: T.surface, borderTopLeftRadius: 28, borderTopRightRadius: 28, padding: "22px 22px 32px", border: `1px solid ${T.border}`
      }}>
        <div style={{ width: 40, height: 4, background: T.border, borderRadius: 4, margin: "0 auto 18px" }} />
        <h3 style={{ ...displayFont, fontSize: 20, margin: "0 0 16px", display: "flex", alignItems: "center", gap: 8 }}>
          <Shield size={18} color={T.mint} /> Safety & privacy
        </h3>

        <SettingRow icon={<Eye size={16} />} label="Show online status" active={toggles.onlineStatus} onClick={() => flip("onlineStatus")} />
        <SettingRow icon={<MapPin size={16} />} label="Show distance" active={toggles.distance} onClick={() => flip("distance")} />
        <SettingRow icon={<Check size={16} />} label="Read receipts" active={toggles.readReceipts} onClick={() => flip("readReceipts")} />
        <SettingRow icon={<EyeOff size={16} />} label="Incognito mode (MATCH+)" active={toggles.incognito} onClick={() => flip("incognito")} />
        <SettingRow icon={<Users size={16} />} label="Discoverable in search" active={toggles.discoverable} onClick={() => flip("discoverable")} />

        <p style={{ fontWeight: 700, fontSize: 13, margin: "18px 0 8px", color: T.muted }}>WHO CAN MESSAGE YOU</p>
        <div style={{ display: "flex", gap: 8 }}>
          {["Everyone", "Matches only"].map((opt) => (
            <button key={opt} onClick={() => setToggles((t) => ({ ...t, whoCanMessage: opt }))} style={{
              flex: 1, padding: "10px", borderRadius: 12, fontSize: 12.5, cursor: "pointer",
              border: `1px solid ${toggles.whoCanMessage === opt ? T.rose : T.border}`,
              background: toggles.whoCanMessage === opt ? `${T.rose}22` : T.surface2, color: T.text,
            }}>{opt}</button>
          ))}
        </div>

        <p style={{ fontWeight: 700, fontSize: 13, margin: "20px 0 8px", color: T.muted }}>ACCOUNT</p>
        <SafetyLink icon={<Lock size={16} />} label="Blocked accounts" onClick={() => setShowBlocked(true)} />
        <SafetyLink icon={<Shield size={16} />} label="Report a problem" onClick={() => setShowReport(true)} />
        <SafetyLink
          icon={<BadgeCheck size={16} color={verified ? T.mint : T.text} />}
          label={verified ? "Verified ✓" : "Get verified"}
          onClick={() => !verified && setShowVerify(true)}
        />

        <p style={{ fontSize: 11, color: T.mutedDim, marginTop: 18, lineHeight: 1.5 }}>
          MATCH only ever shows an approximate distance — your exact location is never shared with other users. Built with GDPR-ready data controls.
        </p>

        <button onClick={onClose} style={{ ...primaryBtn, width: "100%", marginTop: 18 }}>Done</button>
      </div>

      {showVerify && (
        <VerificationModal
          onClose={() => setShowVerify(false)}
          onDone={() => { setShowVerify(false); onVerified && onVerified(); }}
        />
      )}
      {showBlocked && <BlockedAccountsSheet onClose={() => setShowBlocked(false)} />}
      {showReport && <ReportProblemSheet onClose={() => setShowReport(false)} />}
    </div>
  );
}

function BlockedAccountsSheet({ onClose }) {
  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 85, display: "flex", alignItems: "flex-end", justifyContent: "center" }}>
      <div onClick={onClose} style={{ position: "absolute", inset: 0, background: "rgba(10,8,14,0.78)" }} />
      <div className="pop-in" style={{
        position: "relative", width: "100%", maxWidth: 460, background: T.surface, borderTopLeftRadius: 28,
        borderTopRightRadius: 28, padding: "22px 22px 32px", border: `1px solid ${T.border}`
      }}>
        <div style={{ width: 40, height: 4, background: T.border, borderRadius: 4, margin: "0 auto 18px" }} />
        <h3 style={{ ...displayFont, fontSize: 19, margin: "0 0 16px", display: "flex", alignItems: "center", gap: 8 }}>
          <Lock size={17} /> Blocked accounts
        </h3>
        <EmptyState text="You haven't blocked anyone. Blocked profiles will show up here." />
        <button onClick={onClose} style={{ ...primaryBtn, width: "100%" }}>Close</button>
      </div>
    </div>
  );
}

function ReportProblemSheet({ onClose }) {
  const [category, setCategory] = useState(null);
  const [details, setDetails] = useState("");
  const [sent, setSent] = useState(false);
  const cats = ["Fake profile", "Inappropriate content", "Harassment", "App bug", "Other"];
  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 85, display: "flex", alignItems: "flex-end", justifyContent: "center" }}>
      <div onClick={onClose} style={{ position: "absolute", inset: 0, background: "rgba(10,8,14,0.78)" }} />
      <div className="pop-in" style={{
        position: "relative", width: "100%", maxWidth: 460, background: T.surface, borderTopLeftRadius: 28,
        borderTopRightRadius: 28, padding: "22px 22px 32px", border: `1px solid ${T.border}`
      }}>
        <div style={{ width: 40, height: 4, background: T.border, borderRadius: 4, margin: "0 auto 18px" }} />
        {!sent ? (
          <>
            <h3 style={{ ...displayFont, fontSize: 19, margin: "0 0 16px", display: "flex", alignItems: "center", gap: 8 }}>
              <Shield size={17} color={T.mint} /> Report a problem
            </h3>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 14 }}>
              {cats.map((c) => <Chip key={c} label={c} active={category === c} onClick={() => setCategory(c)} />)}
            </div>
            <textarea
              value={details}
              onChange={(e) => setDetails(e.target.value)}
              placeholder="Tell us what happened…"
              rows={4}
              style={{
                width: "100%", padding: "14px 16px", borderRadius: 14, border: `1px solid ${T.border}`,
                background: T.surface2, color: T.text, outline: "none", fontSize: 13.5, marginBottom: 16, resize: "none", ...bodyFont
              }}
            />
            <button
              onClick={() => setSent(true)}
              disabled={!category}
              style={{ ...primaryBtn, width: "100%", opacity: category ? 1 : 0.45, cursor: category ? "pointer" : "not-allowed" }}
            >Submit report</button>
          </>
        ) : (
          <div style={{ textAlign: "center", padding: "14px 0" }}>
            <Check size={30} color={T.mint} style={{ marginBottom: 10 }} />
            <h3 style={{ ...displayFont, fontSize: 18, margin: "0 0 6px" }}>Report submitted</h3>
            <p style={{ fontSize: 12.5, color: T.muted, marginBottom: 18 }}>Thanks — our safety team reviews every report within 24h.</p>
            <button onClick={onClose} style={{ ...primaryBtn, width: "100%" }}>Done</button>
          </div>
        )}
      </div>
    </div>
  );
}

function VerificationModal({ onClose, onDone }) {
  const [step, setStep] = useState("intro"); // intro | scanning | done
  const startScan = () => {
    setStep("scanning");
    setTimeout(() => setStep("done"), 2200);
  };
  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 85, display: "flex", alignItems: "center", justifyContent: "center" }}>
      <div onClick={step !== "scanning" ? onClose : undefined} style={{ position: "absolute", inset: 0, background: "rgba(10,8,14,0.85)" }} />
      <div className="pop-in" style={{
        position: "relative", width: "88%", maxWidth: 340, background: T.surface, borderRadius: 26,
        border: `1px solid ${T.border}`, padding: "26px 22px", textAlign: "center"
      }}>
        {step === "intro" && (
          <>
            <div style={{
              width: 64, height: 64, borderRadius: "50%", background: `${T.mint}22`, display: "flex",
              alignItems: "center", justifyContent: "center", margin: "0 auto 14px"
            }}>
              <Camera size={26} color={T.mint} />
            </div>
            <h3 style={{ ...displayFont, fontSize: 19, margin: "0 0 8px" }}>Photo verification</h3>
            <p style={{ fontSize: 12.5, color: T.muted, lineHeight: 1.5, marginBottom: 18 }}>
              Take a quick live selfie matching a pose we show you. We compare it to your profile photos — it's never shared with other users.
            </p>
            <button onClick={startScan} style={{ ...primaryBtn, width: "100%", background: `linear-gradient(90deg, ${T.mint}, #2FB89E)` }}>
              Start face scan
            </button>
            <button onClick={onClose} style={{ background: "none", border: "none", color: T.mutedDim, fontSize: 12.5, marginTop: 12, cursor: "pointer" }}>Not now</button>
          </>
        )}
        {step === "scanning" && (
          <>
            <div style={{ position: "relative", width: 96, height: 96, margin: "0 auto 16px" }}>
              <div style={{
                position: "absolute", inset: 0, borderRadius: "50%", border: `3px solid ${T.surface3}`,
              }} />
              <div style={{
                position: "absolute", inset: 0, borderRadius: "50%", border: `3px solid transparent`,
                borderTopColor: T.mint, borderRightColor: T.mint, animation: "ringSpin 1s linear infinite",
              }} />
              <div style={{ position: "absolute", inset: 14, borderRadius: "50%", overflow: "hidden" }}>
                <img src={DEMO_USER.photo} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
              </div>
            </div>
            <h3 style={{ ...displayFont, fontSize: 17, margin: "0 0 6px" }}>Verifying your photo…</h3>
            <p style={{ fontSize: 12, color: T.muted }}>Matching facial landmarks — hold still.</p>
          </>
        )}
        {step === "done" && (
          <>
            <div style={{
              width: 64, height: 64, borderRadius: "50%", background: `${T.mint}22`, display: "flex",
              alignItems: "center", justifyContent: "center", margin: "0 auto 14px"
            }}>
              <BadgeCheck size={28} color={T.mint} />
            </div>
            <h3 style={{ ...displayFont, fontSize: 19, margin: "0 0 8px" }}>You're verified! ✓</h3>
            <p style={{ fontSize: 12.5, color: T.muted, marginBottom: 18 }}>
              A verified badge now appears on your profile so matches know it's really you.
            </p>
            <button onClick={onDone} style={{ ...primaryBtn, width: "100%" }}>Done</button>
          </>
        )}
      </div>
    </div>
  );
}
function SettingRow({ icon, label, active, onClick }) {
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 0", borderBottom: `1px solid ${T.border}` }}>
      <span style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 13.5 }}>{icon} {label}</span>
      <button onClick={onClick} style={{
        width: 42, height: 24, borderRadius: 999, border: "none", cursor: "pointer", position: "relative",
        background: active ? T.rose : T.surface3, transition: "background .2s"
      }}>
        <span style={{
          position: "absolute", top: 3, left: active ? 21 : 3, width: 18, height: 18, borderRadius: "50%",
          background: "#fff", transition: "left .2s"
        }} />
      </button>
    </div>
  );
}
function SafetyLink({ icon, label, onClick }) {
  return (
    <button onClick={onClick} style={{
      width: "100%", display: "flex", alignItems: "center", justifyContent: "space-between", padding: "12px 0",
      background: "none", border: "none", borderBottom: `1px solid ${T.border}`, color: T.text, cursor: "pointer", fontSize: 13.5
    }}>
      <span style={{ display: "flex", alignItems: "center", gap: 10 }}>{icon} {label}</span>
      <ChevronRight size={15} color={T.mutedDim} />
    </button>
  );
}

/* ------------------------------ PREMIUM MODAL ------------------------------ */
function PremiumModal({ onClose }) {
  const [plan, setPlan] = useState("match_plus");
  const plans = {
    match_plus: { name: "MATCH+", price: "€14.99/mo", color: T.violet, features: ["Unlimited likes", "See who liked you", "Advanced filters (verified, intention, exact age & distance)", "5 super likes / day", "Rewind last swipe", "Full why-you-match (7 dimensions)", "1 boost / month (30 min)"] },
    super_match: { name: "SUPER MATCH", price: "€24.99/mo", color: T.amber, features: ["Everything in MATCH+", "Incognito (only people you like see you)", "Unlimited super likes", "See who viewed your profile", "Message priority"] },
  };
  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 95, display: "flex", alignItems: "flex-end", justifyContent: "center" }}>
      <div onClick={onClose} style={{ position: "absolute", inset: 0, background: "rgba(10,8,14,0.78)" }} />
      <div className="pop-in" style={{
        position: "relative", width: "100%", maxWidth: 460, background: T.surface, borderTopLeftRadius: 28,
        borderTopRightRadius: 28, padding: "24px 22px 32px", border: `1px solid ${T.border}`, maxHeight: "88%", overflowY: "auto"
      }}>
        <div style={{ width: 40, height: 4, background: T.border, borderRadius: 4, margin: "0 auto 18px" }} />
        <div style={{ textAlign: "center", marginBottom: 20 }}>
          <Crown size={30} color={T.amber} />
          <h3 style={{ ...displayFont, fontSize: 24, margin: "8px 0 4px" }}>Go further with MATCH+</h3>
          <p style={{ color: T.muted, fontSize: 13 }}>Cancel anytime. Your free experience stays fully usable.</p>
        </div>

        <div style={{ display: "flex", gap: 10, marginBottom: 18 }}>
          {Object.entries(plans).map(([key, p]) => (
            <button key={key} onClick={() => setPlan(key)} style={{
              flex: 1, padding: 16, borderRadius: 18, cursor: "pointer", textAlign: "left",
              border: `2px solid ${plan === key ? p.color : T.border}`, background: plan === key ? `${p.color}18` : T.surface2,
            }}>
              <p style={{ fontWeight: 800, fontSize: 13, margin: 0, color: T.text }}>{p.name}</p>
              <p style={{ ...monoFont, fontSize: 15, margin: "6px 0 0", color: p.color }}>{p.price}</p>
            </button>
          ))}
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 22 }}>
          {plans[plan].features.map((f) => (
            <div key={f} style={{ display: "flex", gap: 10, alignItems: "center" }}>
              <Check size={16} color={plans[plan].color} />
              <span style={{ fontSize: 13.5 }}>{f}</span>
            </div>
          ))}
        </div>

        <div style={{ display: "flex", gap: 10, marginBottom: 10 }}>
          <FeatureIcon icon={<Zap size={16} />} label="Boost" />
          <FeatureIcon icon={<Eye size={16} />} label="See likes" />
          <FeatureIcon icon={<RotateCcw size={16} />} label="Rewind" />
          <FeatureIcon icon={<EyeOff size={16} />} label="Incognito" />
        </div>

        <button style={{ ...primaryBtn, width: "100%", background: `linear-gradient(90deg, ${plans[plan].color}, ${T.rose})` }}>
          Continue with {plans[plan].name}
        </button>
        <button onClick={onClose} style={{ background: "none", border: "none", color: T.muted, fontSize: 13, marginTop: 12, cursor: "pointer", width: "100%" }}>Maybe later</button>
      </div>
    </div>
  );
}
function FeatureIcon({ icon, label }) {
  return (
    <div style={{ flex: 1, textAlign: "center", background: T.surface2, borderRadius: 12, padding: "10px 4px" }}>
      <div style={{ display: "flex", justifyContent: "center", marginBottom: 4, color: T.amber }}>{icon}</div>
      <p style={{ fontSize: 9.5, margin: 0, color: T.muted }}>{label}</p>
    </div>
  );
}

/* ------------------------------ NOTIFICATIONS ------------------------------ */
const NOTIFS = [
  { icon: "❤️", text: "Sarah liked your profile", time: "2m" },
  { icon: "🔥", text: "It's a match with Alex — 91%!", time: "18m" },
  { icon: "💬", text: "Daniel sent you a message", time: "1h" },
  { icon: "🎥", text: "Mia is going live now", time: "2h" },
  { icon: "🎉", text: "3 matches are attending Rooftop Sunset Mixer", time: "5h" },
  { icon: "✨", text: "Your MATCH recommendations improved based on recent activity", time: "1d" },
];
function NotificationsPanel({ onClose }) {
  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 75, display: "flex", justifyContent: "center" }}>
      <div onClick={onClose} style={{ position: "absolute", inset: 0, background: "rgba(10,8,14,0.72)" }} />
      <div className="pop-in" style={{
        position: "relative", width: "100%", maxWidth: 460, marginTop: 60, height: "fit-content", maxHeight: "78%",
        overflowY: "auto", background: T.surface, borderRadius: 24, padding: 20, border: `1px solid ${T.border}`
      }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
          <h3 style={{ ...displayFont, fontSize: 19, margin: 0 }}>Notifications</h3>
          <IconBtn onClick={onClose}><X size={16} /></IconBtn>
        </div>
        {NOTIFS.map((n, i) => (
          <div key={i} style={{ display: "flex", gap: 12, padding: "10px 4px", borderBottom: i < NOTIFS.length - 1 ? `1px solid ${T.border}` : "none" }}>
            <span style={{ fontSize: 18 }}>{n.icon}</span>
            <p style={{ flex: 1, fontSize: 13, margin: 0 }}>{n.text}</p>
            <span style={{ fontSize: 11, color: T.mutedDim, flexShrink: 0 }}>{n.time}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ------------------------------ EMPTY STATE ------------------------------ */
function EmptyState({ text }) {
  return (
    <div style={{
      border: `1px dashed ${T.border}`, borderRadius: 20, padding: "32px 20px", textAlign: "center", color: T.muted,
      marginBottom: 16
    }}>
      <Heart size={26} color={T.mutedDim} style={{ marginBottom: 8 }} />
      <p style={{ fontSize: 13.5, margin: 0 }}>{text}</p>
    </div>
  );
}

/* ------------------------------ BOTTOM NAV ------------------------------ */
function BottomNav({ tab, setTab, onCreate }) {
  const items = [
    { key: "home", icon: Home, label: "Home" },
    { key: "discover", icon: Search, label: "Discover" },
    { key: "create", icon: Plus, label: "Create" },
    { key: "matches", icon: Heart, label: "Matches" },
    { key: "messages", icon: MessageCircle, label: "Messages" },
  ];
  return (
    <div className="glass" style={{
      position: "absolute", bottom: 0, left: 0, right: 0, borderTop: `1px solid ${T.border}`,
      display: "flex", justifyContent: "space-around", padding: "10px 8px 16px", zIndex: 50,
    }}>
      {items.map((it) => {
        const Icon = it.icon;
        const active = tab === it.key || (it.key === "create" && tab === "social");
        if (it.key === "create") {
          return (
            <button key={it.key} onClick={onCreate} style={{
              width: 46, height: 46, borderRadius: "50%", border: "none", cursor: "pointer",
              background: `linear-gradient(135deg, ${T.rose}, ${T.violet})`, color: "#fff",
              display: "flex", alignItems: "center", justifyContent: "center", marginTop: -8,
              boxShadow: `0 8px 20px -6px ${T.rose}88`
            }}><Icon size={22} /></button>
          );
        }
        return (
          <button key={it.key} onClick={() => setTab(it.key)} style={{
            background: "none", border: "none", cursor: "pointer", display: "flex", flexDirection: "column",
            alignItems: "center", gap: 3, color: active ? T.rose : T.mutedDim, padding: "4px 8px"
          }}>
            <Icon size={20} fill={active && it.key === "matches" ? T.rose : "none"} />
            <span style={{ fontSize: 9.5, fontWeight: 600 }}>{it.label}</span>
          </button>
        );
      })}
    </div>
  );
}
