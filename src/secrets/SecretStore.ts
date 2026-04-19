import * as vscode from 'vscode';

const KEY_PREFIX = 'harnesstune.apiKey.';
const RELAY_PREFIX = 'harnesstune.relay.';

export class SecretStore {
  constructor(private readonly secrets: vscode.SecretStorage) {}

  /** Retrieve an API key for the given provider. Returns undefined if not set. */
  public async getApiKey(provider: string): Promise<string | undefined> {
    return this.secrets.get(KEY_PREFIX + provider);
  }

  /** Store an API key for the given provider. */
  public async setApiKey(provider: string, value: string): Promise<void> {
    return this.secrets.store(KEY_PREFIX + provider, value);
  }

  /** Delete an API key for the given provider. */
  public async deleteApiKey(provider: string): Promise<void> {
    return this.secrets.delete(KEY_PREFIX + provider);
  }

  /** Store a relay token for a workspace */
  public async setRelayToken(workspaceId: string, token: string): Promise<void> {
    return this.secrets.store(RELAY_PREFIX + workspaceId, token);
  }

  /** Retrieve a relay token for a workspace */
  public async getRelayToken(workspaceId: string): Promise<string | undefined> {
    return this.secrets.get(RELAY_PREFIX + workspaceId);
  }

  /** Delete a relay token for a workspace */
  public async deleteRelayToken(workspaceId: string): Promise<void> {
    return this.secrets.delete(RELAY_PREFIX + workspaceId);
  }
}
