import { randomUUID } from "node:crypto";

export type AdminChildFlowType = "force_checkin";

export type AdminChildFlowContext = {
  id: string;
  type: AdminChildFlowType;
  guildId: string;
  actorDiscordUserId: string;
  tournamentInstanceId: number;
  sourcePanelScopeKey: string;
  createdAt: Date;
  expiresAt: Date;
};

const DEFAULT_FLOW_TTL_MS = 10 * 60 * 1000;
const flowContexts = new Map<string, AdminChildFlowContext>();

function cleanupExpiredContexts(now = Date.now()) {
  for (const [id, context] of flowContexts.entries()) {
    if (context.expiresAt.getTime() <= now) {
      flowContexts.delete(id);
    }
  }
}

export function createAdminChildFlowContext(params: {
  type: AdminChildFlowType;
  guildId: string;
  actorDiscordUserId: string;
  tournamentInstanceId: number;
  sourcePanelScopeKey: string;
  ttlMs?: number;
}): AdminChildFlowContext {
  cleanupExpiredContexts();
  const createdAt = new Date();
  const ttlMs = params.ttlMs ?? DEFAULT_FLOW_TTL_MS;
  const context: AdminChildFlowContext = {
    id: randomUUID(),
    type: params.type,
    guildId: params.guildId,
    actorDiscordUserId: params.actorDiscordUserId,
    tournamentInstanceId: params.tournamentInstanceId,
    sourcePanelScopeKey: params.sourcePanelScopeKey,
    createdAt,
    expiresAt: new Date(createdAt.getTime() + ttlMs),
  };
  flowContexts.set(context.id, context);
  return context;
}

export function getAdminChildFlowContext(flowId: string): AdminChildFlowContext | null {
  cleanupExpiredContexts();
  const context = flowContexts.get(flowId);
  if (!context) {
    return null;
  }
  if (context.expiresAt.getTime() <= Date.now()) {
    flowContexts.delete(flowId);
    return null;
  }
  return context;
}

export function deleteAdminChildFlowContext(flowId: string): void {
  flowContexts.delete(flowId);
}
