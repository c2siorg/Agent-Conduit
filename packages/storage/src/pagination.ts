/**
 * Cursor pagination — AAP list endpoints return `next_cursor` + `has_more` (§5.2).
 * Opaque cursors keep paging stable across inserts.
 */
export interface PageQuery {
  cursor?: string;
  limit?: number;
}

export interface Page<T> {
  items: T[];
  nextCursor: string | null;
  hasMore: boolean;
}
