import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { CONFIG_FILE_NAME, DEFAULT_CONFIG, loadConfig, parseKeyFile, resolveApiKey } from "../src/config.ts";

describe("parseKeyFile", () => {
	it("reads a plain assignment", () => {
		expect(parseKeyFile("OPENROUTER_API_KEY=sk-or-abc\n")).toBe("sk-or-abc");
	});

	it("accepts export and quotes, and skips comments", () => {
		const contents = "# key file\nexport OPENROUTER_API_KEY='sk-or-quoted'\n";
		expect(parseKeyFile(contents)).toBe("sk-or-quoted");
	});

	it("returns undefined when the key line is missing or empty", () => {
		expect(parseKeyFile("OTHER=1\n")).toBeUndefined();
		expect(parseKeyFile("OPENROUTER_API_KEY=\n")).toBeUndefined();
	});
});

describe("loadConfig", () => {
	const dirs: string[] = [];
	const makeDir = () => {
		const dir = mkdtempSync(join(tmpdir(), "jev-ext-router-"));
		dirs.push(dir);
		return dir;
	};
	afterEach(() => {
		for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
	});

	it("returns the defaults when the file is absent", () => {
		expect(loadConfig(makeDir())).toEqual(DEFAULT_CONFIG);
	});

	it("merges user keys over the defaults", () => {
		const dir = makeDir();
		writeFileSync(join(dir, CONFIG_FILE_NAME), JSON.stringify({ defaultEnabled: true, exclude: ["fusion"] }));
		const config = loadConfig(dir);
		expect(config.defaultEnabled).toBe(true);
		expect(config.exclude).toEqual(["fusion"]);
		expect(config.minProbability).toBe(DEFAULT_CONFIG.minProbability);
	});

	it("fails loudly on malformed JSON", () => {
		const dir = makeDir();
		writeFileSync(join(dir, CONFIG_FILE_NAME), "{ not json");
		expect(() => loadConfig(dir)).toThrow(/cannot parse/);
	});

	it("resolves the key from the environment before the file", () => {
		const dir = makeDir();
		const previous = process.env.OPENROUTER_API_KEY;
		process.env.OPENROUTER_API_KEY = "sk-from-env";
		try {
			expect(resolveApiKey({ ...DEFAULT_CONFIG, keyFile: join(dir, "missing.env") })).toBe("sk-from-env");
		} finally {
			if (previous === undefined) delete process.env.OPENROUTER_API_KEY;
			else process.env.OPENROUTER_API_KEY = previous;
		}
	});

	it("names the missing key file in its error", () => {
		const dir = makeDir();
		const previous = process.env.OPENROUTER_API_KEY;
		delete process.env.OPENROUTER_API_KEY;
		try {
			expect(() => resolveApiKey({ ...DEFAULT_CONFIG, keyFile: join(dir, "missing.env") })).toThrow(
				/missing\.env/,
			);
		} finally {
			if (previous !== undefined) process.env.OPENROUTER_API_KEY = previous;
		}
	});
});
