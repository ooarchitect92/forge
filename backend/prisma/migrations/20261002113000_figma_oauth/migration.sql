CREATE TABLE IF NOT EXISTS figma_oauth_states (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "organizationId" uuid NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  "workspaceId" uuid NULL REFERENCES workspaces(id) ON DELETE SET NULL,
  "websiteId" uuid NOT NULL REFERENCES websites(id) ON DELETE CASCADE,
  "actorId" uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  "stateHash" varchar(64) NOT NULL UNIQUE,
  "verifierCiphertext" text NOT NULL,
  scopes jsonb NOT NULL DEFAULT '[]'::jsonb,
  "expiresAt" timestamptz NOT NULL,
  "consumedAt" timestamptz,
  "createdAt" timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS figma_oauth_states_org_site_created_idx ON figma_oauth_states ("organizationId","websiteId","createdAt");
CREATE INDEX IF NOT EXISTS figma_oauth_states_expires_idx ON figma_oauth_states ("expiresAt");
ALTER TABLE figma_oauth_states ENABLE ROW LEVEL SECURITY;
ALTER TABLE figma_oauth_states FORCE ROW LEVEL SECURITY;
CREATE POLICY figma_oauth_states_tenant_policy ON figma_oauth_states
  USING ("organizationId" = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK ("organizationId" = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
