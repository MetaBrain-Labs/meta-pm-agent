-- Remember the model usage profile the user selected last, so new conversations and
-- document runs default to that profile instead of the built-in one.
-- Idempotent and additive; selecting the built-in profile deletes the row on purpose,
-- and deleting a profile cascades here so the default falls back to the built-in profile.
BEGIN;

CREATE TABLE IF NOT EXISTS public.user_default_model_profile (
  user_id character varying(36) primary key not null,
  profile_id character varying(36) not null,
  updated_at timestamp with time zone not null default now(),
  foreign key (user_id) references public."user" (id)
  match simple on update no action on delete cascade,
  foreign key (profile_id) references public.model_usage_profile (id)
  match simple on update no action on delete cascade
);

COMMIT;
