-- Things — seed
--
-- Profile IDs are fixed constants, matching src/store/useProfile.ts. That way
-- claimed_by / created_by references made while the app was running purely on
-- the local adapter still resolve after the switch to Supabase.

insert into profiles (id, slug, display_name, avatar_emoji, color_hex) values
  ('11111111-1111-4111-8111-111111111111', 'avi',    'Avi',    '🦊', '#7c5cff'),
  ('22222222-2222-4222-8222-222222222222', 'jackie', 'Jackie', '🦋', '#ff6ea9')
on conflict (id) do nothing;

-- Jackie navigates with Waze, Avi with Google Maps. Both changeable in-app.
insert into profile_settings (profile_id, accent_hex, nav_app) values
  ('11111111-1111-4111-8111-111111111111', '#7c5cff', 'google'),
  ('22222222-2222-4222-8222-222222222222', '#ff6ea9', 'waze')
on conflict (profile_id) do nothing;

insert into household_settings (singleton, home_label) values (true, 'Home')
on conflict (singleton) do nothing;
