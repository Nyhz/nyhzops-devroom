/**
 * Typed Socket.IO event map scaffolding.
 *
 * This file installs the type-safety scaffolding using Socket.IO's native
 * `Server<ClientToServerEvents, ServerToClientEvents>` generics. It types
 * the full set of subscribe/unsubscribe client events and the
 * CONTROL-critical server→client path. Other server→client events remain
 * untyped for now — Socket.IO tolerates unknown events, so incremental
 * tightening via interface augmentation is safe.
 */

// Client → Server: subscribe / unsubscribe, briefing:send, general:send
export interface ClientToServerEvents {
  'system:subscribe': () => void;
  'system:unsubscribe': () => void;
  'mission:subscribe': (id: string) => void;
  'mission:unsubscribe': (id: string) => void;
  'hq:subscribe': () => void;
  'hq:unsubscribe': () => void;
  'campaign:subscribe': (campaignId: string) => void;
  'campaign:unsubscribe': (campaignId: string) => void;
  'battlefield:subscribe': (battlefieldId: string) => void;
  'battlefield:unsubscribe': (battlefieldId: string) => void;
  'devserver:subscribe': (battlefieldId: string) => void;
  'devserver:unsubscribe': (battlefieldId: string) => void;
  'console:subscribe': (battlefieldId: string) => void;
  'console:unsubscribe': (battlefieldId: string) => void;
  'deps:subscribe': (battlefieldId: string) => void;
  'deps:unsubscribe': (battlefieldId: string) => void;
  'tests:subscribe': (battlefieldId: string) => void;
  'tests:unsubscribe': (battlefieldId: string) => void;
  'telemetry:subscribe': (battlefieldId: string) => void;
  'telemetry:unsubscribe': (battlefieldId: string) => void;
  'briefing:subscribe': (campaignId: string) => void;
  'briefing:unsubscribe': (campaignId: string) => void;
  'briefing:send': (data: { campaignId: string; message: string }) => void;
  'general:subscribe': (sessionId: string) => void;
  'general:unsubscribe': (sessionId: string) => void;
  'general:send': (data: { sessionId: string; message: string }) => void;
}

// Server → Client: type the CONTROL-critical path; leave room for incremental tightening.
export interface ServerToClientEvents {
  'mission:log': (payload: {
    id: string;
    missionId: string | null;
    campaignId: string | null;
    battlefieldId: string | null;
    actor: string;
    message: string;
    level: string;
    createdAt: number;
  }) => void;
  'mission:status': (payload: {
    missionId: string;
    status: string;
    compromiseReason?: string;
  }) => void;
  'campaign:log': (payload: {
    id: string;
    missionId: string | null;
    campaignId: string | null;
    battlefieldId: string | null;
    actor: string;
    message: string;
    level: string;
    createdAt: number;
  }) => void;
  'campaign:mission-status': (payload: {
    campaignId: string;
    missionId: string;
    status: string;
  }) => void;
  'activity:event': (payload: {
    type: string;
    battlefieldCodename: string;
    missionTitle: string;
    timestamp: number;
    detail: string;
  }) => void;
  'notification:new': (payload: {
    id: string;
    level: string;
    title: string;
    detail: string;
    entityType?: string;
    entityId?: string;
    battlefieldId?: string;
    timestamp: number;
  }) => void;
}

// Event names present in the codebase but not yet typed — documented
// here so incremental typing can find them:
// FIXME: also present — briefing:chunk, briefing:error, briefing:plan-ready,
//        general:chunk, general:complete, general:error, general:system,
//        tests:complete, tests:*, deps:verify-*, devserver:*, console:*,
//        telemetry:*, system:status, etc.
// These remain untyped for now; Socket.IO treats them as open extensions.
// Interface augmentation can tighten in future PRs.
