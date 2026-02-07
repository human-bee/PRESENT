'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import type { Room, Participant } from 'livekit-client';
import { useEditor } from '@tldraw/tldraw';
import { uniqueId } from 'tldraw';
import type { FairyModeDefinition, FairyProject, FairyProjectRole } from '@tldraw/fairy-shared';
import { toProjectId } from '@tldraw/fairy-shared';
import { createLiveKitBus } from '@/lib/livekit/livekit-bus';
import { useFairyApp } from '@/vendor/tldraw-fairy/fairy/fairy-app/FairyAppProvider';
import type { FairyAgent } from '@/vendor/tldraw-fairy/fairy/fairy-agent/FairyAgent';
import { useFairyPromptData } from './fairy-prompt-data';
import { getBooleanFlag } from '@/lib/feature-flags';

interface FairyLiveKitBridgeProps {
  room?: Room;
}

interface AgentHostState {
  isHost: boolean;
  hostId: string | null;
}

const FAIRY_CLIENT_AGENT_ENABLED = getBooleanFlag(process.env.NEXT_PUBLIC_FAIRY_CLIENT_AGENT_ENABLED, true);

function useIsAgentHost(room?: Room) {
  const [hostState, setHostState] = useState<AgentHostState>({ isHost: false, hostId: null });

  useEffect(() => {
    if (!room) {
      setHostState({ isHost: false, hostId: null });
      return;
    }

    const getParticipantId = (participant: Participant | undefined) =>
      participant?.identity || participant?.sid || '';
    const isAgentParticipant = (participant: Participant | undefined) => {
      const flagged = Boolean((participant as any)?.isAgent || (participant as any)?.permissions?.agent);
      if (flagged) return true;
      const identity = String(participant?.identity || participant?.name || '').toLowerCase();
      if (!identity) return false;
      if (identity.startsWith('agent-')) return true;
      if (identity.includes('voice-agent')) return true;
      return false;
    };
    const getEligibleId = (participant: Participant | undefined) => {
      if (!participant || isAgentParticipant(participant)) return '';
      return getParticipantId(participant);
    };

    const recompute = () => {
      const localId = getEligibleId(room.localParticipant);
      if (!localId) {
        setHostState({ isHost: false, hostId: null });
        return;
      }

      const ids = [localId];
      room.remoteParticipants.forEach((participant) => {
        const id = getEligibleId(participant);
        if (id) ids.push(id);
      });

      ids.sort();
      setHostState({ isHost: ids[0] === localId, hostId: ids[0] ?? null });
    };

    recompute();

    const handleParticipantChange = () => recompute();
    room.on('participantConnected', handleParticipantChange);
    room.on('participantDisconnected', handleParticipantChange);
    room.on('connectionStateChanged', handleParticipantChange);

    return () => {
      room.off('participantConnected', handleParticipantChange);
      room.off('participantDisconnected', handleParticipantChange);
      room.off('connectionStateChanged', handleParticipantChange);
    };
  }, [room]);

  return hostState;
}

function pickAgent(agents: FairyAgent[]): FairyAgent | null {
  if (!agents.length) return null;
  const selected = agents.find((agent) => agent.getEntity()?.isSelected);
  return selected ?? agents[0];
}

function getSelectedAgents(agents: FairyAgent[]): FairyAgent[] {
  return agents.filter((agent) => (agent.getEntity()?.isSelected && !agent.mode.isSleeping()) ?? false);
}

function getSharedProject(fairyApp: ReturnType<typeof useFairyApp>, agents: FairyAgent[]) {
  if (!fairyApp || agents.length === 0) return null;
  const firstProject = fairyApp.projects.getProjectByAgentId(agents[0].id);
  if (!firstProject) return null;
  const allInSameProject = agents.every(
    (agent) => fairyApp.projects.getProjectByAgentId(agent.id)?.id === firstProject.id,
  );
  return allInSameProject ? firstProject : null;
}

