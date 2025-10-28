export interface Logger {
  debug(...args: unknown[]): void;
  info(...args: unknown[]): void;
  warn(...args: unknown[]): void;
  error(...args: unknown[]): void;
}

export class ConsoleLogger implements Logger {
  private levelOrder = ['debug', 'info', 'warn', 'error'] as const;
  private currentLevelIndex: number;

  constructor(level: 'debug' | 'info' | 'warn' | 'error' = 'info') {
    this.currentLevelIndex = this.levelOrder.indexOf(level);
  }

  private shouldLog(level: typeof this.levelOrder[number]) {
    return this.levelOrder.indexOf(level) >= this.currentLevelIndex;
  }

  debug(...args: unknown[]): void {
    if (this.shouldLog('debug')) console.debug('[DEBUG]', ...args);
  }

  info(...args: unknown[]): void {
    if (this.shouldLog('info')) console.info('[INFO]', ...args);
  }

  warn(...args: unknown[]): void {
    if (this.shouldLog('warn')) console.warn('[WARN]', ...args);
  }

  error(...args: unknown[]): void {
    if (this.shouldLog('error')) console.error('[ERROR]', ...args);
  }
}
