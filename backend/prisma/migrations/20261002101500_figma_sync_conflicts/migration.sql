ALTER TABLE figma_node_mappings
  ADD COLUMN IF NOT EXISTS "localHash" varchar(64);
