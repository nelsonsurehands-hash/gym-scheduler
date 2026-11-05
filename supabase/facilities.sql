-- ============================================================================
-- Extra Coach Facilities: a school's gym / facility schedule.
-- Separate from The Extra Coach team data. Same sign-in accounts.
--   fac_orgs      a school or gym
--   fac_spaces    the rooms people book (Main Gym, Elementary Gym, Cafeteria…)
--   fac_members   who belongs: admin (approves, manages people), editor (books), viewer (sees)
--   fac_invites   staff the admin added by email; they join when they sign in
--   fac_bookings  times on the schedule: pending → approved / declined
-- Safe to run again: it only creates what's missing and replaces functions and rules.
-- ============================================================================

create table if not exists public.fac_orgs (
  id            uuid primary key default gen_random_uuid(),
  name          text not null check (length(name) between 1 and 120),
  approval      boolean not null default true,     -- editors' bookings wait for an admin
  day_start     text not null default '06:00',
  day_end       text not null default '22:00',
  public_token  text unique,                        -- read-only link for the whole school; null = off
  created_by    uuid references auth.users(id) on delete set null default auth.uid(),
  created_at    timestamptz not null default now()
);

create table if not exists public.fac_spaces (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references public.fac_orgs(id) on delete cascade,
  name        text not null check (length(name) between 1 and 80),
  color       text not null default '#5b2a86',
  sort        integer not null default 0,
  created_at  timestamptz not null default now()
);
create index if not exists fac_spaces_org on public.fac_spaces(org_id);

create table if not exists public.fac_members (
  org_id        uuid not null references public.fac_orgs(id) on delete cascade,
  user_id       uuid not null references auth.users(id) on delete cascade,
  role          text not null default 'viewer' check (role in ('admin','editor','viewer')),
  direct        boolean not null default false,    -- editor can book without approval
  email         text,
  display_name  text,
  created_at    timestamptz not null default now(),
  primary key (org_id, user_id)
);
create index if not exists fac_members_user on public.fac_members(user_id);

