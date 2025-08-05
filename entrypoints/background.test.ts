import { beforeEach, describe, expect, it, vi } from "vitest";

// Mock chrome APIs
const mockChrome = {
	runtime: {
		id: "test-extension-id",
		getManifest: vi.fn(() => ({ version: "1.0.0" })),
	},
	storage: {
		local: {
			get: vi.fn(),
			set: vi.fn(),
		},
	},
};

globalThis.chrome = mockChrome as any;

// Import the function we want to test
// Since isValidMessageSender is not exported, we need to test it indirectly
// or extract it for testing. For now, let's create a test version.

// Re-implement the function for testing (copied from background.ts)
const isValidMessageSender = (
	sender: chrome.runtime.MessageSender,
	message: any,
): boolean => {
	// Allow messages from extension popup, options page, and content scripts
	// These will not have sender.tab but will be from extension context
	if (!sender.tab) {
		// Messages from popup/options will have sender.id matching our extension ID
		if (sender.id === chrome.runtime.id) {
			return true;
		}
		// Reject messages without tab that aren't from our extension
		return false;
	}

	// Messages from content scripts must have valid tab context
	// Check that the tab exists and sender has proper extension context
	if (sender.tab && sender.id === chrome.runtime.id) {
		// Additional validation: content scripts should be injected by us
		// Verify the message type is one we expect from content scripts
		const validContentScriptMessages = [
			"CONTENT_EXTRACTED",
			"CONTENT_EXTRACTED_FOR_REVIEW", 
			"MODAL_CONFIRMED",
			"MODAL_CANCELLED",
			"CONTENT_ERROR",
		];

		// Ensure message has a valid type property
		if (message && typeof message.type === "string" && validContentScriptMessages.includes(message.type)) {
			return true;
		}

		// Allow START_TTS and CANCEL_JOB from any extension context (popup/content)
		if (message && typeof message.type === "string" && (message.type === "START_TTS" || message.type === "CANCEL_JOB")) {
			return true;
		}
	}

	// Reject all other messages
	return false;
};

describe("Message Authentication", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	describe("isValidMessageSender function", () => {
		it("should allow messages from extension popup/options (no tab)", () => {
			const sender: chrome.runtime.MessageSender = {
				id: "test-extension-id",
				// No tab property indicates popup/options page
			};
			const message = { type: "START_TTS" };

			const result = isValidMessageSender(sender, message);
			expect(result).toBe(true);
		});

		it("should reject messages from external sources (no tab)", () => {
			const sender: chrome.runtime.MessageSender = {
				id: "different-extension-id",
				// No tab property but wrong extension ID
			};
			const message = { type: "START_TTS" };

			const result = isValidMessageSender(sender, message);
			expect(result).toBe(false);
		});

		it("should reject messages without sender ID (no tab)", () => {
			const sender: chrome.runtime.MessageSender = {
				// No id property and no tab
			};
			const message = { type: "START_TTS" };

			const result = isValidMessageSender(sender, message);
			expect(result).toBe(false);
		});

		it("should allow valid content script messages", () => {
			const sender: chrome.runtime.MessageSender = {
				id: "test-extension-id",
				tab: { id: 123, url: "https://example.com" },
			};

			const validMessages = [
				"CONTENT_EXTRACTED",
				"CONTENT_EXTRACTED_FOR_REVIEW",
				"MODAL_CONFIRMED", 
				"MODAL_CANCELLED",
				"CONTENT_ERROR",
			];

			for (const messageType of validMessages) {
				const message = { type: messageType };
				const result = isValidMessageSender(sender, message);
				expect(result).toBe(true);
			}
		});

		it("should allow START_TTS and CANCEL_JOB from content scripts", () => {
			const sender: chrome.runtime.MessageSender = {
				id: "test-extension-id",
				tab: { id: 123, url: "https://example.com" },
			};

			const allowedMessages = ["START_TTS", "CANCEL_JOB"];

			for (const messageType of allowedMessages) {
				const message = { type: messageType };
				const result = isValidMessageSender(sender, message);
				expect(result).toBe(true);
			}
		});

		it("should reject unknown message types from content scripts", () => {
			const sender: chrome.runtime.MessageSender = {
				id: "test-extension-id",
				tab: { id: 123, url: "https://example.com" },
			};
			const message = { type: "UNKNOWN_MESSAGE_TYPE" };

			const result = isValidMessageSender(sender, message);
			expect(result).toBe(false);
		});

		it("should reject messages from wrong extension ID with tab", () => {
			const sender: chrome.runtime.MessageSender = {
				id: "different-extension-id",
				tab: { id: 123, url: "https://example.com" },
			};
			const message = { type: "CONTENT_EXTRACTED" };

			const result = isValidMessageSender(sender, message);
			expect(result).toBe(false);
		});

		it("should reject messages without extension ID but with tab", () => {
			const sender: chrome.runtime.MessageSender = {
				// No id property
				tab: { id: 123, url: "https://example.com" },
			};
			const message = { type: "CONTENT_EXTRACTED" };

			const result = isValidMessageSender(sender, message);
			expect(result).toBe(false);
		});

		it("should handle edge case with undefined tab properly", () => {
			const sender: chrome.runtime.MessageSender = {
				id: "test-extension-id",
				tab: undefined,
			};
			const message = { type: "START_TTS" };

			const result = isValidMessageSender(sender, message);
			expect(result).toBe(true);
		});

		it("should reject potentially malicious message types", () => {
			const sender: chrome.runtime.MessageSender = {
				id: "test-extension-id",
				tab: { id: 123, url: "https://example.com" },
			};

			const maliciousMessages = [
				"INJECT_SCRIPT",
				"STEAL_DATA", 
				"BYPASS_SECURITY",
				"ADMIN_ACCESS",
				"",
				null,
				undefined,
			];

			for (const messageType of maliciousMessages) {
				const message = { type: messageType };
				const result = isValidMessageSender(sender, message);
				expect(result).toBe(false);
			}
		});

		it("should handle complex sender objects safely", () => {
			// Test with complex sender object that might come from compromised context
			const sender: chrome.runtime.MessageSender = {
				id: "test-extension-id",
				tab: { 
					id: 123, 
					url: "https://example.com",
					// Additional properties that shouldn't affect validation
					title: "Evil Page <script>alert(1)</script>",
					favIconUrl: "javascript:alert(1)",
				},
				frameId: 0,
				origin: "https://example.com",
			};
			const message = { type: "CONTENT_EXTRACTED" };

			const result = isValidMessageSender(sender, message);
			expect(result).toBe(true); // Should still be valid based on core criteria
		});

		it("should validate message structure requirements", () => {
			const sender: chrome.runtime.MessageSender = {
				id: "test-extension-id",
				tab: { id: 123, url: "https://example.com" },
			};

			// Test with malformed message objects
			const malformedMessages = [
				null,
				undefined,
				{}, // No type property
				{ type: null },
				{ type: undefined },
				{ type: "" },
			];

			for (const message of malformedMessages) {
				const result = isValidMessageSender(sender, message);
				expect(result).toBe(false);
			}
		});
	});
});