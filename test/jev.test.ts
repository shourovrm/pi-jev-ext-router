import { describe, expect, it } from "vitest";
import { askJev, buildRequestBody, JEV_ENDPOINT, parseDecision } from "../src/jev.ts";

const options = { web: "Web search.", none: "Nothing extra." };

describe("buildRequestBody", () => {
	it("sends the prompt as state with the privacy settings and one choice question", () => {
		const body = buildRequestBody("find docs", options, "typesafe/jev-1.13") as Record<string, unknown>;
		expect(body.state).toBe("find docs");
		expect(body.model).toBe("typesafe/jev-1.13");
		expect(body.provider).toEqual({ data_collection: "deny", zdr: true });
		const question = (body.questions as { extension: { type: string; criteria: unknown } }).extension;
		expect(question.type).toBe("choice");
		expect(question.criteria).toEqual(options);
	});
});

describe("parseDecision", () => {
	it("reads the choice answer", () => {
		const payload = { answers: { extension: { choice: "web", probabilities: { web: 1 }, confidence: 1 } } };
		expect(parseDecision(payload)).toEqual({ choice: "web", probabilities: { web: 1 }, confidence: 1 });
	});

	it("rejects a reply without the expected answer", () => {
		expect(() => parseDecision({ answers: {} })).toThrow(/unexpected Jev response/);
	});
});

describe("askJev", () => {
	const okResponse = {
		answers: { extension: { choice: "web", probabilities: { web: 0.9, none: 0.1 }, confidence: 0.9 } },
		usage: { cost: 0.00001 },
	};

	it("posts to the decisions endpoint with the bearer key and returns the parsed decision", async () => {
		let seenUrl = "";
		let seenHeaders: Record<string, string> = {};
		const fetchImpl = (async (url: string | URL | Request, init?: RequestInit) => {
			seenUrl = String(url);
			seenHeaders = init?.headers as Record<string, string>;
			return new Response(JSON.stringify(okResponse), { status: 200 });
		}) as typeof fetch;

		const decision = await askJev("find docs", options, {
			apiKey: "sk-test",
			model: "typesafe/jev-1.13",
			timeoutMs: 1000,
			fetchImpl,
		});

		expect(seenUrl).toBe(JEV_ENDPOINT);
		expect(seenHeaders.Authorization).toBe("Bearer sk-test");
		expect(decision.answer.choice).toBe("web");
		expect(decision.costUsd).toBe(0.00001);
	});

	it("surfaces an HTTP error with its status and body", async () => {
		const fetchImpl = (async () => new Response("quota exceeded", { status: 429 })) as typeof fetch;
		await expect(
			askJev("find docs", options, { apiKey: "sk-test", model: "m", timeoutMs: 1000, fetchImpl }),
		).rejects.toThrow(/HTTP 429: quota exceeded/);
	});
});
