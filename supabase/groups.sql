
-- NEXORA : groupes et membres
-- Sauvegarder ce fichier dans GitHub.
-- Vérifier le schéma existant avant de l'exécuter dans Supabase.

create table if not exists public.groups (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(trim(name)) between 2 and 60),
  description text,
  created_by uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

create table if not exists public.group_members (
  group_id uuid not null references public.groups(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null default 'member'
    check (role in ('admin', 'moderator', 'member')),
  created_at timestamptz not null default now(),
  primary key (group_id, user_id)
);

create table if not exists public.group_messages (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.groups(id) on delete cascade,
  sender_id uuid not null references auth.users(id) on delete cascade,
  content text not null
    check (char_length(trim(content)) between 1 and 5000),
  created_at timestamptz not null default now()
);

create index if not exists group_messages_recent_idx
  on public.group_messages (group_id, created_at desc);

alter table public.groups enable row level security;
alter table public.group_members enable row level security;
alter table public.group_messages enable row level security;

drop policy if exists "Members can read their groups"
  on public.groups;

create policy "Members can read their groups"
on public.groups
for select
to authenticated
using (
  exists (
    select 1
    from public.group_members gm
    where gm.group_id = id
      and gm.user_id = auth.uid()
  )
);

drop policy if exists "Members can read membership"
  on public.group_members;

create policy "Members can read membership"
on public.group_members
for select
to authenticated
using (
  exists (
    select 1
    from public.group_members gm
    where gm.group_id = group_id
      and gm.user_id = auth.uid()
  )
);

drop policy if exists "Members can read group messages"
  on public.group_messages;

create policy "Members can read group messages"
on public.group_messages
for select
to authenticated
using (
  exists (
    select 1
    from public.group_members gm
    where gm.group_id = group_messages.group_id
      and gm.user_id = auth.uid()
  )
);

drop policy if exists "Members can send group messages"
  on public.group_messages;

create policy "Members can send group messages"
on public.group_messages
for insert
to authenticated
with check (
  sender_id = auth.uid()
  and exists (
    select 1
    from public.group_members gm
    where gm.group_id = group_messages.group_id
      and gm.user_id = auth.uid()
  )
);
