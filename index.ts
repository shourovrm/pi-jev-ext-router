/**
 * pi-jev-ext-router
 *
 * Before each model turn, ask Jev (a fast decision model on OpenRouter) which
 * lazily loaded extension the prompt needs, then activate it through
 * pi-lazy-extensions. The model starts the turn with the right tools already
 * present instead of discovering them through the `ext` proxy tool.
 */

import { type ExtensionAPI, type ExtensionContext, getAgentDir } from "@earendil-works/pi-coding-agent";
import { buildOptions, findManifestPath, idleWindowMsOf, loadManifest, NONE_OPTION } from "./src/catalog.ts";
import { CONFIG_FILE_NAME, loadConfig, type RouterConfig, resolveApiKey } from "./src/config.ts";
import { chooseActivations } from "./src/decision.ts";
import { skipReason } from "./src/filter.ts";
import { askJev, type JevDecision } from "./src/jev.ts";
import { appendLog, logFilePath } from "./src/log.ts";

const STATE_ENTRY_TYPE = "jev-ext-router-state";
const STATUS_KEY = "jev-ext-router";
const LAZY_COMMAND = "ext";

interface RouterState {
	enabled: boolean;
}

export default function jevExtRouter(pi: ExtensionAPI) {
	const agentDir = getAgentDir();
	let config: RouterConfig = loadConfig(agentDir);
	let enabled = false;
	let manifestPath: string | undefined;
	let options: Record<string, string> = {};
	let idleWindowMs = Number.POSITIVE_INFINITY;

	const report = (ctx: ExtensionContext, message: string, level: "info" | "warning" | "error" = "info") => {
		if (ctx.hasUI) {
			ctx.ui.notify(message, level);
			return;
		}
		if (level !== "info") console.error(message);
	};

	const updateStatus = (ctx: ExtensionContext, detail?: string) => {
		if (!ctx.hasUI) return;
		if (!enabled) {
			ctx.ui.setStatus(STATUS_KEY, undefined);
			return;
		}
		ctx.ui.setStatus(STATUS_KEY, detail ? `jev-router: ${detail}` : "jev-router: on");
	};

	const savedState = (ctx: ExtensionContext): boolean | undefined => {
		let saved: boolean | undefined;
		for (const entry of ctx.sessionManager.getBranch()) {
			if (entry.type !== "custom" || entry.customType !== STATE_ENTRY_TYPE) continue;
			const data = entry.data as Partial<RouterState> | undefined;
			if (typeof data?.enabled === "boolean") saved = data.enabled;
		}
		return saved;
	};

	/** Re-read config and the lazy manifest; both are cheap and may change between sessions. */
	const refreshCatalog = (ctx: ExtensionContext) => {
		config = loadConfig(agentDir);
		manifestPath = findManifestPath(ctx.cwd, agentDir);
		if (!manifestPath) {
			options = {};
			idleWindowMs = Number.POSITIVE_INFINITY;
			return;
		}
		const manifest = loadManifest(manifestPath);
		options = buildOptions(manifest, config.exclude);
		idleWindowMs = idleWindowMsOf(manifest);
	};

	const restore = (ctx: ExtensionContext) => {
		refreshCatalog(ctx);
		const startOn = pi.getFlag("jev-router") === true || config.defaultEnabled;
		enabled = savedState(ctx) ?? startOn;
		updateStatus(ctx);
	};

	const setEnabled = (next: boolean, ctx: ExtensionContext) => {
		enabled = next;
		pi.appendEntry(STATE_ENTRY_TYPE, { enabled } satisfies RouterState);
		updateStatus(ctx);
		report(ctx, `jev-router ${enabled ? "on: prompts are sent to Jev to pick extensions" : "off"}`);
	};

	const lazyLoaderPresent = () => pi.getCommands().some((command) => command.name === LAZY_COMMAND);

	/** When each extension was last activated here, so a repeat within the loader's idle window skips the wait. */
	const activatedAt = new Map<string, number>();

	const toolSignature = () =>
		`${pi
			.getAllTools()
			.map((tool) => tool.name)
			.sort()
			.join("\n")}|${pi.getActiveTools().length}`;

	const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

	/**
	 * pi-lazy-extensions keeps its registry private; its `/ext activate` command is the
	 * only entry point another extension can reach. sendUserMessage runs slash commands
	 * before anything else and never prompts the model for them, but the extension-facing
	 * wrapper drops the returned promise, so completion is observed by watching the tool
	 * registry change instead. A repeat activation inside the loader's idle window is a
	 * no-op on its side, so there is nothing to wait for.
	 */
	const activate = async (name: string): Promise<"loaded" | "already-loaded" | "no-change"> => {
		const loadedRecently = Date.now() - (activatedAt.get(name) ?? Number.NEGATIVE_INFINITY) < idleWindowMs;
		const before = toolSignature();
		pi.sendUserMessage(`/${LAZY_COMMAND} activate ${name}`, { expandPromptTemplates: true });
		activatedAt.set(name, Date.now());
		if (loadedRecently) return "already-loaded";

		const deadline = Date.now() + config.activationWaitMs;
		while (Date.now() < deadline) {
			await sleep(15);
			if (toolSignature() !== before) return "loaded";
		}
		// Either the extension was already loaded by the model's own `ext` call, or the
		// loader failed (a stale manifest path is the usual cause) and only told the UI.
		activatedAt.delete(name);
		return "no-change";
	};

	/**
	 * Activate every offered extension in turn and report which ones actually exposed
	 * tools. An entry that exposes nothing is either a stale manifest path or an
	 * extension that registers its tools in `session_start`, which never fires for a
	 * lazily loaded extension; such an entry has to load eagerly instead.
	 */
	const probe = async (): Promise<string[]> => {
		const lines: string[] = [];
		for (const name of Object.keys(options)) {
			if (name === NONE_OPTION) continue;
			const toolsBefore = new Set(pi.getAllTools().map((tool) => tool.name));
			activatedAt.delete(name);
			const outcome = await activate(name);
			const added = pi
				.getAllTools()
				.map((tool) => tool.name)
				.filter((toolName) => !toolsBefore.has(toolName));
			lines.push(
				added.length > 0
					? `${name}: ${added.length} new tool(s): ${added.join(", ")}`
					: `${name}: no new tools (${outcome}); check its manifest path, or load it eagerly if it registers tools in session_start`,
			);
		}
		return lines;
	};

	const decide = async (text: string): Promise<JevDecision> => {
		if (Object.keys(options).length <= 1) {
			throw new Error(
				manifestPath
					? `jev-ext-router: no lazy extensions in ${manifestPath}`
					: "jev-ext-router: no lazy-extensions.json manifest found",
			);
		}
		return askJev(text, options, {
			apiKey: resolveApiKey(config),
			model: config.model,
			timeoutMs: config.timeoutMs,
		});
	};

	const summarize = (decision: JevDecision): string => {
		const ranked = Object.entries(decision.answer.probabilities)
			.sort((left, right) => right[1] - left[1])
			.slice(0, 3)
			.map(([name, probability]) => `${name} ${probability.toFixed(2)}`)
			.join(", ");
		return `${ranked} (${decision.elapsedMs} ms, $${decision.costUsd.toFixed(6)})`;
	};

	const routePrompt = async (text: string, ctx: ExtensionContext) => {
		if (!lazyLoaderPresent()) {
			report(ctx, "jev-router: pi-lazy-extensions is not loaded, nothing to activate", "warning");
			return;
		}

		let decision: JevDecision;
		try {
			decision = await decide(text);
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			appendLog({ timestamp: new Date().toISOString(), error: message });
			report(ctx, `jev-router: ${message}; continuing without routing`, "warning");
			return;
		}

		const activated = chooseActivations(decision.answer, config.minProbability, config.maxActivations);
		const unchanged: string[] = [];
		for (const name of activated) {
			if ((await activate(name)) === "no-change") unchanged.push(name);
		}
		if (unchanged.length > 0) {
			report(
				ctx,
				`jev-router: no new tools appeared within ${config.activationWaitMs} ms after activating ${unchanged.join(", ")}; check the path in ${manifestPath}`,
				"warning",
			);
		}

		appendLog({
			timestamp: new Date().toISOString(),
			choice: decision.answer.choice,
			probabilities: decision.answer.probabilities,
			confidence: decision.answer.confidence,
			activated,
			unchanged: unchanged.length > 0 ? unchanged : undefined,
			costUsd: decision.costUsd,
			elapsedMs: decision.elapsedMs,
		});
		updateStatus(ctx, activated.length > 0 ? activated.join("+") : "none");
	};

	pi.registerFlag("jev-router", {
		description: "Start with Jev extension routing on",
		type: "boolean",
		default: false,
	});

	pi.registerCommand("jev-router", {
		description: "Jev extension routing: on | off | status | try <text> | probe",
		handler: async (args, ctx) => {
			const [verb, ...rest] = args.trim().split(/\s+/);
			switch (verb) {
				case "on":
					setEnabled(true, ctx);
					return;
				case "off":
					setEnabled(false, ctx);
					return;
				case "try": {
					const text = rest.join(" ");
					if (text === "") {
						report(ctx, "Usage: /jev-router try <prompt text>", "warning");
						return;
					}
					try {
						const decision = await decide(text);
						const picked = chooseActivations(decision.answer, config.minProbability, config.maxActivations);
						report(ctx, `would activate: ${picked.join(", ") || "nothing"} · ${summarize(decision)}`);
					} catch (error) {
						report(ctx, error instanceof Error ? error.message : String(error), "error");
					}
					return;
				}
				case "probe": {
					if (!lazyLoaderPresent()) {
						report(ctx, "jev-router: pi-lazy-extensions is not loaded, nothing to probe", "warning");
						return;
					}
					const lines = await probe();
					if (ctx.hasUI) report(ctx, lines.join("\n"));
					else console.log(lines.join("\n"));
					return;
				}
				case "status":
				case "":
				case undefined: {
					const lines = [
						`jev-router: ${enabled ? "on" : "off"} (default ${config.defaultEnabled ? "on" : "off"}, config ${CONFIG_FILE_NAME})`,
						`manifest: ${manifestPath ?? "none found"} · ${Math.max(0, Object.keys(options).length - 1)} lazy extensions offered`,
						`lazy loader command /${LAZY_COMMAND}: ${lazyLoaderPresent() ? "present" : "missing"}`,
						`log: ${logFilePath()}`,
					];
					report(ctx, lines.join("\n"));
					return;
				}
				default:
					report(ctx, "Usage: /jev-router [on|off|status|try <text>]", "warning");
			}
		},
	});

	pi.on("session_start", async (_event, ctx) => restore(ctx));
	pi.on("session_tree", async (_event, ctx) => restore(ctx));

	pi.on("input", async (event, ctx) => {
		if (!enabled) return { action: "continue" };

		const skipped = skipReason(event.text, event.source, config.minPromptLength);
		if (skipped) {
			appendLog({ timestamp: new Date().toISOString(), skipped });
			return { action: "continue" };
		}

		await routePrompt(event.text, ctx);
		return { action: "continue" };
	});
}
