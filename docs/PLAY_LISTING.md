# Google Play: listing and app content pack

Ready to paste into Play Console. Placeholders in `[brackets]` need the owner's decision
(app name, legal entity, URLs). Limits: title ≤ 30, short description ≤ 80, full
description ≤ 4000 characters. `scripts` at the bottom checks the lengths.

> Don't promise what the app doesn't do yet. Selfie photo verification is still a demo
> (server switch `live_require_verified_photo = 0`), so the copy below never says "verified
> profiles". Add that line once real verification ships.

---

## 1. Store listing: English (en-GB, default)

**App name (≤ 30):** `MATCH — Dating & Events`  *(placeholder, see STORE_CHECKLIST §0)*

**Short description (≤ 80):**
```
Date with intention: daily picks, live speed dating and real-life events.
```

**Full description:**
```
MATCH is a dating app for people who actually want to meet.

Instead of endless swiping, MATCH helps you find fewer, better matches and turn them into real conversations and real dates.

WHY PEOPLE LIKE MATCH
• Daily picks: a short, hand-picked list of people who fit you, every day.
• Why you match: see what you have in common across 7 dimensions, from intentions to interests.
• Your Friday answer: one question that says more than a bio ("What does your perfect Friday night look like?").
• Chats that don't die: friendly nudges, conversation starters and a match timer you can extend, so matches don't fade away.

LIVE, BUILT FOR DATING
• Speed dating rooms: 3–4 people, 3-minute rounds, run by the host.
• Question of the night: answer live and see who answers like you.
• Like the host from the live screen. If it's mutual, it's a match.
• Anyone can watch. To comment, send gifts or host you need a complete profile, and hosts must have an account at least a day old.

MEET IN REAL LIFE
• Events near you: join, RSVP and meet people in person.
• "We met" and private post-date feedback help keep the community honest.
• Date check-in: set a reminder to tell a trusted friend you're OK.

SAFETY AND PRIVACY FIRST
• 18+ only.
• You can only message people you've matched with. No unsolicited DMs.
• Block and report from anywhere. Blocked people can't see you, including in lives.
• Hosts can remove or mute people and turn comments off.
• Your exact location is never shown. We only use an area of about 1.5 km.
• Delete your account in the app at any time.

FREE TO USE, WITH OPTIONAL UPGRADES
MATCH is free: create a profile, like, match, chat, join events and watch lives.
• MATCH+: unlimited likes, see who liked you, rewind, more super likes and a monthly boost.
• SUPER MATCH: everything in MATCH+, plus incognito, see who viewed you, unlimited super likes and message priority.
Subscriptions renew automatically until cancelled in Google Play. MATCH coins are optional: use them for gifts in lives or to boost your profile. Earn free coins with your daily streak and by inviting friends.

Terms: [TERMS_URL]
Privacy: [PRIVACY_URL]
```

## 2. Store listing: Portuguese (pt-PT)

**Nome (≤ 30):** `MATCH — Encontros e Eventos`

**Descrição breve (≤ 80):**
```
Encontros com intenção: escolhas do dia, speed dating ao vivo e eventos reais.
```

