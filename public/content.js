// This content script is injected programmatically by the background script
console.log("Content script loaded");
extractContent();

async function extractContent() {
	try {
		// Load Readability.js dynamically
		await loadReadability();

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

function loadReadability() {
	return new Promise((resolve, reject) => {
		// Check if Readability is already loaded
		if (window.Readability) {
			resolve();
			return;
		}

		// Create script element to load Readability.js
		const script = document.createElement("script");
		script.src = chrome.runtime.getURL("lib/readability.js");
		script.onload = () => {
			if (window.Readability) {
				resolve();
			} else {
				reject(new Error("Readability.js failed to load properly"));
			}
		};
		script.onerror = () => reject(new Error("Failed to load Readability.js"));

		document.head.appendChild(script);
	});
}
