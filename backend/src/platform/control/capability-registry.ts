export type CapabilityClass = "A" | "B" | "C" | "D" | "E" | "L";
export type CapabilityCriticality = "LOCKED" | "REQUIRED" | "OPTIONAL";

export type CapabilityDefinition = {
  id: string;
  owner: string;
  criticality: CapabilityCriticality;
  changeClass: CapabilityClass;
  minTier: "T0" | "T1" | "T2" | "T3" | "T4";
  provider: string | null;
  desiredState: "ENABLED" | "DISABLED" | "DEGRADED" | "LOCKED";
  dependencies: string[];
  offBehaviour: string;
};

export const capabilityRegistry: readonly CapabilityDefinition[] = Object.freeze([
  { id: "authentication", owner: "platform-security", criticality: "LOCKED", changeClass: "L", minTier: "T0", provider: "oidc", desiredState: "LOCKED", dependencies: [], offBehaviour: "cannot-disable" },
  { id: "authorization", owner: "platform-security", criticality: "LOCKED", changeClass: "L", minTier: "T0", provider: "application-policy", desiredState: "LOCKED", dependencies: ["authentication"], offBehaviour: "cannot-disable" },
  { id: "tenant-isolation", owner: "platform-security", criticality: "LOCKED", changeClass: "L", minTier: "T0", provider: "postgres-rls", desiredState: "LOCKED", dependencies: ["authorization"], offBehaviour: "cannot-disable" },
  { id: "primary-database", owner: "platform", criticality: "LOCKED", changeClass: "L", minTier: "T0", provider: "postgres", desiredState: "LOCKED", dependencies: [], offBehaviour: "controlled-unavailability" },
  { id: "audit", owner: "platform-security", criticality: "LOCKED", changeClass: "L", minTier: "T0", provider: "postgres", desiredState: "LOCKED", dependencies: ["primary-database"], offBehaviour: "cannot-disable" },
  { id: "idempotency", owner: "platform", criticality: "LOCKED", changeClass: "L", minTier: "T0", provider: "postgres", desiredState: "LOCKED", dependencies: ["primary-database"], offBehaviour: "cannot-disable" },
  { id: "billing", owner: "commercial-platform", criticality: "OPTIONAL", changeClass: "A", minTier: "T0", provider: "stripe", desiredState: "ENABLED", dependencies: ["audit","idempotency"], offBehaviour: "new-checkout-disabled-reconciliation-continues" },
  { id: "durable-jobs", owner: "platform", criticality: "REQUIRED", changeClass: "C", minTier: "T0", provider: "postgres-queue", desiredState: "ENABLED", dependencies: ["primary-database","idempotency"], offBehaviour: "reject-new-durable-admission-when-capacity-exhausted" },
  { id: "object-storage", owner: "platform", criticality: "REQUIRED", changeClass: "B", minTier: "T0", provider: "s3", desiredState: "ENABLED", dependencies: ["authorization"], offBehaviour: "new-uploads-disabled-existing-approved-downloads-continue" },
  { id: "integrations", owner: "integrations", criticality: "OPTIONAL", changeClass: "A", minTier: "T0", provider: "adapter-registry", desiredState: "ENABLED", dependencies: ["durable-jobs","audit"], offBehaviour: "new-side-effects-paused-history-retained" },
  { id: "realtime", owner: "collaboration", criticality: "OPTIONAL", changeClass: "B", minTier: "T1", provider: "websocket", desiredState: "ENABLED", dependencies: ["authorization"], offBehaviour: "polling-fallback" },
  { id: "ai", owner: "ai-platform", criticality: "OPTIONAL", changeClass: "A", minTier: "T1", provider: null, desiredState: "DISABLED", dependencies: ["durable-jobs","object-storage"], offBehaviour: "non-ai-features-unaffected" },
  { id: "site-document", owner: "editor-platform", criticality: "REQUIRED", changeClass: "A", minTier: "T0", provider: "postgres", desiredState: "ENABLED", dependencies: ["primary-database","authorization","tenant-isolation","audit","idempotency"], offBehaviour: "legacy-editor-compatibility-remains" },
  { id: "cms-v2", owner: "content-platform", criticality: "OPTIONAL", changeClass: "A", minTier: "T0", provider: "site-document", desiredState: "ENABLED", dependencies: ["site-document"], offBehaviour: "legacy-custom-post-types-remain-readable" },
  { id: "figma-sync", owner: "integrations", criticality: "OPTIONAL", changeClass: "A", minTier: "T1", provider: "figma", desiredState: "ENABLED", dependencies: ["site-document","integrations"], offBehaviour: "manual-editor-and-canonical-document-remain-available" },
  { id: "stitch-design", owner: "ai-platform", criticality: "OPTIONAL", changeClass: "A", minTier: "T1", provider: "google-stitch", desiredState: "ENABLED", dependencies: ["site-document","durable-jobs","audit"], offBehaviour: "manual-design-remains-available" },
]);

const registryMap = new Map(capabilityRegistry.map((item) => [item.id, item]));

export function getCapability(id: string) {
  return registryMap.get(id) || null;
}

export function validateCapabilityRegistry() {
  const ids = new Set<string>();
  for (const capability of capabilityRegistry) {
    if (ids.has(capability.id)) throw new Error(`Duplicate capability: ${capability.id}`);
    ids.add(capability.id);
  }
  for (const capability of capabilityRegistry) {
    for (const dependency of capability.dependencies) {
      if (!ids.has(dependency)) throw new Error(`Unknown dependency ${dependency} for ${capability.id}`);
      if (dependency === capability.id) throw new Error(`Capability ${capability.id} cannot depend on itself`);
    }
    if (capability.criticality === "LOCKED" && capability.changeClass !== "L") {
      throw new Error(`Locked capability ${capability.id} must use change class L`);
    }
  }
  return true;
}
