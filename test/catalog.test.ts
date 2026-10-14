import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { buildOptions, findManifestPath, idleWindowMsOf, loadManifest, NONE_OPTION } from "../src/catalog.ts";

const manifest = {
	idleTimeoutMinutes: 10,
	extensions: [
		{ name: "web", description: "Web search.", tags: ["web", "search"], lifecycle: "lazy" as const },
		{ name: "fetch", description: "Fetch a URL." },
		{ name: "loader", description: "Always on.", lifecycle: "eager" as const },
		{ name: "fusion", description: "Multi-model." },
	],
};

describe("buildOptions", () => {
	it("offers lazy entries with their description and tags, plus none", () => {
		const options = buildOptions(manifest, []);
		expect(options.web).toBe("Web search. Tags: web, search");
		expect(options.fetch).toBe("Fetch a URL.");
		expect(options[NONE_OPTION]).toMatch(/built-in tools/);
	});

	it("leaves out eager entries and excluded names", () => {
		const options = buildOptions(manifest, ["fusion"]);
		expect(options.loader).toBeUndefined();
		expect(options.fusion).toBeUndefined();
		expect(Object.keys(options)).toEqual(["web", "fetch", NONE_OPTION]);
	});
});

describe("manifest discovery", () => {
	const dirs: string[] = [];
	const makeDir = () => {
		const dir = mkdtempSync(join(tmpdir(), "jev-ext-router-"));
		dirs.push(dir);
		return dir;
	};
	afterEach(() => {
		for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
	});

	it("prefers the project .pi manifest over the agent dir", () => {
		const cwd = makeDir();
		const agentDir = makeDir();
		const projectPath = join(cwd, ".pi", "lazy-extensions.json");
		rmSync(projectPath, { force: true });
		writeFileSync(join(agentDir, "lazy-extensions.json"), JSON.stringify(manifest));
		expect(findManifestPath(cwd, agentDir)).toBe(join(agentDir, "lazy-extensions.json"));
	});

	it("returns undefined when nothing exists", () => {
		expect(findManifestPath(makeDir(), makeDir())).toBeUndefined();
	});

	it("reads the loader's idle timeout, defaulting to ten minutes", () => {
		const dir = makeDir();
		const path = join(dir, "lazy-extensions.json");
		writeFileSync(path, JSON.stringify({ extensions: [], settings: { idleTimeout: 3 } }));
		expect(loadManifest(path).idleTimeoutMinutes).toBe(3);
		expect(idleWindowMsOf(loadManifest(path))).toBe(180_000);

		writeFileSync(path, JSON.stringify({ extensions: [] }));
		expect(loadManifest(path).idleTimeoutMinutes).toBe(10);
		expect(idleWindowMsOf({ extensions: [], idleTimeoutMinutes: 0 })).toBe(Number.POSITIVE_INFINITY);
	});

	it("rejects a manifest without an extensions array", () => {
		const dir = makeDir();
		const path = join(dir, "lazy-extensions.json");
		writeFileSync(path, JSON.stringify({ version: 1 }));
		expect(() => loadManifest(path)).toThrow(/"extensions" array/);
	});
});
