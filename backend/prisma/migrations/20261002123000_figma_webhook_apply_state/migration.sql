ALTER TABLE figma_webhook_events
  ADD COLUMN IF NOT EXISTS "appliedAt" timestamptz,
  ADD COLUMN IF NOT EXISTS "appliedRevision" integer;

ALTER TABLE figma_webhook_events
  DROP CONSTRAINT IF EXISTS figma_webhook_events_status_check;

ALTER TABLE figma_webhook_events
  ADD CONSTRAINT figma_webhook_events_status_check
  CHECK (status IN ('PENDING','DISMISSED','APPLIED'));

CREATE INDEX IF NOT EXISTS figma_webhook_events_site_applied_revision_idx
  ON figma_webhook_events ("websiteId","appliedRevision")
  WHERE status='APPLIED';
