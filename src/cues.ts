/**
 * Local gate in front of Jev: a prompt is only sent to Jev when it contains a cue
 * that some lazy extension may be needed. Plain coding prompts ("rename X to Y")
 * carry no cue, so they reach the model without waiting and without leaving the machine.
 */

/**
 * Words and phrases that suggest a lazily loaded tool, grouped by the kind of
 * extension they point at. The matcher sees one flat list; the groups let the
 * router treat "url" and "fetch" as the same need when it remembers what Jev
 * already loaded in this session.
 * Deliberately left out: words that are everyday coding vocabulary ("version",
 * "package", "library", "current", "render", "github"), which would send most
 * prompts to Jev and defeat the gate. "online" is left out because it sits one
 * typo away from "inline", a common word in web code.
 */
export const CUE_GROUPS: Readonly<Record<string, readonly string[]>> = {
	web: [
		"search",
		"research",
		"google",
		"look up",
		"browse",
		"browser",
		"website",
		"webpage",
		"web",
		"internet",
		"url",
		"link",
		"fetch",
		"download",
		"scrape",
		"crawl",
		"news",
		"latest",
		"find out",
		"price",
		"release notes",
		"changelog",
	],
	docs: ["docs", "documentation", "api reference", "migration guide", "context7", "deepwiki"],
	terminal: [
		"interactive",
		"terminal",
		"tty",
		"pty",
		"ssh",
		"vim",
		"nvim",
		"psql",
		"repl",
		"tmux",
		"htop",
		"dev server",
		"watch mode",
	],
	"browser-automation": ["mcp", "playwright", "screenshot", "click on", "headless"],
	images: ["image", "picture", "photo", "logo", "icon", "illustration", "wallpaper", "banner"],
	planning: ["plan", "roadmap", "tdd", "brainstorm", "workflow"],
	"sessions-and-models": [
		"intercom",
		"other session",
		"another session",
		"handoff",
		"fusion",
		"second opinion",
		"several models",
		"multiple models",
		"council",
	],
	questions: ["ask me", "multiple choice"],
};

export const DEFAULT_CUES: readonly string[] = Object.values(CUE_GROUPS).flat();

/** The cue reported when the prompt contains a URL or a bare domain. */
export const URL_CUE = "url";

const URL_PATTERN =
	/(https?:\/\/|www\.)|\b[a-z0-9-]+\.(com|org|net|io|dev|ai|app|co|gov|edu|info|sh|me|xyz)(\/|\b)/i;

/**
 * Word endings accepted after a cue, so "searching", "images" and "fetched" still match.
 * A fixed list rather than "any short suffix": "repl" must not match "replace" or "reply".
 */
const INFLECTIONS = new Set(["s", "es", "d", "ed", "ing", "er", "ers", "ings"]);

/**
 * Optimal string alignment distance: insertions, deletions, substitutions, and a
 * swap of two neighbouring letters each cost one. The swap rule matters because
 * transposed letters ("serach") are the most common typing slip.
 */
export function editDistance(left: string, right: string): number {
	const rows = left.length + 1;
	const columns = right.length + 1;
	const distance: number[][] = Array.from({ length: rows }, () => new Array<number>(columns).fill(0));
	for (let row = 0; row < rows; row++) distance[row][0] = row;
	for (let column = 0; column < columns; column++) distance[0][column] = column;

	for (let row = 1; row < rows; row++) {
		for (let column = 1; column < columns; column++) {
			const substitutionCost = left[row - 1] === right[column - 1] ? 0 : 1;
			let best = Math.min(
				distance[row - 1][column] + 1,
				distance[row][column - 1] + 1,
				distance[row - 1][column - 1] + substitutionCost,
			);
			const isSwap =
				row > 1 && column > 1 && left[row - 1] === right[column - 2] && left[row - 2] === right[column - 1];
			if (isSwap) best = Math.min(best, distance[row - 2][column - 2] + 1);
			distance[row][column] = best;
		}
	}
	return distance[rows - 1][columns - 1];
}

/** How many typos a cue word of this length may absorb. Short words get none: too many real words sit one edit away. */
function allowedTypos(cueWord: string): number {
	// Names with digits are identifiers: "context7" is one edit from the everyday word "context".
	if (/[0-9]/.test(cueWord)) return 0;
	if (cueWord.length <= 4) return 0;
	if (cueWord.length <= 8) return 1;
	return 2;
}

function isInflectionOf(word: string, cueWord: string): boolean {
	if (!word.startsWith(cueWord)) return false;
	const suffix = word.slice(cueWord.length);
	if (suffix === "") return true;
	// Three-letter cues only take a plural "s"; "webs" is fine, "website" must be its own cue.
	if (cueWord.length <= 3) return suffix === "s";
	// A cue ending in "e" drops it before "-ing": "browse" gives "browsing".
	return INFLECTIONS.has(suffix);
}

function wordMatches(word: string, cueWord: string): boolean {
	if (word === cueWord) return true;
	if (isInflectionOf(word, cueWord)) return true;
	if (cueWord.endsWith("e") && isInflectionOf(word, cueWord.slice(0, -1)) && word.endsWith("ing"))
		return true;
	const typos = allowedTypos(cueWord);
	if (typos === 0) return false;
	// Cheap length check first; the distance can never be smaller than the length gap.
	if (Math.abs(word.length - cueWord.length) > typos) return false;
	return editDistance(word, cueWord) <= typos;
}

function toWords(text: string): string[] {
	return text
		.toLowerCase()
		.split(/[^a-z0-9]+/)
		.filter((word) => word !== "");
}

/**
 * The group a cue belongs to, used as the key for "Jev already chose for this".
 * A URL counts as a web cue. Cues outside the built-in groups (extension names,
 * user cues) are their own group.
 */
export function cueGroup(cue: string): string {
	if (cue === URL_CUE) return "web";
	for (const [group, members] of Object.entries(CUE_GROUPS)) {
		if (members.includes(cue)) return group;
	}
	return cue;
}

/** Return the first cue found in the text, in reading order, or undefined when there is none. */
export function findCue(text: string, cues: readonly string[]): string | undefined {
	if (URL_PATTERN.test(text)) return URL_CUE;

	const words = toWords(text);
	const cueWords = cues
		.map((cue) => ({ cue, words: toWords(cue) }))
		.filter((entry) => entry.words.length > 0);

	for (let start = 0; start < words.length; start++) {
		for (const entry of cueWords) {
			if (start + entry.words.length > words.length) continue;
			const allMatch = entry.words.every((cueWord, offset) => wordMatches(words[start + offset], cueWord));
			if (allMatch) return entry.cue;
		}
	}
	return undefined;
}

export interface CueSource {
	name: string;
}

/**
 * Defaults, plus each lazy extension's name, plus the user's own cues, without duplicates.
 * Manifest tags are left out on purpose: they are written to help a search, so they
 * include everyday coding words such as "tools", "process", "models" and "ui" that
 * would send nearly every prompt to Jev.
 */
export function buildCueList(
	defaults: readonly string[],
	extensions: readonly CueSource[],
	userCues: readonly string[],
): string[] {
	const fromManifest = extensions.map((extension) => extension.name.replace(/[-_]+/g, " "));
	const unique = new Set<string>();
	for (const cue of [...defaults, ...fromManifest, ...userCues]) {
		const normalized = cue.trim().toLowerCase();
		if (normalized !== "") unique.add(normalized);
	}
	return [...unique];
}
