import { beforeEach, describe, expect, it, vi } from "vitest";
import {
	areOptionsConfigured,
	type ExtensionOptions,
	type ExtensionState,
	getDefaultExtensionOptions,
	getExtensionOptions,
	getExtensionState,
	resetExtensionState,
	setExtensionOptions,
	setExtensionState,
} from "./storage";

// Mock chrome.storage.local
const mockStorageData: Record<string, any> = {};

const mockStorage = {
	get: vi.fn((keys: string | string[] | Record<string, any>) => {
		if (typeof keys === "string") {
			return Promise.resolve({ [keys]: mockStorageData[keys] });
		}
		if (Array.isArray(keys)) {
			const result: Record<string, any> = {};
			keys.forEach((key) => {
				result[key] = mockStorageData[key];
			});
			return Promise.resolve(result);
		}
		return Promise.resolve(mockStorageData);
	}),
	set: vi.fn((items: Record<string, any>) => {
		Object.assign(mockStorageData, items);
		return Promise.resolve();
	}),
	clear: vi.fn(() => {
		Object.keys(mockStorageData).forEach((key) => delete mockStorageData[key]);
		return Promise.resolve();
	}),
};

// Setup global chrome mock
globalThis.chrome = {
	storage: {
		local: mockStorage,
	},
} as any;

describe("Storage Functions", () => {
	beforeEach(() => {
		// Clear mock storage before each test
		Object.keys(mockStorageData).forEach((key) => delete mockStorageData[key]);
		vi.clearAllMocks();
	});

	describe("ExtensionState functions", () => {
		it("should return default idle state when no state exists", async () => {
			const state = await getExtensionState();
			expect(state).toEqual({ status: "idle" });
			expect(mockStorage.get).toHaveBeenCalledWith("extensionState");
		});

		it("should return stored state when it exists", async () => {
			const storedState: ExtensionState = {
				status: "processing",
				message: "Working...",
			};
			mockStorageData["extensionState"] = storedState;

			const state = await getExtensionState();
			expect(state).toEqual(storedState);
		});

		it("should merge partial state updates with existing state", async () => {
			const initialState: ExtensionState = { status: "idle" };
			mockStorageData["extensionState"] = initialState;

			await setExtensionState({ status: "processing", message: "Loading..." });

			expect(mockStorage.set).toHaveBeenCalledWith({
				extensionState: { status: "processing", message: "Loading..." },
			});
		});

		it("should preserve existing properties when partially updating state", async () => {
			const initialState: ExtensionState = {
				status: "processing",
				message: "Loading...",
			};
			mockStorageData["extensionState"] = initialState;

			await setExtensionState({ status: "success" });

			expect(mockStorage.set).toHaveBeenCalledWith({
				extensionState: { status: "success", message: "Loading..." },
			});
		});

		it("should reset state to idle with no message", async () => {
			const initialState: ExtensionState = {
				status: "error",
				message: "Something went wrong",
			};
			mockStorageData["extensionState"] = initialState;

			await resetExtensionState();

			expect(mockStorage.set).toHaveBeenCalledWith({
				extensionState: { status: "idle", message: undefined },
			});
		});
	});

	describe("ExtensionOptions functions", () => {
		it("should return null when no options exist", async () => {
			const options = await getExtensionOptions();
			expect(options).toBeNull();
			expect(mockStorage.get).toHaveBeenCalledWith("extensionOptions");
		});

		it("should return stored options when they exist", async () => {
			const storedOptions: ExtensionOptions = {
				apiKey: "test-key",
				modelName: "gemini-2.5-flash-preview-tts",
				voice: "Kore",
			};
			mockStorageData["extensionOptions"] = storedOptions;

			const options = await getExtensionOptions();
			expect(options).toEqual(storedOptions);
		});

		it("should store extension options", async () => {
			const options: ExtensionOptions = {
				apiKey: "my-api-key",
				modelName: "gemini-2.5-pro-preview-tts",
				voice: "Zephyr",
			};

			await setExtensionOptions(options);

			expect(mockStorage.set).toHaveBeenCalledWith({
				extensionOptions: options,
			});
		});

		it("should return default options with correct values", async () => {
			const defaultOptions = await getDefaultExtensionOptions();
			expect(defaultOptions).toEqual({
				apiKey: "",
				modelName: "gemini-2.5-flash-preview-tts",
				voice: "Kore",
			});
		});
	});

	describe("areOptionsConfigured function", () => {
		it("should return false when no options exist", async () => {
			const configured = await areOptionsConfigured();
			expect(configured).toBe(false);
		});

		it("should return false when options exist but API key is empty", async () => {
			const options: ExtensionOptions = {
				apiKey: "",
				modelName: "gemini-2.5-flash-preview-tts",
				voice: "Kore",
			};
			mockStorageData["extensionOptions"] = options;

			const configured = await areOptionsConfigured();
			expect(configured).toBe(false);
		});

		it("should return false when options exist but API key is only whitespace", async () => {
			const options: ExtensionOptions = {
				apiKey: "   ",
				modelName: "gemini-2.5-flash-preview-tts",
				voice: "Kore",
			};
			mockStorageData["extensionOptions"] = options;

			const configured = await areOptionsConfigured();
			expect(configured).toBe(false);
		});

		it("should return true when options exist with valid API key", async () => {
			const options: ExtensionOptions = {
				apiKey: "valid-api-key",
				modelName: "gemini-2.5-flash-preview-tts",
				voice: "Kore",
			};
			mockStorageData["extensionOptions"] = options;

			const configured = await areOptionsConfigured();
			expect(configured).toBe(true);
		});
	});
});