create table if not exists public.fac_invites (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references public.fac_orgs(id) on delete cascade,
  email       text not null check (email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  role        text not null default 'viewer' check (role in ('admin','editor','viewer')),
  direct      boolean not null default false,
  created_by  uuid references auth.users(id) on delete set null default auth.uid(),
  created_at  timestamptz not null default now(),
  unique (org_id, email)
);

create table if not exists public.fac_bookings (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null references public.fac_orgs(id) on delete cascade,
  space_id      uuid not null references public.fac_spaces(id) on delete cascade,
  date          date not null,
  start_time    text not null check (start_time ~ '^\d{2}:\d{2}$'),
  end_time      text not null check (end_time ~ '^\d{2}:\d{2}$' and end_time > start_time),
  title         text not null check (length(title) between 1 and 120),
  group_name    text check (group_name is null or length(group_name) <= 80),
  notes         text check (notes is null or length(notes) <= 500),
  series_id     uuid,                               -- repeating bookings share one
  status        text not null default 'pending' check (status in ('pending','approved','declined')),
  requested_by  uuid references auth.users(id) on delete set null default auth.uid(),
  requester     text,
  decided_by    uuid references auth.users(id) on delete set null,
  decided_at    timestamptz,
  decline_note  text,
  created_at    timestamptz not null default now()
);
create index if not exists fac_bookings_org_date on public.fac_bookings(org_id, date);

-- ---------- helpers ----------
create or replace function public.fac_role(o uuid) returns text
language sql stable security definer set search_path = public as $$
  select role from fac_members where org_id = o and user_id = auth.uid() $$;
create or replace function public.fac_is_member(o uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists(select 1 from fac_members where org_id = o and user_id = auth.uid()) $$;
create or replace function public.fac_is_admin(o uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists(select 1 from fac_members where org_id = o and user_id = auth.uid() and role = 'admin') $$;
create or replace function public.fac_can_book(o uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists(select 1 from fac_members where org_id = o and user_id = auth.uid() and role in ('admin','editor')) $$;

-- Create a school: you become its admin, with one space to start.
create or replace function public.fac_create_org(p_name text, p_spaces text[] default array['Main Gym'])
returns uuid language plpgsql security definer set search_path = public as $$
declare o uuid; s text; i int := 0;
begin
  if auth.uid() is null then raise exception 'Sign in first'; end if;
  insert into fac_orgs(name) values (trim(p_name)) returning id into o;
  insert into fac_members(org_id, user_id, role, email, display_name)
    values (o, auth.uid(), 'admin', auth.jwt() ->> 'email',
            coalesce(nullif(auth.jwt() -> 'user_metadata' ->> 'full_name', ''), split_part(auth.jwt() ->> 'email', '@', 1)));
  foreach s in array coalesce(p_spaces, array['Main Gym']) loop
    if length(trim(s)) > 0 then
      insert into fac_spaces(org_id, name, sort, color)
        values (o, trim(s), i, (array['#5b2a86','#1f7a8c','#d0632a','#3c8d2f','#b3283c','#2d5bd3','#c79a12','#8a4f7d'])[1 + i % 8]);
      i := i + 1;
    end if;
  end loop;
  return o;
end $$;

-- Join every school that invited your email. Run after each sign-in.
create or replace function public.fac_claim_invites() returns integer
language plpgsql security definer set search_path = public as $$
declare n int := 0; inv fac_invites; em text := lower(auth.jwt() ->> 'email');
begin
  if auth.uid() is null or em is null then return 0; end if;
  for inv in select * from fac_invites where lower(email) = em loop
    insert into fac_members(org_id, user_id, role, direct, email, display_name)
      values (inv.org_id, auth.uid(), inv.role, inv.direct, em,
              coalesce(nullif(auth.jwt() -> 'user_metadata' ->> 'full_name', ''), split_part(em, '@', 1)))
      on conflict (org_id, user_id) do nothing;
    delete from fac_invites where id = inv.id;
    n := n + 1;
  end loop;
  return n;
end $$;

-- Bookings: editors without "direct" always start as pending; only admins decide.
-- An approved booking can't overlap another approved one in the same space.
create or replace function public.fac_booking_guard() returns trigger
language plpgsql security definer set search_path = public as $$
declare r text; d boolean; clash fac_bookings;
begin
  select role, direct into r, d from fac_members where org_id = new.org_id and user_id = auth.uid();
  -- the school can turn approval off: then every editor books directly
  d := coalesce(d, false) or not coalesce((select approval from fac_orgs where id = new.org_id), true);
  if not exists(select 1 from fac_spaces where id = new.space_id and org_id = new.org_id) then
    raise exception 'That space is not part of this school';
  end if;
  if tg_op = 'INSERT' then
    new.requested_by := auth.uid();
    if new.requester is null then new.requester := (select coalesce(display_name, email) from fac_members where org_id = new.org_id and user_id = auth.uid()); end if;
    if r = 'admin' or (r = 'editor' and d) then
      if new.status = 'pending' then new.status := 'approved'; end if;
    else
      new.status := 'pending';
    end if;
  elsif new.status is distinct from old.status then
    if r is distinct from 'admin' and not (r = 'editor' and d and old.requested_by = auth.uid()) then
      raise exception 'Only an administrator can approve or decline';
    end if;
    new.decided_by := auth.uid(); new.decided_at := now();
  elsif r is distinct from 'admin' then
    -- the person who asked may change their own booking; it goes back to the admin
    if old.status = 'approved' and not d then new.status := 'pending'; end if;
  end if;
  if new.status = 'approved' then
    select * into clash from fac_bookings b
      where b.org_id = new.org_id and b.space_id = new.space_id and b.date = new.date and b.status = 'approved'
        and b.id <> new.id and b.start_time < new.end_time and new.start_time < b.end_time limit 1;
    if found then
      raise exception 'Overlaps "%" (% – %) in that space', clash.title, clash.start_time, clash.end_time;
    end if;
  end if;
  return new;
end $$;
drop trigger if exists fac_booking_guard on public.fac_bookings;
create trigger fac_booking_guard before insert or update on public.fac_bookings
  for each row execute function public.fac_booking_guard();

-- Keep at least one admin.
create or replace function public.fac_keep_admin() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if (tg_op = 'DELETE' and old.role = 'admin') or (tg_op = 'UPDATE' and old.role = 'admin' and new.role <> 'admin') then
    if exists(select 1 from fac_orgs where id = old.org_id) and
       not exists(select 1 from fac_members where org_id = old.org_id and role = 'admin' and user_id <> old.user_id) then
      raise exception 'A school needs at least one administrator';
    end if;
  end if;
  return coalesce(new, old);
end $$;
drop trigger if exists fac_keep_admin on public.fac_members;
create trigger fac_keep_admin before update or delete on public.fac_members
  for each row execute function public.fac_keep_admin();

-- Read-only schedule for the school's public link (no sign-in). Approved bookings only.
create or replace function public.fac_public(p_token text, p_from date, p_to date) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare o fac_orgs;
begin
  select * into o from fac_orgs where public_token = p_token and p_token is not null and length(p_token) >= 12;
  if not found then return null; end if;
  if p_to - p_from > 62 then p_to := p_from + 62; end if;
  return jsonb_build_object(
    'org', jsonb_build_object('name', o.name, 'day_start', o.day_start, 'day_end', o.day_end),
    'spaces', coalesce((select jsonb_agg(jsonb_build_object('id', id, 'name', name, 'color', color) order by sort, name) from fac_spaces where org_id = o.id), '[]'),
    'bookings', coalesce((select jsonb_agg(jsonb_build_object('id', id, 'space_id', space_id, 'date', date, 'start_time', start_time,
        'end_time', end_time, 'title', title, 'group_name', group_name) order by date, start_time)
      from fac_bookings where org_id = o.id and status = 'approved' and date between p_from and p_to), '[]'));
end $$;

-- ---------- row-level security ----------
alter table public.fac_orgs     enable row level security;
alter table public.fac_spaces   enable row level security;
alter table public.fac_members  enable row level security;
alter table public.fac_invites  enable row level security;
alter table public.fac_bookings enable row level security;

drop policy if exists "fac orgs read"    on public.fac_orgs;
drop policy if exists "fac orgs change"  on public.fac_orgs;
drop policy if exists "fac orgs delete"  on public.fac_orgs;
create policy "fac orgs read"   on public.fac_orgs for select to authenticated using (fac_is_member(id));
create policy "fac orgs change" on public.fac_orgs for update to authenticated using (fac_is_admin(id)) with check (fac_is_admin(id));
create policy "fac orgs delete" on public.fac_orgs for delete to authenticated using (fac_is_admin(id));

drop policy if exists "fac spaces read"   on public.fac_spaces;
drop policy if exists "fac spaces write"  on public.fac_spaces;
create policy "fac spaces read"  on public.fac_spaces for select to authenticated using (fac_is_member(org_id));
create policy "fac spaces write" on public.fac_spaces for all to authenticated using (fac_is_admin(org_id)) with check (fac_is_admin(org_id));

drop policy if exists "fac members read"    on public.fac_members;
drop policy if exists "fac members admin"   on public.fac_members;
drop policy if exists "fac members leave"   on public.fac_members;
create policy "fac members read"  on public.fac_members for select to authenticated using (fac_is_member(org_id));
create policy "fac members admin" on public.fac_members for update to authenticated using (fac_is_admin(org_id)) with check (fac_is_admin(org_id));
create policy "fac members leave" on public.fac_members for delete to authenticated using (fac_is_admin(org_id) or user_id = auth.uid());

drop policy if exists "fac invites admin" on public.fac_invites;
create policy "fac invites admin" on public.fac_invites for all to authenticated using (fac_is_admin(org_id)) with check (fac_is_admin(org_id));

drop policy if exists "fac bookings read"   on public.fac_bookings;
drop policy if exists "fac bookings add"    on public.fac_bookings;
drop policy if exists "fac bookings change" on public.fac_bookings;
drop policy if exists "fac bookings delete" on public.fac_bookings;
create policy "fac bookings read"   on public.fac_bookings for select to authenticated using (fac_is_member(org_id));
create policy "fac bookings add"    on public.fac_bookings for insert to authenticated with check (fac_can_book(org_id));
create policy "fac bookings change" on public.fac_bookings for update to authenticated
  using (fac_is_admin(org_id) or (fac_can_book(org_id) and requested_by = auth.uid()))
  with check (fac_is_admin(org_id) or (fac_can_book(org_id) and requested_by = auth.uid()));
create policy "fac bookings delete" on public.fac_bookings for delete to authenticated
  using (fac_is_admin(org_id) or (fac_can_book(org_id) and requested_by = auth.uid()));

grant select, insert, update, delete on public.fac_orgs, public.fac_spaces, public.fac_members, public.fac_invites, public.fac_bookings to authenticated;
grant execute on function public.fac_create_org(text, text[]), public.fac_claim_invites() to authenticated;
grant execute on function public.fac_public(text, date, date) to anon, authenticated;
