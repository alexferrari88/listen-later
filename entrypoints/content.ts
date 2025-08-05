// Content script for extracting readable content from web pages
// This content script is injected programmatically by the background script
// Readability.js is already injected before this script, so window.Readability should be available

import { logger } from '../lib/logger';

// Extend window object to include Readability and currentJobId
declare global {
	interface Window {
		Readability: any;
		currentJobId?: string;
	}
}

export default defineContentScript({
	matches: ['http://localhost:3000/*'], // Restrictive pattern - only used for programmatic injection
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

		// Readability should already be available
		if (!window.Readability) {
			logger.error("Readability.js not available");
			throw new Error("Readability.js not available");
		}
		logger.debug("Readability.js is available");

		// Create a copy of the document for Readability
		logger.debug("Cloning document for Readability processing");
		const documentClone = document.cloneNode(true);

		// Create Readability instance
		logger.debug("Creating Readability instance");
		const reader = new window.Readability(documentClone, {
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
			logger.debug("Processing extracted content");
			// Clean up the text content
			const cleanText = article.textContent
				.replace(/\s+/g, " ")
				.trim()
				.substring(0, 100000); // Limit to ~100k characters (well within 32k token API limit)

			logger.debug("Text processing complete", {
				originalLength: article.textContent.length,
				cleanedLength: cleanText.length,
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
					type: "CONTENT_EXTRACTED",
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