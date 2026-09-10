export function updateVersioned<T extends { version: number }>(
  current: T,
  expectedVersion: number,
  patch: Partial<Omit<T, "version">>,
): T {
  if (current.version !== expectedVersion) {
    throw new Error(`Version conflict: expected ${expectedVersion}, found ${current.version}`);
  }
  return { ...current, ...patch, version: current.version + 1 };
}