function buildGroupChatPrompt(
  instruction: string,
  followers: FairyAgent[],
  isDuo: boolean,
) {
  if (isDuo) {
    const partnerName = followers[0]?.getConfig()?.name ?? 'your partner';
    const partnerId = followers[0]?.id ?? '';
    return `You are collaborating with your partner on a duo project. You are the leader of the duo.You have been instructed to do this project:
${instruction}.
A project has automatically been created, but you need to start it yourself. You have been placed into duo orchestrator mode. You are working together with your partner to complete this project. Your partner is:
- name: ${partnerName} (id: ${partnerId})
You are to complete the project together. You can assign tasks to your partner or work on tasks yourself. As you are the leader of the duo, your priority is to assign tasks for your partner to complete, but you may do tasks yourself as well, if it makes sense to work in parallel. Make sure to give the approximate locations of the work to be done, if relevant, in order to make sure you both don't get confused if there are multiple tasks to be done.`;
  }
  const followerNames = followers
    .map((agent) => `- name: ${agent.getConfig()?.name} (id: ${agent.id})`)
    .join('\n');
  return `You are the leader of a group of fairies who have been instructed to do this project:
${instruction}.
A project has automatically been created, but you need to start it yourself. You have been placed into orchestrator mode. You are in charge of making sure the other fairies follow your instructions and complete the project together. Your teammates are:
${followerNames}
You are to complete the project together.
Make sure to give the approximate locations of the work to be done, if relevant, in order to make sure fairies dont get confused if there are multiple tasks to be done.`;
}

function buildProjectAugmentationPrompt(value: string) {
  return `The user has sent a follow-up instruction for the current project. DO NOT cancel or stop the existing project. Instead, augment the current plan based on this instruction:

${value}

IMPORTANT: You are continuing the same project. Based on the user's request:
- Create new tasks if the user wants additional work done
- Delete tasks using 'delete-project-task' if the user wants to cancel or remove specific work
- Mark tasks as done if they should be considered complete
- Adjust task assignments if needed
- Send a brief message explaining what changes you're making to the project

Do NOT start a completely new project. Respond with a message action first explaining your plan changes, then modify tasks as needed.`;
}

