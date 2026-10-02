CREATE TABLE IF NOT EXISTS figma_webhook_subscriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "websiteId" uuid NOT NULL REFERENCES websites(id) ON DELETE CASCADE,
  "organizationId" uuid NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  "workspaceId" uuid NULL REFERENCES workspaces(id) ON DELETE SET NULL,
  "actorId" uuid NULL REFERENCES users(id) ON DELETE SET NULL,
  "figmaWebhookId" varchar(255) UNIQUE,
  "fileKey" varchar(255) NOT NULL,
  "eventType" varchar(60) NOT NULL DEFAULT 'FILE_UPDATE',
  "passcodeHash" varchar(64) NOT NULL,
  status varchar(30) NOT NULL DEFAULT 'CREATING'
    CHECK (status IN ('CREATING','ACTIVE','PAUSED','RECONCILIATION_REQUIRED','REVOKED')),
  "lastEventAt" timestamptz,
  "createdAt" timestamptz NOT NULL DEFAULT now(),
  "updatedAt" timestamptz NOT NULL DEFAULT now(),
  UNIQUE ("websiteId","fileKey","eventType")
);
CREATE INDEX IF NOT EXISTS figma_webhook_subscriptions_org_site_status_idx
  ON figma_webhook_subscriptions ("organizationId","websiteId",status);

CREATE TABLE IF NOT EXISTS figma_webhook_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "subscriptionId" uuid NOT NULL REFERENCES figma_webhook_subscriptions(id) ON DELETE CASCADE,
  "websiteId" uuid NOT NULL REFERENCES websites(id) ON DELETE CASCADE,
  "organizationId" uuid NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  "eventKey" varchar(64) NOT NULL,
  "eventType" varchar(60) NOT NULL,
  "fileKey" varchar(255) NOT NULL,
  summary jsonb NOT NULL DEFAULT '{}'::jsonb,
  status varchar(30) NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','DISMISSED')),
  "receivedAt" timestamptz NOT NULL DEFAULT now(),
  "dismissedAt" timestamptz,
  UNIQUE ("subscriptionId","eventKey")
);
CREATE INDEX IF NOT EXISTS figma_webhook_events_org_site_status_received_idx
  ON figma_webhook_events ("organizationId","websiteId",status,"receivedAt");

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['figma_webhook_subscriptions','figma_webhook_events']
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY %I ON %I USING ("organizationId" = NULLIF(current_setting(''app.tenant_id'', true), '''')::uuid) WITH CHECK ("organizationId" = NULLIF(current_setting(''app.tenant_id'', true), '''')::uuid)',
      t || '_tenant_policy', t
    );
  END LOOP;
END $$;
