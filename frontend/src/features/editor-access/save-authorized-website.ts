/** A browser cache write is not a durable server acknowledgement. Callers update
 * their saved baseline only after this function confirms the expected resource.
 * No automatic retry: legacy saves do not yet have a durable idempotency contract.
 */
export async function saveAuthorizedWebsite(base: string, websiteId: string, payload: unknown, signal?: AbortSignal) {
  const deadline = AbortSignal.timeout(15000);
  const response = await fetch(`${base}/api/websites/${encodeURIComponent(websiteId)}`, {
    method: "PUT", credentials: "include", headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload), signal: signal ? AbortSignal.any([signal, deadline]) : deadline,
  });
  const body = await response.json().catch(() => null);
  if (!response.ok) throw new Error(body?.error?.message || "The server did not confirm this save. Your changes remain unsaved.");
  if (!body?.website || body.website.id !== websiteId) throw new Error("The server returned an invalid save acknowledgement.");
  return body.website;
}
