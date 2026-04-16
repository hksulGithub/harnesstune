export const Uri = {
  joinPath: (...args: unknown[]) => ({ fsPath: args.join('/') }),
  file: (p: string) => ({ fsPath: p }),
};

export const EventEmitter = class<T> {
  private listeners: Array<(e: T) => unknown> = [];
  event = (listener: (e: T) => unknown) => {
    this.listeners.push(listener);
    return { dispose: () => { this.listeners = this.listeners.filter(l => l !== listener); } };
  };
  fire(data: T) {
    for (const listener of this.listeners) {
      listener(data);
    }
  }
  dispose() {
    this.listeners = [];
  }
};

export enum ViewColumn { One = 1 }

export const window = {
  createWebviewPanel: () => {},
  showErrorMessage: () => {},
  showInformationMessage: () => {},
};

export const commands = {
  executeCommand: () => {},
};
