-- Demo scenarios between the seeded TEST profiles and one admin account.
-- Run by seed_test_profiles.py, which substitutes the '__IDS__' / '__ADMIN__' placeholders.
-- Runs as the DB owner via the Management API (server side). Where a function reads
-- auth.uid() (We met, feedback, events, RSVPs, stories, posts) the acting test user is
-- set through request.jwt.claims for that call only, so the same rules as the app apply.

create function pg_temp.act(u uuid) returns void language sql as $f$
  select set_config('request.jwt.claims', case when u is null then '' else
    json_build_object('sub', u, 'role', 'authenticated')::text end, true);
$f$;

-- A likes B, B likes back -> the real try_create_match trigger creates match + conversation + lifecycle.
create function pg_temp.mk_match(a uuid, b uuid, at timestamptz) returns uuid language plpgsql as $f$
declare m uuid;
begin
  insert into public.likes (liker_id, liked_id) values (a, b);
  insert into public.likes (liker_id, liked_id) values (b, a);
  select id into m from public.matches where (user_a = a and user_b = b) or (user_a = b and user_b = a);
  if m is null then raise exception 'match not created'; end if;
  update public.likes set created_at = at - interval '2 hours' where liker_id = a and liked_id = b;
  update public.likes set created_at = at where liker_id = b and liked_id = a;
  update public.matches set created_at = at where id = m;
  update public.conversations set created_at = at where match_id = m;
  update public.match_lifecycle set matched_at = at, updated_at = now() where match_id = m;
  update public.notifications set created_at = at,
         read_at = case when at < now() - interval '3 hours' then at + interval '10 minutes' end
   where type = 'match' and payload->>'match_id' = m::text;
  return m;
end $f$;

create function pg_temp.say(m uuid, s uuid, body text, at timestamptz) returns void language sql as $f$
  insert into public.messages (conversation_id, sender_id, type, content, created_at)
  select c.id, s, 'text', body, at from public.conversations c where c.match_id = m;
$f$;

create function pg_temp.chat(m uuid, a uuid, b uuid, lines text[], t0 timestamptz, step interval) returns void
language plpgsql as $f$
declare i int;
begin
  for i in 1 .. cardinality(lines) loop
    perform pg_temp.say(m, case when i % 2 = 1 then a else b end, lines[i], t0 + step * (i - 1));
  end loop;
end $f$;

create function pg_temp.conv(m uuid) returns uuid language sql as $f$
  select id from public.conversations where match_id = m;
$f$;

do $seed$
declare
  ids jsonb := '__IDS__'::jsonb;
  me uuid := '__ADMIN__'::uuid;
  ines uuid := (ids->>'ines')::uuid;   marta uuid := (ids->>'marta')::uuid;   beatriz uuid := (ids->>'beatriz')::uuid;
  sofia uuid := (ids->>'sofia')::uuid; carolina uuid := (ids->>'carolina')::uuid; joana uuid := (ids->>'joana')::uuid;
  tiago uuid := (ids->>'tiago')::uuid; rui uuid := (ids->>'rui')::uuid;     miguel uuid := (ids->>'miguel')::uuid;
  duarte uuid := (ids->>'duarte')::uuid; andre uuid := (ids->>'andre')::uuid; alex uuid := (ids->>'alex')::uuid;
  m_ines uuid; m_tiago uuid; m_miguel uuid; m_rui uuid; m_duarte uuid; m_beatriz uuid;
  m1 uuid; m2 uuid; m3 uuid; p uuid; ev uuid;
