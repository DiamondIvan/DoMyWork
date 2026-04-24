const functionsBaseUrl = (
  process.env.EXPO_PUBLIC_FUNCTIONS_BASE_URL ?? ""
).replace(/\/$/, "");

export const defaultUserId = process.env.EXPO_PUBLIC_DEFAULT_USER_ID ?? "";

export async function enqueueAutomationRequest({ userId, type, payload }) {
  if (!functionsBaseUrl) {
    throw new Error("Missing EXPO_PUBLIC_FUNCTIONS_BASE_URL");
  }

  const effectiveUserId = (userId ?? defaultUserId).trim();
  if (!effectiveUserId) {
    throw new Error(
      "Missing userId. Set EXPO_PUBLIC_DEFAULT_USER_ID or provide one.",
    );
  }

  const res = await fetch(`${functionsBaseUrl}/enqueueAutomationRequest`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      userId: effectiveUserId,
      type,
      payload,
    }),
  });

  const json = await res.json().catch(() => null);
  if (!res.ok) {
    throw new Error(json?.error ?? `Request failed (${res.status})`);
  }

  return json;
}
