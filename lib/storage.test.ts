import { beforeEach, describe, expect, it, vi } from "vitest";
import {
	areOptionsConfigured,
	cleanupOldJobs,
	type ExtensionOptions,
	type ExtensionState,
	generateFilename,
	getDefaultExtensionOptions,
	getExtensionOptions,
	getExtensionState,
	resetExtensionState,
	setExtensionOptions,
	setExtensionState,
	type TabInfo,
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
				voice: "Aoede",
				speechStylePrompts: [],
				defaultPromptId: "",
			};
			mockStorageData["extensionOptions"] = storedOptions;

			const options = await getExtensionOptions();
			// Should add default prompts and prompt ID when missing
			expect(options?.apiKey).toBe("test-key");
			expect(options?.modelName).toBe("gemini-2.5-flash-preview-tts");
			expect(options?.voice).toBe("Aoede");
			expect(options?.speechStylePrompts).toBeDefined();
			expect(options?.speechStylePrompts.length).toBeGreaterThan(0);
			expect(options?.defaultPromptId).toBe("documentary");
		});

		it("should store extension options with encrypted API key", async () => {
			const options: ExtensionOptions = {
				apiKey: "my-api-key",
				modelName: "gemini-2.5-pro-preview-tts",
				voice: "Zephyr",
				speechStylePrompts: [],
				defaultPromptId: "documentary",
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
				voice: "Aoede",
				speechStylePrompts: [],
				defaultPromptId: "documentary",
			};

			// Store the options (this encrypts the API key)
			await setExtensionOptions(originalOptions);

			// Retrieve the options (this should decrypt the API key)
			const retrievedOptions = await getExtensionOptions();

			// The retrieved options should have the same core data
			expect(retrievedOptions?.apiKey).toBe("test-api-key-12345");
			expect(retrievedOptions?.modelName).toBe("gemini-2.5-flash-preview-tts");
			expect(retrievedOptions?.voice).toBe("Aoede");
			expect(retrievedOptions?.defaultPromptId).toBe("documentary");
			expect(retrievedOptions?.speechStylePrompts).toBeDefined();

			// Clean up by clearing the stored data to prevent interference with other tests
			delete mockStorageData.extensionOptions;
		});

		it("should return default options with correct values", async () => {
			const defaultOptions = await getDefaultExtensionOptions();
			expect(defaultOptions.apiKey).toBe("");
			expect(defaultOptions.modelName).toBe("gemini-2.5-flash-preview-tts");
			expect(defaultOptions.voice).toBe("Aoede");
			expect(defaultOptions.speechStylePrompts).toBeDefined();
			expect(defaultOptions.speechStylePrompts.length).toBeGreaterThan(0);
			expect(defaultOptions.defaultPromptId).toBe("documentary");
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
				voice: "Aoede",
				speechStylePrompts: [],
				defaultPromptId: "documentary",
			};
			mockStorageData["extensionOptions"] = options;

			const configured = await areOptionsConfigured();
			expect(configured).toBe(false);
		});

		it("should return false when options exist but API key is only whitespace", async () => {
			const options: ExtensionOptions = {
				apiKey: "   ",
				modelName: "gemini-2.5-flash-preview-tts",
				voice: "Aoede",
				speechStylePrompts: [],
				defaultPromptId: "documentary",
			};
			mockStorageData["extensionOptions"] = options;

			const configured = await areOptionsConfigured();
			expect(configured).toBe(false);
		});

		it("should return true when options exist with valid API key", async () => {
			const options: ExtensionOptions = {
				apiKey: "valid-api-key",
				modelName: "gemini-2.5-flash-preview-tts",
				voice: "Aoede",
				speechStylePrompts: [],
				defaultPromptId: "documentary",
			};
			mockStorageData["extensionOptions"] = options;

			const configured = await areOptionsConfigured();
			expect(configured).toBe(true);
		});
	});

	describe("cleanupOldJobs function", () => {
		it("should remove preparing jobs older than 10 minutes", async () => {
			const oldPreparingJob = {
				id: "old-preparing",
				tabId: 1,
				tabInfo: { url: "http://test.com", title: "Test", domain: "test.com" },
				status: "preparing" as const,
				message: "Preparing...",
				startTime: Date.now() - 11 * 60 * 1000, // 11 minutes ago
				text: "test text",
			};

			const initialState: ExtensionState = {
				activeJobs: [oldPreparingJob],
				maxConcurrentJobs: 3,
			};
			mockStorageData["extensionState"] = initialState;

			await cleanupOldJobs();

			const finalState = await getExtensionState();
			expect(finalState.activeJobs).toHaveLength(0);
		});

		it("should preserve preparing jobs newer than 10 minutes", async () => {
			const newPreparingJob = {
				id: "new-preparing",
				tabId: 1,
				tabInfo: { url: "http://test.com", title: "Test", domain: "test.com" },
				status: "preparing" as const,
				message: "Preparing...",
				startTime: Date.now() - 5 * 60 * 1000, // 5 minutes ago
				text: "test text",
			};

			const initialState: ExtensionState = {
				activeJobs: [newPreparingJob],
				maxConcurrentJobs: 3,
			};
			mockStorageData["extensionState"] = initialState;

			await cleanupOldJobs();

			const finalState = await getExtensionState();
			expect(finalState.activeJobs).toHaveLength(1);
			expect(finalState.activeJobs[0].id).toBe("new-preparing");
		});

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
					id: "old-preparing",
					tabId: 2,
					tabInfo: {
						url: "http://test2.com",
						title: "Test2",
						domain: "test2.com",
					},
					status: "preparing" as const,
					message: "Preparing...",
					startTime: now - 15 * 60 * 1000, // 15 minutes ago - should remove
					text: "test text 2",
				},
				{
					id: "new-preparing",
					tabId: 3,
					tabInfo: {
						url: "http://test3.com",
						title: "Test3",
						domain: "test3.com",
					},
					status: "preparing" as const,
					message: "Preparing...",
					startTime: now - 5 * 60 * 1000, // 5 minutes ago - should keep
					text: "test text 3",
				},
				{
					id: "old-success",
					tabId: 4,
					tabInfo: {
						url: "http://test4.com",
						title: "Test4",
						domain: "test4.com",
					},
					status: "success" as const,
					message: "Done",
					startTime: now - 6 * 60 * 1000, // 6 minutes ago - should remove
					text: "test text 4",
				},
				{
					id: "new-success",
					tabId: 5,
					tabInfo: {
						url: "http://test5.com",
						title: "Test5",
						domain: "test5.com",
					},
					status: "success" as const,
					message: "Done",
					startTime: now - 3 * 60 * 1000, // 3 minutes ago - should keep
					text: "test text 5",
				},
				{
					id: "new-error",
					tabId: 6,
					tabInfo: {
						url: "http://test6.com",
						title: "Test6",
						domain: "test6.com",
					},
					status: "error" as const,
					message: "Failed",
					startTime: now - 6 * 60 * 1000, // 6 minutes ago - should keep
					text: "test text 6",
				},
				{
					id: "old-error",
					tabId: 7,
					tabInfo: {
						url: "http://test7.com",
						title: "Test7",
						domain: "test7.com",
					},
					status: "error" as const,
					message: "Failed",
					startTime: now - 25 * 60 * 60 * 1000, // 25 hours ago - should remove
					text: "test text 7",
				},
			];

			const initialState: ExtensionState = {
				activeJobs: jobs,
				maxConcurrentJobs: 3,
			};
			mockStorageData["extensionState"] = initialState;

			await cleanupOldJobs();

			const finalState = await getExtensionState();
			expect(finalState.activeJobs).toHaveLength(4);

			const remainingIds = finalState.activeJobs.map((job) => job.id);
			expect(remainingIds).toContain("processing-job");
			expect(remainingIds).toContain("new-preparing");
			expect(remainingIds).toContain("new-success");
			expect(remainingIds).toContain("new-error");
			expect(remainingIds).not.toContain("old-preparing");
			expect(remainingIds).not.toContain("old-success");
			expect(remainingIds).not.toContain("old-error");
		});
	});

	describe("Security enhancements", () => {
		describe("filename sanitization", () => {
			it("should prevent path traversal attacks", () => {
				const tabInfo: TabInfo = {
					url: "https://malicious.com/article",
					title: "../../../etc/passwd",
					domain: "malicious.com",
				};

				const filename = generateFilename(tabInfo);
				expect(filename).not.toContain("../");
				expect(filename).not.toContain("./");
				expect(filename).toBe("etc passwd - malicious.com.mp3");
			});

			it("should remove null bytes and control characters", () => {
				const tabInfo: TabInfo = {
					url: "https://test.com/article",
					title: "Title\x00with\x01control\x1fchars",
					domain: "test.com",
				};

				const filename = generateFilename(tabInfo);
				expect(filename).not.toMatch(/[\x00-\x1f]/);
				expect(filename).toBe("Titlewithcontrolchars - test.com.mp3");
			});

			it("should handle Windows reserved names", () => {
				const reservedNames = ["CON", "PRN", "AUX", "NUL", "COM1", "COM9", "LPT1", "LPT9"];
				
				for (const reserved of reservedNames) {
					const tabInfo: TabInfo = {
						url: "https://test.com/article",
						title: reserved,
						domain: "test.com",
					};

					const filename = generateFilename(tabInfo);
					expect(filename).toBe(`file_${reserved} - test.com.mp3`);
				}
			});

			it("should handle mixed case Windows reserved names", () => {
				const tabInfo: TabInfo = {
					url: "https://test.com/article",
					title: "con",
					domain: "test.com",
				};

				const filename = generateFilename(tabInfo);
				expect(filename).toBe("file_con - test.com.mp3");
			});

			it("should handle leading dots and provide fallback names", () => {
				const testCases = [
					{ title: ".", expected: "unnamed_file" },
					{ title: "..", expected: "unnamed_file" },
					{ title: "...", expected: "unnamed_file" },
					{ title: ".hidden", expected: "hidden" },
					{ title: "...hidden", expected: "hidden" },
				];

				for (const testCase of testCases) {
					const tabInfo: TabInfo = {
						url: "https://test.com/article",
						title: testCase.title,
						domain: "test.com",
					};

					const filename = generateFilename(tabInfo);
					expect(filename).toBe(`${testCase.expected} - test.com.mp3`);
				}
			});

			it("should provide fallback for completely sanitized names", () => {
				const tabInfo: TabInfo = {
					url: "https://test.com/article",
					title: "///...///",
					domain: "test.com",
				};

				const filename = generateFilename(tabInfo);
				expect(filename).toBe("unnamed_file - test.com.mp3");
			});
		});

		describe("encryption security", () => {
			it("should use AES-GCM encryption for new API keys", async () => {
				const options: ExtensionOptions = {
					apiKey: "test-secure-key",
					modelName: "gemini-2.5-flash-preview-tts",
					voice: "Aoede",
					speechStylePrompts: [],
					defaultPromptId: "documentary",
				};

				await setExtensionOptions(options);

				// Get the raw stored data
				const storedData = mockStorageData["extensionOptions"];
				expect(storedData.apiKey).not.toBe("test-secure-key");
				
				// New encryption format should be structured JSON
				let parsed;
				try {
					parsed = JSON.parse(atob(storedData.apiKey));
				} catch (error) {
					// Should not fail to parse
					expect(error).toBeNull();
				}

				expect(parsed).toBeDefined();
				expect(parsed.v).toBe(1); // Version should be 1
				expect(parsed.data).toBeDefined();
				expect(parsed.iv).toBeDefined();
				expect(parsed.salt).toBeDefined();
			});

			it("should successfully decrypt API keys", async () => {
				const originalKey = "my-secure-api-key-123";
				const options: ExtensionOptions = {
					apiKey: originalKey,
					modelName: "gemini-2.5-flash-preview-tts",
					voice: "Aoede",
					speechStylePrompts: [],
					defaultPromptId: "documentary",
				};

				// Store and retrieve
				await setExtensionOptions(options);
				const retrieved = await getExtensionOptions();

				expect(retrieved?.apiKey).toBe(originalKey);
			});

			it("should handle encryption errors gracefully", async () => {
				// Mock the secureEncrypt function to fail by mocking crypto.subtle.importKey
				const originalImportKey = crypto.subtle.importKey;
				crypto.subtle.importKey = vi.fn().mockRejectedValue(new Error("Encryption failed"));

				const options: ExtensionOptions = {
					apiKey: "test-key",
					modelName: "gemini-2.5-flash-preview-tts",
					voice: "Aoede",
					speechStylePrompts: [],
					defaultPromptId: "documentary",
				};

				// Should fall back to unencrypted storage
				await setExtensionOptions(options);
				const stored = mockStorageData["extensionOptions"];
				expect(stored.apiKey).toBe("test-key"); // Should be unencrypted

				// Restore crypto
				crypto.subtle.importKey = originalImportKey;
			});
		});
	});

	describe("generateFilename function", () => {
		it("should use article title and domain when both fit within limits", () => {
			const tabInfo: TabInfo = {
				url: "https://example.com/article",
				title: "Page Title",
				domain: "example.com",
				articleTitle: "Great Article",
			};

			const filename = generateFilename(tabInfo);
			expect(filename).toBe("Great Article - example.com.mp3");
		});

		it("should use page title and domain when no article title is provided", () => {
			const tabInfo: TabInfo = {
				url: "https://example.com/page",
				title: "Page Title",
				domain: "example.com",
			};

			const filename = generateFilename(tabInfo);
			expect(filename).toBe("Page Title - example.com.mp3");
		});

		it("should use only domain when no meaningful title is provided", () => {
			const tabInfo: TabInfo = {
				url: "https://example.com/",
				title: "",
				domain: "example.com",
			};

			const filename = generateFilename(tabInfo);
			expect(filename).toBe("example.com.mp3");
		});

		it("should use only domain when title is only whitespace", () => {
			const tabInfo: TabInfo = {
				url: "https://example.com/",
				title: "   ",
				domain: "example.com",
				articleTitle: "  \t  ",
			};

			const filename = generateFilename(tabInfo);
			expect(filename).toBe("example.com.mp3");
		});

		it("should truncate long titles to fit within 80 character limit", () => {
			const longTitle = "This is a very long article title that definitely exceeds the character limit we want to enforce for filenames";
			const tabInfo: TabInfo = {
				url: "https://example.com/article",
				title: "Short Title",
				domain: "example.com",
				articleTitle: longTitle,
			};

			const filename = generateFilename(tabInfo);
			expect(filename.length).toBeLessThanOrEqual(84); // 80 + ".mp3"
			expect(filename).toMatch(/^This is a very long article title that definitely exceeds the.*\.mp3$/);
		});

		it("should use title only when adding domain would exceed length limit", () => {
			const longTitle = "This is a moderately long title that fits but leaves no room for domain";
			const tabInfo: TabInfo = {
				url: "https://verylongdomainname.com/article",
				title: "Short Title",
				domain: "verylongdomainname.com",
				articleTitle: longTitle,
			};

			const filename = generateFilename(tabInfo);
			expect(filename).toBe(`${longTitle}.mp3`);
			expect(filename).not.toContain("verylongdomainname.com");
		});

		it("should sanitize filesystem-incompatible characters", () => {
			const tabInfo: TabInfo = {
				url: "https://example.com/article",
				title: 'Title with <bad>characters:/\\|?*"',
				domain: "example.com",
			};

			const filename = generateFilename(tabInfo);
			expect(filename).toBe("Title with bad characters - example.com.mp3");
		});

		it("should normalize multiple spaces and separator formatting", () => {
			const tabInfo: TabInfo = {
				url: "https://example.com/article",
				title: "Title   with    multiple   spaces",
				domain: "example.com",
			};

			const filename = generateFilename(tabInfo);
			expect(filename).toBe("Title with multiple spaces - example.com.mp3");
		});

		it("should handle when title is the same as domain", () => {
			const tabInfo: TabInfo = {
				url: "https://github.com/",
				title: "github.com",
				domain: "github.com",
			};

			const filename = generateFilename(tabInfo);
			expect(filename).toBe("github.com.mp3");
			expect(filename).not.toContain(" - github.com");
		});

		it("should prefer article title over page title", () => {
			const tabInfo: TabInfo = {
				url: "https://example.com/article",
				title: "Generic Page Title",
				domain: "example.com",
				articleTitle: "Specific Article Title",
			};

			const filename = generateFilename(tabInfo);
			expect(filename).toBe("Specific Article Title - example.com.mp3");
		});

		it("should trim whitespace from titles before processing", () => {
			const tabInfo: TabInfo = {
				url: "https://example.com/article",
				title: "  Page Title  ",
				domain: "example.com",
				articleTitle: "  Article Title  ",
			};

			const filename = generateFilename(tabInfo);
			expect(filename).toBe("Article Title - example.com.mp3");
		});

		it("should handle edge case with very short domain name", () => {
			const tabInfo: TabInfo = {
				url: "https://a.co/item",
				title: "Product Page",
				domain: "a.co",
			};

			const filename = generateFilename(tabInfo);
			expect(filename).toBe("Product Page - a.co.mp3");
		});

		it("should skip domain when insufficient space remains", () => {
			const tabInfo: TabInfo = {
				url: "https://example.com/article",
				title: "This title is exactly sixty-one characters long making it tight",
				domain: "example.com",
			};

			const filename = generateFilename(tabInfo);
			// Should not include domain because remaining space would be < 10 chars
			expect(filename).toBe("This title is exactly sixty-one characters long making it tight.mp3");
			expect(filename).not.toContain("example.com");
		});

		it("should handle complex sanitization with separators", () => {
			const tabInfo: TabInfo = {
				url: "https://example.com/article",
				title: "Title - with: existing/separators",
				domain: "example.com",
			};

			const filename = generateFilename(tabInfo);
			expect(filename).toBe("Title - with existing separators - example.com.mp3");
		});
	});
});
