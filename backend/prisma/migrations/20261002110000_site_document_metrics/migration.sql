CREATE TABLE IF NOT EXISTS site_document_metrics (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "websiteId" uuid NOT NULL REFERENCES websites(id) ON DELETE CASCADE,
  "organizationId" uuid NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  "workspaceId" uuid NULL REFERENCES workspaces(id) ON DELETE SET NULL,
  "actorId" uuid NULL REFERENCES users(id) ON DELETE SET NULL,
  operation varchar(60) NOT NULL,
  source varchar(30) NOT NULL DEFAULT 'USER',
  "durationMs" integer NOT NULL CHECK ("durationMs" >= 0),
  "commandCount" integer NOT NULL DEFAULT 0 CHECK ("commandCount" >= 0),
  status varchar(20) NOT NULL CHECK (status IN ('SUCCESS','ERROR')),
  "errorCode" varchar(100),
  "idempotencyKey" varchar(128),
  "createdAt" timestamptz NOT NULL DEFAULT now(),
  UNIQUE ("websiteId",operation,"idempotencyKey")
);
CREATE INDEX IF NOT EXISTS site_document_metrics_org_site_created_idx ON site_document_metrics ("organizationId","websiteId","createdAt");
CREATE INDEX IF NOT EXISTS site_document_metrics_site_status_created_idx ON site_document_metrics ("websiteId",status,"createdAt");
ALTER TABLE site_document_metrics ENABLE ROW LEVEL SECURITY;
ALTER TABLE site_document_metrics FORCE ROW LEVEL SECURITY;
CREATE POLICY site_document_metrics_tenant_policy ON site_document_metrics
  USING ("organizationId" = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK ("organizationId" = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
