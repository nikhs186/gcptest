// Drop-in replacement for "firebase-functions/logger" so the API can run as a
// plain Node process (no Cloud Functions runtime) while keeping the same call sites.
/* eslint-disable @typescript-eslint/no-explicit-any */

function write(level: "INFO" | "WARN" | "ERROR" | "DEBUG", message: string, entries: any[]) {
  const line = `${new Date().toISOString()} [${level}] ${message}`;
  const stream = level === "ERROR" ? console.error : level === "WARN" ? console.warn : console.log;
  if (entries.length > 0) {
    stream(line, ...entries);
  } else {
    stream(line);
  }
}

export const info = (message: string, ...entries: any[]) => write("INFO", message, entries);
export const warn = (message: string, ...entries: any[]) => write("WARN", message, entries);
export const error = (message: string, ...entries: any[]) => write("ERROR", message, entries);
export const debug = (message: string, ...entries: any[]) => write("DEBUG", message, entries);
