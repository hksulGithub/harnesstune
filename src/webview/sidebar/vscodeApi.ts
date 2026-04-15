// acquireVsCodeApi() MUST be called exactly once per webview and stored in module scope.
// Calling it twice throws. This is the #1 most common webview bug.
import type { WebviewToHostMessage } from '../../types/messages';

interface VsCodeApi {
  postMessage(message: WebviewToHostMessage): void;
  getState(): unknown;
  setState(state: unknown): void;
}

declare function acquireVsCodeApi(): VsCodeApi;

export const vscode = acquireVsCodeApi();
