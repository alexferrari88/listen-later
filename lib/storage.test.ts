import { beforeEach, describe, expect, it, vi } from "vitest";
import {
	areOptionsConfigured,
	cleanupOldJobs,
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
		it("should return default job-based state when no state exists", async () => {
			const state = await getExtensionState();
			expect(state).toEqual({ activeJobs: [], maxConcurrentJobs: 3 });
			expect(mockStorage.get).toHaveBeenCalledWith("extensionState");
		});

		it("should return stored state when it exists", async () => {
			const storedState: ExtensionState = {
				activeJobs: [
					{
						id: "test-job",
						tabId: 1,
						tabInfo: {
							url: "http://test.com",
							title: "Test",
							domain: "test.com",
						},
						status: "processing",
						message: "Working...",
						startTime: Date.now(),
						text: "test text",
					},
				],
				maxConcurrentJobs: 3,
			};
			mockStorageData["extensionState"] = storedState;

			const state = await getExtensionState();
			expect(state).toEqual(storedState);
		});

		it("should merge partial state updates with existing state", async () => {
			const initialState: ExtensionState = {
				activeJobs: [],
				maxConcurrentJobs: 3,
			};
			mockStorageData["extensionState"] = initialState;

			const newJob = {
				id: "test-job",
				tabId: 1,
				tabInfo: { url: "http://test.com", title: "Test", domain: "test.com" },
				status: "processing" as const,
				message: "Loading...",
				startTime: Date.now(),
				text: "test text",
			};
			await setExtensionState({ activeJobs: [newJob] });

			expect(mockStorage.set).toHaveBeenCalledWith({
				extensionState: { activeJobs: [newJob], maxConcurrentJobs: 3 },
			});
		});

		it("should preserve existing properties when partially updating state", async () => {
			const existingJob = {
				id: "existing-job",
				tabId: 1,
				tabInfo: { url: "http://test.com", title: "Test", domain: "test.com" },
				status: "processing" as const,
				message: "Loading...",
				startTime: Date.now(),
				text: "test text",
			};
			const initialState: ExtensionState = {
				activeJobs: [existingJob],
				maxConcurrentJobs: 3,
			};
			mockStorageData["extensionState"] = initialState;

			await setExtensionState({ maxConcurrentJobs: 5 });

			expect(mockStorage.set).toHaveBeenCalledWith({
				extensionState: { activeJobs: [existingJob], maxConcurrentJobs: 5 },
			});
		});

		it("should reset state to default job-based state", async () => {
			const initialState: ExtensionState = {
				activeJobs: [
					{
						id: "test-job",
						tabId: 1,
						tabInfo: {
							url: "http://test.com",
							title: "Test",
							domain: "test.com",
						},
						status: "error",
						message: "Something went wrong",
						startTime: Date.now(),
						text: "test text",
					},
				],
				maxConcurrentJobs: 3,
			};
			mockStorageData["extensionState"] = initialState;

			await resetExtensionState();

			expect(mockStorage.set).toHaveBeenCalledWith({
				extensionState: { activeJobs: [], maxConcurrentJobs: 3 },
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

		it("should store extension options with encrypted API key", async () => {
			const options: ExtensionOptions = {
				apiKey: "my-api-key",
				modelName: "gemini-2.5-pro-preview-tts",
				voice: "Zephyr",
			};

			await setExtensionOptions(options);

			// Verify storage was called
			expect(mockStorage.set).toHaveBeenCalledTimes(1);

			// Get the actual call arguments
			const callArgs = mockStorage.set.mock.calls[0][0];
			const storedOptions = callArgs.extensionOptions;

			// API key should be encrypted (different from original)
			expect(storedOptions.apiKey).not.toBe(options.apiKey);
			expect(storedOptions.apiKey).toBeTruthy();

			// Other fields should remain unchanged
			expect(storedOptions.modelName).toBe(options.modelName);
			expect(storedOptions.voice).toBe(options.voice);
		});

		it("should encrypt and decrypt API key correctly", async () => {
			const originalOptions: ExtensionOptions = {
				apiKey: "test-api-key-12345",
				modelName: "gemini-2.5-flash-preview-tts",
				voice: "Kore",
			};

			// Store the options (this encrypts the API key)
			await setExtensionOptions(originalOptions);

			// Retrieve the options (this should decrypt the API key)
			const retrievedOptions = await getExtensionOptions();

			// The retrieved options should match the original
			expect(retrievedOptions).toEqual(originalOptions);

			// Clean up by clearing the stored data to prevent interference with other tests
			delete mockStorageData.extensionOptions;
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

	describe("cleanupOldJobs function", () => {
		it("should preserve processing jobs regardless of age", async () => {
			const oldProcessingJob = {
				id: "old-processing",
				tabId: 1,
				tabInfo: { url: "http://test.com", title: "Test", domain: "test.com" },
				status: "processing" as const,
				message: "Still processing...",
				startTime: Date.now() - 25 * 60 * 60 * 1000, // 25 hours ago
				text: "test text",
			};

			const initialState: ExtensionState = {
				activeJobs: [oldProcessingJob],
				maxConcurrentJobs: 3,
			};
			mockStorageData["extensionState"] = initialState;

			await cleanupOldJobs();

			const finalState = await getExtensionState();
			expect(finalState.activeJobs).toHaveLength(1);
			expect(finalState.activeJobs[0].id).toBe("old-processing");
		});

		it("should remove success jobs older than 5 minutes", async () => {
			const oldSuccessJob = {
				id: "old-success",
				tabId: 1,
				tabInfo: { url: "http://test.com", title: "Test", domain: "test.com" },
				status: "success" as const,
				message: "Completed",
				startTime: Date.now() - 6 * 60 * 1000, // 6 minutes ago
				text: "test text",
			};

			const initialState: ExtensionState = {
				activeJobs: [oldSuccessJob],
				maxConcurrentJobs: 3,
			};
			mockStorageData["extensionState"] = initialState;

			await cleanupOldJobs();

			const finalState = await getExtensionState();
			expect(finalState.activeJobs).toHaveLength(0);
		});

		it("should preserve success jobs newer than 5 minutes", async () => {
			const newSuccessJob = {
				id: "new-success",
				tabId: 1,
				tabInfo: { url: "http://test.com", title: "Test", domain: "test.com" },
				status: "success" as const,
				message: "Completed",
				startTime: Date.now() - 3 * 60 * 1000, // 3 minutes ago
				text: "test text",
			};

			const initialState: ExtensionState = {
				activeJobs: [newSuccessJob],
				maxConcurrentJobs: 3,
			};
			mockStorageData["extensionState"] = initialState;

			await cleanupOldJobs();

			const finalState = await getExtensionState();
			expect(finalState.activeJobs).toHaveLength(1);
			expect(finalState.activeJobs[0].id).toBe("new-success");
		});

		it("should preserve error jobs newer than 24 hours", async () => {
			const newErrorJob = {
				id: "new-error",
				tabId: 1,
				tabInfo: { url: "http://test.com", title: "Test", domain: "test.com" },
				status: "error" as const,
				message: "Failed",
				startTime: Date.now() - 6 * 60 * 1000, // 6 minutes ago
				text: "test text",
			};

			const initialState: ExtensionState = {
				activeJobs: [newErrorJob],
				maxConcurrentJobs: 3,
			};
			mockStorageData["extensionState"] = initialState;

			await cleanupOldJobs();

			const finalState = await getExtensionState();
			expect(finalState.activeJobs).toHaveLength(1);
			expect(finalState.activeJobs[0].id).toBe("new-error");
		});

		it("should remove error jobs older than 24 hours", async () => {
			const oldErrorJob = {
				id: "old-error",
				tabId: 1,
				tabInfo: { url: "http://test.com", title: "Test", domain: "test.com" },
				status: "error" as const,
				message: "Failed",
				startTime: Date.now() - 25 * 60 * 60 * 1000, // 25 hours ago
				text: "test text",
			};

			const initialState: ExtensionState = {
				activeJobs: [oldErrorJob],
				maxConcurrentJobs: 3,
			};
			mockStorageData["extensionState"] = initialState;

			await cleanupOldJobs();

			const finalState = await getExtensionState();
			expect(finalState.activeJobs).toHaveLength(0);
		});

		it("should handle mixed job types correctly", async () => {
			const now = Date.now();
			const jobs = [
				{
					id: "processing-job",
					tabId: 1,
					tabInfo: {
						url: "http://test.com",
						title: "Test",
						domain: "test.com",
					},
					status: "processing" as const,
					message: "Processing...",
					startTime: now - 25 * 60 * 60 * 1000, // 25 hours ago - should keep
					text: "test text",
				},
				{
					id: "old-success",
					tabId: 2,
					tabInfo: {
						url: "http://test2.com",
						title: "Test2",
						domain: "test2.com",
					},
					status: "success" as const,
					message: "Done",
					startTime: now - 6 * 60 * 1000, // 6 minutes ago - should remove
					text: "test text 2",
				},
				{
					id: "new-success",
					tabId: 3,
					tabInfo: {
						url: "http://test3.com",
						title: "Test3",
						domain: "test3.com",
					},
					status: "success" as const,
					message: "Done",
					startTime: now - 3 * 60 * 1000, // 3 minutes ago - should keep
					text: "test text 3",
				},
				{
					id: "new-error",
					tabId: 4,
					tabInfo: {
						url: "http://test4.com",
						title: "Test4",
						domain: "test4.com",
					},
					status: "error" as const,
					message: "Failed",
					startTime: now - 6 * 60 * 1000, // 6 minutes ago - should keep
					text: "test text 4",
				},
				{
					id: "old-error",
					tabId: 5,
					tabInfo: {
						url: "http://test5.com",
						title: "Test5",
						domain: "test5.com",
					},
					status: "error" as const,
					message: "Failed",
					startTime: now - 25 * 60 * 60 * 1000, // 25 hours ago - should remove
					text: "test text 5",
				},
			];

			const initialState: ExtensionState = {
				activeJobs: jobs,
				maxConcurrentJobs: 3,
			};
			mockStorageData["extensionState"] = initialState;

			await cleanupOldJobs();

			const finalState = await getExtensionState();
			expect(finalState.activeJobs).toHaveLength(3);

			const remainingIds = finalState.activeJobs.map((job) => job.id);
			expect(remainingIds).toContain("processing-job");
			expect(remainingIds).toContain("new-success");
			expect(remainingIds).toContain("new-error");
			expect(remainingIds).not.toContain("old-success");
			expect(remainingIds).not.toContain("old-error");
		});
	});
});
