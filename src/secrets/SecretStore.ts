import * as vscode from 'vscode';

const KEY_PREFIX = 'harnesstune.apiKey.';

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
}
