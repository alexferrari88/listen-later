import { describe, expect, it } from "vitest";
import { estimateTokenCount, splitTextIntoChunks } from "../lib/textChunker";

describe("estimateTokenCount", () => {
	it("returns 0 for empty or whitespace strings", () => {
		expect(estimateTokenCount("")).toBe(0);
		expect(estimateTokenCount("   \n")).toBe(0);
	});

	it("scales with input size", () => {
		const shortText = "short sentence.";
		const longText = "long ".repeat(500);

		expect(estimateTokenCount(longText)).toBeGreaterThan(
			estimateTokenCount(shortText),
		);
	});
});

describe("splitTextIntoChunks", () => {
	const buildParagraph = (id: number, repeat: number) =>
		`Paragraph ${id}: ${"content ".repeat(repeat)}`.trim();

	it("returns a single chunk when under the limit", () => {
		const text = `${buildParagraph(1, 20)}\n\n${buildParagraph(2, 15)}`;
		const chunks = splitTextIntoChunks(text, 2000);

		expect(chunks).toHaveLength(1);
		expect(chunks[0]).toContain("Paragraph 1");
		expect(chunks[0]).toContain("Paragraph 2");
	});

	it("splits on paragraph boundaries when possible", () => {
		const paragraphs = Array.from({ length: 5 }, (_, index) =>
			buildParagraph(index + 1, 200),
		);
		const text = paragraphs.join("\n\n");

		const chunks = splitTextIntoChunks(text, 500);

		expect(chunks.length).toBeGreaterThan(1);
		expect(chunks[0]).toContain("Paragraph 1");
		expect(chunks[1]).toContain("Paragraph 2");
	});

	it("falls back to sentence or character splits for oversized paragraphs", () => {
		const longSentence = `${"VeryLongSentence ".repeat(1500)}.`;
		const text = `${longSentence}\n\n${buildParagraph(2, 10)}`;

		const chunks = splitTextIntoChunks(text, 500);

		expect(chunks.length).toBeGreaterThan(2);
		expect(chunks.join("\n\n")).toContain("Paragraph 2");
	});
});
