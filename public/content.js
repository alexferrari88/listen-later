// This content script is injected programmatically by the background script
// Readability.js is already injected before this script, so window.Readability should be available
console.log("Content script loaded");
extractContent();

function extractContent() {
	try {
		// Readability should already be available
		if (!window.Readability) {
			throw new Error("Readability.js not available");
		}

		// Create a copy of the document for Readability
		const documentClone = document.cloneNode(true);

		// Create Readability instance
		const reader = new window.Readability(documentClone, {
			debug: false,
			charThreshold: 500,
		});

		// Parse the article
		const article = reader.parse();

		if (article && article.textContent) {
			// Clean up the text content
			const cleanText = article.textContent
				.replace(/\s+/g, " ")
				.trim()
				.substring(0, 10000); // Limit to ~10k characters for API limits

			if (cleanText.length > 50) {
				// Send extracted content to background script
				chrome.runtime.sendMessage({
					type: "CONTENT_EXTRACTED",
					text: cleanText,
					title: article.title || document.title,
				});
			} else {
				throw new Error("Not enough readable content found on this page");
			}
		} else {
			throw new Error("Could not extract readable content from this page");
		}
	} catch (error) {
		console.error("Content extraction failed:", error);
		chrome.runtime.sendMessage({
			type: "CONTENT_ERROR",
			error:
				error instanceof Error
					? error.message
					: "Unknown error during content extraction",
		});
	}
}
