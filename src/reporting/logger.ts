import fs from "fs";
import path from "path";

type Level = "INFO" | "WARN" | "ERROR" | "DEBUG";

const logsDir = path.resolve(process.cwd(), "artifacts/logs");
if (!fs.existsSync(logsDir)) fs.mkdirSync(logsDir, { recursive: true });

const logFile = path.join(
  logsDir,
  `run-${new Date().toISOString().replace(/[:.]/g, "-")}.log`
);

function write(level: Level, message: string) {
  const line = `${new Date().toISOString()} [${level}] ${message}\n`;
  fs.appendFileSync(logFile, line);
  process.stdout.write(line);
}

export const logger = {
  info: (msg: string) => write("INFO", msg),
  warn: (msg: string) => write("WARN", msg),
  error: (msg: string) => write("ERROR", msg),
  debug: (msg: string) => write("DEBUG", msg),
};

export function getLogFilePath() {
  return logFile;
}