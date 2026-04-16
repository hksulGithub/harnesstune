export const Uri = {
  joinPath: (...args: unknown[]) => ({ fsPath: args.join('/') }),
  file: (p: string) => ({ fsPath: p }),
};

export const EventEmitter = class {
  event = () => {};
  fire() {}
  dispose() {}
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