export function FairyLiveKitBridge({ room }: FairyLiveKitBridgeProps) {
  const editor = useEditor();
  const fairyApp = useFairyApp();
  const { isHost } = useIsAgentHost(room);
  const bus = useMemo(() => (room ? createLiveKitBus(room) : null), [room]);
  const processedIdsRef = useRef<Set<string>>(new Set());
  const buildPromptData = useFairyPromptData();

  // NOTE: Viewport + screenshot bridging is handled by the unified CanvasAgentController.
  // Keep the fairy bridge focused on fairy-specific prompt handling to avoid duplicate handlers.

  useEffect(() => {
    if (!bus) return;

    const unsubscribe = bus.on('agent_prompt', (message: any) => {
      void (async () => {
        if (!message || message.type !== 'agent_prompt') return;
        if (!isHost || !FAIRY_CLIENT_AGENT_ENABLED) return;

        const { payload } = message as { payload?: any };
        const text: string | undefined =
          typeof payload?.message === 'string' ? payload.message.trim() : undefined;
        if (!text) return;

        const requestId: string =
          typeof payload?.requestId === 'string' && payload.requestId
            ? payload.requestId
            : `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

        const seen = processedIdsRef.current;
        if (seen.has(requestId)) return;
        seen.add(requestId);
        if (seen.size > 100) {
          const firstKey = seen.values().next().value;
          if (firstKey) seen.delete(firstKey);
        }

        const boundsInput = payload?.bounds;
        const normalizedBounds =
          boundsInput && typeof boundsInput === 'object'
            ? {
                x: Number(boundsInput.x) || 0,
                y: Number(boundsInput.y) || 0,
                w: Number(boundsInput.w) || 0,
                h: Number(boundsInput.h) || 0,
              }
            : editor.getViewportPageBounds();

        const selectionIds = Array.isArray(payload?.selectionIds)
          ? payload.selectionIds.filter((id: unknown) => typeof id === 'string')
          : [];
        const validSelectionIds = selectionIds.filter((id: string) => {
          try {
            return Boolean(editor.getShape(id as any));
          } catch {
            return false;
          }
        });

        const requestedFairyCount = (() => {
          const meta = payload?.metadata;
          const raw =
            (meta && typeof meta === 'object' ? (meta as any)?.fairy?.count : undefined) ??
            (meta && typeof meta === 'object' ? (meta as any)?.fairyCount : undefined);
          const parsed =
            typeof raw === 'number' ? raw : typeof raw === 'string' ? Number(raw) : Number.NaN;
          if (!Number.isFinite(parsed)) return null;
          return Math.max(1, Math.min(8, Math.floor(parsed)));
        })();

        const ensureFairyCount = async (desired: number) => {
          const deadline = Date.now() + 2500;
          let current = fairyApp.agents.getAgents();
          const safeCreate = () => {
            try {
              fairyApp.agents.createNewFairyConfig();
            } catch {}
          };
          while (current.length < desired && Date.now() < deadline) {
            safeCreate();
            await new Promise((resolve) => setTimeout(resolve, 80));
            current = fairyApp.agents.getAgents();
          }
          return current;
        };

        let agents = fairyApp.agents.getAgents();
        // When the orchestrator requests multiple fairies, auto-select and orchestrate a multi-agent project.
        if (requestedFairyCount && requestedFairyCount >= 2) {
          agents = await ensureFairyCount(requestedFairyCount);
          const targetAgents = agents.slice(0, requestedFairyCount);
          const targetIds = new Set(targetAgents.map((agent) => agent.id));
          agents.forEach((agent) => {
            const shouldSelect = targetIds.has(agent.id);
            if (shouldSelect && agent.mode.isSleeping()) {
              try {
                agent.mode.setMode('idling');
              } catch {}
            }
            agent.updateEntity((f) => (f ? { ...f, isSelected: shouldSelect } : f));
          });
        }

        const selectedAgents = getSelectedAgents(agents);

        const runWithSelection = async (runner: () => Promise<void>) => {
          const previousSelection =
            typeof (editor as any).getSelectedShapeIds === 'function'
              ? (editor as any).getSelectedShapeIds()
              : [];
          const setSelection = (ids: string[]) => {
            const setter = (editor as any).setSelectedShapes ?? (editor as any).setSelectedShapeIds;
            if (typeof setter === 'function') {
              setter.call(editor, ids);
            }
          };
          if (validSelectionIds.length > 0) {
            setSelection(validSelectionIds);
          }
          try {
            await runner();
          } finally {
            if (validSelectionIds.length > 0) {
              setSelection(previousSelection);
            }
          }
        };

        if (selectedAgents.length > 1) {
          const sharedProject = getSharedProject(fairyApp, selectedAgents);
          if (sharedProject) {
            const orchestratorMember = fairyApp.projects.getProjectOrchestrator(sharedProject);
            const orchestratorAgent = orchestratorMember
              ? agents.find((agent) => agent.id === orchestratorMember.id)
              : null;
            if (orchestratorAgent) {
              if (orchestratorAgent.mode.isSleeping()) {
                orchestratorAgent.mode.setMode('idling');
              }
              orchestratorAgent.updateEntity((f) => (f ? { ...f, isSelected: true } : f));
              orchestratorAgent.position.summon();

              const projectMembers = sharedProject.members.length;
              const isDuo = projectMembers === 2;
              const augmentationPrompt = buildProjectAugmentationPrompt(text);

              void runWithSelection(async () => {
                orchestratorAgent.interrupt({
                  mode: isDuo ? 'duo-orchestrating-active' : 'orchestrating-active',
                  input: {
                    agentMessages: [augmentationPrompt],
                    userMessages: [text],
                    bounds: normalizedBounds,
                    source: 'user',
                    data: buildPromptData({
                      metadata: payload?.metadata,
                      selectionIds: validSelectionIds,
                    }),
                  },
                });
              });
              return;
            }
          }

          const eligibleAgents = selectedAgents.filter(
            (agent) => fairyApp.projects.getProjectByAgentId(agent.id) == null,
          );
          const leaderAgent = eligibleAgents[0] ?? null;
          const followerAgents = leaderAgent
            ? eligibleAgents.filter((agent) => agent.id !== leaderAgent.id)
            : [];

          if (leaderAgent && followerAgents.length > 0) {
            if (leaderAgent.mode.isSleeping()) {
              leaderAgent.mode.setMode('idling');
            }
            leaderAgent.updateEntity((f) => (f ? { ...f, isSelected: true } : f));
            leaderAgent.position.summon();

            const isDuo = followerAgents.length === 1;
            const agentAttributes: { role: FairyProjectRole; mode: FairyModeDefinition['type'] } = {
              role: isDuo ? 'duo-orchestrator' : 'orchestrator',
              mode: isDuo ? 'duo-orchestrating-active' : 'orchestrating-active',
            };

            const newProjectId = uniqueId(5);
            const newProject: FairyProject = {
              id: toProjectId(newProjectId),
              title: '',
              description: '',
              color: '',
              members: [
                {
                  id: leaderAgent.id,
                  role: agentAttributes.role,
                },
                ...followerAgents.map((agent) => ({ id: agent.id, role: 'drone' as const })),
              ],
              plan: '',
              softDeleted: false,
            };

            fairyApp.projects.hardDeleteSoftDeletedProjects();
            fairyApp.projects.addProject(newProject);

            const projectMemberIds = new Set(newProject.members.map((member) => member.id));
            agents.forEach((agent) => {
              const shouldSelect = projectMemberIds.has(agent.id);
              agent.updateEntity((f) => (f ? { ...f, isSelected: shouldSelect } : f));
            });

            leaderAgent.interrupt({
              mode: agentAttributes.mode,
              input: null,
            });

            followerAgents.forEach((agent) => {
              agent.interrupt({ mode: 'standing-by', input: null });
            });

            const leaderEntity = leaderAgent.getEntity();
            if (leaderEntity) {
              const leaderPosition = leaderEntity.position;
              const leaderPageId = leaderEntity.currentPageId;
              followerAgents.forEach((agent, index) => {
                const offset = (index + 1) * 120;
                const position = { x: leaderPosition.x + offset, y: leaderPosition.y };
                agent.position.moveTo(position);
                agent.updateEntity((f) => ({ ...f, flipX: true, currentPageId: leaderPageId }));
              });
            }

            const groupChatPrompt = buildGroupChatPrompt(text, followerAgents, isDuo);

            void runWithSelection(async () => {
              await leaderAgent.prompt({
                source: 'user',
                agentMessages: [groupChatPrompt],
                userMessages: [text],
                bounds: normalizedBounds,
                data: buildPromptData({
                  metadata: payload?.metadata,
                  selectionIds: validSelectionIds,
                }),
              } as any);
            });
            return;
          }
        }

        const agentPool = selectedAgents.length > 0 ? selectedAgents : agents;
        const agent = pickAgent(agentPool);
        if (!agent) return;

        if (agent.mode.isSleeping()) {
          agent.mode.setMode('idling');
        }
        agent.updateEntity((f) => (f ? { ...f, isSelected: true } : f));
        agent.position.summon();

        const run = async () => {
          try {
            await runWithSelection(async () => {
              await agent.prompt({
                message: text,
                bounds: normalizedBounds,
                source: 'user',
                data: buildPromptData({
                  metadata: payload?.metadata,
                  selectionIds: validSelectionIds,
                }),
              } as any);
            });
          } catch (error) {
            console.error('[FairyBridge] prompt failed', error);
          }
        };

        void run();
      })();
    });

    return () => {
      unsubscribe?.();
    };
  }, [bus, buildPromptData, editor, fairyApp, isHost]);

  return null;
}
