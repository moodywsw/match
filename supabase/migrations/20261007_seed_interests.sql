-- Seeded via apply_migration seed_interests
insert into public.interests (category, label) values
  ('music', 'Indie'), ('music', 'Pop'), ('music', 'Hip-hop'), ('music', 'Electronic'), ('music', 'Live concerts'),
  ('food', 'Cooking'), ('food', 'Coffee'), ('food', 'Vegan'), ('food', 'Wine'), ('food', 'Street food'),
  ('lifestyle', 'Travel'), ('lifestyle', 'Fitness'), ('lifestyle', 'Hiking'), ('lifestyle', 'Photography'),
  ('lifestyle', 'Pets'), ('lifestyle', 'Yoga'),
  ('movies', 'Cinema'), ('movies', 'Documentaries'), ('movies', 'Sci-fi'), ('movies', 'Comedy')
on conflict (label) do nothing;
