import type { ModelConfiguration } from '../domain/types.js';
import type { ModelRegistry, RegistrySnapshot, VersionedModelRegistry } from '../ports/stores.js';
import { nowIso } from '../util/ids.js';

export class InMemoryModelRegistry implements VersionedModelRegistry {
  private models = new Map<string, ModelConfiguration>();
  private cachedSnapshot: readonly ModelConfiguration[] | null = null;
  private version = 0;
  private source = 'startup';
  private createdAt = nowIso();

  constructor(models: readonly ModelConfiguration[] = []) { this.replace(models); }

  snapshot(): readonly ModelConfiguration[] { return (this.cachedSnapshot ??= [...this.models.values()]); }

  get(id: string): ModelConfiguration | undefined { return this.models.get(id); }

  replace(models: readonly ModelConfiguration[]): void { this.publish(models, 'replace'); }

  currentSnapshot(): RegistrySnapshot {
    return { version: this.version, source: this.source, createdAt: this.createdAt, models: this.snapshot() };
  }

  publish(models: readonly ModelConfiguration[], source: string): RegistrySnapshot {
    this.models = new Map(models.map((model) => [model.id, structuredClone(model)]));
    this.cachedSnapshot = null;
    this.version += 1;
    this.source = source;
    this.createdAt = nowIso();
    return this.currentSnapshot();
  }
}
