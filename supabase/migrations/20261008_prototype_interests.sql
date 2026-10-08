-- Add the MATCH prototype's taste chips (MatchApp.jsx onboarding pools) to the
-- interests catalog so onboarding/profile can store exactly what the UI shows.
-- Case-insensitive de-dup against labels that already exist (e.g. "Hip-hop").
insert into interests (category, label)
select v.category, v.label
from (values
  ('music','Pop'),('music','Hip-Hop'),('music','R&B'),('music','Rock'),('music','Techno'),
  ('music','House'),('music','Reggaeton'),('music','Classical'),('music','Jazz'),('music','Indie'),
  ('food','Sushi'),('food','Italian'),('food','Burgers'),('food','Portuguese'),('food','Mexican'),
  ('food','Vegan'),('food','Fine dining'),('food','Street food'),
  ('lifestyle','Gym'),('lifestyle','Travel'),('lifestyle','Gaming'),('lifestyle','Fashion'),
  ('lifestyle','Nightlife'),('lifestyle','Reading'),('lifestyle','Beach'),('lifestyle','Hiking'),
  ('lifestyle','Concerts'),('lifestyle','Cooking'),
  ('movies','Horror'),('movies','Comedy'),('movies','Sci-Fi'),('movies','Romance'),('movies','Documentary')
) as v(category, label)
where not exists (select 1 from interests i where lower(i.label) = lower(v.label));
