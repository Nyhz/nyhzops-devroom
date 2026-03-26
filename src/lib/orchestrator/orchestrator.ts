import { eq, and, sql, inArray } from 'drizzle-orm';
import { Server as SocketIOServer } from 'socket.io';
import { getDatabase } from '@/lib/db/index';
import { missions } from '@/lib/db/schema';
import { config } from '@/lib/config';
import { executeMission, RateLimitError } from './executor';
import { CampaignExecutor } from './campaign-executor';
import type { Mission } from '@/types';

export class Orchestrator {
  public activeJobs: Map<string, AbortController> = new Map();
  public activeCampaigns: Map<string, CampaignExecutor> = new Map();
  public latestRateLimit: {
    status: string;
    resetsAt: number;
    rateLimitType: string;
    lastUpdated: number;
  } | null = null;
  private retryCount: Map<string, number> = new Map();
  private io: SocketIOServer;
  private maxAgents: number;

  constructor(io: SocketIOServer) {
    this.io = io;
    this.maxAgents = config.maxAgents;
  }

  async onMissionQueued(missionId: string): Promise<void> {
    // Check capacity
    if (this.activeJobs.size >= this.maxAgents) {
      console.log(`[Orchestrator] All ${this.maxAgents} slots full. Mission ${missionId} stays queued.`);
      return;
    }

    // Get mission from DB
    const db = getDatabase();
    const mission = db.select().from(missions)
      .where(eq(missions.id, missionId)).get();

    if (!mission || mission.status !== 'queued') {
      console.log(`[Orchestrator] Mission ${missionId} not found or not queued. Skipping.`);
      return;
    }

    // Create abort controller and track
    const ac = new AbortController();
    this.activeJobs.set(missionId, ac);
    console.log(`[Orchestrator] Executing mission ${missionId} (${this.activeJobs.size}/${this.maxAgents} slots)`);

    // Execute (don't await — runs in background)
    executeMission(mission as Mission, this.io, ac)
      .catch((err) => {
        if (err instanceof RateLimitError) {
          this.handleRateLimit(missionId, err);
        } else {
          console.error(`[Orchestrator] Mission ${missionId} failed:`, err.message);
        }
      })
      .finally(() => {
        this.activeJobs.delete(missionId);
        console.log(`[Orchestrator] Mission ${missionId} done (${this.activeJobs.size}/${this.maxAgents} slots)`);
        this.drainQueue();

        // Notify campaign executor if this is a campaign mission
        const completedMission = db.select().from(missions).where(eq(missions.id, missionId)).get();
        if (completedMission?.campaignId) {
          const campaignExec = this.activeCampaigns.get(completedMission.campaignId);
          if (campaignExec) {
            campaignExec.onCampaignMissionComplete(missionId).catch(err => {
              console.error(`[Orchestrator] Campaign mission complete handler failed:`, err);
            });
          }
        }
      });
  }

  async onMissionAbort(missionId: string): Promise<void> {
    const ac = this.activeJobs.get(missionId);
    if (ac) {
      console.log(`[Orchestrator] Aborting mission ${missionId}`);
      ac.abort();
    }
  }

  getActiveCount(): number {
    return this.activeJobs.size;
  }

  isExecuting(missionId: string): boolean {
    return this.activeJobs.has(missionId);
  }

  async startCampaign(campaignId: string): Promise<void> {
    const executor = new CampaignExecutor(campaignId, this.io);
    this.activeCampaigns.set(campaignId, executor);
    await executor.start();
  }

  async resumeCampaign(campaignId: string): Promise<void> {
    let executor = this.activeCampaigns.get(campaignId);
    if (!executor) {
      executor = new CampaignExecutor(campaignId, this.io);
      this.activeCampaigns.set(campaignId, executor);
    }
    await executor.resume();
  }

  async skipAndContinueCampaign(campaignId: string): Promise<void> {
    let executor = this.activeCampaigns.get(campaignId);
    if (!executor) {
      executor = new CampaignExecutor(campaignId, this.io);
      this.activeCampaigns.set(campaignId, executor);
    }
    await executor.skipAndContinue();
  }

  async abortCampaign(campaignId: string): Promise<void> {
    // Abort all active missions for this campaign
    const db = getDatabase();
    const campaignMissions = db.select({ id: missions.id }).from(missions)
      .where(and(
        eq(missions.campaignId, campaignId),
        inArray(missions.status, ['queued', 'deploying', 'in_combat'])
      )).all();

    for (const m of campaignMissions) {
      await this.onMissionAbort(m.id);
    }

    this.activeCampaigns.delete(campaignId);
  }

  async shutdown(): Promise<void> {
    console.log(`[Orchestrator] Shutting down ${this.activeJobs.size} active missions...`);
    const db = getDatabase();

    for (const [missionId, ac] of this.activeJobs) {
      ac.abort();
      db.update(missions).set({
        status: 'abandoned',
        completedAt: Date.now(),
        updatedAt: Date.now(),
        debrief: 'Mission abandoned: DEVROOM server shutdown.',
      }).where(eq(missions.id, missionId)).run();
    }

    this.activeJobs.clear();
    this.activeCampaigns.clear();
  }

  private async drainQueue(): Promise<void> {
    const slots = this.maxAgents - this.activeJobs.size;
    if (slots <= 0) return;

    const db = getDatabase();
    const queued = db.select().from(missions)
      .where(eq(missions.status, 'queued'))
      .orderBy(
        sql`CASE ${missions.priority} WHEN 'critical' THEN 0 WHEN 'high' THEN 1 WHEN 'normal' THEN 2 WHEN 'low' THEN 3 END`,
        missions.createdAt,
      )
      .limit(slots)
      .all();

    for (const mission of queued) {
      // Don't await — each mission runs independently
      this.onMissionQueued(mission.id);
    }
  }

  private handleRateLimit(missionId: string, err: RateLimitError): void {
    const retries = (this.retryCount.get(missionId) || 0) + 1;
    this.retryCount.set(missionId, retries);

    const db = getDatabase();

    if (retries > 5) {
      // Give up
      db.update(missions).set({
        status: 'compromised',
        completedAt: Date.now(),
        updatedAt: Date.now(),
        debrief: `Mission compromised: rate limit exceeded after 5 retries. Last limit type: ${err.rateLimitType}`,
      }).where(eq(missions.id, missionId)).run();

      this.io.to(`mission:${missionId}`).emit('mission:status', {
        missionId, status: 'compromised', timestamp: Date.now(),
      });
      this.retryCount.delete(missionId);
      console.log(`[Orchestrator] Mission ${missionId} compromised after 5 rate limit retries`);
      return;
    }

    // Exponential backoff: 60 * 2^(retry-1) seconds
    const delayMs = 60_000 * Math.pow(2, retries - 1);
    const delaySec = delayMs / 1000;

    console.log(`[Orchestrator] Mission ${missionId} rate limited. Retry ${retries}/5 in ${delaySec}s`);

    this.io.to(`mission:${missionId}`).emit('mission:log', {
      missionId,
      timestamp: Date.now(),
      type: 'status',
      content: `Rate limited. Retry ${retries}/5 in ${delaySec}s...\n`,
    });

    setTimeout(() => {
      this.onMissionQueued(missionId);
    }, delayMs);
  }
}
