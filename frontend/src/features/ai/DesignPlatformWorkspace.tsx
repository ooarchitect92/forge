import { useEffect, useMemo, useState } from "react";

type TemplateSummary = {
  id: string;
  name: string;
  category: string;
  description: string;
  pages: string[];
  pageCount: number;
  collectionCount: number;
  briefPreview: string;
};
type IndustryTemplate = { id: string; name: string; category: string; description: string; pages: string[]; aiBrief: string; cms: unknown };
type Platform = {
  providers: {
    stitch: { available: boolean; workflow: string };
    figma: { connected: boolean; runtimeCapabilities: string[]; conditionalCapabilities: { reason: string } };
  };
  cms: { fieldTypes: string[]; destructiveMigrations: boolean };
  starterUsage: { limit: number; reserved: number; remaining: number; disclosure: string };
};
type FigmaPreview = {
  source: { fileName: string; fileKeyHint: string; lastModified: string | null };
  import: { pageCount: number; pageNames: string[]; nodeCount: number; warnings: string[] };
};
type CmsPreview = {
  canApply: boolean;
  conflictCount: number;
  summary: Record<string, number>;
  actions: Array<{ collection: string; kind: string; target: string; detail?: string }>;
};

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try { response = await fetch(url, { ...init, credentials: "include" }); }
  catch { throw new Error("The request could not reach Forge."); }
  const body = await response.json().catch(() => null);
  if (!response.ok) throw new Error(body?.error?.message || body?.message || "The design-platform request failed safely.");
  return body as T;
}

function commandHeaders(key: string, websiteId?: string, version?: number): Record<string, string> {
  return {
    "Content-Type": "application/json",
    "X-Forge-Intent": "document-command",
    "Idempotency-Key": key,
    ...(websiteId && version ? { "If-Match": `"${websiteId}:document:${version}"` } : {}),
  };
}

