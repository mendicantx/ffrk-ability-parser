// Talks to DataController (/data/*), which serves the server's data cache.

// Asks the server to re-fetch the sheets and battle.js (rate-limited server-side).
// Resolves to an error message, or null on success. A refresh where some sources
// failed (and kept their previous data) is reported as an error naming them.
export async function refreshServerData() {
  const token = document.querySelector('meta[name="csrf-token"]')?.content ?? '';
  try {
    const resp = await fetch('/data/refresh', { method: 'POST', headers: { 'X-CSRF-Token': token } });
    const body = await resp.json().catch(() => ({}));
    if (resp.ok) {
      const failed = Object.entries(body.refresh_errors ?? {});
      return failed.length
        ? `Refreshed, but these kept their previous data: ${failed.map(([name, message]) => `${name} (${message})`).join('; ')}`
        : null;
    }
    return body.error ?? `HTTP ${resp.status}`;
  } catch (e) {
    return e.message;
  }
}

// Splits a /data/sheets response into its sheets and the refresh time.
export function splitSheetsResponse(data) {
  const { last_refreshed_at: lastRefreshedAt = null, ...sheets } = data;
  return { sheets, lastRefreshedAt };
}
