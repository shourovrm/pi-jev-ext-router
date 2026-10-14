import { appendFileSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

/** One line per routed prompt. The prompt text is never written here. */
export interface LogEntry {
	timestamp: string;
	skipped?: string;
	choice?: string;
	probabilities?: Record<string, number>;
	confidence?: number;
	activated?: string[];
	/** Activations after which no new tools appeared: already loaded, or the loader failed. */
	unchanged?: string[];
	costUsd?: number;
	elapsedMs?: number;
	error?: string;
}

export function logFilePath(): string {
	const stateHome = process.env.XDG_STATE_HOME || join(homedir(), ".local", "state");
	return join(stateHome, "jev-ext-router", "log.jsonl");
}

export function appendLog(entry: LogEntry, path: string = logFilePath()): void {
	mkdirSync(dirname(path), { recursive: true });
	appendFileSync(path, `${JSON.stringify(entry)}\n`, "utf8");
}
