import { AppError } from "../../utils/app-error.js";
import { industryTemplateSchema, type CmsFieldType, type IndustryTemplate } from "./contracts.js";

const field = (name: string, key: string, type: CmsFieldType, required = true) => ({ name, key, type, required, options: {} });
const collection = (
  name: string,
  singular: string,
  slug: string,
  description: string,
  fields: ReturnType<typeof field>[],
) => ({ name, singular, plural: name, slug, description, isPublic: true, hasArchive: true, fields, items: [] });

const rawTemplates: IndustryTemplate[] = [
  {
    id: "academy-editorial", name: "Editorial Academy", category: "Education",
    description: "A premium multi-program education site with structured programs, insights and admissions content.",
    pages: ["Home", "Programs", "Program Detail", "About", "Admissions", "Insights", "Contact"],
    aiBrief: "Create a distinctive premium education website with an editorial visual system, expressive typography, warm neutral surfaces, deep forest or navy sections, restrained coral accents, generous whitespace and varied section rhythm. Build useful Home, Programs, Program Detail, About, Admissions, Insights and Contact pages. Use native reusable components, accessible navigation, responsive layouts and clear calls to action. Connect program and insight layouts to CMS-ready structures. Do not invent prices, dates, pass rates, accreditations, faculty names, testimonials or addresses. Clearly label information that requires the organization to provide source data.",
    cms: { version: 1, name: "Academy content model", description: "Programs and editorial insights used by academy templates.", collections: [
      collection("Programs", "Program", "programs", "Qualifications, courses or learning programs.", [
        field("Summary", "summary", "text"), field("Who It Suits", "who_it_suits", "rich-text"),
        field("Learning Outcomes", "learning_outcomes", "rich-text"), field("Featured", "featured", "boolean", false),
        field("Cover Image", "cover_image", "image", false),
      ]),
      collection("Insights", "Insight", "insights", "Articles, study guidance and announcements.", [
        field("Excerpt", "excerpt", "text"), field("Body", "body", "rich-text"),
        field("Cover Image", "cover_image", "image", false), field("Featured", "featured", "boolean", false),
      ]),
    ] },
  },
  {
    id: "saas-product-launch", name: "SaaS Product Launch", category: "Technology",
    description: "A product-led SaaS system with solutions, changelog, resources and conversion-focused landing pages.",
    pages: ["Home", "Product", "Solutions", "Customers", "Pricing", "Resources", "Changelog", "Contact"],
    aiBrief: "Create a modern product-led SaaS website with a confident technical aesthetic, sharp typography, restrained gradients, clear interactive hierarchy and a flexible component system. Build Home, Product, Solutions, Customers, Pricing, Resources, Changelog and Contact pages. Include meaningful product explanation, workflow diagrams made from native layout primitives, feature comparison structures and accessible conversion paths. Use CMS-ready resources and changelog layouts. Never invent customer logos, testimonials, security certifications, prices, uptime figures or performance claims; use explicit placeholders where verified company data is required.",
    cms: { version: 1, name: "SaaS content model", description: "Product resources, changelog entries and solution pages.", collections: [
      collection("Solutions", "Solution", "solutions", "Audience- or workflow-specific solution pages.", [
        field("Summary", "summary", "text"), field("Problem", "problem", "rich-text"),
        field("Outcome", "outcome", "rich-text"), field("Featured", "featured", "boolean", false),
      ]),
      collection("Resources", "Resource", "resources", "Guides, articles and product education.", [
        field("Excerpt", "excerpt", "text"), field("Body", "body", "rich-text"), field("Cover Image", "cover_image", "image", false),
      ]),
      collection("Changelog", "Change", "changelog", "Product updates and release notes.", [
        field("Summary", "summary", "text"), field("Details", "details", "rich-text"), field("Major Release", "major_release", "boolean", false),
      ]),
    ] },
  },
  {
    id: "care-services-trust", name: "Trusted Care Services", category: "Healthcare",
    description: "An accessible service marketplace for home nursing, elderly care and child support.",
    pages: ["Home", "Services", "Service Detail", "How It Works", "Safety", "For Caregivers", "Contact"],
    aiBrief: "Create an accessible, reassuring home-care services website for hourly and scheduled nursing support for patients, elderly people and children. Use a calm contemporary design, high-contrast typography, human-centered content hierarchy and clear emergency disclaimers. Build Home, Services, Service Detail, How It Works, Safety, For Caregivers and Contact pages. Make service availability, verification, booking steps and escalation boundaries easy to understand. Use CMS-ready service layouts. Do not claim medical outcomes, certifications, response times, caregiver availability, prices or service areas unless supplied by the operator. This is not an emergency service; make that boundary visible without creating alarm.",
    cms: { version: 1, name: "Care services content model", description: "Service categories and practical guidance.", collections: [
      collection("Care Services", "Care Service", "care-services", "Home care and nursing service definitions.", [
        field("Summary", "summary", "text"), field("Who It Is For", "who_it_is_for", "rich-text"),
        field("What Is Included", "what_is_included", "rich-text"), field("Clinical Service", "clinical_service", "boolean", false),
        field("Cover Image", "cover_image", "image", false),
      ]),
      collection("Care Guides", "Care Guide", "care-guides", "Non-emergency educational guidance and preparation checklists.", [
        field("Excerpt", "excerpt", "text"), field("Body", "body", "rich-text"),
      ]),
    ] },
  },
  {
    id: "professional-practice", name: "Professional Practice", category: "Professional Services",
    description: "A credible editorial site for legal, accounting, consulting and architecture practices.",
    pages: ["Home", "Services", "Service Detail", "Industries", "About", "Insights", "Contact"],
    aiBrief: "Create a premium professional-services website with a disciplined editorial system, confident typography, generous spacing, refined motion-ready composition and strong evidence hierarchy. Build Home, Services, Service Detail, Industries, About, Insights and Contact pages. Use CMS-ready service, industry and insight templates, accessible navigation and clear consultation calls to action. Do not invent clients, case studies, awards, credentials, office locations, team members, prices or quantified results. Use explicit source-needed placeholders for claims requiring verification.",
    cms: { version: 1, name: "Professional practice content model", description: "Services, industries and editorial insights.", collections: [
      collection("Services", "Service", "services", "Professional service offerings.", [
        field("Summary", "summary", "text"), field("Details", "details", "rich-text"), field("Featured", "featured", "boolean", false),
      ]),
      collection("Industries", "Industry", "industries", "Industry-specific experience and service context.", [
        field("Summary", "summary", "text"), field("Details", "details", "rich-text"),
      ]),
      collection("Insights", "Insight", "insights", "Articles and practical analysis.", [
        field("Excerpt", "excerpt", "text"), field("Body", "body", "rich-text"), field("Cover Image", "cover_image", "image", false),
      ]),
    ] },
  },
];

const templates = rawTemplates.map((template) => industryTemplateSchema.parse(template));
const byId = new Map(templates.map((template) => [template.id, template]));

export function listIndustryTemplates() {
  return templates.map(({ cms, aiBrief, ...template }) => ({
    ...template,
    pageCount: template.pages.length,
    collectionCount: cms.collections.length,
    briefPreview: `${aiBrief.slice(0, 180)}${aiBrief.length > 180 ? "…" : ""}`,
  }));
}

export function getIndustryTemplate(id: string): IndustryTemplate {
  const template = byId.get(id);
  if (!template) throw new AppError("Industry template not found", 404, "INDUSTRY_TEMPLATE_NOT_FOUND");
  return template;
}
