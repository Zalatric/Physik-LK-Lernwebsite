-- =====================================================================
-- Datei-Cloud: Tabellen, Sicherheitsregeln (RLS), Speicher und Funktion
-- Einmalig im Supabase Dashboard unter „SQL Editor" ausführen.
-- Das Skript kann wiederholt ausgeführt werden (idempotent).
-- =====================================================================

-- 1) Datei-Tabelle (Whitelists und 30-MB-Grenze als CHECK-Constraints)
create table if not exists public.cloud_files (
  id uuid primary key default gen_random_uuid(),
  owner uuid not null references auth.users (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 200),
  fach text not null check (fach in ('Mathe','Physik','Sonstiges')),
  category text not null check (category in ('Unterrichtsmaterial','Zusammenfassung','Aufgaben','Lösungen','Klausurvorbereitung')),
  size bigint not null check (size between 1 and 31457280),
  mime text not null check (mime in (
    'application/pdf',
    'image/png','image/jpeg','image/webp','image/gif',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/zip')),
  path text not null unique,
  created_at timestamptz not null default now()
);

-- 2) Anzeigenamen (statt E-Mail-Adressen in der Dateiliste)
create table if not exists public.profiles (
  user_id uuid primary key references auth.users (id) on delete cascade,
  display_name text not null check (char_length(display_name) between 1 and 40)
);

-- 3) Sicherheitsregeln (Row Level Security)
alter table public.cloud_files enable row level security;
alter table public.profiles enable row level security;

-- cloud_files: alle angemeldeten Nutzer lesen …
drop policy if exists cloud_files_select on public.cloud_files;
create policy cloud_files_select on public.cloud_files
  for select to authenticated using (true);

-- … aber NICHT direkt einfügen oder ändern (kein INSERT-/UPDATE-Recht):
-- Neue Einträge entstehen ausschließlich über finalize_cloud_upload(),
-- und löschen darf nur der Eigentümer:
drop policy if exists cloud_files_delete on public.cloud_files;
create policy cloud_files_delete on public.cloud_files
  for delete to authenticated using (owner = auth.uid());

-- profiles: jeder liest, ändert nur das eigene
drop policy if exists profiles_select on public.profiles;
drop policy if exists profiles_insert on public.profiles;
drop policy if exists profiles_update on public.profiles;
create policy profiles_select on public.profiles
  for select to authenticated using (true);
create policy profiles_insert on public.profiles
  for insert to authenticated with check (user_id = auth.uid());
create policy profiles_update on public.profiles
  for update to authenticated using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- 4) Serverseitige Finalisierung eines Uploads.
--    Prüft: angemeldet, Pfad liegt im eigenen Ordner, Speicherobjekt
--    existiert wirklich, echte gespeicherte Größe (aus den Objekt-
--    Metadaten, nicht vom Client behauptet). Nur dann entsteht der
--    Datenbankeintrag – fehlgeschlagene Uploads bleiben unsichtbar.
create or replace function public.finalize_cloud_upload(
  p_name text, p_fach text, p_category text, p_mime text, p_path text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
  v_size bigint;
  v_type text;
begin
  if auth.uid() is null then
    raise exception 'Nicht angemeldet.';
  end if;
  if position('/' in p_path) = 0
     or left(p_path, position('/' in p_path) - 1) is distinct from auth.uid()::text then
    raise exception 'Ungültiger Speicherpfad.';
  end if;
  select (metadata->>'size')::bigint, metadata->>'mimetype'
    into v_size, v_type
    from storage.objects
    where bucket_id = 'cloud' and name = p_path;
  if v_size is null then
    raise exception 'Datei wurde nicht vollständig hochgeladen.';
  end if;
  if v_size > 31457280 then
    raise exception 'Datei ist größer als 30 MB.';
  end if;
  if v_type is not null and v_type is distinct from p_mime then
    raise exception 'Dateityp stimmt nicht überein.';
  end if;
  insert into public.cloud_files (owner, name, fach, category, size, mime, path)
    values (auth.uid(), p_name, p_fach, p_category, v_size, p_mime, p_path)
    returning id into v_id;
  return v_id;
end;
$$;

revoke all on function public.finalize_cloud_upload from public;
grant execute on function public.finalize_cloud_upload to authenticated;

-- 5) Live-Aktualisierung der Dateiliste (Realtime)
do $$ begin
  alter publication supabase_realtime add table public.cloud_files;
exception when duplicate_object then null; end $$;
do $$ begin
  alter publication supabase_realtime add table public.profiles;
exception when duplicate_object then null; end $$;

-- 6) Privater Speicher-Bucket: 30 MB je Datei, nur erlaubte Typen
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('cloud', 'cloud', false, 31457280,
  '["application/pdf","image/png","image/jpeg","image/webp","image/gif",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "application/zip"]')
on conflict (id) do update
  set public = false,
      file_size_limit = 31457280,
      allowed_mime_types = excluded.allowed_mime_types;

-- Speicher-Sicherheitsregeln: jeder angemeldete Nutzer liest,
-- hochladen und löschen darf man nur im eigenen Ordner ({user-id}/…)
drop policy if exists cloud_bucket_read on storage.objects;
drop policy if exists cloud_bucket_upload on storage.objects;
drop policy if exists cloud_bucket_delete on storage.objects;
create policy cloud_bucket_read on storage.objects
  for select to authenticated using (bucket_id = 'cloud');
create policy cloud_bucket_upload on storage.objects
  for insert to authenticated
  with check (bucket_id = 'cloud' and (storage.foldername(name))[1] = auth.uid()::text);
create policy cloud_bucket_delete on storage.objects
  for delete to authenticated
  using (bucket_id = 'cloud' and (storage.foldername(name))[1] = auth.uid()::text);
