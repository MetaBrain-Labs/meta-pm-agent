-- Document generation tables for planning output documents.
-- Run this manually after the existing core tables are available.

CREATE TABLE IF NOT EXISTS "document_generation_run" (
  "id" varchar(36) PRIMARY KEY,
  "workspace_id" varchar(36) NOT NULL,
  "kind" varchar(16) NOT NULL,
  "status" varchar(24) NOT NULL DEFAULT 'queued',
  "workflow_thread_id" varchar(255) NOT NULL,
  "current_stage" varchar(64),
  "task_planning" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "document_artifact_id" varchar(36),
  "error_message" text,
  "started_at" timestamptz,
  "finished_at" timestamptz,
  "created_at" timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "document_generation_run_kind_check"
    CHECK ("kind" IN ('prd', 'mrd', 'brd')),
  CONSTRAINT "document_generation_run_status_check"
    CHECK ("status" IN ('queued', 'running', 'completed', 'stopped', 'failed'))
);

CREATE TABLE IF NOT EXISTS "document_artifact" (
  "id" varchar(36) PRIMARY KEY,
  "workspace_id" varchar(36) NOT NULL,
  "run_id" varchar(36) NOT NULL UNIQUE,
  "kind" varchar(16) NOT NULL,
  "title" varchar(255) NOT NULL,
  "content_markdown" text NOT NULL,
  "content_json" jsonb,
  "version" integer NOT NULL DEFAULT 1,
  "created_at" timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "document_artifact_kind_check"
    CHECK ("kind" IN ('prd', 'mrd', 'brd')),
  CONSTRAINT "document_artifact_run_fk"
    FOREIGN KEY ("run_id")
    REFERENCES "document_generation_run" ("id")
    ON DELETE CASCADE
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'document_generation_run_artifact_fk'
  ) THEN
    ALTER TABLE "document_generation_run"
      ADD CONSTRAINT "document_generation_run_artifact_fk"
      FOREIGN KEY ("document_artifact_id")
      REFERENCES "document_artifact" ("id")
      ON DELETE SET NULL;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "document_generation_run_workspace_kind_created_idx"
  ON "document_generation_run" ("workspace_id", "kind", "created_at" DESC);

CREATE INDEX IF NOT EXISTS "document_generation_run_active_idx"
  ON "document_generation_run" ("workspace_id", "kind", "status")
  WHERE "status" IN ('queued', 'running');

CREATE INDEX IF NOT EXISTS "document_artifact_workspace_kind_version_idx"
  ON "document_artifact" ("workspace_id", "kind", "version" DESC);
