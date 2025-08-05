// Content script for extracting readable content from web pages
// This content script is injected programmatically by the background script
// Uses @mozilla/readability for content extraction and text normalization libraries for TTS preprocessing

import { Readability } from '@mozilla/readability';
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

		if (article && (article.textContent || article.content)) {
			// Extract text while preserving paragraph structure
			let extractedText = article.textContent || "";
			
			if (article.content) {
				logger.debug("Extracting structured content to preserve paragraphs");
				
				// Create a temporary div to parse the extracted HTML content
				const tempDiv = document.createElement('div');
				tempDiv.innerHTML = article.content;
				
				// Extract text from paragraph-level elements
				const paragraphs: string[] = [];
				const elements = tempDiv.querySelectorAll('p, li, h1, h2, h3, h4, h5, h6');
				
				elements.forEach(element => {
					const text = element.textContent?.trim();
					if (text && text.length > 0) {
						paragraphs.push(text);
					}
				});
				
				// Join paragraphs with double newlines to preserve structure
				if (paragraphs.length > 0) {
					extractedText = paragraphs.join('\n\n');
					logger.debug("Structured extraction complete", {
						paragraphCount: paragraphs.length,
						totalLength: extractedText.length
					});
				}
			}
			logger.debug("Processing extracted content - removing UI elements");
			
			// Clean up UI elements while preserving text structure for TTS
			const cleanText = extractedText
				// Remove URLs and email addresses
				.replace(/https?:\/\/[^\s]+/g, "")
				.replace(/[\w.-]+@[\w.-]+\.[a-zA-Z]{2,}/g, "")
				
				// Remove common social sharing text
				.replace(/\b(share on|tweet this|like this|follow us)\b[^\n.]*/gi, "")
				.replace(/\b(facebook|twitter|instagram|linkedin|pinterest)\b[^\n.]*/gi, "")
				
				// Remove navigation elements  
				.replace(/^(home|about|contact|menu|search|login|register)([|\s]+\w+)*$/gim, "")
				.replace(/\b(previous|next|page \d+( of \d+)?|more\.\.\.)\b[^\n.]*/gi, "")
				
				// Remove author/date metadata patterns
				.replace(/^(by |author:|published|updated|posted|written by)[^\n]*/gim, "")
				.replace(/^\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4}[^\n]*/gim, "")
				
				// Remove very short lines that are likely UI fragments (< 4 words)
				.replace(/^\s*\w+\s*\w*\s*\w*\s*$/gim, "")
				
				// Clean up whitespace while preserving paragraph structure
				.replace(/\n\s*\n\s*\n+/g, "\n\n")  // Multiple line breaks to double
				.replace(/[ \t]+/g, " ")              // Collapse spaces and tabs
				.replace(/\n /g, "\n")                // Remove spaces after newlines
				.replace(/ \n/g, "\n")                // Remove spaces before newlines
				.trim()
				.substring(0, 100000); // Limit to ~100k characters

			logger.debug("UI cleanup complete, text structure preserved", {
				originalLength: extractedText.length,
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