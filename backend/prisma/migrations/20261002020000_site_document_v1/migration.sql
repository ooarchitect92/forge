CREATE TABLE IF NOT EXISTS site_document_states (
  "websiteId" uuid PRIMARY KEY REFERENCES websites(id) ON DELETE CASCADE,
  "organizationId" uuid NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  "workspaceId" uuid NULL REFERENCES workspaces(id) ON DELETE SET NULL,
  "schemaVersion" integer NOT NULL DEFAULT 1 CHECK ("schemaVersion" > 0),
  revision integer NOT NULL DEFAULT 1 CHECK (revision > 0),
  document jsonb NOT NULL,
  "updatedBy" uuid NULL REFERENCES users(id) ON DELETE SET NULL,
  "createdAt" timestamptz NOT NULL DEFAULT now(),
  "updatedAt" timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS site_document_states_org_updated_idx ON site_document_states ("organizationId","updatedAt");
CREATE INDEX IF NOT EXISTS site_document_states_workspace_idx ON site_document_states ("workspaceId");

CREATE TABLE IF NOT EXISTS site_document_revisions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "websiteId" uuid NOT NULL REFERENCES websites(id) ON DELETE CASCADE,
  "organizationId" uuid NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  "workspaceId" uuid NULL REFERENCES workspaces(id) ON DELETE SET NULL,
  revision integer NOT NULL CHECK (revision > 0),
  "schemaVersion" integer NOT NULL CHECK ("schemaVersion" > 0),
  document jsonb NOT NULL,
  commands jsonb NOT NULL DEFAULT '[]'::jsonb,
  source varchar(30) NOT NULL DEFAULT 'USER',
  "actorId" uuid NULL REFERENCES users(id) ON DELETE SET NULL,
  "createdAt" timestamptz NOT NULL DEFAULT now(),
  UNIQUE ("websiteId", revision)
);
CREATE INDEX IF NOT EXISTS site_document_revisions_org_site_created_idx ON site_document_revisions ("organizationId","websiteId","createdAt");

CREATE TABLE IF NOT EXISTS site_document_commands (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "websiteId" uuid NOT NULL REFERENCES websites(id) ON DELETE CASCADE,
  "organizationId" uuid NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  "workspaceId" uuid NULL REFERENCES workspaces(id) ON DELETE SET NULL,
  revision integer NOT NULL CHECK (revision > 0),
  sequence integer NOT NULL CHECK (sequence >= 0),
  "actorId" uuid NULL REFERENCES users(id) ON DELETE SET NULL,
  source varchar(30) NOT NULL DEFAULT 'USER',
  "commandType" varchar(100) NOT NULL,
  payload jsonb NOT NULL,
  "createdAt" timestamptz NOT NULL DEFAULT now(),
  UNIQUE ("websiteId", revision, sequence)
);
CREATE INDEX IF NOT EXISTS site_document_commands_org_site_created_idx ON site_document_commands ("organizationId","websiteId","createdAt");

CREATE TABLE IF NOT EXISTS cms_collections_v2 (
  id varchar(200) PRIMARY KEY,
  "websiteId" uuid NOT NULL REFERENCES websites(id) ON DELETE CASCADE,
  "organizationId" uuid NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  "workspaceId" uuid NULL REFERENCES workspaces(id) ON DELETE SET NULL,
  name varchar(255) NOT NULL,
  slug varchar(255) NOT NULL,
  description varchar(2000),
  "createdAt" timestamptz NOT NULL DEFAULT now(),
  "updatedAt" timestamptz NOT NULL DEFAULT now(),
  UNIQUE ("websiteId", slug)
);
CREATE INDEX IF NOT EXISTS cms_collections_v2_org_site_idx ON cms_collections_v2 ("organizationId","websiteId");

