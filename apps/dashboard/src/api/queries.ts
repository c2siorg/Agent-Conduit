import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import type { Agent } from '@conduit/core';

/**
 * Example query hook — agents registry.
 * Real hooks call `DashboardApi`; query keys are stable per resource for cache correctness.
 * @remarks Scaffold — `queryFn` is stubbed.
 */
export function useAgents(): UseQueryResult<Agent[]> {
  return useQuery<Agent[]>({
    queryKey: ['agents'],
    queryFn: () => {
      throw new Error('useAgents.queryFn not implemented');
    },
  });
}
