'use client';

import { useEffect, useRef, useState } from 'react';
import { useSocket } from '@/hooks/use-socket';
import type { CampaignStatus, PhaseStatus, MissionStatus } from '@/types';

interface CampaignStatusEvent {
  campaignId: string;
  status: CampaignStatus;
}

interface PhaseStatusEvent {
  campaignId: string;
  phaseId: string;
  status: PhaseStatus;
}

interface PhaseDebriefEvent {
  campaignId: string;
  phaseId: string;
  debrief: string;
}

interface CampaignMissionStatusEvent {
  campaignId: string;
  missionId: string;
  status: MissionStatus;
}

interface MissionStatusEvent {
  missionId: string;
  status: MissionStatus;
}

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

  // Stabilize missionIds reference using a ref + JSON comparison
  const missionIdsRef = useRef(missionIds);
  if (JSON.stringify(missionIdsRef.current) !== JSON.stringify(missionIds)) {
    missionIdsRef.current = missionIds;
  }
  const stableMissionIds = missionIdsRef.current;

  useEffect(() => {
    if (!socket) return;
    socket.emit('campaign:subscribe', campaignId);

    // Subscribe to each mission's room for real-time status updates
    for (const mid of stableMissionIds) {
      socket.emit('mission:subscribe', mid);
    }

    const onStatus = (d: CampaignStatusEvent) => {
      if (d.campaignId === campaignId) setStatus(d.status);
    };
    const onPhaseStatus = (d: PhaseStatusEvent) => {
      if (d.campaignId === campaignId) setPhaseStatuses(p => ({ ...p, [d.phaseId]: d.status }));
    };
    const onPhaseDebrief = (d: PhaseDebriefEvent) => {
      if (d.campaignId === campaignId) setPhaseDebriefs(p => ({ ...p, [d.phaseId]: d.debrief }));
    };
    const onCampaignMissionStatus = (d: CampaignMissionStatusEvent) => {
      if (d.campaignId === campaignId) setMissionStatuses(p => ({ ...p, [d.missionId]: d.status }));
    };

    const onMissionStatus = (d: MissionStatusEvent) => {
      if (d.missionId && stableMissionIds.includes(d.missionId)) {
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
      for (const mid of stableMissionIds) {
        socket.emit('mission:unsubscribe', mid);
      }
    };
  }, [socket, campaignId, stableMissionIds]);

  return { status, phaseStatuses, phaseDebriefs, missionStatuses };
}
