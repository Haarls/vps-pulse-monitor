import type { StateTransition } from './store.js';

export function formatAlertMessage(t: StateTransition): string {
  const ts = t.occurredAt.slice(0, 19).replace('T', ' ') + ' UTC';
  if (t.eventType === 'DOWN') {
    return `[DOWN] ${t.targetName} (${t.endpoint}) — ${t.reason} at ${ts}`;
  }
  const dur = t.durationSec !== null ? ` after ${t.durationSec}s` : '';
  return `[RECOVERED] ${t.targetName} (${t.endpoint}) — ${t.reason}${dur} at ${ts}`;
}

export async function dispatchWebhookAlert(
  webhookUrl: string | undefined,
  transition: StateTransition,
  fetchImpl: typeof fetch = fetch,
): Promise<boolean> {
  if (!webhookUrl?.trim()) return false;

  const message = formatAlertMessage(transition);
  // Dual text + content keys support Slack, Discord, and generic JSON webhook receivers without extra adapters.
  const body = JSON.stringify({
    text: message,
    content: message,
    event: transition,
  });

  const res = await fetchImpl(webhookUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body,
    signal: AbortSignal.timeout(5_000),
  });

  if (!res.ok) {
    throw new Error(`Webhook responded with HTTP ${res.status}`);
  }
  return true;
}
