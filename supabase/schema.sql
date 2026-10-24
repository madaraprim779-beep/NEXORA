
-- NEXORA : conversations privées et messages
-- À exécuter dans Supabase SQL Editor.
-- Ne pas exécuter avant d'avoir vérifié le schéma existant.

create table if not exists public.conversations (
  id uuid primary key default gen_random_uuid(),
  user_one uuid not null references auth.users(id) on delete cascade,
  user_two uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),

  constraint conversations_different_users
    check (user_one <> user_two),

  constraint conversations_ordered_users
    check (user_one < user_two),

  constraint conversations_unique_pair
    unique (user_one, user_two)
);

create table if not exists public.messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null
    references public.conversations(id) on delete cascade,
  sender_id uuid not null
    references auth.users(id) on delete cascade,
  content text not null,
  created_at timestamptz not null default now(),

  constraint messages_content_length
    check (char_length(trim(content)) between 1 and 5000)
);

create index if not exists messages_conversation_created_idx
  on public.messages (conversation_id, created_at);

alter table public.conversations enable row level security;
alter table public.messages enable row level security;

drop policy if exists "Participants can read conversations"
  on public.conversations;

create policy "Participants can read conversations"
on public.conversations
for select
to authenticated
using (
  auth.uid() = user_one or auth.uid() = user_two
);

drop policy if exists "Participants can read messages"
  on public.messages;

create policy "Participants can read messages"
on public.messages
for select
to authenticated
using (
  exists (
    select 1
    from public.conversations c
    where c.id = conversation_id
      and auth.uid() in (c.user_one, c.user_two)
  )
);

drop policy if exists "Participants can send messages"
  on public.messages;

create policy "Participants can send messages"
on public.messages
for insert
to authenticated
with check (
  sender_id = auth.uid()
  and exists (
    select 1
    from public.conversations c
    where c.id = conversation_id
      and auth.uid() in (c.user_one, c.user_two)
  )
);
