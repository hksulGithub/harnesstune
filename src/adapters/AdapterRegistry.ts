import type { AgentBackendAdapter } from './AgentBackendAdapter';
import type { AdapterFactory, WorkspaceConnectionConfig } from './AdapterFactory';

export class AdapterRegistry {
  private readonly factories = new Map<string, AdapterFactory>();

  register(backendType: string, factory: AdapterFactory): void {
    this.factories.set(backendType, factory);
  }

  create(config: WorkspaceConnectionConfig): AgentBackendAdapter {
    const factory = this.factories.get(config.backendType);
    if (!factory) {
      throw new Error(`No adapter factory registered for backendType: ${config.backendType}`);
    }
    return factory.createAdapter(config);
  }
}
