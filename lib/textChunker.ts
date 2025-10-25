const AVG_CHARS_PER_TOKEN = 4;

const splitParagraphRegex = /\n{2,}/;

const sentenceRegex = /[^.!?]+[.!?]*/g;

const whitespaceRegex = /\s+/;

/**
 * Estimate the number of tokens in a piece of text.
 * Uses both character and word based heuristics to err on the side of over-counting.
 */
export const estimateTokenCount = (text: string): number => {
	if (!text) {
		return 0;
	}

	const trimmed = text.trim();
	if (!trimmed) {
		return 0;
	}

	const charEstimate = trimmed.length / AVG_CHARS_PER_TOKEN;
	const wordEstimate =
		trimmed.split(whitespaceRegex).filter(Boolean).length * 1.3;

	return Math.ceil(Math.max(charEstimate, wordEstimate));
};

const splitBySentences = (paragraph: string): string[] => {
	const matches = paragraph.match(sentenceRegex);
	if (!matches) {
		return [paragraph];
	}

	return matches.map((sentence) => sentence.trim()).filter(Boolean);
};

const splitByCharacters = (text: string, maxTokens: number): string[] => {
	const maxChars = Math.max(1, Math.floor(maxTokens * AVG_CHARS_PER_TOKEN));
	const chunks: string[] = [];
	for (let i = 0; i < text.length; i += maxChars) {
		chunks.push(text.slice(i, i + maxChars).trim());
	}
	return chunks.filter(Boolean);
};

const splitLargeParagraph = (
	paragraph: string,
	maxTokens: number,
): string[] => {
	if (estimateTokenCount(paragraph) <= maxTokens) {
		return [paragraph];
	}

	// Try splitting by sentences first for cleaner boundaries
	const sentenceChunks = splitSentencesIntoChunks(paragraph, maxTokens);
	if (sentenceChunks.length > 0) {
		return sentenceChunks;
	}

	// Fallback to character based splitting if sentence handling failed
	return splitByCharacters(paragraph, maxTokens);
};

const splitSentencesIntoChunks = (
	paragraph: string,
	maxTokens: number,
): string[] => {
	const sentences = splitBySentences(paragraph);
	if (sentences.length <= 1) {
		return [];
	}

	const chunks: string[] = [];
	let currentChunk = "";
	let currentTokens = 0;

	const flush = () => {
		if (currentChunk.trim()) {
			chunks.push(currentChunk.trim());
		}
		currentChunk = "";
		currentTokens = 0;
	};

	for (const sentence of sentences) {
		const tokenCount = estimateTokenCount(sentence);
		if (tokenCount > maxTokens) {
			flush();
			chunks.push(...splitByCharacters(sentence, maxTokens));
			continue;
		}

		const separator = currentChunk ? " " : "";
		if (currentTokens + tokenCount > maxTokens) {
			flush();
		}
		currentChunk += `${separator}${sentence}`;
		currentTokens += tokenCount;
	}

	flush();
	return chunks;
};

/**
 * Split a large text blob into context-window safe chunks.
 * Splits on paragraph boundaries where possible and degrades gracefully to sentences / character spans.
 */
export const splitTextIntoChunks = (
	text: string,
	maxTokens: number,
): string[] => {
	if (maxTokens <= 0) {
		throw new Error("maxTokens must be greater than 0");
	}

	const trimmed = text.trim();
	if (!trimmed) {
		return [];
	}

	const paragraphs = trimmed
		.split(splitParagraphRegex)
		.map((paragraph) => paragraph.trim())
		.filter(Boolean);

	if (paragraphs.length === 0) {
		return [];
	}

	const chunks: string[] = [];
	let currentChunk = "";
	let currentTokens = 0;

	const flush = () => {
		if (currentChunk.trim()) {
			chunks.push(currentChunk.trim());
		}
		currentChunk = "";
		currentTokens = 0;
	};

	for (const paragraph of paragraphs) {
		const safeParagraphs = splitLargeParagraph(paragraph, maxTokens);

		for (const safeParagraph of safeParagraphs) {
			const paragraphTokens = estimateTokenCount(safeParagraph);

			if (paragraphTokens > maxTokens) {
				// Guardrail - this should only happen if heuristics severely under-counted
				chunks.push(...splitByCharacters(safeParagraph, maxTokens));
				currentChunk = "";
				currentTokens = 0;
				continue;
			}

			const separator = currentChunk ? "\n\n" : "";
			if (currentTokens + paragraphTokens > maxTokens) {
				flush();
			}

			currentChunk += `${separator}${safeParagraph}`;
			currentTokens += paragraphTokens;
		}
	}

	flush();

	return chunks;
};
