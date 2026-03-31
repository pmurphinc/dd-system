import { createHash } from "crypto";
import {
  buildPublicTournamentState,
  PublicTournamentStatePayload,
} from "./buildPublicTournamentState";

const REQUEST_TIMEOUT_MS = 3_500;
const RETRY_DELAY_MS = 700;

let warnedMissingConfig = false;
let warnedLegacyWebhookPath = false;
let lastPayloadHash: string | null = null;

function normalizeWebhookUrl(rawUrl: string): string {
  if (!rawUrl.includes("/api/tournament/update")) {
    return rawUrl;
  }

  if (!warnedLegacyWebhookPath) {
    warnedLegacyWebhookPath = true;
    console.warn(
      "[tournament-webhook] TOURNAMENT_WEBHOOK_URL used legacy path /api/tournament/update. Normalizing to /api/webhooks/tournament."
    );
  }

  return rawUrl.replace("/api/tournament/update", "/api/webhooks/tournament");
}

function getWebhookConfig():
  | { url: string; secret: string }
  | null {
  const rawUrl = process.env.TOURNAMENT_WEBHOOK_URL?.trim();
  const secret = process.env.TOURNAMENT_WEBHOOK_SECRET?.trim();

  if (!rawUrl || !secret) {
    if (!warnedMissingConfig) {
      warnedMissingConfig = true;
      console.warn(
        "[tournament-webhook] Missing TOURNAMENT_WEBHOOK_URL or TOURNAMENT_WEBHOOK_SECRET; webhook notifications are disabled."
      );
    }
    return null;
  }

  return {
    url: normalizeWebhookUrl(rawUrl),
    secret,
  };
}

function getPayloadHash(payload: PublicTournamentStatePayload): string {
  return createHash("sha256").update(JSON.stringify(payload)).digest("hex");
}

function shouldRetry(statusCode: number | null, error: unknown): boolean {
  if (error) return true;
  if (statusCode === null) return false;
  return statusCode >= 500;
}

async function sendWebhookRequest(
  url: string,
  secret: string,
  payload: PublicTournamentStatePayload
): Promise<{
  ok: boolean;
  statusCode: number | null;
  error?: unknown;
  responseBody?: string;
}> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Webhook-Secret": secret,
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });

    return {
      ok: response.ok,
      statusCode: response.status,
      responseBody: await response.text(),
    };
  } catch (error) {
    return {
      ok: false,
      statusCode: null,
      error,
    };
  } finally {
    clearTimeout(timeout);
  }
}

function logDeliveryResult(
  payload: PublicTournamentStatePayload,
  result: {
    ok: boolean;
    statusCode: number | null;
    error?: unknown;
    responseBody?: string;
  },
  reason?: string
) {
  const payloadPreview = JSON.stringify({
    eventWinner: payload.eventWinner,
    status: payload.status,
    currentLeader: payload.currentLeader,
    updatedAt: payload.updatedAt,
    tournamentId: payload.tournamentId,
    cycle: payload.cycle,
    isComplete: payload.isComplete,
  });
  const context = `status="${payload.status}" leader="${payload.currentLeader ?? "-"}" winner="${payload.eventWinner ?? "-"}" cycle="${payload.cycle}" tournamentId="${payload.tournamentId}" payload=${payloadPreview}`;

  if (result.ok) {
    console.log(
      `[tournament-webhook] sent (${reason ?? "state_change"}) ${context} response=${result.statusCode ?? "n/a"} body=${result.responseBody ?? ""}`
    );
    return;
  }

  console.warn(
    `[tournament-webhook] failed (${reason ?? "state_change"}) ${context} response=${result.statusCode ?? "n/a"} error=${result.error instanceof Error ? result.error.message : "unknown"} body=${result.responseBody ?? ""}`
  );
}

