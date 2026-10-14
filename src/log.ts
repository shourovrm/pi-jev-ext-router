import { appendFileSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

/** One line per routed prompt. The prompt text is never written here. */
export interface LogEntry {
	timestamp: string;
	skipped?: string;
	/** The cue that sent the prompt to Jev, or that matched before an "already active" skip. */
	cue?: string;
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

/** Files the router writes for itself live under $XDG_STATE_HOME/jev-ext-router. */
export function stateFilePath(fileName: string): string {
	const stateHome = process.env.XDG_STATE_HOME || join(homedir(), ".local", "state");
	return join(stateHome, "jev-ext-router", fileName);
}

export function logFilePath(): string {
	return stateFilePath("log.jsonl");
}

export function appendLog(entry: LogEntry, path: string = logFilePath()): void {
	mkdirSync(dirname(path), { recursive: true });
	appendFileSync(path, `${JSON.stringify(entry)}\n`, "utf8");
}