begin
  perform pg_temp.act(null);

  -- 1. Fresh match, no messages for 26h -> nudge + conversation starters.
  m_ines := pg_temp.mk_match(ines, me, now() - interval '26 hours');

  -- 2. Brand-new match (match moment / new match row, no starters yet).
  m_beatriz := pg_temp.mk_match(beatriz, me, now() - interval '20 minutes');

  -- 3. Silent match: two messages ~84h ago -> tick marks it EXPIRING.
  m_tiago := pg_temp.mk_match(tiago, me, now() - interval '4 days');
  perform pg_temp.chat(m_tiago, tiago, me, array[
    'Hey! Your Friday answer made me laugh. How''s your week going?',
    'Busy but good! Yours?'], now() - interval '84 hours', interval '40 minutes');

  -- 4. Chatty match: 11 + 11 messages -> video call suggestion.
  m_miguel := pg_temp.mk_match(miguel, me, now() - interval '3 days');
  perform pg_temp.chat(m_miguel, miguel, me, array[
    'Hey! Your profile made me smile. Are you a jazz person or should I keep my sax talk to a minimum? 😄',
    'Ha, I''m more of a "whatever''s playing" person. But I''m curious about the sax.',
    'Fair answer. I play Thursdays at a tiny bar in Bairro Alto, mostly standards.',
    'That sounds amazing. How long have you been playing?',
    'Since I was 14. My uncle left his old alto at our place and never came back for it.',
    'Best accidental inheritance ever',
    'Right? What about you, what do you do when you''re not on here?',
    'Work during the week, long walks by the river at weekends. Belém to Cais do Sodré is my favourite stretch.',
    'That''s a proper walk! Do you stop for pastéis de nata on the way or is that cheating?',
    'It''s mandatory, not cheating 😂',
    'Good, we agree on the important things.',
    'What''s the best concert you''ve ever been to?',
    'Kamasi Washington at the Coliseu. Three hours and nobody sat down. You?',
    'A fado night in Alfama with friends. Tiny place, candles, no microphones.',
    'Ok that''s honestly better than mine.',
    'It wasn''t a competition, but I''ll take the win',
    'Haha. I''m really enjoying this chat',
    'Same here, you''re easy to talk to',
    'Would you be up for a quick video call this week? Easier than typing everything out',
    'Maybe! Let me see how the week goes',
    'No pressure at all. I''m free most evenings after 8',
    'Good to know 🙂'], now() - interval '68 hours', interval '3 hours');

  -- 5. Met in person: Rui marked "We met" -> admin is asked to confirm, then private feedback.
  m_rui := pg_temp.mk_match(rui, me, now() - interval '6 days');
  perform pg_temp.chat(m_rui, rui, me, array[
    'Hi! I saw you like long walks too. Sintra or Arrábida?',
    'Arrábida, the beaches are unreal. You?',
    'Sintra, because I always get lost there and somehow that''s the fun part',
    'Haha that''s a good reason',
    'I make furniture for a living, so weekends outside keep me sane',
    'That''s such a cool job. What are you building at the moment?',
    'A walnut table for a café in Graça. Slow, but satisfying.',
    'I''d love to see it when it''s done',
    'Want to grab a coffee on Saturday? There''s a nice kiosk in Jardim da Estrela',
    'Sure, Saturday at 4?',
    'Perfect, see you there',
    'See you!'], now() - interval '6 days' + interval '1 hour', interval '5 hours');
  perform pg_temp.say(m_rui, rui, 'Thanks for today, that was really nice. Same time next week? 🙂', now() - interval '26 hours');
  perform pg_temp.act(rui);
  perform private.mark_we_met(m_rui);
  perform pg_temp.act(null);
  update public.date_confirmations set created_at = now() - interval '25 hours' where match_id = m_rui;
  update public.notifications set created_at = now() - interval '25 hours'
   where type = 'we_met' and payload->>'match_id' = m_rui::text;

  -- 6. Old silent match -> expired (Archived section).
  m_duarte := pg_temp.mk_match(duarte, me, now() - interval '9 days');
  perform pg_temp.say(m_duarte, duarte, 'Hey! Surf or kitesurf person?', now() - interval '8 days 20 hours');

  -- 7. Likes on the admin (Likes you); Carolina's is a super like (notifies).
  insert into public.likes (liker_id, liked_id) values (marta, me), (joana, me);
  update public.likes set created_at = now() - interval '5 hours' where liker_id = marta and liked_id = me;
  update public.likes set created_at = now() - interval '2 days' where liker_id = joana and liked_id = me;
  insert into public.likes (liker_id, liked_id, is_super_like) values (carolina, me, true);

  -- 8. Sofia gets the "Real photos" trust badge: 3 dates, both sides confirmed, positive feedback.
  m1 := pg_temp.mk_match(andre, sofia, now() - interval '21 days');
  m2 := pg_temp.mk_match(alex, sofia, now() - interval '14 days');
  m3 := pg_temp.mk_match(duarte, sofia, now() - interval '10 days');
  perform pg_temp.chat(m1, andre, sofia, array['Board games on Friday?', 'Only if I get to be the banker', 'Deal'], now() - interval '20 days', interval '1 hour');
  perform pg_temp.chat(m2, alex, sofia, array['That francesinha offer still stands?', 'Always. Thursday?'], now() - interval '13 days', interval '1 hour');
  perform pg_temp.chat(m3, duarte, sofia, array['Kitesurf lesson this weekend?', 'Only if you catch me when I fall'], now() - interval '9 days', interval '1 hour');
  perform pg_temp.say(m1, andre, 'Rematch soon?', now() - interval '20 hours');
  perform pg_temp.say(m2, alex, 'Dumplings next time, my treat', now() - interval '18 hours');
  perform pg_temp.say(m3, duarte, 'Wind looks good on Sunday 🌬️', now() - interval '16 hours');
  perform pg_temp.act(andre);  perform private.mark_we_met(m1);
  perform private.submit_date_feedback(m1, 'yes', true, 'yes', null);
  perform pg_temp.act(alex);   perform private.mark_we_met(m2);
  perform private.submit_date_feedback(m2, 'mostly', true, 'maybe', null);
  perform pg_temp.act(duarte); perform private.mark_we_met(m3);
  perform private.submit_date_feedback(m3, 'yes', true, 'yes', null);
  perform pg_temp.act(sofia);
  perform private.mark_we_met(m1); perform private.mark_we_met(m2); perform private.mark_we_met(m3);
  perform pg_temp.act(null);

  -- 9. Stories (expire 24h after seeding) and feed posts.
  perform pg_temp.act(ines);
  insert into public.stories (user_id, type, content) values (ines, 'text', '{"text":"Golden hour at Senhora do Monte 🌅 Lisbon, you show-off."}');
  perform pg_temp.act(miguel);
  insert into public.stories (user_id, type, content) values (miguel, 'poll', '{"question":"Thursday jam: standards or bossa nova?","options":["Standards","Bossa nova"]}');
  perform pg_temp.act(marta);
  insert into public.stories (user_id, type, content) values (marta, 'question', '{"question":"Best late-night food in Lisbon? Go."}');

  perform pg_temp.act(joana);
  insert into public.posts (user_id, type, content) values (joana, 'text',
    'Finished editing my first short film at 3am. Screening at Cinema São Jorge next month, come say hi 🎬') returning id into p;
  update public.posts set created_at = now() - interval '3 hours' where id = p;
  insert into public.post_likes (post_id, user_id) values (p, ines), (p, alex), (p, miguel);
  insert into public.comments (post_id, user_id, content) values (p, alex, 'So proud of you!! Saving the date');
  perform pg_temp.act(duarte);
  insert into public.posts (user_id, type, content, poll_options) values (duarte, 'poll', 'Best beach near Lisbon?',
    '["Carcavelos","Costa da Caparica","Guincho","Comporta"]') returning id into p;
  update public.posts set created_at = now() - interval '1 day' where id = p;
  insert into public.post_likes (post_id, user_id) values (p, beatriz), (p, tiago);
  perform pg_temp.act(andre);
  insert into public.posts (user_id, type, content) values (andre, 'text',
    'Sintra hike this Sunday, Peninha trail, ~12 km, easy pace. Bringing too many sandwiches as usual 🥪') returning id into p;
  update public.posts set created_at = now() - interval '6 hours' where id = p;
  insert into public.comments (post_id, user_id, content) values (p, rui, 'Count me in if it doesn''t rain');

  -- 10. One upcoming event (Miguel hosts; creator auto-RSVPs), plus RSVPs.
  perform pg_temp.act(miguel);
  insert into public.events (title, category, description, city, area, location, starts_at, ends_at, capacity, cell_lat, cell_lng)
  values ('Jazz night at Hot Clube', 'Music',
    'Live standards and a jam session after 23h. Come alone or bring friends, I''ll save a table near the stage.',
    'Lisbon', 'Avenida da Liberdade', 'Hot Clube de Portugal, Praça da Alegria 48',
    date_trunc('day', now() at time zone 'Europe/Lisbon') at time zone 'Europe/Lisbon'
      + make_interval(days => (12 - extract(dow from now() at time zone 'Europe/Lisbon')::int) % 7 + 7) + interval '21 hours 30 minutes',
    date_trunc('day', now() at time zone 'Europe/Lisbon') at time zone 'Europe/Lisbon'
      + make_interval(days => (12 - extract(dow from now() at time zone 'Europe/Lisbon')::int) % 7 + 8) + interval '30 minutes',
    40, 38.7184, -9.1449) returning id into ev;
  perform pg_temp.act(ines);  insert into public.event_participants (event_id, user_id) values (ev, ines);
  perform pg_temp.act(tiago); insert into public.event_participants (event_id, user_id) values (ev, tiago);
  perform pg_temp.act(sofia); insert into public.event_participants (event_id, user_id) values (ev, sofia);
  perform pg_temp.act(null);

  -- 11. Lifecycle: run the real tick (nudge Inês, expire-warn Tiago + Duarte), then shape timers.
  perform private.match_lifecycle_tick();
  update public.match_lifecycle set expiring_at = now() - interval '12 hours', expires_at = now() + interval '36 hours'
   where match_id = m_tiago;
  update public.notifications set created_at = now() - interval '12 hours',
         payload = jsonb_set(payload, '{expires_at}', to_jsonb(now() + interval '36 hours'))
   where type = 'match_expiring' and payload->>'match_id' = m_tiago::text;
  update public.match_lifecycle set expires_at = now() - interval '1 minute' where match_id = m_duarte;
  perform private.match_lifecycle_tick();
  update public.match_lifecycle set expiring_at = now() - interval '5 days', expires_at = now() - interval '3 days',
         expired_at = now() - interval '3 days' where match_id = m_duarte;
  update public.notifications set created_at = now() - interval '5 days', read_at = now() - interval '5 days'
   where type = 'match_expiring' and payload->>'match_id' = m_duarte::text;
  update public.notifications set created_at = now() - interval '3 days'
   where type = 'match_expired' and payload->>'match_id' = m_duarte::text;

  -- 12. Read state: older messages read; Rui's last message and Miguel's latest stay unread for the admin.
  update public.messages ms set read_at = ms.created_at + interval '5 minutes'
   where ms.conversation_id in (select id from public.conversations where match_id in (m_tiago, m_miguel, m_rui, m_duarte, m1, m2, m3))
     and ms.created_at < now() - interval '27 hours';
  insert into public.conversation_reads (conversation_id, user_id, last_read_at)
  select c.id, u.uid, (select max(created_at) from public.messages x where x.conversation_id = c.id and x.created_at < now() - interval '27 hours')
    from public.conversations c
    cross join lateral (select unnest(array[(select user_a from public.matches where id = c.match_id),
                                            (select user_b from public.matches where id = c.match_id)]) uid) u
   where c.match_id in (m_tiago, m_miguel, m_rui, m_duarte)
  on conflict (conversation_id, user_id) do update set last_read_at = excluded.last_read_at;
  update public.notifications n set created_at = (select max(x.created_at) from public.messages x
           where x.conversation_id = (n.payload->>'conversation_id')::uuid and x.sender_id = n.actor_id)
   where n.type = 'message' and n.actor_id in (select id from public.profiles where is_test)
     and n.payload ? 'conversation_id';
  update public.notifications set read_at = created_at + interval '5 minutes'
   where type = 'message' and read_at is null and created_at < now() - interval '27 hours'
     and actor_id in (select id from public.profiles where is_test);

  -- 13. Regenerate today's picks for the admin on next open.
  delete from public.daily_picks where user_id = me;
  delete from private.pick_runs where user_id = me;