function buildTieLeaderFallbackPayload(
  payload: PublicTournamentStatePayload
): PublicTournamentStatePayload | null {
  if (!payload.currentLeader || !payload.currentLeader.includes("(Tie)")) {
    return null;
  }

  return {
    ...payload,
    currentLeader: null,
  };
}

export async function pushTournamentWebhookUpdate(input?: {
  tournamentInstanceId?: number;
  guildId?: string;
  reason?: string;
  force?: boolean;
}): Promise<{ sent: boolean; reason: string; payload?: PublicTournamentStatePayload }> {
  const config = getWebhookConfig();
  if (!config) {
    return { sent: false, reason: "missing_webhook_config" };
  }

  const payload = await buildPublicTournamentState({
    tournamentInstanceId: input?.tournamentInstanceId,
    guildId: input?.guildId,
  });

  if (!payload) {
    console.warn("[tournament-webhook] No tournament payload available; skipping send.");
    return { sent: false, reason: "no_payload" };
  }

  const payloadHash = getPayloadHash(payload);
  if (!input?.force && payloadHash === lastPayloadHash) {
    return { sent: false, reason: "duplicate_payload", payload };
  }

  const firstAttempt = await sendWebhookRequest(config.url, config.secret, payload);
  if (firstAttempt.ok) {
    lastPayloadHash = payloadHash;
    logDeliveryResult(payload, firstAttempt, input?.reason);
    return { sent: true, reason: "ok", payload };
  }

  if (shouldRetry(firstAttempt.statusCode, firstAttempt.error)) {
    await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS));
    const retry = await sendWebhookRequest(config.url, config.secret, payload);
    if (retry.ok) {
      lastPayloadHash = payloadHash;
      logDeliveryResult(payload, retry, `${input?.reason ?? "state_change"}:retry`);
      return { sent: true, reason: "ok_after_retry", payload };
    }
    logDeliveryResult(payload, retry, `${input?.reason ?? "state_change"}:retry_failed`);
    return { sent: false, reason: "request_failed", payload };
  }

  if (firstAttempt.statusCode === 400) {
    const tieFallbackPayload = buildTieLeaderFallbackPayload(payload);
    if (tieFallbackPayload) {
      const tieRetry = await sendWebhookRequest(
        config.url,
        config.secret,
        tieFallbackPayload
      );

      if (tieRetry.ok) {
        lastPayloadHash = getPayloadHash(tieFallbackPayload);
        logDeliveryResult(tieFallbackPayload, tieRetry, `${input?.reason ?? "state_change"}:tie_leader_fallback`);
        return { sent: true, reason: "ok_after_tie_fallback", payload: tieFallbackPayload };
      }

      logDeliveryResult(tieFallbackPayload, tieRetry, `${input?.reason ?? "state_change"}:tie_leader_fallback_failed`);
      return { sent: false, reason: "request_failed", payload: tieFallbackPayload };
    }
  }

  logDeliveryResult(payload, firstAttempt, input?.reason);
  return { sent: false, reason: "request_failed", payload };
}

export async function sendManualTournamentWebhookTestPayload(): Promise<{
  sent: boolean;
  reason: string;
  payload: PublicTournamentStatePayload;
  responseStatusCode: number | null;
  responseBody?: string;
}> {
  const config = getWebhookConfig();
  const payload: PublicTournamentStatePayload = {
    eventWinner: null,
    status: "Registration Open",
    currentLeader: null,
    updatedAt: new Date().toISOString(),
    tournamentId: "manual-test",
    cycle: 0,
    isComplete: false,
  };

  if (!config) {
    return {
      sent: false,
      reason: "missing_webhook_config",
      payload,
      responseStatusCode: null,
    };
  }

  const response = await sendWebhookRequest(config.url, config.secret, payload);
  logDeliveryResult(payload, response, "manual_test_payload");

  return {
    sent: response.ok,
    reason: response.ok ? "ok" : "request_failed",
    payload,
    responseStatusCode: response.statusCode,
    responseBody: response.responseBody,
  };
}
