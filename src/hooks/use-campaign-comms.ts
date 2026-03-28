'use client';

import { useEffect, useState } from 'react';
import { useSocket } from '@/hooks/use-socket';
import type { CampaignStatus, PhaseStatus, MissionStatus } from '@/types';

export function useCampaignComms(
  campaignId: string,
  initialStatus: string,
  missionIds: string[] = [],
) {
  const socket = useSocket();
  const [status, setStatus] = useState<CampaignStatus>(initialStatus as CampaignStatus);
  const [phaseStatuses, setPhaseStatuses] = useState<Record<string, PhaseStatus>>({});
  const [phaseDebriefs, setPhaseDebriefs] = useState<Record<string, string>>({});
  const [missionStatuses, setMissionStatuses] = useState<Record<string, MissionStatus>>({});

  useEffect(() => {
    if (!socket) return;
    socket.emit('campaign:subscribe', campaignId);

    // Subscribe to each mission's room for real-time status updates
    for (const mid of missionIds) {
      socket.emit('mission:subscribe', mid);
    }

    // Campaign-level events
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const onStatus = (d: any) => { if (d.campaignId === campaignId) setStatus(d.status); };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const onPhaseStatus = (d: any) => { if (d.campaignId === campaignId) setPhaseStatuses(p => ({ ...p, [d.phaseId]: d.status })); };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const onPhaseDebrief = (d: any) => { if (d.campaignId === campaignId) setPhaseDebriefs(p => ({ ...p, [d.phaseId]: d.debrief })); };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const onCampaignMissionStatus = (d: any) => { if (d.campaignId === campaignId) setMissionStatuses(p => ({ ...p, [d.missionId]: d.status })); };

    // Mission-level status events (emitted by executor and review handler)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const onMissionStatus = (d: any) => {
      if (d.missionId && missionIds.includes(d.missionId)) {
        setMissionStatuses(p => ({ ...p, [d.missionId]: d.status }));
      }
    };

    socket.on('campaign:status', onStatus);
    socket.on('campaign:phase-status', onPhaseStatus);
    socket.on('campaign:phase-debrief', onPhaseDebrief);
    socket.on('campaign:mission-status', onCampaignMissionStatus);
    socket.on('mission:status', onMissionStatus);

    return () => {
      socket.off('campaign:status', onStatus);
      socket.off('campaign:phase-status', onPhaseStatus);
      socket.off('campaign:phase-debrief', onPhaseDebrief);
      socket.off('campaign:mission-status', onCampaignMissionStatus);
      socket.off('mission:status', onMissionStatus);
      socket.emit('campaign:unsubscribe', campaignId);
      for (const mid of missionIds) {
        socket.emit('mission:unsubscribe', mid);
      }
    };
  }, [socket, campaignId, missionIds.join(',')]);

  return { status, phaseStatuses, phaseDebriefs, missionStatuses };
}
