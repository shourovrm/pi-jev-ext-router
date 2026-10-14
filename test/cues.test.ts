import { describe, expect, it } from "vitest";
import { buildCueList, cueGroup, DEFAULT_CUES, editDistance, findCue } from "../src/cues.ts";

const cues = buildCueList(DEFAULT_CUES, [], []);

describe("editDistance", () => {
	it("counts a swap of neighbouring letters as one edit", () => {
		expect(editDistance("serach", "search")).toBe(1);
	});

	it("counts insertions, deletions and substitutions", () => {
		expect(editDistance("screnshot", "screenshot")).toBe(1);
		expect(editDistance("browsr", "browser")).toBe(1);
		expect(editDistance("imgae", "image")).toBe(1);
		expect(editDistance("kitten", "sitting")).toBe(3);
	});
});

describe("findCue", () => {
	it("finds exact cue words and phrases", () => {
		expect(findCue("search the web for the vitest changelog", cues)).toBe("search");
		expect(findCue("can you look up the release notes", cues)).toBe("look up");
	});

	it("tolerates common typos in longer words", () => {
		expect(findCue("serach for the latest vitest version", cues)).toBe("search");
		expect(findCue("check the documnetation for zod", cues)).toBe("documentation");
		expect(findCue("take a screnshot of the page", cues)).toBe("screenshot");
	});

	it("matches inflected forms of a cue", () => {
		expect(findCue("searching around for a fix", cues)).toBe("search");
		expect(findCue("generate two images for the hero", cues)).toBe("image");
		expect(findCue("browsing the release page", cues)).toBe("browse");
	});

	it("does not treat other words that merely start with a cue as inflections", () => {
		expect(findCue("reply to the reviewer and replace the helper", cues)).toBeUndefined();
	});

	it("treats any URL or domain as a cue", () => {
		expect(findCue("what does https://example.com say", cues)).toBe("url");
		expect(findCue("summarise docs.python.org/3/library/re", cues)).toBe("url");
	});

	it("requires short cues to match exactly", () => {
		expect(findCue("open an ssh session to the box", cues)).toBe("ssh");
		// "wet" is one edit from "web" but a three-letter word is too short to guess at.
		expect(findCue("the paint is still wet", cues)).toBeUndefined();
	});

	it("lets ordinary coding prompts through with no cue", () => {
		expect(findCue("rename parse_row to parse_line in utils.py", cues)).toBeUndefined();
		expect(findCue("why does this test fail with a null pointer", cues)).toBeUndefined();
		expect(findCue("refactor the config loader into two functions", cues)).toBeUndefined();
		expect(findCue("add a docstring to every exported function", cues)).toBeUndefined();
		expect(findCue("move the inline styles into the stylesheet", cues)).toBeUndefined();
		expect(findCue("add more context to the error message", cues)).toBeUndefined();
	});
});

describe("buildCueList", () => {
	it("adds manifest names as phrases and ignores their tags", () => {
		const extensions = [{ name: "interactive-shell", tags: ["tools"] }];
		const list = buildCueList([], extensions, []);
		expect(list).toEqual(["interactive shell"]);
	});

	it("adds user cues and drops duplicates and blanks", () => {
		const list = buildCueList(["search"], [], ["Search", "  ", "kubectl"]);
		expect(list.filter((cue) => cue === "search")).toHaveLength(1);
		expect(list).toContain("kubectl");
	});
});

describe("cueGroup", () => {
	it("puts a URL and the web words in one group", () => {
		expect(cueGroup("url")).toBe("web");
		expect(cueGroup("fetch")).toBe("web");
		expect(cueGroup("look up")).toBe("web");
	});

	it("keeps unrelated cues apart and gives unknown cues their own group", () => {
		expect(cueGroup("screenshot")).toBe("browser-automation");
		expect(cueGroup("kubectl")).toBe("kubectl");
	});
});
