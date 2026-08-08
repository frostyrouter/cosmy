import type { ModelConfiguration } from '../domain/types.js';
import type { ModelRegistry } from '../ports/stores.js';

export class InMemoryModelRegistry implements ModelRegistry {
  private models = new Map<string, ModelConfiguration>();

  constructor(models: readonly ModelConfiguration[] = []) { this.replace(models); }

  snapshot(): readonly ModelConfiguration[] { return [...this.models.values()]; }

  get(id: string): ModelConfiguration | undefined { return this.models.get(id); }

  replace(models: readonly ModelConfiguration[]): void {
    this.models = new Map(models.map((model) => [model.id, structuredClone(model)]));
  }
}
