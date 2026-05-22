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

export enum StatusBarAlignment { Left = 1, Right = 2 }

export class ThemeColor {
  constructor(public readonly id: string) {}
}

type MockStatusBarItem = {
  text: string;
  command: string | undefined;
  tooltip: string | undefined;
  backgroundColor: ThemeColor | undefined;
  show: jest.Mock;
  dispose: jest.Mock;
};

const statusBarItems: MockStatusBarItem[] = [];

export function __resetStatusBarItems(): void {
  statusBarItems.length = 0;
}

export function __getStatusBarItems(): MockStatusBarItem[] {
  return statusBarItems;
}

export const window = {
  createWebviewPanel: () => {},
  createStatusBarItem: () => {
    const item: MockStatusBarItem = {
      text: '',
      command: undefined,
      tooltip: undefined,
      backgroundColor: undefined,
      show: jest.fn(),
      dispose: jest.fn(),
    };
    statusBarItems.push(item);
    return item;
  },
  showErrorMessage: () => {},
  showInformationMessage: () => {},
  showWarningMessage: () => Promise.resolve(undefined),
};

export const commands = {
  executeCommand: () => {},
};
