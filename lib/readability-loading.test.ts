import { beforeEach, describe, expect, it, vi } from "vitest";
import fs from "fs";
import path from "path";

// Mock chrome runtime API
const mockGetURL = vi.fn();
globalThis.chrome = {
	runtime: {
		getURL: mockGetURL,
		sendMessage: vi.fn(),
	},
} as any;

describe("Readability.js Loading Regression Tests", () => {
	let readabilityCode: string;
	let contentScriptCode: string;

	beforeEach(() => {
		// Reset global state
		delete (globalThis as any).Readability;
		delete (globalThis.window as any)?.Readability;
		vi.clearAllMocks();

		// Store original module state to restore later
		if (!global.originalModule) {
			global.originalModule = globalThis.module;
		}

		// Load the actual files from the build output
		const extensionPath = path.join(__dirname, "..", ".output", "chrome-mv3");
		readabilityCode = fs.readFileSync(
			path.join(extensionPath, "lib", "readability.js"),
			"utf-8",
		);
		contentScriptCode = fs.readFileSync(
			path.join(extensionPath, "content.js"),
			"utf-8",
		);
	});

	describe("Readability.js Browser Compatibility", () => {
		it("should expose Readability to window object in browser environment", () => {
			// Simulate browser environment
			const mockWindow = {};
			globalThis.window = mockWindow as any;

			// Execute the readability code
			eval(readabilityCode);

			// Verify that Readability is now available on window
			expect((mockWindow as any).Readability).toBeDefined();
			expect(typeof (mockWindow as any).Readability).toBe("function");
			expect((mockWindow as any).Readability.name).toBe("Readability");
		});

		it("should still export via CommonJS for Node environments", () => {
			// Store window temporarily and delete it
			const originalWindow = globalThis.window;
			delete globalThis.window;

			// Ensure module is available for the test
			if (!globalThis.module) {
				globalThis.module = global.originalModule || { exports: {} };
			}

			// Store original exports to restore later
			const originalExports = globalThis.module.exports;

			// Execute the readability code
			eval(readabilityCode);

			// Verify CommonJS export works
			expect(globalThis.module.exports).toBeDefined();
			expect(typeof globalThis.module.exports).toBe("function");
			expect(globalThis.module.exports.name).toBe("Readability");

			// Restore original state
			globalThis.module.exports = originalExports;
			globalThis.window = originalWindow;
		});

		it("should work in mixed environments (both module and window)", () => {
			// Simulate environment where both module and window exist
			const mockWindow = {};
			const originalWindow = globalThis.window;
			globalThis.window = mockWindow as any;

			// Ensure module is available for the test
			if (!globalThis.module) {
				globalThis.module = global.originalModule || { exports: {} };
			}

			// Store original exports to restore later
			const originalExports = globalThis.module.exports;

			// Execute the readability code
			eval(readabilityCode);

			// Both exports should work
			expect(globalThis.module.exports).toBeDefined();
			expect((mockWindow as any).Readability).toBeDefined();
			expect(globalThis.module.exports).toBe((mockWindow as any).Readability);

			// Restore original state
			globalThis.module.exports = originalExports;
			globalThis.window = originalWindow;
		});
	});

	describe("Content Script Loading Logic", () => {
		it("should successfully load and verify Readability availability", async () => {
			// Setup browser environment
			const mockWindow = {};
			globalThis.window = mockWindow as any;

			// Mock chrome.runtime.getURL to return a fake URL
			mockGetURL.mockReturnValue("chrome-extension://test/lib/readability.js");

			// Mock document and DOM manipulation
			const mockScript = {
				src: "",
				onload: null as any,
				onerror: null as any,
			};
			const mockDocument = {
				createElement: vi.fn(() => mockScript),
				head: {
					appendChild: vi.fn(() => {
						// Simulate script loading by executing readability code
						eval(readabilityCode);
						// Then trigger onload
						if (mockScript.onload) mockScript.onload();
					}),
				},
				cloneNode: vi.fn(() => ({})),
				title: "Test Page",
			};
			globalThis.document = mockDocument as any;

			// Extract and execute the loadReadability function from content script
			const loadReadabilityMatch = contentScriptCode.match(
				/function loadReadability\(\) \{([\s\S]*?)\n\}/,
			);
			expect(loadReadabilityMatch).toBeTruthy();

			const loadReadabilityFn = new Function(
				`return function loadReadability() {${loadReadabilityMatch![1]}}`,
			)();

			// Test the loading function
			await expect(loadReadabilityFn()).resolves.toBeUndefined();

			// Verify the expected interactions
			expect(mockDocument.createElement).toHaveBeenCalledWith("script");
			expect(mockScript.src).toBe("chrome-extension://test/lib/readability.js");
			expect(mockDocument.head.appendChild).toHaveBeenCalledWith(mockScript);
			expect((mockWindow as any).Readability).toBeDefined();
		});

		it("should reject when Readability fails to load", async () => {
			// Setup browser environment without proper Readability loading
			globalThis.window = {} as any;
			mockGetURL.mockReturnValue("chrome-extension://test/lib/readability.js");

			const mockScript = {
				src: "",
				onload: null as any,
				onerror: null as any,
			};
			const mockDocument = {
				createElement: vi.fn(() => mockScript),
				head: {
					appendChild: vi.fn(() => {
						// Simulate script loading but NOT setting window.Readability
						// (simulating the original bug)
						if (mockScript.onload) mockScript.onload();
					}),
				},
			};
			globalThis.document = mockDocument as any;

			// Extract loadReadability function
			const loadReadabilityMatch = contentScriptCode.match(
				/function loadReadability\(\) \{([\s\S]*?)\n\}/,
			);
			const loadReadabilityFn = new Function(
				`return function loadReadability() {${loadReadabilityMatch![1]}}`,
			)();

			// Test should reject with expected error
			await expect(loadReadabilityFn()).rejects.toThrow(
				"Readability.js failed to load properly",
			);
		});

		it("should reject when script fails to load", async () => {
			// Setup browser environment
			globalThis.window = {} as any;
			mockGetURL.mockReturnValue("chrome-extension://test/lib/readability.js");

			const mockScript = {
				src: "",
				onload: null as any,
				onerror: null as any,
			};
			const mockDocument = {
				createElement: vi.fn(() => mockScript),
				head: {
					appendChild: vi.fn(() => {
						// Simulate script load error
						if (mockScript.onerror) mockScript.onerror();
					}),
				},
			};
			globalThis.document = mockDocument as any;

			// Extract loadReadability function
			const loadReadabilityMatch = contentScriptCode.match(
				/function loadReadability\(\) \{([\s\S]*?)\n\}/,
			);
			const loadReadabilityFn = new Function(
				`return function loadReadability() {${loadReadabilityMatch![1]}}`,
			)();

			// Test should reject with expected error
			await expect(loadReadabilityFn()).rejects.toThrow(
				"Failed to load Readability.js",
			);
		});

		it("should skip loading if Readability is already available", async () => {
			// Pre-load Readability on window
			const mockWindow = { Readability: vi.fn() };
			globalThis.window = mockWindow as any;

			const mockDocument = {
				createElement: vi.fn(),
				head: { appendChild: vi.fn() },
			};
			globalThis.document = mockDocument as any;

			// Extract loadReadability function
			const loadReadabilityMatch = contentScriptCode.match(
				/function loadReadability\(\) \{([\s\S]*?)\n\}/,
			);
			const loadReadabilityFn = new Function(
				`return function loadReadability() {${loadReadabilityMatch![1]}}`,
			)();

			// Should resolve immediately without DOM manipulation
			await expect(loadReadabilityFn()).resolves.toBeUndefined();

			// Should not have tried to create/append script elements
			expect(mockDocument.createElement).not.toHaveBeenCalled();
			expect(mockDocument.head.appendChild).not.toHaveBeenCalled();
		});
	});

	describe("Full Content Extraction Integration", () => {
		it("should successfully extract content using loaded Readability", async () => {
			// Create a realistic DOM structure
			const mockArticle = {
				textContent: "This is a test article with meaningful content that should be extracted by Readability.js for processing.",
				title: "Test Article Title",
			};

			const mockReader = {
				parse: vi.fn(() => mockArticle),
			};

			const mockReadability = vi.fn(() => mockReader);

			// Setup complete browser environment
			const mockWindow = { Readability: mockReadability };
			globalThis.window = mockWindow as any;

			const mockDocument = {
				cloneNode: vi.fn(() => ({})),
				title: "Test Page",
			};
			globalThis.document = mockDocument as any;

			// Mock chrome.runtime.sendMessage
			const mockSendMessage = vi.fn();
			globalThis.chrome.runtime.sendMessage = mockSendMessage;

			// Mock loadReadability function to skip loading since Readability is already available
			const mockLoadReadability = vi.fn(() => Promise.resolve());

			// Extract both functions and create them in scope
			const extractContentMatch = contentScriptCode.match(
				/async function extractContent\(\) \{([\s\S]*?)\n\}/,
			);
			expect(extractContentMatch).toBeTruthy();

			// Create the extractContent function with loadReadability in scope
			const extractContentFn = new Function(
				'loadReadability',
				`return async function extractContent() {${extractContentMatch![1]}}`,
			)(mockLoadReadability);

			// Execute content extraction
			await expect(extractContentFn()).resolves.toBeUndefined();

			// Verify the extraction flow
			expect(mockLoadReadability).toHaveBeenCalled();
			expect(mockDocument.cloneNode).toHaveBeenCalledWith(true);
			expect(mockReadability).toHaveBeenCalledWith({}, {
				debug: false,
				charThreshold: 500,
			});
			expect(mockReader.parse).toHaveBeenCalled();
			expect(mockSendMessage).toHaveBeenCalledWith({
				type: "CONTENT_EXTRACTED",
				text: mockArticle.textContent,
				title: mockArticle.title,
			});
		});

		it("should handle content extraction errors gracefully", async () => {
			// Setup environment where Readability throws an error
			const mockReadability = vi.fn(() => {
				throw new Error("Readability parsing failed");
			});

			globalThis.window = { Readability: mockReadability } as any;
			globalThis.document = { cloneNode: vi.fn(() => ({})) } as any;

			const mockSendMessage = vi.fn();
			globalThis.chrome.runtime.sendMessage = mockSendMessage;

			// Mock loadReadability function 
			const mockLoadReadability = vi.fn(() => Promise.resolve());

			// Extract extractContent function
			const extractContentMatch = contentScriptCode.match(
				/async function extractContent\(\) \{([\s\S]*?)\n\}/,
			);
			const extractContentFn = new Function(
				'loadReadability',
				`return async function extractContent() {${extractContentMatch![1]}}`,
			)(mockLoadReadability);

			// Should not throw, but send error message
			await expect(extractContentFn()).resolves.toBeUndefined();

			// Should have sent error message
			expect(mockSendMessage).toHaveBeenCalledWith({
				type: "CONTENT_ERROR",
				error: "Readability parsing failed",
			});
		});
	});
});