**Descrição completa:**
```
O MATCH é uma app de encontros para quem quer mesmo conhecer alguém.

Em vez de deslizar sem fim, o MATCH ajuda-te a encontrar menos matches, mas melhores, e a transformá-los em conversas e encontros reais.

PORQUE É QUE AS PESSOAS GOSTAM DO MATCH
• Escolhas do dia: uma lista curta de pessoas compatíveis contigo, todos os dias.
• Porque fazem match: vê o que têm em comum em 7 dimensões, das intenções aos interesses.
• A tua resposta de sexta-feira: uma pergunta que diz mais do que uma bio ("Como é a tua sexta-feira à noite perfeita?").
• Conversas que não morrem: lembretes simpáticos, sugestões para quebrar o gelo e um temporizador que podes prolongar.

LIVE, PENSADO PARA ENCONTROS
• Salas de speed dating: 3–4 pessoas, rondas de 3 minutos, conduzidas pelo anfitrião.
• Pergunta da noite: responde em direto e descobre quem pensa como tu.
• Dá like ao anfitrião a partir do live. Se for mútuo, é match.
• Qualquer pessoa pode assistir. Para comentar, enviar presentes ou fazer um live precisas de um perfil completo, e só contas com pelo menos um dia podem ser anfitriãs.

CONHECER AO VIVO
• Eventos perto de ti: inscreve-te e conhece pessoas pessoalmente.
• "Encontrámo-nos" e feedback privado depois do encontro ajudam a manter a comunidade honesta.
• Check-in do encontro: um lembrete para dizeres a alguém de confiança que está tudo bem.

SEGURANÇA E PRIVACIDADE
• Só para maiores de 18.
• Só podes enviar mensagens a quem fizeste match. Nada de mensagens não pedidas.
• Bloqueia e denuncia em qualquer lado. Quem bloqueias não te vê, nem nos lives.
• Os anfitriões podem remover ou silenciar pessoas e desligar os comentários.
• A tua localização exata nunca é mostrada. Usamos apenas uma zona de cerca de 1,5 km.
• Apaga a tua conta na app quando quiseres.

GRÁTIS, COM UPGRADES OPCIONAIS
O MATCH é grátis: cria o perfil, dá likes, faz match, conversa, vai a eventos e assiste a lives.
• MATCH+: likes ilimitados, vê quem gostou de ti, rewind, mais super likes e um boost por mês.
• SUPER MATCH: tudo do MATCH+, mais modo incógnito, quem visitou o teu perfil, super likes ilimitados e prioridade nas mensagens.
As subscrições renovam automaticamente até as cancelares no Google Play. As moedas MATCH são opcionais: servem para presentes nos lives ou para dar boost ao teu perfil. Ganha moedas grátis com a sequência diária e convidando amigos.

Termos: [TERMS_URL]
Privacidade: [PRIVACY_URL]
```

**Category:** Dating · **Tags:** Dating, Social, Events · **Contact email:** [support@…] ·
**Website:** [MARKETING_URL] · **Privacy policy URL:** [PRIVACY_URL] (required)

---

## 3. Graphics and screenshots plan

| Asset | Spec | Plan |
|---|---|---|
| App icon | 512×512 PNG, 32-bit, ≤ 1 MB | Export from `apps/mobile/assets/source/gen-icons.py` (matchstick on `#15121C`). |
| Feature graphic | 1024×500 JPG/PNG, no alpha | Matchstick logo on the left; the tagline "Fewer swipes. Real dates." in the brand gradient on the right; dark `#15121C` background. No device frames, nothing important in the outer 10%. |
| Phone screenshots | 2–8, 9:16, 1080×1920 minimum (we use 1080×2400) | 6 screenshots, below. |
| 7"/10" tablet | optional | Skip (phone-only for now). |

**Screenshot set** (capture on an Android phone with the seeded test accounts from
`TEST_ACCOUNTS.md`, dark mode, clean status bar, no real people's photos unless you have the
rights). Each one gets a short caption band at the top in EN and in PT.

| # | Screen | Caption EN | Legenda PT |
|---|---|---|---|
| 1 | Discover card with the "Why you match" chips | Fewer swipes. Better matches. | Menos swipes. Matches melhores. |
| 2 | Daily picks | Your picks for today | As tuas escolhas de hoje |
| 3 | The MATCH moment overlay | It's mutual? It's a match. | É mútuo? É match. |
| 4 | Live → ⚡ Speed dating room with the round timer | Live speed dating, 3-minute rounds | Speed dating ao vivo, rondas de 3 min |
| 5 | Live → 🌙 Question of the night | Answer live. Find your people. | Responde em direto. Encontra a tua gente. |
| 6 | Chat with an expiring-match banner, or Events near you | Chats that don't die · Real-life events | Conversas que não morrem · Eventos reais |

Don't show other users' exact location, real names or the admin account in screenshots.

---

## 4. Content rating (IARC questionnaire)

- **Category:** *Social Networking, Forums, Blogs, and User-Generated Content Sharing* (the
  dating app path).
- Violence, fear, blood: **No**
- Sexuality or nudity in the app's own content: **No**. Users can upload photos, but nudity is
  forbidden by the Terms and reportable.
- Crude humour or profanity in the app's own content: **No**
- Controlled substances (drugs, alcohol, tobacco) as app content: **No**. Interests may mention
  wine or drinks; that's user content.
- Gambling or simulated gambling: **No**. Coins only buy gifts, with no chance-based mechanics.
- **Users can interact or exchange content: Yes** (chat after a match, comments, stories,
  posts, lives, video calls).
- **Shares the user's location with other users: Yes**, approximate only (distance or city,
  never exact).
- **Digital purchases: Yes** (subscriptions and coin packs).
- Unrestricted internet or web browsing: **No**
- Promotes or sells age-restricted products: **No**

The IARC rating will probably come out lower than 18. That's fine, because the age gate is set
separately in **Target audience** below.

