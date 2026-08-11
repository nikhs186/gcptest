"use strict";
// Drop-in replacement for "firebase-functions/logger" so the API can run as a
// plain Node process (no Cloud Functions runtime) while keeping the same call sites.
/* eslint-disable @typescript-eslint/no-explicit-any */
Object.defineProperty(exports, "__esModule", { value: true });
exports.debug = exports.error = exports.warn = exports.info = void 0;
function write(level, message, entries) {
    const line = `${new Date().toISOString()} [${level}] ${message}`;
    const stream = level === "ERROR" ? console.error : level === "WARN" ? console.warn : console.log;
    if (entries.length > 0) {
        stream(line, ...entries);
    }
    else {
        stream(line);
    }
}
const info = (message, ...entries) => write("INFO", message, entries);
exports.info = info;
const warn = (message, ...entries) => write("WARN", message, entries);
exports.warn = warn;
const error = (message, ...entries) => write("ERROR", message, entries);
exports.error = error;
const debug = (message, ...entries) => write("DEBUG", message, entries);
exports.debug = debug;
//# sourceMappingURL=logger.js.map