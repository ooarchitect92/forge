import { prisma } from "../../config/prisma.js";
import { getActiveConnectorCredential } from "../../platform/integrations/connector-credentials.js";
import { getScopedWebsite } from "../../services/websites/scoped-access.js";
import { designAvailability } from "../ai/design/config.js";
import { listIndustryTemplates } from "./template-catalog.js";

function boundedDailyUnits(): number {
  const value = Number(process.env.AI_DESIGN_DAILY_UNITS || 100);
  return Number.isInteger(value) && value >= 1 && value <= 10_000 ? value : 100;
}

export async function designPlatformCapabilities(websiteId: string, actorId: string) {
  const website = await getScopedWebsite(websiteId, actorId);
  const start = new Date(); start.setUTCHours(0, 0, 0, 0);
  const usage = website.workspaceId
    ? await prisma.aiExecution.aggregate({
        where: { workspaceId: website.workspaceId, createdAt: { gte: start } },
        _sum: { reservedUnits: true },
      })
    : { _sum: { reservedUnits: 0 } };
  const dailyLimit = boundedDailyUnits();
  const reserved = usage._sum.reservedUnits ?? 0;

  let figmaConnected = false;
  if (website.organizationId) {
    figmaConnected = !!(await getActiveConnectorCredential({
      organizationId: website.organizationId,
      websiteId,
      provider: "figma",
    }));
  }
  if (!figmaConnected && process.env.NODE_ENV !== "production" && !!process.env.FIGMA_ACCESS_TOKEN) figmaConnected = true;

  return {
    version: 1,
    website: { id: website.id, documentVersion: website.documentVersion, workspaceStatus: website.workspaceStatus },
    providers: {
      stitch: {
        ...designAvailability(),
        runtimeCapabilities: ["prompt-to-site", "prompt-to-page", "selection-edit", "native-changeset-review"],
        advancedSdkCapabilities: {
          screenEdits: false,
          variants: false,
          screenshots: false,
          designSystems: false,
          reason: "Pinned adapter upgrade and contract qualification required",
        },
      },
      figma: {
        connected: figmaConnected,
        authentication: website.organizationId ? "governed-connector" : "tenant-migration-required",
        runtimeCapabilities: ["file-preview", "selected-node-import", "native-page-changeset", "component-style-inventory"],
        conditionalCapabilities: {
          variablesWrite: false,
          codeConnectPublish: false,
          canvasWriteBack: false,
          reason: "Requires Figma plan/seat permissions and a separately approved write connector",
        },
      },
    },
    cms: {
      available: true,
      runtimeCapabilities: ["collection-blueprint-preview", "merge-only-schema-apply", "typed-fields", "seed-items"],
      destructiveMigrations: false,
      fieldTypes: ["text", "rich-text", "image", "number", "boolean"],
    },
    templates: {
      available: true,
      count: listIndustryTemplates().length,
      capabilities: ["industry-brief", "page-plan", "cms-blueprint"],
    },
    starterUsage: {
      unit: "reserved-provider-call",
      period: "UTC_DAY",
      limit: dailyLimit,
      reserved,
      remaining: Math.max(0, dailyLimit - reserved),
      vendorCreditsIncluded: false,
      disclosure: "Forge starter units are an internal safety quota. Google, Anthropic and Figma quotas or billing remain governed by those providers.",
    },
  };
}
