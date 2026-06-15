/**
 * stubRepository — a typed placeholder whose every method throws "not implemented".
 * Lets a driver satisfy the StorageDriver shape during scaffolding without faking logic.
 */
export function stubRepository<T extends object>(label: string): T {
  return new Proxy({} as T, {
    get(_target, prop) {
      return () => {
        throw new Error(`${label}.${String(prop)} not implemented`);
      };
    },
  });
}
