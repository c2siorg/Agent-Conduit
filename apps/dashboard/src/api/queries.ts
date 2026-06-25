import type { AgentConfiguration } from '@conduit/core';
import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import {
  createDashboardApi,
  type AgentSummary,
  type AuditEntry,
  type AuditFilter,
  type ConnectionSummary,
} from './client';

const api = createDashboardApi();

/** The gateway's AAP discovery document (§5.1) - the effective, server-side configuration. */
export function useConfiguration(): UseQueryResult<AgentConfiguration> {
  return useQuery({
    queryKey: ['configuration'],
    queryFn: () => api.getConfiguration(),
    staleTime: 60000,
  });
}

/** Agent registry, refreshed periodically for a near-live view. */
export function useAgents(): UseQueryResult<AgentSummary[]> {
  return useQuery({
    queryKey: ['agents'],
    queryFn: () => api.listAgents(),
    refetchInterval: 5000,
  });
}

/** Connection vault entries (no secrets). */
export function useConnections(): UseQueryResult<ConnectionSummary[]> {
  return useQuery({
    queryKey: ['connections'],
    queryFn: () => api.listConnections(),
    refetchInterval: 10000,
  });
}

/** Audit log, filtered server-side by agent/outcome, refreshed for a near-live stream. */
export function useAudit(filter: AuditFilter): UseQueryResult<AuditEntry[]> {
  return useQuery({
    queryKey: ['audit', filter.agentId ?? '', filter.outcome ?? ''],
    queryFn: () => api.listAudit(filter),
    refetchInterval: 5000,
  });
}

export interface HealthState {
  ready: boolean;
}

/** Gateway readiness (DB reachable) for the system-status indicator + dashboard. */
export function useHealth(): UseQueryResult<HealthState> {
  return useQuery({
    queryKey: ['health'],
    queryFn: async () => {
      const res = await fetch('/api/readyz');
      const body = (await res.json().catch(() => ({}))) as { status?: string };
      return { ready: res.ok && body.status === 'ready' };
    },
    refetchInterval: 10000,
  });
}
