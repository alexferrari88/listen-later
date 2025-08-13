// Modal content script for showing text preview modal in page content
// This content script is injected programmatically by the background script when needed

import { logger } from "../lib/logger";
import type { ProcessingJob, SpeechStylePrompt } from "../lib/storage";
import { getExtensionOptions, substituteSpeechStyleTemplate } from "../lib/storage";

// Extend window object to include modal data
declare global {
	interface Window {
		modalJobData?: ProcessingJob;
		listenLaterModal?: HTMLElement;
	}
}

export default defineContentScript({
	matches: ["http://listen-later-extension.localhost/*"], // Non-conflicting pattern - only used for programmatic injection
	main() {
		logger.info("Modal content script loaded");
		logger.debug("Environment check:", {
			hasJobData: !!window.modalJobData,
		});

		// Listen for messages from background script
		chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
			logger.debug("Modal content script received message:", message.type);

			if (message.type === "SHOW_TEXT_PREVIEW_MODAL") {
				showTextPreviewModal(message.job);
				sendResponse({ success: true });
			} else if (message.type === "HIDE_TEXT_PREVIEW_MODAL") {
				hideTextPreviewModal();
				sendResponse({ success: true });
			}
		});
	},
});

async function showTextPreviewModal(job: ProcessingJob) {
	// Remove existing modal if any
	hideTextPreviewModal();

	logger.debug("Showing text preview modal", {
		jobId: job.id,
		textLength: job.text?.length || 0,
	});

	// Load extension options to get available prompts
	const options = await getExtensionOptions();
	if (!options) {
		logger.error("Failed to load extension options for modal");
		return;
	}

	const availablePrompts = options.speechStylePrompts || [];
	let selectedPromptId = options.defaultPromptId || "documentary";

	// Create modal overlay
	const overlay = document.createElement("div");
	overlay.id = "listen-later-modal-overlay";
	overlay.style.cssText = `
		position: fixed;
		top: 0;
		left: 0;
		right: 0;
		bottom: 0;
		background-color: rgba(0, 0, 0, 0.5);
		display: flex;
		align-items: center;
		justify-content: center;
		z-index: 2147483647;
		font-family: Arial, sans-serif;
	`;

	// Create modal container
	const modal = document.createElement("div");
	modal.style.cssText = `
		background-color: white;
		border-radius: 8px;
		width: 90vw;
		max-width: 600px;
		max-height: 80vh;
		display: flex;
		flex-direction: column;
		box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
		font-family: Arial, sans-serif;
	`;

	// Create header
	const header = document.createElement("div");
	header.style.cssText = `
		padding: 20px 20px 15px 20px;
		border-bottom: 1px solid #e0e0e0;
		background-color: #f8f9fa;
		border-radius: 8px 8px 0 0;
	`;

	const title = document.createElement("h3");
	title.textContent = "Review Extracted Text";
	title.style.cssText = `
		margin: 0 0 8px 0;
		font-size: 18px;
		font-weight: 600;
		color: #333;
	`;

	const articleInfo = document.createElement("div");
	articleInfo.textContent = job.tabInfo.articleTitle || job.tabInfo.title;
	articleInfo.style.cssText = `
		font-size: 14px;
		color: #666;
		font-weight: 500;
		line-height: 1.3;
	`;

	header.appendChild(title);
	header.appendChild(articleInfo);

	// Create content section
	const content = document.createElement("div");
	content.style.cssText = `
		padding: 20px;
		flex: 1;
		display: flex;
		flex-direction: column;
		min-height: 0;
	`;

	const instructions = document.createElement("div");
	instructions.textContent =
		"Review and edit the extracted text below. Select a speech style and make any necessary corrections before generating speech.";
	instructions.style.cssText = `
		font-size: 14px;
		color: #666;
		margin-bottom: 15px;
		line-height: 1.4;
	`;

	// Speech Style Prompt Selector
	const promptSection = document.createElement("div");
	promptSection.style.cssText = `
		margin-bottom: 15px;
		padding: 12px;
		background-color: #f8f9fa;
		border: 1px solid #e0e0e0;
		border-radius: 6px;
	`;

	const promptLabel = document.createElement("label");
	promptLabel.textContent = "Speech Style:";
	promptLabel.style.cssText = `
		display: block;
		font-weight: 500;
		font-size: 13px;
		color: #333;
		margin-bottom: 6px;
	`;

	const promptSelect = document.createElement("select");
	promptSelect.style.cssText = `
		width: 100%;
		padding: 6px 8px;
		border: 1px solid #ccc;
		border-radius: 4px;
		font-size: 13px;
		background-color: white;
	`;

	// Add prompt options
	availablePrompts.forEach(prompt => {
		const option = document.createElement("option");
		option.value = prompt.id;
		option.textContent = `${prompt.name} - ${prompt.description}`;
		if (prompt.id === selectedPromptId) {
			option.selected = true;
		}
		promptSelect.appendChild(option);
	});

	// Final text preview section
	const previewSection = document.createElement("div");
	previewSection.style.cssText = `
		margin-top: 8px;
	`;

	const previewLabel = document.createElement("div");
	previewLabel.textContent = "Final text that will be sent for speech generation:";
	previewLabel.style.cssText = `
		font-size: 11px;
		color: #666;
		margin-bottom: 4px;
		font-weight: 500;
	`;

	const previewText = document.createElement("div");
	previewText.style.cssText = `
		max-height: 60px;
		overflow-y: auto;
		padding: 6px 8px;
		background-color: #f5f5f5;
		border: 1px solid #e0e0e0;
		border-radius: 3px;
		font-size: 11px;
		color: #555;
		line-height: 1.3;
	`;

	// Function to update preview text
	const updatePreview = () => {
		const currentPrompt = availablePrompts.find(p => p.id === selectedPromptId);
		if (currentPrompt && textarea.value) {
			const finalText = substituteSpeechStyleTemplate(currentPrompt.template, textarea.value);
			previewText.textContent = finalText;
		} else {
			previewText.textContent = textarea.value || "";
		}
	};

	promptSection.appendChild(promptLabel);
	promptSection.appendChild(promptSelect);
	previewSection.appendChild(previewLabel);
	previewSection.appendChild(previewText);
	promptSection.appendChild(previewSection);

	const textarea = document.createElement("textarea");
	textarea.value = job.text || "";
	textarea.style.cssText = `
		width: 100%;
		flex: 1;
		min-height: 200px;
		padding: 12px;
		border: 2px solid #e0e0e0;
		border-radius: 6px;
		font-size: 14px;
		font-family: Arial, sans-serif;
		line-height: 1.5;
		resize: none;
		outline: none;
		background-color: #fafafa;
		box-sizing: border-box;
	`;

	// Create stats section
	const stats = document.createElement("div");
	stats.style.cssText = `
		display: flex;
		gap: 15px;
		margin-top: 10px;
		font-size: 12px;
		color: #666;
	`;

	const updateStats = () => {
		const text = textarea.value;
		const characterCount = text.length;
		const wordCount = text
			.trim()
			.split(/\s+/)
			.filter((word) => word.length > 0).length;
		const readTime = Math.ceil(wordCount / 150);

		stats.innerHTML = `
			<span style="font-weight: 500;">${characterCount.toLocaleString()} characters</span>
			<span style="font-weight: 500;">${wordCount.toLocaleString()} words</span>
			<span style="font-weight: 500;">~${readTime} min read</span>
		`;
	};

	// Add event listeners
	textarea.addEventListener("input", updateStats);
	textarea.addEventListener("input", updatePreview);
	
	promptSelect.addEventListener("change", (e) => {
		selectedPromptId = (e.target as HTMLSelectElement).value;
		updatePreview();
	});

	updateStats(); // Initial stats
	updatePreview(); // Initial preview

	content.appendChild(instructions);
	content.appendChild(promptSection);
	content.appendChild(textarea);
	content.appendChild(stats);

	// Create actions section
	const actions = document.createElement("div");
	actions.style.cssText = `
		padding: 15px 20px;
		border-top: 1px solid #e0e0e0;
		display: flex;
		gap: 10px;
		justify-content: flex-end;
	`;

	const cancelButton = document.createElement("button");
	cancelButton.textContent = "Cancel";
	cancelButton.style.cssText = `
		padding: 10px 16px;
		background-color: transparent;
		color: #666;
		border: 1px solid #ccc;
		border-radius: 4px;
		font-size: 14px;
		cursor: pointer;
		font-weight: 500;
	`;

	const confirmButton = document.createElement("button");
	confirmButton.textContent = "Confirm & Generate Speech";
	confirmButton.style.cssText = `
		padding: 10px 16px;
		background-color: #4285f4;
		color: white;
		border: none;
		border-radius: 4px;
		font-size: 14px;
		cursor: pointer;
		font-weight: 500;
		min-width: 180px;
	`;

	// Handle button clicks
	let isConfirming = false;

	cancelButton.addEventListener("click", () => {
		logger.debug("User cancelled text confirmation", { jobId: job.id });
		hideTextPreviewModal();
		chrome.runtime.sendMessage({
			type: "MODAL_CANCELLED",
			jobId: job.id,
		});
	});

	confirmButton.addEventListener("click", async () => {
		if (isConfirming || !textarea.value.trim()) return;

		isConfirming = true;
		confirmButton.textContent = "Starting generation...";
		confirmButton.style.backgroundColor = "#4285f4";
		confirmButton.style.cursor = "not-allowed";
		cancelButton.disabled = true;
		textarea.disabled = true;

		try {
			logger.debug("User confirmed text for TTS", {
				jobId: job.id,
				textLength: textarea.value.length,
				selectedPromptId,
			});

			// Send confirmation message to background script
			chrome.runtime.sendMessage({
				type: "MODAL_CONFIRMED",
				jobId: job.id,
				text: textarea.value,
				selectedPromptId,
			});

			// Brief delay to show feedback, then close modal immediately
			setTimeout(() => {
				hideTextPreviewModal();
			}, 500);
		} catch (error) {
			logger.error("Failed to send modal confirmation:", error);
			// Reset button state on error
			isConfirming = false;
			confirmButton.textContent = "Confirm & Generate Speech";
			confirmButton.style.backgroundColor = "#4285f4";
			confirmButton.style.cursor = "pointer";
			cancelButton.disabled = false;
			textarea.disabled = false;
		}
	});

	// Update confirm button state based on textarea content
	const updateConfirmButton = () => {
		const hasText = textarea.value.trim().length > 0;
		confirmButton.disabled = !hasText || isConfirming;
		confirmButton.style.opacity = hasText && !isConfirming ? "1" : "0.5";
	};

	textarea.addEventListener("input", updateConfirmButton);
	updateConfirmButton(); // Initial state

	actions.appendChild(cancelButton);
	actions.appendChild(confirmButton);

	// Assemble modal
	modal.appendChild(header);
	modal.appendChild(content);
	modal.appendChild(actions);
	overlay.appendChild(modal);

	// Handle overlay click to close
	overlay.addEventListener("click", (e) => {
		if (e.target === overlay) {
			cancelButton.click();
		}
	});

	// Handle escape key
	const handleKeydown = (e: KeyboardEvent) => {
		if (e.key === "Escape") {
			cancelButton.click();
		}
	};

	document.addEventListener("keydown", handleKeydown);

	// Store cleanup function on the overlay
	(overlay as any).cleanup = () => {
		document.removeEventListener("keydown", handleKeydown);
	};

	// Add to page
	document.body.appendChild(overlay);
	window.listenLaterModal = overlay;

	// Focus the textarea
	setTimeout(() => {
		textarea.focus();
		textarea.setSelectionRange(0, 0); // Move cursor to start
	}, 100);
}

function hideTextPreviewModal() {
	const existingModal =
		window.listenLaterModal ||
		document.getElementById("listen-later-modal-overlay");
	if (existingModal) {
		logger.debug("Hiding text preview modal");

		// Call cleanup function if it exists
		if ((existingModal as any).cleanup) {
			(existingModal as any).cleanup();
		}

		existingModal.remove();
		window.listenLaterModal = undefined;
	}
}