## 5. App content declarations

| Section | Answer |
|---|---|
| Privacy policy | [PRIVACY_URL] |
| Ads | **No, the app has no ads** (no ad SDKs) |
| App access | **Some functionality is restricted** → give the reviewer a demo account with a complete profile (email and password; create a dedicated `review@` account, not a seeded test one) and note that live video needs a second device. |
| Target audience | **18+ only**. Not designed for children. The app enforces 18+ at sign-up (date of birth). |
| Content: UGC | Yes. Moderation: report on every profile, message, story, post, comment and live; block everywhere; auto-hide after reports; admin moderation queue; hosts can remove or mute viewers. |
| News app | No |
| COVID-19 / health / financial features | No / No / No |
| Government app | No |
| Data safety | See §6 |
| Account deletion | In-app: Profile → Settings & privacy → Delete account. **Web URL: [DELETE_URL]**, a page explaining how to request deletion without the app (required). |
| Dating app declaration | If asked: it's a dating app for adults, with mutual-match messaging only and real-time video (lives and calls). |
| Foreground service permissions | Not needed if `enableBackgroundPlayback: false` ships (see ANDROID_PUSH.md). Otherwise declare "media playback" with a video. |
| Photo and video permissions | Uses the system photo picker; no broad media access needed (block `READ_EXTERNAL_STORAGE`, see ANDROID_PUSH.md). |

## 6. Data safety form

**Overview answers**
- Does the app collect or share any of the required user data types? **Yes**
- Is all user data encrypted in transit? **Yes** (HTTPS/TLS to Supabase, Expo, RevenueCat,
  LiveKit)
- Do you provide a way for users to request deletion? **Yes** (in-app + [DELETE_URL])
- Shared with third parties? **No.** Supabase, Expo, RevenueCat, LiveKit and Google FCM are
  *service providers* acting on our behalf, which Google doesn't count as "sharing". Data
  shown to other users at the user's request (profile, messages) isn't "sharing" either.

**Data types collected** (all *Collected*, none *Shared*, none used for ads or marketing,
none sold)

| Category → type | Required? | Purposes |
|---|---|---|
| Location → **Approximate location** | Optional (the app works with a typed city) | App functionality (distance, people and events nearby) |
| Personal info → **Name** | Required | App functionality, Account management |
| Personal info → **Email address** | Required | Account management, App functionality (password-reset emails) |
| Personal info → **User IDs** | Required | App functionality, Account management |
| Personal info → **Sexual orientation** (who you want to meet) | Required | App functionality (matching) |
| Personal info → **Other info** (date of birth / age, gender, intention, bio, interests, Friday answer) | Required (DOB, gender); others optional | App functionality, Fraud prevention, security and compliance (18+) |
| Financial info → **Purchase history** | Optional | App functionality (unlocking plans and coins), Account management |
| Messages → **Other in-app messages** (chats, live comments) | Optional | App functionality, Fraud prevention, security and compliance (reports) |
| Photos and videos → **Photos** | Required (profile photo to interact) | App functionality |
| Photos and videos → **Videos** (video stories) | Optional | App functionality |
| Audio → **Voice or sound recordings** (voice notes) | Optional | App functionality |
| App activity → **App interactions** (likes, matches, RSVPs, live participation) | Required | App functionality, Fraud prevention, security and compliance |
| App activity → **Other user-generated content** (stories, posts, comments, post-date feedback, reports) | Optional | App functionality, Fraud prevention, security and compliance |
| Device or other IDs → **Device or other IDs** (push token) | Optional | App functionality (notifications) |

**Not collected:** precise location (once `ACCESS_FINE_LOCATION` is blocked; we only use a
low-accuracy fix that the server turns into a ~1.5 km cell), contacts, calendar, health,
financial account numbers (Google Play handles payments), web history, files, installed apps,
crash logs and diagnostics (no crash SDK; update this if Sentry or similar is added).

**Ephemeral processing:** live video and call audio/video go through LiveKit in real time
and aren't recorded or stored.

> Keep this consistent with `docs/legal/privacy.*.md` and Apple's App Privacy labels
> (STORE_CHECKLIST §1).

## 7. Release track

1. Internal testing → upload the `production` AAB (`npx eas-cli build -p android --profile
   production`, then `npx eas-cli submit -p android --profile production`; the track is
   `internal` and the status `draft` in `eas.json`).
2. **Closed testing with 12+ testers for 14 days** (required for personal developer accounts).
3. Production.

---

### Length check
```bash
python3 docs/check_listing_lengths.py
```
