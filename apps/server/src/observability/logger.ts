import type { LogLevel } from '../config/configSchema.js';

/**
 * Logger — structured NDJSON logging.
 * Never logs secrets, raw tokens, or raw request args (use the audit log's args hash instead).
 */
export interface Logger {
  debug(message: string, fields?: Record<string, unknown>): void;
  info(message: string, fields?: Record<string, unknown>): void;
  warn(message: string, fields?: Record<string, unknown>): void;
  error(message: string, fields?: Record<string, unknown>): void;
  /** Derive a child logger with bound fields (e.g. requestId, agentId). */
  child(bindings: Record<string, unknown>): Logger;
}

const LEVELS: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };

class NdjsonLogger implements Logger {
  constructor(
    private readonly threshold: number,
    private readonly bindings: Record<string, unknown> = {},
  ) {}

  private emit(level: LogLevel, message: string, fields?: Record<string, unknown>): void {
    if (LEVELS[level] < this.threshold) {
      return;
    }
    const record = { level, time: new Date().toISOString(), message, ...this.bindings, ...fields };
    process.stdout.write(`${JSON.stringify(record)}\n`);
  }

  debug(message: string, fields?: Record<string, unknown>): void {
    this.emit('debug', message, fields);
  }
  info(message: string, fields?: Record<string, unknown>): void {
    this.emit('info', message, fields);
  }
  warn(message: string, fields?: Record<string, unknown>): void {
    this.emit('warn', message, fields);
  }
  error(message: string, fields?: Record<string, unknown>): void {
    this.emit('error', message, fields);
  }
  child(bindings: Record<string, unknown>): Logger {
    return new NdjsonLogger(this.threshold, { ...this.bindings, ...bindings });
  }
}

/** Build the default NDJSON logger at the given level. */
export function createLogger(level: LogLevel): Logger {
  return new NdjsonLogger(LEVELS[level]);
}
