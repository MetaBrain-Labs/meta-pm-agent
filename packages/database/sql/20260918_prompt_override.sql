-- Workspace-scoped prompt overrides for the user-configurable prompt registry.
-- This migration is idempotent and additive so existing local databases can apply it safely.
-- No built-in default prompt is ever copied into this table: reset deletes the row so the
-- runtime falls back to the immutable default shipped with the application.
BEGIN;

CREATE TABLE IF NOT EXISTS public.prompt_override (
  workspace_id character varying(36) not null,
  prompt_id character varying(64) not null,
  content text not null,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),
  primary key (workspace_id, prompt_id),
  foreign key (workspace_id) references public.workspace (id)
  match simple on update no action on delete cascade
);

CREATE INDEX IF NOT EXISTS prompt_override_prompt_id_idx
  on prompt_override using btree (prompt_id);

COMMIT;
