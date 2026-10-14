import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ToolLedger } from "../src/ledger.ts";

describe("ToolLedger", () => {
	const dirs: string[] = [];
	const ledgerPath = () => {
		const dir = mkdtempSync(join(tmpdir(), "jev-ledger-"));
		dirs.push(dir);
		return join(dir, "tools.json");
	};
	afterEach(() => {
		for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
	});

	it("knows nothing about an extension it never saw load", () => {
		const ledger = new ToolLedger(ledgerPath());
		expect(ledger.isActive("webfetch", new Set(["web_fetch"]))).toBe(false);
	});

	it("reports an extension active only while all of its tools are active", () => {
		const ledger = new ToolLedger(ledgerPath());
		ledger.record("context7", ["context7_resolve_library_id", "context7_get_library_docs"]);
		const both = new Set(["read", "context7_resolve_library_id", "context7_get_library_docs"]);
		expect(ledger.isActive("context7", both)).toBe(true);
		// The lazy loader unloads an idle extension by removing its tools from the active set.
		expect(ledger.isActive("context7", new Set(["read", "context7_resolve_library_id"]))).toBe(false);
	});

	it("checks a group of extensions together", () => {
		const ledger = new ToolLedger(ledgerPath());
		ledger.record("webfetch", ["web_fetch"]);
		ledger.record("mcp", ["mcp"]);
		expect(ledger.allActive(["webfetch", "mcp"], new Set(["web_fetch", "mcp"]))).toBe(true);
		expect(ledger.allActive(["webfetch", "mcp"], new Set(["web_fetch"]))).toBe(false);
		expect(ledger.allActive([], new Set(["web_fetch"]))).toBe(false);
	});

	it("ignores an empty recording, so a failed load never marks an extension active", () => {
		const ledger = new ToolLedger(ledgerPath());
		ledger.record("webfetch", []);
		expect(ledger.isActive("webfetch", new Set())).toBe(false);
	});

	it("saves what it learns and reads it back in the next session", () => {
		const path = ledgerPath();
		new ToolLedger(path).record("webfetch", ["web_fetch"]);
		expect(JSON.parse(readFileSync(path, "utf8"))).toEqual({
			version: 1,
			tools: { webfetch: ["web_fetch"] },
		});
		expect(new ToolLedger(path).isActive("webfetch", new Set(["web_fetch"]))).toBe(true);
	});

	it("fails loudly on a corrupt ledger file", () => {
		const path = ledgerPath();
		writeFileSync(path, "{ broken");
		expect(() => new ToolLedger(path)).toThrow(/cannot parse/);
	});
});