export function DesignPlatformWorkspace({
  apiUrl,
  websiteId,
  prepareVersion,
  onChangesetCreated,
  onUseBrief,
}: {
  apiUrl: string;
  websiteId: string;
  prepareVersion: () => Promise<number>;
  onChangesetCreated: (changesetId: string) => Promise<void> | void;
  onUseBrief: (brief: string) => void;
}) {
  const base = `${apiUrl}/api/v1/ai/design-platform`;
  const [platform, setPlatform] = useState<Platform | null>(null);
  const [templates, setTemplates] = useState<TemplateSummary[]>([]);
  const [selectedTemplate, setSelectedTemplate] = useState<IndustryTemplate | null>(null);
  const [figmaSource, setFigmaSource] = useState("");
  const [figmaPreview, setFigmaPreview] = useState<FigmaPreview | null>(null);
  const [cmsJson, setCmsJson] = useState("");
  const [cmsPreview, setCmsPreview] = useState<CmsPreview | null>(null);
  const [result, setResult] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState("");

  useEffect(() => {
    let active = true;
    void Promise.all([
      request<{ platform: Platform }>(`${base}/websites/${websiteId}/capabilities`),
      request<{ templates: TemplateSummary[] }>(`${base}/templates`),
    ]).then(([capabilities, catalog]) => {
      if (!active) return;
      setPlatform(capabilities.platform);
      setTemplates(catalog.templates);
    }).catch((cause) => { if (active) setError(cause instanceof Error ? cause.message : "Unable to load design-platform capabilities."); });
    return () => { active = false; };
  }, [base, websiteId]);

  const usagePercent = useMemo(() => platform?.starterUsage.limit
    ? Math.min(100, Math.round((platform.starterUsage.reserved / platform.starterUsage.limit) * 100))
    : 0, [platform]);

  async function run(name: string, work: () => Promise<void>) {
    setBusy(name); setError(""); setResult("");
    try { await work(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Operation failed safely."); }
    finally { setBusy(""); }
  }

  async function chooseTemplate(id: string) {
    await run("template", async () => {
      const response = await request<{ template: IndustryTemplate }>(`${base}/templates/${id}`);
      setSelectedTemplate(response.template);
      setCmsJson(JSON.stringify(response.template.cms, null, 2));
      setCmsPreview(null);
      onUseBrief(response.template.aiBrief);
      setResult(`${response.template.name} brief loaded into the AI designer. Review it before generation.`);
    });
  }

  async function previewFigma() {
    await run("figma-preview", async () => {
      const response = await request<{ preview: FigmaPreview }>(`${base}/websites/${websiteId}/figma/preview`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ source: figmaSource, depth: 6 }),
      });
      setFigmaPreview(response.preview);
    });
  }

  async function proposeFigma() {
    await run("figma-import", async () => {
      const version = await prepareVersion();
      const response = await request<{ executionId: string; changesetId: string }>(`${base}/websites/${websiteId}/figma/changesets`, {
        method: "POST",
        headers: commandHeaders(crypto.randomUUID(), websiteId, version),
        body: JSON.stringify({ source: figmaSource, depth: 6 }),
      });
      await onChangesetCreated(response.changesetId);
      setResult("Figma import proposal created. Review the native pages below before applying them.");
    });
  }

  function parsedCms(): unknown {
    try { return JSON.parse(cmsJson); }
    catch { throw new Error("CMS blueprint must be valid JSON."); }
  }

  async function previewCms() {
    await run("cms-preview", async () => {
      const response = await request<{ preview: CmsPreview }>(`${base}/websites/${websiteId}/cms/blueprints/preview`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(parsedCms()),
      });
      setCmsPreview(response.preview);
    });
  }

  async function applyCms() {
    await run("cms-apply", async () => {
      const response = await request<{ result: { counts: Record<string, number>; blueprintName: string } }>(`${base}/websites/${websiteId}/cms/blueprints/apply`, {
        method: "POST", headers: commandHeaders(crypto.randomUUID()), body: JSON.stringify(parsedCms()),
      });
      const refreshed = await request<{ preview: CmsPreview }>(`${base}/websites/${websiteId}/cms/blueprints/preview`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(parsedCms()),
      });
      setCmsPreview(refreshed.preview);
      setResult(`${response.result.blueprintName} applied with merge-only semantics: ${Object.entries(response.result.counts).map(([key, value]) => `${key} ${value}`).join(", ")}.`);
    });
  }

  return <div className="mt-4 space-y-5 rounded-xl border border-slate-200 bg-slate-50 p-4">
    <div className="grid gap-3 md:grid-cols-3">
      <div className="rounded-lg bg-white p-3 shadow-sm"><p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Stitch pipeline</p><p className="mt-1 font-semibold">{platform?.providers.stitch.available ? "Configured" : "Needs administrator setup"}</p></div>
      <div className="rounded-lg bg-white p-3 shadow-sm"><p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Figma connector</p><p className="mt-1 font-semibold">{platform?.providers.figma.connected ? "Connected" : "Connect a governed token"}</p></div>
      <div className="rounded-lg bg-white p-3 shadow-sm"><p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Forge starter units</p><p className="mt-1 font-semibold">{platform ? `${platform.starterUsage.remaining} of ${platform.starterUsage.limit} remaining` : "Loading…"}</p><div className="mt-2 h-1.5 rounded bg-slate-200"><div className="h-1.5 rounded bg-blue-600" style={{ width: `${usagePercent}%` }} /></div></div>
    </div>
    {platform && <p className="text-xs text-slate-600">{platform.starterUsage.disclosure}</p>}

    <section>
      <div className="mb-2"><h3 className="font-semibold">AI industry templates</h3><p className="text-sm text-slate-600">Load a grounded design brief and its matching CMS blueprint. Nothing is applied automatically.</p></div>
      <div className="grid gap-2 md:grid-cols-2">
        {templates.map((template) => <button key={template.id} disabled={!!busy} onClick={() => void chooseTemplate(template.id)} className="rounded-lg border bg-white p-3 text-left hover:border-blue-500 disabled:opacity-50">
          <span className="text-xs font-semibold uppercase tracking-wide text-blue-700">{template.category}</span>
          <span className="mt-1 block font-semibold">{template.name}</span>
          <span className="mt-1 block text-xs text-slate-600">{template.pageCount} pages · {template.collectionCount} collections</span>
        </button>)}
      </div>
      {selectedTemplate && <p className="mt-2 text-sm text-slate-700">Loaded: <strong>{selectedTemplate.name}</strong> — {selectedTemplate.description}</p>}
    </section>

    <section className="rounded-lg border bg-white p-4">
      <h3 className="font-semibold">Import from Figma as a reviewable proposal</h3>
      <p className="mt-1 text-sm text-slate-600">Forge reads a Figma file or selected node, converts supported layers to native pages, and leaves the current website unchanged until approval.</p>
      <input value={figmaSource} onChange={(event) => { setFigmaSource(event.target.value); setFigmaPreview(null); }} placeholder="https://www.figma.com/design/... or file key" className="mt-3 w-full rounded border p-2 text-sm" />
      <div className="mt-2 flex flex-wrap gap-2">
        <button disabled={!!busy || figmaSource.trim().length < 8 || platform?.providers.figma.connected !== true} onClick={() => void previewFigma()} className="rounded border px-3 py-2 text-sm disabled:opacity-50">Preview import</button>
        <button disabled={!!busy || !figmaPreview} onClick={() => void proposeFigma()} className="rounded bg-blue-700 px-3 py-2 text-sm text-white disabled:opacity-50">Create native proposal</button>
      </div>
      {figmaPreview && <div className="mt-3 rounded bg-slate-50 p-3 text-sm">
        <p><strong>{figmaPreview.source.fileName}</strong> · {figmaPreview.import.pageCount} pages · {figmaPreview.import.nodeCount} converted layers</p>
        <p className="mt-1 text-slate-600">{figmaPreview.import.pageNames.join(", ")}</p>
        {!!figmaPreview.import.warnings.length && <ul className="mt-2 list-disc pl-5 text-amber-800">{figmaPreview.import.warnings.map((warning) => <li key={warning}>{warning}</li>)}</ul>}
      </div>}
    </section>

    <section className="rounded-lg border bg-white p-4">
      <h3 className="font-semibold">CMS blueprint</h3>
      <p className="mt-1 text-sm text-slate-600">Preview and merge collections, typed fields and optional seed items. Existing fields are never deleted, and type changes are blocked for review.</p>
      <textarea value={cmsJson} onChange={(event) => { setCmsJson(event.target.value); setCmsPreview(null); }} placeholder="Choose a template or paste a version 1 CMS blueprint" className="mt-3 min-h-52 w-full rounded border p-3 font-mono text-xs" />
      <div className="mt-2 flex gap-2">
        <button disabled={!!busy || !cmsJson.trim()} onClick={() => void previewCms()} className="rounded border px-3 py-2 text-sm disabled:opacity-50">Preview CMS changes</button>
        <button disabled={!!busy || !cmsPreview?.canApply} onClick={() => void applyCms()} className="rounded bg-slate-900 px-3 py-2 text-sm text-white disabled:opacity-50">Apply merge-only blueprint</button>
      </div>
      {cmsPreview && <div className="mt-3 rounded bg-slate-50 p-3 text-sm">
        <p className={cmsPreview.canApply ? "text-emerald-800" : "text-red-700"}>{cmsPreview.canApply ? "Blueprint is safe to merge." : `${cmsPreview.conflictCount} field type conflict(s) require review.`}</p>
        <p className="mt-1 text-slate-600">{Object.entries(cmsPreview.summary).map(([key, value]) => `${key}: ${value}`).join(" · ")}</p>
      </div>}
    </section>

    {busy && <p role="status" className="text-sm text-blue-700">Working on {busy.replace(/-/g, " ")}…</p>}
    {result && <p role="status" className="rounded bg-emerald-50 p-3 text-sm text-emerald-800">{result}</p>}
    {error && <p role="alert" className="rounded bg-red-50 p-3 text-sm text-red-700">{error}</p>}
  </div>;
}
