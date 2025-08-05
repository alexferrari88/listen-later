// Content script for extracting readable content from web pages
// This content script is injected programmatically by the background script
// Uses @mozilla/readability for content extraction and text normalization libraries for TTS preprocessing

import { Readability } from '@mozilla/readability';
import { EnglishTextNormalizer } from '@shelf/text-normalizer';
import { toWords } from 'to-words';
import normalizeText from 'normalize-text';
import { logger } from '../lib/logger';

// Extend window object to include currentJobId
declare global {
	interface Window {
		currentJobId?: string;
	}
}

export default defineContentScript({
	matches: ['http://localhost/*'], // Restrictive pattern - only used for programmatic injection
	main() {
		logger.info("Content script loaded");
		logger.debug("Environment check:", { 
			hasReadability: !!window.Readability,
			hasJobId: !!window.currentJobId 
		});
		extractContent();
	},
});

function extractContent() {
	try {
		logger.debug("Starting content extraction");
		logger.debug("Page info:", {
			url: window.location.href,
			title: document.title,
			documentLength: document.body?.innerText?.length || 0,
			jobId: window.currentJobId
		});

		// Check if we have a job ID (injected by background script)
		if (!window.currentJobId) {
			logger.error("No job ID provided by background script");
			throw new Error("No job ID provided - content script not properly initialized");
		}

		logger.debug("Using @mozilla/readability and TTS preprocessing libraries");

		// Create a copy of the document for Readability
		logger.debug("Cloning document for Readability processing");
		const documentClone = document.cloneNode(true);

		// Create Readability instance
		logger.debug("Creating Readability instance");
		const reader = new Readability(documentClone as Document, {
			debug: false, // We'll handle our own logging
			charThreshold: 500,
		});

		// Parse the article
		logger.debug("Parsing article with Readability");
		const article = reader.parse();
		logger.debug("Readability parsing complete", {
			hasArticle: !!article,
			hasContent: !!article?.textContent,
			title: article?.title,
			length: article?.textContent?.length || 0
		});

		if (article && article.textContent) {
			logger.debug("Processing extracted content with TTS preprocessing");
			
			// Step 1: Basic text cleanup
			let processedText = article.textContent
				.replace(/https?:\/\/[^\s]+/g, "")  // Remove URLs entirely
				.replace(/[\w.-]+@[\w.-]+\.[a-zA-Z]{2,}/g, "") // Remove email addresses
				.replace(/\n\s*\n/g, "\n\n")        // Preserve paragraph breaks
				.replace(/[ \t]+/g, " ")            // Collapse spaces and tabs only
				.replace(/\n /g, "\n")              // Remove spaces after newlines
				.replace(/ \n/g, "\n")              // Remove spaces before newlines
				.trim();
			
			// Step 2: Text normalization for TTS
			try {
				const textNormalizer = new EnglishTextNormalizer();
				processedText = textNormalizer.normalize(processedText);
				logger.debug("Applied English text normalization");
			} catch (error) {
				logger.warn("Text normalization failed, continuing without it:", error);
			}
			
			// Step 3: Convert numbers to words for better TTS pronunciation
			try {
				const toWordsConverter = new toWords();
				// Find and convert standalone numbers (basic implementation)
				processedText = processedText.replace(/\b\d+\b/g, (match) => {
					const num = parseInt(match, 10);
					if (num >= 0 && num <= 1000000) { // Reasonable range
						try {
							return toWordsConverter.convert(num);
						} catch {
							return match; // Keep original if conversion fails
						}
					}
					return match;
				});
				logger.debug("Applied number-to-words conversion");
			} catch (error) {
				logger.warn("Number conversion failed, continuing without it:", error);
			}
			
			// Step 4: Final text normalization
			try {
				processedText = normalizeText(processedText);
				logger.debug("Applied final text normalization");
			} catch (error) {
				logger.warn("Final normalization failed, continuing without it:", error);
			}
			
			// Step 5: Length limiting
			const cleanText = processedText.substring(0, 100000); // Limit to ~100k characters

			logger.debug("TTS text processing complete", {
				originalLength: article.textContent.length,
				processedLength: cleanText.length,
				preview: cleanText.substring(0, 100) + '...'
			});

			if (cleanText.length > 50) {
				logger.info("Sending extracted content to background script", {
					jobId: window.currentJobId,
					textLength: cleanText.length,
					title: article.title || document.title
				});
				// Send extracted content to background script with job ID
				chrome.runtime.sendMessage({
					type: "CONTENT_EXTRACTED_FOR_REVIEW",
					jobId: window.currentJobId,
					text: cleanText,
					title: article.title || document.title,
				});
			} else {
				logger.error("Insufficient content", { length: cleanText.length });
				throw new Error("Not enough readable content found on this page");
			}
		} else {
			logger.error("No readable content extracted", { article });
			throw new Error("Could not extract readable content from this page");
		}
	} catch (error) {
		logger.error("Content extraction failed:", error);
		logger.debug("Error details:", {
			message: error instanceof Error ? error.message : 'Unknown error',
			stack: error instanceof Error ? error.stack : undefined,
			pageUrl: window.location.href,
			pageTitle: document.title,
			jobId: window.currentJobId
		});
		chrome.runtime.sendMessage({
			type: "CONTENT_ERROR",
			jobId: window.currentJobId,
			error:
				error instanceof Error
					? error.message
					: "Unknown error during content extraction",
		});
	}
}