'use client';

import { useEffect, useState } from 'react';
import { useSocket, useReconnectKey } from '@/hooks/use-socket';
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

export function useCampaignComms(
  campaignId: string,
  initialStatus: string,
) {
  const socket = useSocket();
  const reconnectKey = useReconnectKey();
  const [status, setStatus] = useState<CampaignStatus>(initialStatus as CampaignStatus);
  const [phaseStatuses, setPhaseStatuses] = useState<Record<string, PhaseStatus>>({});
  const [phaseDebriefs, setPhaseDebriefs] = useState<Record<string, string>>({});
  const [missionStatuses, setMissionStatuses] = useState<Record<string, MissionStatus>>({});

  useEffect(() => {
    if (!socket) return;
    socket.emit('campaign:subscribe', campaignId);

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

    socket.on('campaign:status', onStatus);
    socket.on('campaign:phase-status', onPhaseStatus);
    socket.on('campaign:phase-debrief', onPhaseDebrief);
    socket.on('campaign:mission-status', onCampaignMissionStatus);

    return () => {
      socket.off('campaign:status', onStatus);
      socket.off('campaign:phase-status', onPhaseStatus);
      socket.off('campaign:phase-debrief', onPhaseDebrief);
      socket.off('campaign:mission-status', onCampaignMissionStatus);
      socket.emit('campaign:unsubscribe', campaignId);
    };
  }, [socket, campaignId, reconnectKey]);

  return { status, phaseStatuses, phaseDebriefs, missionStatuses };
}
