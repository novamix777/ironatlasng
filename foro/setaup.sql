-- Pega esto en Supabase > SQL Editor > Run (una sola vez)

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  username text unique not null check (username ~ '^[A-Za-z0-9_]{3,20}$'),
  role text not null default 'user' check (role in ('user','admin')),
  banned boolean not null default false,
  created_at timestamptz default now()
);

create table public.channels (
  id bigint generated always as identity primary key,
  name text unique not null check (char_length(name) between 2 and 30),
  description text check (char_length(description) <= 120),
  admin_only boolean not null default false
);

create table public.messages (
  id bigint generated always as identity primary key,
  channel_id bigint not null references public.channels(id) on delete cascade,
  user_id uuid not null default auth.uid() references public.profiles(id) on delete cascade,
  content text not null check (char_length(content) between 1 and 500),
  created_at timestamptz default now()
);
create index on public.messages (channel_id, created_at desc);

-- helpers
create function public.is_admin() returns boolean language sql security definer set search_path = public stable as
$$ select exists(select 1 from profiles where id = auth.uid() and role = 'admin' and not banned) $$;

create function public.is_active() returns boolean language sql security definer set search_path = public stable as
$$ select exists(select 1 from profiles where id = auth.uid() and not banned) $$;

-- crear perfil automáticamente al registrarse
create function public.handle_new_user() returns trigger language plpgsql security definer set search_path = public as
$$ begin
  insert into profiles(id, username) values (new.id, new.raw_user_meta_data->>'username');
  return new;
end $$;
create trigger on_auth_user_created after insert on auth.users for each row execute function public.handle_new_user();

-- anti-flood: 1 mensaje por segundo por usuario
create function public.rate_limit() returns trigger language plpgsql as
$$ begin
  if exists(select 1 from messages where user_id = new.user_id and created_at > now() - interval '1 second') then
    raise exception 'Demasiado rápido';
  end if;
  return new;
end $$;
create trigger msg_rate before insert on public.messages for each row execute function public.rate_limit();

-- RLS: nadie hace nada que no esté permitido aquí
alter table public.profiles enable row level security;
alter table public.channels enable row level security;
alter table public.messages enable row level security;

create policy "ver perfiles" on profiles for select to authenticated using (true);
create policy "admin edita perfiles" on profiles for update to authenticated using (is_admin()) with check (is_admin());

create policy "ver canales" on channels for select to authenticated using (true);
create policy "admin crea canales" on channels for insert to authenticated with check (is_admin());
create policy "admin borra canales" on channels for delete to authenticated using (is_admin());

create policy "ver mensajes" on messages for select to authenticated using (is_active());
create policy "enviar mensajes" on messages for insert to authenticated with check (
  user_id = auth.uid() and is_active()
  and (is_admin() or not exists(select 1 from channels c where c.id = channel_id and c.admin_only))
);
create policy "borrar mensajes" on messages for delete to authenticated using (user_id = auth.uid() or is_admin());

alter publication supabase_realtime add table public.messages;

insert into channels(name, description, admin_only) values
 ('anuncios','Avisos oficiales', true),
 ('general','Conversación libre', false),
 ('ayuda','Dudas y soporte', false);

-- DESPUÉS de registrarte en tu web, conviértete en admin:
-- update profiles set role = 'admin' where username = 'TU_USUARIO';
