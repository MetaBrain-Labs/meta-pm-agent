-- Allow document generation to pause while users resolve evidence blockers.
-- This migration is idempotent so existing local databases can apply it safely.
BEGIN;

ALTER TABLE IF EXISTS public.document_generation_run
  DROP CONSTRAINT IF EXISTS document_generation_run_status_check;

ALTER TABLE IF EXISTS public.document_generation_run
  ADD CONSTRAINT document_generation_run_status_check
  CHECK (
    status IN (
      'queued',
      'running',
      'awaiting_input',
      'completed',
      'stopped',
      'failed'
    )
  );

COMMIT;
