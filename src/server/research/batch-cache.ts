export class BatchSourceSnapshotCache<T> {
  readonly #snapshots = new Map<string, Promise<T>>();

  async get(sourceAppId: string, sourceVersion: number, load: () => Promise<T>): Promise<T> {
    const key = `${sourceAppId}:${sourceVersion}`;
    let snapshot = this.#snapshots.get(key);
    if (!snapshot) {
      snapshot = load();
      this.#snapshots.set(key, snapshot);
      snapshot.catch(() => this.#snapshots.delete(key));
    }
    return snapshot;
  }

  clear(): void {
    this.#snapshots.clear();
  }
}