CREATE TABLE IF NOT EXISTS cms_fields_v2 (
  id varchar(200) PRIMARY KEY,
  "collectionId" varchar(200) NOT NULL REFERENCES cms_collections_v2(id) ON DELETE CASCADE,
  "organizationId" uuid NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  "websiteId" uuid NOT NULL REFERENCES websites(id) ON DELETE CASCADE,
  key varchar(255) NOT NULL,
  name varchar(255) NOT NULL,
  type varchar(50) NOT NULL,
  required boolean NOT NULL DEFAULT false,
  position integer NOT NULL DEFAULT 0,
  config jsonb NOT NULL DEFAULT '{}'::jsonb,
  "createdAt" timestamptz NOT NULL DEFAULT now(),
  "updatedAt" timestamptz NOT NULL DEFAULT now(),
  UNIQUE ("collectionId", key)
);
CREATE INDEX IF NOT EXISTS cms_fields_v2_org_site_collection_idx ON cms_fields_v2 ("organizationId","websiteId","collectionId");

CREATE TABLE IF NOT EXISTS cms_items_v2 (
  id varchar(200) PRIMARY KEY,
  "collectionId" varchar(200) NOT NULL REFERENCES cms_collections_v2(id) ON DELETE CASCADE,
  "organizationId" uuid NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  "websiteId" uuid NOT NULL REFERENCES websites(id) ON DELETE CASCADE,
  title varchar(500),
  slug varchar(500),
  status varchar(30) NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT','PUBLISHED','ARCHIVED')),
  data jsonb NOT NULL DEFAULT '{}'::jsonb,
  "actorId" uuid NULL REFERENCES users(id) ON DELETE SET NULL,
  "createdAt" timestamptz NOT NULL DEFAULT now(),
  "updatedAt" timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS cms_items_v2_collection_slug_unique ON cms_items_v2 ("collectionId",slug);
CREATE INDEX IF NOT EXISTS cms_items_v2_org_site_collection_status_idx ON cms_items_v2 ("organizationId","websiteId","collectionId",status);

CREATE TABLE IF NOT EXISTS cms_bindings_v2 (
  id varchar(200) PRIMARY KEY,
  "websiteId" uuid NOT NULL REFERENCES websites(id) ON DELETE CASCADE,
  "organizationId" uuid NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  "workspaceId" uuid NULL REFERENCES workspaces(id) ON DELETE SET NULL,
  "elementId" varchar(200) NOT NULL,
  property varchar(255) NOT NULL,
  "collectionId" varchar(200) NOT NULL REFERENCES cms_collections_v2(id) ON DELETE CASCADE,
  "fieldId" varchar(200) NOT NULL REFERENCES cms_fields_v2(id) ON DELETE CASCADE,
  "createdAt" timestamptz NOT NULL DEFAULT now(),
  "updatedAt" timestamptz NOT NULL DEFAULT now(),
  UNIQUE ("websiteId","elementId",property)
);
CREATE INDEX IF NOT EXISTS cms_bindings_v2_org_site_collection_idx ON cms_bindings_v2 ("organizationId","websiteId","collectionId");

CREATE TABLE IF NOT EXISTS figma_node_mappings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "websiteId" uuid NOT NULL REFERENCES websites(id) ON DELETE CASCADE,
  "organizationId" uuid NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  "workspaceId" uuid NULL REFERENCES workspaces(id) ON DELETE SET NULL,
  "fileKey" varchar(255) NOT NULL,
  kind varchar(40) NOT NULL,
  "externalId" varchar(255) NOT NULL,
  "localId" varchar(200) NOT NULL,
  "externalVersion" varchar(255),
  "lastSyncedAt" timestamptz NOT NULL DEFAULT now(),
  UNIQUE ("websiteId","fileKey",kind,"externalId")
);
CREATE INDEX IF NOT EXISTS figma_node_mappings_org_site_file_idx ON figma_node_mappings ("organizationId","websiteId","fileKey");

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'site_document_states','site_document_revisions','site_document_commands',
    'cms_collections_v2','cms_fields_v2','cms_items_v2','cms_bindings_v2','figma_node_mappings'
  ]
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY %I ON %I USING ("organizationId" = NULLIF(current_setting(''app.tenant_id'', true), '''')::uuid) WITH CHECK ("organizationId" = NULLIF(current_setting(''app.tenant_id'', true), '''')::uuid)',
      t || '_tenant_policy', t
    );
  END LOOP;
END $$;
