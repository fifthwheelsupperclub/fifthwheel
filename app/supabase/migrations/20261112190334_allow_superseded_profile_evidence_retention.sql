-- Superseded private evidence remains addressable until the retention worker
-- removes its storage object. A ready row requires normalized metadata, while
-- superseded rows may retain those keys temporarily for scheduled cleanup.
alter table public.app_profile_files
  drop constraint app_profile_files_check;

alter table public.app_profile_files
  add constraint app_profile_files_ready_requires_normalized_object
  check (state <> 'ready' or (normalized_key is not null and normalized_byte_size is not null));
