// This content script is injected programmatically by the background script
// Readability.js is already injected before this script, so window.Readability should be available

// Simple logging for development mode (can't import modules in content script)
const isDev = typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.getManifest && chrome.runtime.getManifest().version_name?.includes('dev');
const log = {
	debug: (msg, ...args) => isDev && console.log(`[CONTENT] ${msg}`, ...args),
	info: (msg, ...args) => isDev && console.log(`[CONTENT] ${msg}`, ...args),
	error: (msg, ...args) => console.error(`[CONTENT] ${msg}`, ...args)
};

log.info("Content script loaded");
log.debug("Environment check:", { isDev, hasReadability: !!window.Readability });
extractContent();

function extractContent() {
	try {
		log.debug("Starting content extraction");
		log.debug("Page info:", {
			url: window.location.href,
			title: document.title,
			documentLength: document.body?.innerText?.length || 0
		});
		
		// Readability should already be available
		if (!window.Readability) {
			log.error("Readability.js not available");
			throw new Error("Readability.js not available");
		}
		log.debug("Readability.js is available");

		// Create a copy of the document for Readability
		log.debug("Cloning document for Readability processing");
		const documentClone = document.cloneNode(true);

		// Create Readability instance
		log.debug("Creating Readability instance");
		const reader = new window.Readability(documentClone, {
			debug: isDev,
			charThreshold: 500,
		});

		// Parse the article
		log.debug("Parsing article with Readability");
		const article = reader.parse();
		log.debug("Readability parsing complete", {
			hasArticle: !!article,
			hasContent: !!article?.textContent,
			title: article?.title,
			length: article?.textContent?.length || 0
		});

		if (article && article.textContent) {
			log.debug("Processing extracted content");
			// Clean up the text content
			const cleanText = article.textContent
				.replace(/\s+/g, " ")
				.trim()
				.substring(0, 100000); // Limit to ~100k characters (well within 32k token API limit)

			log.debug("Text processing complete", {
				originalLength: article.textContent.length,
				cleanedLength: cleanText.length,
				preview: cleanText.substring(0, 100) + '...'
			});

			if (cleanText.length > 50) {
				log.info("Sending extracted content to background script", {
					textLength: cleanText.length,
					title: article.title || document.title
				});
				// Send extracted content to background script
				chrome.runtime.sendMessage({
					type: "CONTENT_EXTRACTED",
					text: cleanText,
					title: article.title || document.title,
				});
			} else {
				log.error("Insufficient content", { length: cleanText.length });
				throw new Error("Not enough readable content found on this page");
			}
		} else {
			log.error("No readable content extracted", { article });
			throw new Error("Could not extract readable content from this page");
		}
	} catch (error) {
		log.error("Content extraction failed:", error);
		log.debug("Error details:", {
			message: error instanceof Error ? error.message : 'Unknown error',
			stack: error instanceof Error ? error.stack : undefined,
			pageUrl: window.location.href,
			pageTitle: document.title
		});
		chrome.runtime.sendMessage({
			type: "CONTENT_ERROR",
			error:
				error instanceof Error
					? error.message
					: "Unknown error during content extraction",
		});
	}
}