end $seed$;

select json_build_object(
  'test_profiles', (select count(*) from public.profiles where is_test),
  'admin_matches', (select json_agg(json_build_object('with', p.name, 'state', l.state, 'msgs', l.msgs_a + l.msgs_b,
        'nudged', l.nudged_at is not null, 'video', l.video_suggested_at is not null, 'expires_at', l.expires_at) order by p.name)
     from public.match_lifecycle l join public.profiles p on p.id = case when l.user_a = '__ADMIN__'::uuid then l.user_b else l.user_a end
    where '__ADMIN__'::uuid in (l.user_a, l.user_b)),
  'we_met', (select count(*) from public.date_confirmations d join public.profiles p on p.id = d.user_id and p.is_test),
  'sofia_badge', (select private.real_photos_verified(id) from public.profiles where is_test and name = 'Sofia'),
  'likes_on_admin', (select count(*) from public.likes where liked_id = '__ADMIN__'::uuid),
  'stories', (select count(*) from public.stories s join public.profiles p on p.id = s.user_id and p.is_test),
  'posts', (select count(*) from public.posts s join public.profiles p on p.id = s.user_id and p.is_test),
  'events', (select json_agg(json_build_object('title', e.title, 'starts_at', e.starts_at, 'going',
        (select count(*) from public.event_participants x where x.event_id = e.id)))
     from public.events e join public.profiles p on p.id = e.creator_id and p.is_test),
  'admin_notifications', (select json_object_agg(type, n) from (select type, count(*) n from public.notifications
     where user_id = '__ADMIN__'::uuid group by type) z)
);
