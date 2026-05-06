type LogLevel = "debug" | "info" | "warn" | "error";

type LogContext = Record<string, string | number | boolean | null>;

export class Logger {
  static debug(source: string, message: string, context: LogContext = {}) {
    Logger.write("debug", source, message, context);
  }

  static info(source: string, message: string, context: LogContext = {}) {
    Logger.write("info", source, message, context);
  }

  static warn(source: string, message: string, context: LogContext = {}) {
    Logger.write("warn", source, message, context);
  }

  static error(source: string, message: string, context: LogContext = {}) {
    Logger.write("error", source, message, context);
  }

  private static write(
    level: LogLevel,
    source: string,
    message: string,
    context: LogContext,
  ) {
    const payload = JSON.stringify({
      level,
      message: `[${source}] ${message}`,
      context,
      ts: new Date().toISOString(),
    });

    const stream = level === "error" || level === "warn" ? process.stderr : process.stdout;
    stream.write(`${payload}\n`);
  }
}
