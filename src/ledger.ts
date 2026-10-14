import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

interface LedgerFile {
	version: 1;
	tools: Record<string, string[]>;
}

/**
 * Which tools each lazy extension adds, learned from what appeared in pi's active
 * tool list when the extension loaded.
 *
 * pi-lazy-extensions unloads an idle extension by taking its tools out of the
 * active list, so "are all of this extension's tools active right now" is an exact
 * test for "is it loaded" with no timer to keep in sync with the loader. The map is
 * saved to disk so it also works for extensions the model loaded itself and in the
 * next session.
 */
export class ToolLedger {
	private readonly toolsByExtension = new Map<string, string[]>();

	constructor(private readonly path: string) {
		if (!existsSync(path)) return;
		let parsed: Partial<LedgerFile>;
		try {
			parsed = JSON.parse(readFileSync(path, "utf8"));
		} catch (error) {
			const reason = error instanceof Error ? error.message : String(error);
			throw new Error(`jev-ext-router: cannot parse tool ledger ${path}: ${reason}`);
		}
		for (const [extension, tools] of Object.entries(parsed.tools ?? {})) {
			if (Array.isArray(tools) && tools.length > 0) this.toolsByExtension.set(extension, tools);
		}
	}

	record(extension: string, tools: readonly string[]): void {
		// A load that added nothing proves nothing; keep whatever was known before.
		if (tools.length === 0) return;
		this.toolsByExtension.set(extension, [...tools].sort());
		this.save();
	}

	toolsOf(extension: string): readonly string[] {
		return this.toolsByExtension.get(extension) ?? [];
	}

	isActive(extension: string, activeTools: ReadonlySet<string>): boolean {
		const tools = this.toolsOf(extension);
		return tools.length > 0 && tools.every((tool) => activeTools.has(tool));
	}

	allActive(extensions: readonly string[], activeTools: ReadonlySet<string>): boolean {
		return extensions.length > 0 && extensions.every((extension) => this.isActive(extension, activeTools));
	}

	private save(): void {
		const file: LedgerFile = { version: 1, tools: Object.fromEntries(this.toolsByExtension) };
		mkdirSync(dirname(this.path), { recursive: true });
		writeFileSync(this.path, `${JSON.stringify(file, null, 2)}\n`, "utf8");
	}
}
