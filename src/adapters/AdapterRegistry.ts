import type { AgentBackendAdapter } from './AgentBackendAdapter';
import type { AdapterFactory, WorkspaceConnectionConfig } from './AdapterFactory';
import { assertNeverBackendType } from '../types/workspace';

export class AdapterRegistry {
  private readonly factories = new Map<string, AdapterFactory>();

  register(backendType: string, factory: AdapterFactory): void {
    this.factories.set(backendType, factory);
  }

  create(config: WorkspaceConnectionConfig): AgentBackendAdapter {
    const factory = this.factories.get(config.backendType);
    if (!factory) {
      switch (config.backendType) {
        case 'claude-code':
        case 'openclaw':
        case 'remote':
          throw new Error(`No adapter factory registered for backendType: ${config.backendType}`);
        default:
          return assertNeverBackendType(config.backendType);
      }
    }
    return factory.createAdapter(config);
  }
}
