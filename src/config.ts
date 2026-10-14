import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

/** User-editable settings, read from `<agent-dir>/jev-ext-router.json`. */
export interface RouterConfig {
	/** Whether a new session starts with routing on. Off by default: every routed prompt leaves the machine. */
	defaultEnabled: boolean;
	/** Jev's probability for an extension must reach this before it is activated. */
	minProbability: number;
	/** At most this many extensions are activated per prompt. */
	maxActivations: number;
	/** Give up on Jev after this many milliseconds and let the prompt through unrouted. */
	timeoutMs: number;
	/** Longest wait for pi-lazy-extensions to finish loading one activated extension. */
	activationWaitMs: number;
	/** Prompts shorter than this are not routed ("ok", "yes", "go on"). */
	minPromptLength: number;
	/** Jev model id on OpenRouter. */
	model: string;
	/** File holding `OPENROUTER_API_KEY=...`; `~` expands to the home directory. */
	keyFile: string;
	/** Lazy extension names that Jev is never offered. */
	exclude: string[];
}

export const DEFAULT_CONFIG: RouterConfig = {
	defaultEnabled: false,
	minProbability: 0.35,
	maxActivations: 2,
	timeoutMs: 3000,
	activationWaitMs: 2000,
	minPromptLength: 8,
	model: "typesafe/jev-1.13",
	keyFile: "~/.config/jev/openrouter.env",
	exclude: [],
};

export const CONFIG_FILE_NAME = "jev-ext-router.json";

export function expandHome(path: string): string {
	if (path === "~") return homedir();
	if (path.startsWith("~/")) return join(homedir(), path.slice(2));
	return path;
}

/** Merge the user's file over the defaults. A missing file is not an error; a malformed one is. */
export function loadConfig(agentDir: string): RouterConfig {
	const path = join(agentDir, CONFIG_FILE_NAME);
	if (!existsSync(path)) return { ...DEFAULT_CONFIG };

	let parsed: unknown;
	try {
		parsed = JSON.parse(readFileSync(path, "utf8"));
	} catch (error) {
		const reason = error instanceof Error ? error.message : String(error);
		throw new Error(`jev-ext-router: cannot parse ${path}: ${reason}`);
	}
	if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
		throw new Error(`jev-ext-router: ${path} must contain a JSON object`);
	}
	return { ...DEFAULT_CONFIG, ...(parsed as Partial<RouterConfig>) };
}

/**
 * Parse a dotenv-style file and return the OpenRouter key.
 * Accepts `KEY=value`, `export KEY=value`, and single or double quotes around the value.
 */
export function parseKeyFile(contents: string): string | undefined {
	for (const rawLine of contents.split(/\r?\n/)) {
		const line = rawLine.trim();
		if (line === "" || line.startsWith("#")) continue;
		const match = /^(?:export\s+)?OPENROUTER_API_KEY\s*=\s*(.*)$/.exec(line);
		if (!match) continue;
		let value = match[1].trim();
		const quoted = /^(['"])(.*)\1$/.exec(value);
		if (quoted) value = quoted[2];
		if (value !== "") return value;
	}
	return undefined;
}

/** The environment wins over the key file so a shell export can override the saved key. */
export function resolveApiKey(config: RouterConfig): string {
	const fromEnv = process.env.OPENROUTER_API_KEY?.trim();
	if (fromEnv) return fromEnv;

	const path = expandHome(config.keyFile);
	if (!existsSync(path)) {
		throw new Error(`jev-ext-router: no OPENROUTER_API_KEY in the environment and no key file at ${path}`);
	}
	const key = parseKeyFile(readFileSync(path, "utf8"));
	if (!key) {
		throw new Error(`jev-ext-router: ${path} has no OPENROUTER_API_KEY line`);
	}
	return key;
}
