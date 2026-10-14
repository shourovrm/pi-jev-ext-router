import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";

/** One entry of pi-lazy-extensions' manifest. Only the fields the router reads. */
export interface LazyExtensionEntry {
	name: string;
	description?: string;
	tags?: string[];
	lifecycle?: "lazy" | "eager" | "keep-alive";
}

export interface LazyManifest {
	extensions: LazyExtensionEntry[];
}

export const NONE_OPTION = "none";

/**
 * Same search order as pi-lazy-extensions, so both read the same file:
 * LAZY_EXTENSIONS_CONFIG, then `<cwd>/.pi/`, then the agent dir, then `<cwd>`.
 */
export function findManifestPath(cwd: string, agentDir: string): string | undefined {
	const candidates = [
		process.env.LAZY_EXTENSIONS_CONFIG,
		join(cwd, ".pi", "lazy-extensions.json"),
		join(agentDir, "lazy-extensions.json"),
		join(cwd, "lazy-extensions.json"),
	];
	for (const candidate of candidates) {
		if (candidate && existsSync(candidate)) return resolve(candidate);
	}
	return undefined;
}

export function loadManifest(path: string): LazyManifest {
	let parsed: unknown;
	try {
		parsed = JSON.parse(readFileSync(path, "utf8"));
	} catch (error) {
		const reason = error instanceof Error ? error.message : String(error);
		throw new Error(`jev-ext-router: cannot parse lazy manifest ${path}: ${reason}`);
	}
	const extensions = (parsed as { extensions?: unknown } | null)?.extensions;
	if (!Array.isArray(extensions)) {
		throw new Error(`jev-ext-router: ${path} has no "extensions" array`);
	}
	return { extensions: extensions as LazyExtensionEntry[] };
}

/**
 * Build the option list Jev chooses from: every lazily loaded extension plus `none`.
 * Eager extensions are already loaded, so offering them would only waste probability mass.
 */
export function buildOptions(manifest: LazyManifest, exclude: string[]): Record<string, string> {
	const excluded = new Set(exclude);
	const options: Record<string, string> = {};

	for (const entry of manifest.extensions) {
		if (!entry.name || excluded.has(entry.name)) continue;
		if (entry.lifecycle === "eager" || entry.lifecycle === "keep-alive") continue;

		const parts = [entry.description?.trim() ?? ""];
		if (entry.tags && entry.tags.length > 0) parts.push(`Tags: ${entry.tags.join(", ")}`);
		options[entry.name] = parts.filter((part) => part !== "").join(" ") || entry.name;
	}

	options[NONE_OPTION] =
		"No extra extension is needed. The built-in tools (read, write, edit, bash, grep, find) are enough, or the request is plain conversation.";
	return options;
}
