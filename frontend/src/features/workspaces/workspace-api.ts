export interface WorkspaceSummary {
  id: string; name: string; slug: string; organizationId: string;
  organizationName?: string; userRole: "OWNER" | "ADMIN" | "MEMBER";
}
export interface WorkspaceDetails extends WorkspaceSummary {
  members: Array<{ id: string; userId: string; role: string; user: { fullName: string | null } }>;
  websites: Array<{ id: string; name: string; slug: string; status: string }>;
  hasMoreWebsites: boolean;
}
export async function workspaceRequest<T>(base: string, path: string, options: {
  signal?: AbortSignal; method?: string; payload?: unknown; key?: string;
} = {}): Promise<T> {
  const method = options.method ?? "GET";
  const response = await fetch(`${base}/api/v1/tenant-workspaces${path}`, {
    method, credentials: "include", signal: options.signal,
    headers: method === "GET" ? {} : {
      "Content-Type": "application/json", "X-Forge-Intent": "workspace-command", "Idempotency-Key": options.key ?? "",
    },
    body: options.payload === undefined ? undefined : JSON.stringify(options.payload),
  });
  const data = await response.json().catch(() => null);
  if (!response.ok || !data) throw new Error(data?.error?.message || data?.message || `Workspace request failed (${response.status})`);
  return data as T;
}
