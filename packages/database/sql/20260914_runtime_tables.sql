-- Runtime tables missing from Prisma. Apply after the core schema.
-- Public schema is the supported local deployment schema. No application data is deleted.
BEGIN;

-- Persist complete Agent/stage identifiers (e.g. conversation_confirmation).
-- Widening varchar to text preserves existing values and is repeatable.
ALTER TABLE public.message ALTER COLUMN type TYPE text;

CREATE TABLE IF NOT EXISTS public.model_usage_profile (
  id character varying(36) primary key not null,
  user_id character varying(36) not null,
  name character varying(80) not null,
  config jsonb not null,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),
  foreign key (user_id) references public."user" (id)
  match simple on update no action on delete cascade
);

CREATE TABLE IF NOT EXISTS public.conversation_model_profile (
  conversation_id character varying(36) primary key not null,
  profile_id character varying(36) not null,
  updated_at timestamp with time zone not null default now(),
  foreign key (conversation_id) references public.conversation (id)
  match simple on update no action on delete cascade,
  foreign key (profile_id) references public.model_usage_profile (id)
  match simple on update no action on delete cascade
);

CREATE TABLE IF NOT EXISTS public.document_generation_run (
  id character varying(36) primary key not null,
  workspace_id character varying(36) not null,
  kind character varying(16) not null,
  status character varying(24) not null default 'queued',
  workflow_thread_id character varying(255) not null,
  current_stage character varying(64),
  task_planning jsonb not null default '[]'::jsonb,
  reasoning_log jsonb not null default '[]'::jsonb,
  scoring_attempts jsonb not null default '[]'::jsonb,
  document_artifact_id character varying(36),
  error_message text,
  started_at timestamp with time zone,
  finished_at timestamp with time zone,
  created_at timestamp with time zone not null default CURRENT_TIMESTAMP,
  updated_at timestamp with time zone not null default CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS public.document_artifact (
  id character varying(36) primary key not null,
  workspace_id character varying(36) not null,
  run_id character varying(36) not null,
  kind character varying(16) not null,
  title character varying(255) not null,
  content_markdown text not null,
  content_json jsonb,
  version integer not null default 1,
  created_at timestamp with time zone not null default CURRENT_TIMESTAMP,
  updated_at timestamp with time zone not null default CURRENT_TIMESTAMP,
  foreign key (run_id) references public.document_generation_run (id)
  match simple on update no action on delete cascade
);

CREATE TABLE IF NOT EXISTS public.product_context_snapshot (
  id character varying(36) primary key not null,
  workspace_id character varying(36) not null,
  conversation_id character varying(36),
  request_form_id character varying(36),
  context_json jsonb not null default '{}'::jsonb,
  version integer not null default 1,
  created_at timestamp(6) with time zone default CURRENT_TIMESTAMP,
  updated_at timestamp(6) with time zone default CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS public.token_usage (
  id character varying(36) primary key not null,
  conversation_id character varying(36) not null,
  message_id character varying(36),
  agent_type character varying(50) not null,
  input_tokens integer not null default 0,
  output_tokens integer not null default 0,
  total_tokens integer not null default 0,
  cost_input numeric(12,8) not null default 0,
  cost_output numeric(12,8) not null default 0,
  cost_total numeric(12,8) not null default 0,
  duration_ms integer,
  created_at timestamp with time zone not null default now(),
  cache_hit_input_tokens integer not null default 0,
  cache_miss_input_tokens integer not null default 0,
  foreign key (conversation_id) references public.conversation (id)
  match simple on update no action on delete cascade,
  foreign key (message_id) references public.message (id)
  match simple on update no action on delete set null
);

CREATE INDEX IF NOT EXISTS conversation_model_profile_profile_idx on conversation_model_profile using btree (profile_id);
CREATE UNIQUE INDEX IF NOT EXISTS document_artifact_run_id_key on document_artifact using btree (run_id);
CREATE INDEX IF NOT EXISTS document_artifact_workspace_kind_version_idx on document_artifact using btree (workspace_id, kind, version);
CREATE INDEX IF NOT EXISTS document_generation_run_workspace_kind_created_idx on document_generation_run using btree (workspace_id, kind, created_at);
CREATE UNIQUE INDEX IF NOT EXISTS model_usage_profile_user_name_key on model_usage_profile using btree (user_id, (lower((name)::text)));
CREATE UNIQUE INDEX IF NOT EXISTS product_context_snapshot_workspace_id_key on product_context_snapshot using btree (workspace_id);
CREATE INDEX IF NOT EXISTS product_context_snapshot_conversation_id_idx on product_context_snapshot using btree (conversation_id);
CREATE INDEX IF NOT EXISTS product_context_snapshot_request_form_id_idx on product_context_snapshot using btree (request_form_id);
CREATE INDEX IF NOT EXISTS idx_token_usage_conversation on token_usage using btree (conversation_id);
CREATE INDEX IF NOT EXISTS idx_token_usage_message on token_usage using btree (message_id);
CREATE INDEX IF NOT EXISTS idx_token_usage_agent_type on token_usage using btree (conversation_id, agent_type);

ALTER TABLE public.token_usage ADD COLUMN IF NOT EXISTS cache_hit_input_tokens integer NOT NULL DEFAULT 0;
ALTER TABLE public.token_usage ADD COLUMN IF NOT EXISTS cache_miss_input_tokens integer NOT NULL DEFAULT 0;
DO $$ BEGIN
 IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='product_knowledge_graph' AND column_name='content') THEN
  ALTER TABLE public.product_knowledge_graph ALTER COLUMN content SET DEFAULT '';
 END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.document_generation_run'::regclass AND contype = 'f' AND conkey = ARRAY[(SELECT attnum FROM pg_attribute WHERE attrelid = 'public.document_generation_run'::regclass AND attname = 'document_artifact_id')]::smallint[]) THEN
    ALTER TABLE public.document_generation_run ADD CONSTRAINT document_generation_run_artifact_fk
      FOREIGN KEY (document_artifact_id) REFERENCES public.document_artifact(id) ON DELETE SET NULL;
  END IF;
END $$;
ALTER TABLE public.document_generation_run DROP CONSTRAINT IF EXISTS document_generation_run_status_check;
ALTER TABLE public.document_generation_run ADD CONSTRAINT document_generation_run_status_check
 CHECK (status IN ('queued', 'running', 'awaiting_input', 'completed', 'stopped', 'failed'));
DROP INDEX IF EXISTS public.document_generation_run_active_idx;
CREATE INDEX document_generation_run_active_idx ON public.document_generation_run(workspace_id, kind, status)
 WHERE status IN ('queued', 'running', 'awaiting_input');
COMMIT;
