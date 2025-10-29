// Import lamejs for MP3 encoding
import * as lamejs from "@breezystack/lamejs";
import { logger, withAsyncLogging } from "../lib/logger";
import { createRateLimiter } from "../lib/rateLimiter";
import { estimateTokenCount, splitTextIntoChunks } from "../lib/textChunker";

// Browser-compatible base64 conversion helpers
const base64ToUint8Array = (base64: string): Uint8Array => {
	const binaryString = atob(base64);
	const bytes = new Uint8Array(binaryString.length);
	for (let i = 0; i < binaryString.length; i++) {
		bytes[i] = binaryString.charCodeAt(i);
	}
	return bytes;
};

const uint8ArrayToBase64 = (uint8Array: Uint8Array): string => {
	let binaryString = "";
	for (let i = 0; i < uint8Array.length; i++) {
		binaryString += String.fromCharCode(uint8Array[i]);
	}
	return btoa(binaryString);
};

const concatenateUint8Arrays = (arrays: Uint8Array[]): Uint8Array => {
	const totalLength = arrays.reduce((sum, array) => sum + array.length, 0);
	const result = new Uint8Array(totalLength);
	let offset = 0;
	for (const array of arrays) {
		result.set(array, offset);
		offset += array.length;
	}
	return result;
};

import {
	canStartNewJob,
	checkRateLimit,
	cleanupOldJobs,
	cleanupRateLimitData,
	createJob,
	getExtensionOptions,
	getExtensionState,
	getJob,
	getSpeechStylePromptById,
	type ProcessingJob,
	removeJob,
	sanitizeErrorMessage,
	substituteSpeechStyleTemplate,
	updateJob,
} from "../lib/storage";

const TTS_API_MAX_REQUESTS_PER_MINUTE = 10;
const TTS_API_MAX_TOKENS_PER_MINUTE = 10_000;
const TTS_API_TOKEN_OVERHEAD = 200;

export default defineBackground(() => {
	logger.info("Background script initialized");

	// Update badge on startup to show any existing active jobs
	updateExtensionBadge();
	logger.debug("Environment mode:", import.meta.env.MODE);

	// Open options page on install
	chrome.runtime.onInstalled.addListener((details) => {
		logger.debug("Extension installed/updated", { reason: details.reason });
		if (details.reason === "install") {
			logger.info("Opening options page on first install");
			chrome.runtime.openOptionsPage();
		}
	});

	// Periodic cleanup of old jobs and rate limit data
	setInterval(async () => {
		try {
			await cleanupOldJobs();
			await cleanupRateLimitData();
		} catch (error) {
			logger.error("Failed to cleanup old jobs and rate limit data", error);
		}
	}, 60000); // Run every minute

	// Main message listener
	chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
		logger.background.message(message.type, {
			message,
			sender: {
				tab: sender.tab?.id,
				url: sender.tab?.url,
				frameId: sender.frameId,
			},
		});

		// Message authentication: verify sender is from extension context
		if (!isValidMessageSender(sender, message)) {
			const errorResponse = {
				success: false,
				error: "Message rejected: invalid sender context",
			};
			logger.warn("Message rejected from invalid sender", {
				messageType: message.type,
				sender: {
					tab: sender.tab?.id,
					url: sender.tab?.url,
					frameId: sender.frameId,
					origin: sender.origin,
					tlsChannelId: sender.tlsChannelId,
				},
			});
			sendResponse(errorResponse);
			return false;
		}

		// Check rate limiting for messages that can trigger heavy operations
		const rateLimitedMessageTypes = ["START_TTS", "CONTENT_EXTRACTED", "CONTENT_EXTRACTED_FOR_REVIEW"];
		if (rateLimitedMessageTypes.includes(message.type) && sender.tab) {
			const origin = sender.tab.url ? new URL(sender.tab.url).origin : "unknown";
			// Use async/await in handleMessage wrapper to properly handle rate limiting
			handleMessageWithRateLimit(message, sender, sendResponse, sender.tab.id, origin);
		} else {
			// No rate limiting needed for this message type
			handleMessage(message, sender, sendResponse);
		}
		return true; // Keep the message channel open for async responses
	});
});

// Message authentication function to validate sender
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

		if (validContentScriptMessages.includes(message.type)) {
			return true;
		}

		// Allow START_TTS and CANCEL_JOB from any extension context (popup/content)
		if (message.type === "START_TTS" || message.type === "CANCEL_JOB") {
			return true;
		}
	}

	// Reject all other messages
	return false;
};

// Wrapper function to handle rate limiting before processing messages
const handleMessageWithRateLimit = withAsyncLogging(
	async (
		message: any,
		sender: chrome.runtime.MessageSender,
		sendResponse: (response?: any) => void,
		tabId: number,
		origin: string,
	) => {
		try {
			const rateLimitResult = await checkRateLimit(tabId, origin);
			if (!rateLimitResult.allowed) {
				const errorResponse = {
					success: false,
					error: rateLimitResult.error || "Rate limit exceeded",
				};
				logger.warn("Message rejected due to rate limiting", {
					messageType: message.type,
					tabId,
					origin,
				});
				sendResponse(errorResponse);
				return;
			}
			
			// Rate limit passed, proceed with message handling
			handleMessage(message, sender, sendResponse);
		} catch (error) {
			logger.error("Rate limit check failed", error);
			// On rate limit check failure, proceed anyway (fail open)
			handleMessage(message, sender, sendResponse);
		}
	},
	"handleMessageWithRateLimit",
);

const handleMessage = withAsyncLogging(
	async (
		message: any,
		sender: chrome.runtime.MessageSender,
		sendResponse: (response?: any) => void,
	) => {
		try {
			switch (message.type) {
				case "START_TTS":
					logger.debug("Handling START_TTS message");
					await handleStartTTS(sender.tab, sendResponse);
					break;
				case "CONTENT_EXTRACTED":
					logger.debug("Handling CONTENT_EXTRACTED message", {
						jobId: message.jobId,
						textLength: message.text?.length,
						title: message.title,
					});
					await handleContentExtracted(
						message.jobId,
						message.text,
						message.title,
						sendResponse,
					);
					break;
				case "CONTENT_EXTRACTED_FOR_REVIEW":
					logger.debug("Handling CONTENT_EXTRACTED_FOR_REVIEW message", {
						jobId: message.jobId,
						textLength: message.text?.length,
						title: message.title,
					});
					await handleContentExtractedForReview(
						message.jobId,
						message.text,
						message.title,
						sendResponse,
					);
					break;
				case "MODAL_CONFIRMED":
					logger.debug("Handling MODAL_CONFIRMED message", {
						jobId: message.jobId,
						textLength: message.text?.length,
						selectedPromptId: message.selectedPromptId,
					});
					await handleModalConfirmed(message.jobId, message.text, message.selectedPromptId, sendResponse);
					break;
				case "MODAL_CANCELLED":
					logger.debug("Handling MODAL_CANCELLED message", {
						jobId: message.jobId,
					});
					await handleModalCancelled(message.jobId, sendResponse);
					break;
				case "CANCEL_JOB":
					logger.debug("Handling CANCEL_JOB message", {
						jobId: message.jobId,
					});
					await handleJobCancellation(message.jobId, sendResponse);
					break;
				case "CONTENT_ERROR":
					logger.debug("Handling CONTENT_ERROR message", {
						jobId: message.jobId,
						error: message.error,
					});
					await handleContentError(message.jobId, message.error, sendResponse);
					break;
				default:
					logger.warn("Unknown message type:", message.type);
					sendResponse({ success: false, error: "Unknown message type" });
			}
		} catch (error) {
			logger.error("Error handling message:", error);
			const sanitizedMessage = sanitizeErrorMessage(error);
			// If we have a job ID in the message, update that job's status
			if (message.jobId) {
				await updateJob(message.jobId, {
					status: "error",
					message: sanitizedMessage,
				});
			}
			sendResponse({
				success: false,
				error: sanitizedMessage,
			});
		}
	},
	"handleMessage",
);

const handleStartTTS = withAsyncLogging(
	async (
		tab: chrome.tabs.Tab | undefined,
		sendResponse: (response?: any) => void,
	) => {
		logger.debug("Starting TTS process");

		// Check if we can start a new job
		if (!(await canStartNewJob())) {
			throw new Error(
				"Maximum concurrent jobs (3) already running. Please wait for one to complete.",
			);
		}

		// Use provided tab or get active tab
		let targetTab = tab;
		if (!targetTab) {
			logger.debug("No tab provided, querying for active tab");
			const [activeTab] = await chrome.tabs.query({
				active: true,
				currentWindow: true,
			});
			targetTab = activeTab;
		}

		logger.debug("Target tab found", {
			id: targetTab?.id,
			url: targetTab?.url,
			title: targetTab?.title,
		});

		if (!targetTab?.id || !targetTab.url || !targetTab.title) {
			throw new Error("No valid tab found or tab missing required information");
		}

		// Create job with preliminary data (text will be added when content is extracted)
		const job = await createJob(
			targetTab.id,
			targetTab.url,
			targetTab.title,
			"", // Empty text for now, will be filled by content script
		);

		// Update badge to show new active job
		await updateExtensionBadge();

		logger.debug("Created job for TTS process", {
			jobId: job.id,
			tabId: targetTab.id,
		});

		// Inject content script with integrated content extraction libraries
		try {
			// Update job status for content script injection
			await updateJob(job.id, {
				message: "Analyzing page content...",
			});

			logger.background.injection("Starting content script injection", {
				tabId: targetTab.id,
				jobId: job.id,
			});
			// First inject the job ID so content script can access it immediately
			await chrome.scripting.executeScript({
				target: { tabId: targetTab.id },
				func: (jobId: string) => {
					(globalThis as any).currentJobId = jobId;
				},
				args: [job.id],
			});

			// Then inject content script - it will now have access to the job ID
			await chrome.scripting.executeScript({
				target: { tabId: targetTab.id },
				files: ["content-scripts/content.js"],
			});

			logger.background.injection("Content script injected successfully");

			sendResponse({ success: true, jobId: job.id });
		} catch (error) {
			logger.background.injection("Injection failed", error);

			// Provide more specific error messages based on error type
			let errorMessage = "Failed to inject content analysis scripts";
			if (error instanceof Error) {
				if (error.message.includes("Cannot access")) {
					errorMessage =
						"Cannot access this page. Try a different page or check if it's a restricted site.";
				} else if (error.message.includes("tab")) {
					errorMessage =
						"Tab was closed or is no longer available. Please try again.";
				} else if (error.message.includes("frame")) {
					errorMessage =
						"Cannot inject script into this page frame. Try refreshing the page.";
				}
			}

			// Update job status to error with specific message
			await updateJob(job.id, {
				status: "error",
				message: errorMessage,
			});

			throw new Error(errorMessage);
		}
	},
	"handleStartTTS",
);

const handleContentExtracted = withAsyncLogging(
	async (
		jobId: string,
		text: string,
		articleTitle: string,
		sendResponse: (response?: any) => void,
	) => {
		logger.debug("Content extracted, preparing for speech generation", {
			jobId,
			textLength: text.length,
			articleTitle,
			preview: text.substring(0, 100) + "...",
		});

		// Get the job and update it with extracted text
		const job = await getJob(jobId);
		if (!job) {
			throw new Error(`Job ${jobId} not found`);
		}

		// Update job with extracted text and article title, and change status to processing
		await updateJob(jobId, {
			text,
			tabInfo: {
				...job.tabInfo,
				articleTitle,
			},
			status: "processing",
			message: "Preparing speech generation request...",
		});

		// Update badge to reflect new processing job
		await updateExtensionBadge();

		try {
			await generateSpeechWithTimeout(jobId);
			sendResponse({ success: true });
		} catch (error) {
			throw error;
		}
	},
	"handleContentExtracted",
);

const handleContentExtractedForReview = withAsyncLogging(
	async (
		jobId: string,
		text: string,
		articleTitle: string,
		sendResponse: (response?: any) => void,
	) => {
		logger.debug("Content extracted for review, showing modal in page", {
			jobId,
			textLength: text.length,
			articleTitle,
			preview: text.substring(0, 100) + "...",
		});

		// Get the job and update it with extracted text
		const job = await getJob(jobId);
		if (!job) {
			throw new Error(`Job ${jobId} not found`);
		}

		// Update job with extracted text and article title
		await updateJob(jobId, {
			text,
			tabInfo: {
				...job.tabInfo,
				articleTitle,
			},
			message: "Text extracted. Please review in the page modal.",
		});

		try {
			// Inject modal content script into the tab
			logger.debug("Injecting modal content script", {
				tabId: job.tabId,
				jobId,
			});
			await chrome.scripting.executeScript({
				target: { tabId: job.tabId },
				files: ["modal-content.js"],
			});

			// Send message to content script to show the modal
			logger.debug("Sending SHOW_TEXT_PREVIEW_MODAL message to content script");
			await chrome.tabs.sendMessage(job.tabId, {
				type: "SHOW_TEXT_PREVIEW_MODAL",
				job: {
					id: job.id,
					text: text,
					tabInfo: {
						...job.tabInfo,
						articleTitle,
					},
				},
			});

			logger.debug("Modal shown successfully");
			sendResponse({ success: true });
		} catch (error) {
			logger.error("Failed to show modal", error);
			// Update job status to error
			await updateJob(jobId, {
				status: "error",
				message: "Failed to show text review modal. Please try again.",
			});
			throw error;
		}
	},
	"handleContentExtractedForReview",
);

const handleModalConfirmed = withAsyncLogging(
	async (
		jobId: string,
		userText: string,
		selectedPromptId: string | undefined,
		sendResponse: (response?: any) => void,
	) => {
		logger.debug("User confirmed text for TTS from modal", {
			jobId,
			textLength: userText.length,
			selectedPromptId,
			preview: userText.substring(0, 100) + "...",
		});

		// Get the job and update it with user-confirmed text
		const job = await getJob(jobId);
		if (!job) {
			throw new Error(`Job ${jobId} not found`);
		}

		// Update job with user-confirmed text and selected prompt ID, and set status back to processing
		await updateJob(jobId, {
			text: userText,
			status: "processing",
			message: "Starting speech generation...",
			progress: 5,
			// Store selected prompt ID in tabInfo for later use
			tabInfo: {
				...job.tabInfo,
				selectedPromptId,
			},
		});

		// Update badge to reflect new processing job
		await updateExtensionBadge();

		try {
			await generateSpeechWithTimeout(jobId);
			sendResponse({ success: true });
		} catch (error) {
			throw error;
		}
	},
	"handleModalConfirmed",
);

const handleModalCancelled = withAsyncLogging(
	async (jobId: string, sendResponse: (response?: any) => void) => {
		logger.debug("User cancelled text confirmation from modal", { jobId });

		// Remove job completely when cancelled
		await removeJob(jobId);

		// Update badge since job was removed
		await updateExtensionBadge();

		sendResponse({ success: true });
	},
	"handleModalCancelled",
);

const handleJobCancellation = withAsyncLogging(
	async (jobId: string, sendResponse: (response?: any) => void) => {
		logger.debug("Handling job cancellation from popup", { jobId });

		// Get job details for notification
		const job = await getJob(jobId);
		const jobName =
			job?.tabInfo.articleTitle || job?.tabInfo.title || "audio file";

		// Update job status
		await updateJob(jobId, {
			status: "error",
			message: "Cancelled by user",
		});

		// Update badge since job is no longer active
		await updateExtensionBadge();

		// Send cancellation notification
		showNotification({
			type: "basic",
			iconUrl: chrome.runtime.getURL("icon/128.png"),
			title: "Listen Later - Cancelled",
			message: `Audio generation cancelled: ${jobName}`,
		});

		sendResponse({ success: true });
	},
	"handleJobCancellation",
);

const handleContentError = withAsyncLogging(
	async (
		jobId: string,
		error: string,
		sendResponse: (response?: any) => void,
	) => {
		logger.debug("Content extraction error received", { jobId, error });

		const sanitizedMessage = sanitizeErrorMessage(new Error(error));

		// Update the specific job's status to error
		await updateJob(jobId, {
			status: "error",
			message: sanitizedMessage,
		});

		// Update badge since job is no longer processing
		await updateExtensionBadge();

		sendResponse({ success: false, error: sanitizedMessage });
	},
	"handleContentError",
);

const generateSpeechWithTimeout = withAsyncLogging(async (jobId: string) => {
	const TIMEOUT_MS = 45 * 60 * 1000; // 45 minutes

	const timeoutPromise = new Promise<never>((_, reject) => {
		setTimeout(() => {
			reject(
				new Error(
					`Speech generation timed out after 45 minutes. This may happen with very long articles. You can try again or break the content into smaller parts.`,
				),
			);
		}, TIMEOUT_MS);
	});

	try {
		await Promise.race([generateSpeech(jobId), timeoutPromise]);
	} catch (error) {
		// Update job status on timeout or other errors
		const errorMessage =
			error instanceof Error ? error.message : "Speech generation failed";
		await updateJob(jobId, {
			status: "error",
			message: errorMessage,
		});

		// Update badge since job is no longer active
		await updateExtensionBadge();

		// Send error notification
		showNotification({
			type: "basic",
			iconUrl: chrome.runtime.getURL("icon/128.png"),
			title: "Listen Later - Error",
			message: `Speech generation failed: ${errorMessage}`,
		});

		throw error;
	}
}, "generateSpeechWithTimeout");

const generateSpeech = withAsyncLogging(async (jobId: string) => {
	// Get the job data
	const job = await getJob(jobId);
	if (!job || !job.text) {
		throw new Error(`Job ${jobId} not found or missing text`);
	}

	logger.debug("Starting speech generation", {
		jobId,
		textLength: job.text.length,
		filename: job.filename,
	});

	// Get user options
	logger.debug("Loading extension options");
	const options = await getExtensionOptions();
	logger.debug("Extension options loaded", {
		hasApiKey: !!options?.apiKey,
		modelName: options?.modelName,
		voice: options?.voice,
	});

	if (!options || !options.apiKey) {
		throw new Error(
			"API key not configured. Please set up your options first.",
		);
	}

	// Update job status for API call preparation
	await updateJob(jobId, {
		message: "Preparing speech generation request...",
		progress: 8,
	});

	// Get the speech style prompt to use
	const selectedPromptId = job.tabInfo.selectedPromptId || options.defaultPromptId || "documentary";
	const selectedPrompt = await getSpeechStylePromptById(selectedPromptId);
	
	// Fallback to documentary style if prompt not found
	const promptTemplate = selectedPrompt?.template || 
		"Narrate the following text in a professional, authoritative, and well-paced documentary style: ${content}";
	const promptPrefixTokens = estimateTokenCount(
		promptTemplate.replace(/\$\{content\}/g, ""),
	);
	const CONTEXT_TOKEN_LIMIT = 32000;
	const TARGET_CHUNK_TOKENS = 30000;
	const TOKEN_SAFETY_MARGIN = 2000;
	const MAX_AUDIO_WORDS_PER_CHUNK = 600;
	const WORDS_TO_TOKENS_MULTIPLIER = 1.3;
	const AUDIO_DURATION_TOKEN_LIMIT = Math.floor(
		MAX_AUDIO_WORDS_PER_CHUNK * WORDS_TO_TOKENS_MULTIPLIER,
	);
	const chunkTokenBudget = Math.max(
		500,
		Math.min(
			TARGET_CHUNK_TOKENS,
			CONTEXT_TOKEN_LIMIT - promptPrefixTokens - TOKEN_SAFETY_MARGIN,
			AUDIO_DURATION_TOKEN_LIMIT,
		),
	);

	logger.debug("Calculated chunk budget", {
		chunkTokenBudget,
		promptPrefixTokens,
		contextLimit: CONTEXT_TOKEN_LIMIT,
		tokenSafetyMargin: TOKEN_SAFETY_MARGIN,
		maxAudioWordsPerChunk: MAX_AUDIO_WORDS_PER_CHUNK,
		audioTokenCeiling: AUDIO_DURATION_TOKEN_LIMIT,
	});

	const textChunks = splitTextIntoChunks(job.text, chunkTokenBudget);
	if (textChunks.length === 0) {
		throw new Error(
			"The extracted article text is empty. Please refresh the page and try again.",
		);
	}

	const chunkCount = textChunks.length;

	logger.debug("Using speech style prompt", {
		jobId,
		selectedPromptId,
		promptName: selectedPrompt?.name || "Default Documentary",
		chunkCount,
		chunkTokenBudget,
		promptPrefixTokens,
	});

	// Prepare API endpoint
	const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${options.modelName}:generateContent`;

	const totalWordCount = getWordCount(job.text);
	const totalTimeEstimate = getTimeEstimateLabel(totalWordCount);
	const rateLimiter = createRateLimiter({
		maxRequestsPerMinute: TTS_API_MAX_REQUESTS_PER_MINUTE,
		maxTokensPerMinute: TTS_API_MAX_TOKENS_PER_MINUTE,
	});

	let completedChunks = 0;

	const chunkResults = await Promise.all(
		textChunks.map(async (rawChunk, index) => {
			const chunkPromptText = substituteSpeechStyleTemplate(
				promptTemplate,
				rawChunk,
			);
			const chunkWordCount = getWordCount(rawChunk);
			const chunkLabel =
				chunkCount === 1
					? `AI is generating speech (~${totalWordCount} words, estimated ${totalTimeEstimate})...`
					: `Generating speech chunk ${index + 1}/${chunkCount} (~${chunkWordCount} words, est. ${getTimeEstimateLabel(chunkWordCount)})...`;
			const chunkTokenEstimate = Math.max(
				1,
				estimateTokenCount(chunkPromptText) + TTS_API_TOKEN_OVERHEAD,
			);
			const requestBody = buildGeminiRequestBody(chunkPromptText, options.voice);

			await updateJob(jobId, {
				message: chunkLabel,
			});

			let throttleNotified = false;
			const audioData = await rateLimiter.schedule(
				() =>
					fetchSpeechChunk({
						apiKey: options.apiKey,
						chunkCount,
						chunkIndex: index,
						chunkTextLength: chunkPromptText.length,
						chunkWordCount,
						endpoint,
						jobId,
						modelName: options.modelName,
						requestBody,
						selectedPromptId,
						promptName: selectedPrompt?.name,
						voice: options.voice,
					}),
				chunkTokenEstimate,
				{
					onThrottle: async (waitMs) => {
						if (throttleNotified) {
							return;
						}
						throttleNotified = true;
						const waitSeconds = Math.ceil(waitMs / 1000);
						const throttleLabel =
							chunkCount === 1
								? "generating speech"
								: `chunk ${index + 1}/${chunkCount}`;
						await updateJob(jobId, {
							message: `Waiting ~${waitSeconds}s before ${throttleLabel} to respect TTS API limits...`,
						});
					},
				},
			);

			completedChunks += 1;
			const chunkProgress = 10 + Math.floor((completedChunks / chunkCount) * 60);

			await updateJob(jobId, {
				message:
					chunkCount === 1
						? "Speech chunk generated successfully."
						: `Chunk ${index + 1}/${chunkCount} generated (${completedChunks}/${chunkCount} ready).`,
				progress: chunkProgress,
			});

			return {
				index,
				audioData,
			};
		}),
	);

	const audioChunks = chunkResults
		.sort((a, b) => a.index - b.index)
		.map((result) => result.audioData);

	// Update progress after receiving API responses
	await updateJob(jobId, {
		message: "Speech generated successfully - processing audio...",
		progress: 85,
	});

	// Convert base64 to blob and download
	logger.debug("Starting audio download", {
		jobId,
		chunkCount,
		filename: job.filename,
	});

	// Update job status for download
	await updateJob(jobId, {
		message: "Preparing audio file for download...",
		progress: 95,
	});

	await downloadAudio(jobId, audioChunks);

	// Update job to success status
	await updateJob(jobId, {
		status: "success",
		message: "Speech generated and downloaded successfully!",
		progress: 100,
	});

	// Update badge since job is no longer active
	await updateExtensionBadge();

	logger.debug("Speech generation completed successfully", { jobId });

	// Send success notification
	showNotification({
		type: "basic",
		iconUrl: chrome.runtime.getURL("icon/128.png"),
		title: "Listen Later",
		message: `Audio generated successfully: ${job.filename || "audio file"}`,
	});
}, "generateSpeech");

const WORD_COUNT_REGEX = /\s+/;

const getWordCount = (text: string): number => {
	const trimmed = text.trim();
	if (!trimmed) {
		return 0;
	}

	return trimmed.split(WORD_COUNT_REGEX).filter(Boolean).length;
};

const getTimeEstimateLabel = (wordCount: number): string => {
	if (wordCount > 1500) {
		return "3 to 8 minutes";
	}
	if (wordCount > 500) {
		return "1 to 4 minutes";
	}
	return "30 seconds to 2 minutes";
};

const buildGeminiRequestBody = (text: string, voiceName: string | undefined) => ({
	contents: [
		{
			parts: [
				{
					text,
				},
			],
		},
	],
	generationConfig: {
		responseModalities: ["AUDIO"],
		speechConfig: {
			voiceConfig: {
				prebuiltVoiceConfig: {
					voiceName,
				},
			},
		},
	},
});

type FetchSpeechChunkParams = {
	apiKey: string;
	chunkCount: number;
	chunkIndex: number;
	chunkTextLength: number;
	chunkWordCount: number;
	endpoint: string;
	jobId: string;
	modelName?: string;
	promptName?: string;
	requestBody: Record<string, unknown>;
	selectedPromptId?: string;
	voice?: string;
};

const buildApiErrorMessage = (response: Response, errorData: any): string => {
	let errorMessage = `API error: ${response.status} ${response.statusText}`;
	if (response.status === 401) {
		errorMessage =
			"API key is invalid or expired. Please check your API key in settings.";
	} else if (response.status === 403) {
		errorMessage =
			"API access forbidden. Please verify your API key permissions.";
	} else if (response.status === 429) {
		errorMessage =
			"API rate limit exceeded. Please wait a few minutes and try again.";
	} else if (response.status === 400) {
		errorMessage =
			"Invalid request sent to API. The content might be too long or contain unsupported characters.";
	} else if (response.status >= 500) {
		errorMessage =
			"Gemini API is currently experiencing issues. Please try again later.";
	} else if (errorData?.error?.message) {
		errorMessage = `API error: ${errorData.error.message}`;
	}

	return errorMessage;
};

const CHUNK_FETCH_TIMEOUT_MS = 6 * 60 * 1000;
const CHUNK_HEARTBEAT_INTERVAL_MS = 60 * 1000;

const fetchSpeechChunk = withAsyncLogging(
	async ({
		apiKey,
		chunkCount,
		chunkIndex,
		chunkTextLength,
		chunkWordCount,
		endpoint,
		jobId,
		modelName,
		promptName,
		requestBody,
		selectedPromptId,
		voice,
	}: FetchSpeechChunkParams) => {
		const chunkLabel = `chunk ${chunkIndex + 1}/${chunkCount}`;
		logger.debug("Sending API request", {
			jobId,
			chunkIndex: chunkIndex + 1,
			chunkCount,
			chunkTextLength,
			chunkWordCount,
		});

		logger.background.api(endpoint, undefined, {
			jobId,
			modelName,
			voice,
			chunkIndex: chunkIndex + 1,
			chunkCount,
			chunkTextLength,
			selectedPromptId,
			promptName,
		});

		let response: Response;
		const abortController = new AbortController();
		const timeoutId = setTimeout(() => {
			abortController.abort();
		}, CHUNK_FETCH_TIMEOUT_MS);
		const heartbeatId = setInterval(() => {
			updateJob(jobId, {
				message: `Still generating speech ${chunkLabel} (~${chunkWordCount} words, ${getTimeEstimateLabel(chunkWordCount)} remaining)...`,
			})
				.catch((error) =>
					logger.error("Failed to update chunk heartbeat", {
						jobId,
						chunkIndex: chunkIndex + 1,
						error,
					}),
				);
		}, CHUNK_HEARTBEAT_INTERVAL_MS);
		try {
			response = await fetch(endpoint, {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					"x-goog-api-key": apiKey,
				},
				body: JSON.stringify(requestBody),
				signal: abortController.signal,
			});
		} catch (error) {
			clearTimeout(timeoutId);
			clearInterval(heartbeatId);
			if (error instanceof DOMException && error.name === "AbortError") {
				logger.error("API request timed out", { jobId, chunkIndex, chunkCount });
				throw new Error(
					"Gemini took too long to respond for this chunk. We stopped waiting after 6 minutes to keep the extension responsive. Please try again or shorten the article.",
				);
			}
			logger.error("Network error during API call", { jobId, chunkIndex, error });
			throw new Error(
				"Network error occurred. Please check your internet connection and try again.",
			);
		}
		clearTimeout(timeoutId);
		clearInterval(heartbeatId);

		logger.background.api(endpoint, response.status);

		if (!response.ok) {
			let errorData: any = {};
			try {
				errorData = await response.json();
			} catch {
				// Ignore JSON parse failures for error payloads
			}

			logger.error("API request failed", {
				jobId,
				chunkIndex,
				chunkCount,
				status: response.status,
				statusText: response.statusText,
				errorData,
			});

			throw new Error(buildApiErrorMessage(response, errorData));
		}

		let data: any;
		try {
			data = await response.json();
		} catch (error) {
			logger.error("Failed to parse API response JSON", { jobId, chunkIndex, error });
			throw new Error(
				"Received invalid response from Gemini API. Please try again.",
			);
		}

		const audioData = data.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;

		if (!audioData) {
			logger.error("No audio data in API response", { jobId, chunkIndex, data });
			throw new Error("No audio data received from Gemini API");
		}

		return audioData;
	},
	"fetchSpeechChunk",
);

const downloadAudio = withAsyncLogging(
	async (jobId: string, base64Data: string | string[]) => {
		// Get the job to access the filename
		const job = await getJob(jobId);
		if (!job) {
			throw new Error(`Job ${jobId} not found`);
		}

		const audioChunks = Array.isArray(base64Data) ? base64Data : [base64Data];
		if (audioChunks.length === 0) {
			throw new Error("No audio data available for download");
		}

		logger.debug("Converting base64 PCM data to MP3 file", {
			jobId,
			chunkCount: audioChunks.length,
			filename: job.filename,
		});

		// Convert base64 chunks to Uint8Array buffers and merge them
		const pcmBuffers = audioChunks.map((chunk, index) => {
			const buffer = base64ToUint8Array(chunk);
			logger.debug("PCM chunk decoded", {
				jobId,
				chunkIndex: index + 1,
				pcmChunkLength: buffer.length,
			});
			return buffer;
		});
		const combinedPcmBuffer = concatenateUint8Arrays(pcmBuffers);
		logger.debug("Combined PCM buffer created", {
			jobId,
			totalPcmLength: combinedPcmBuffer.length,
		});

		// Create MP3 file using lamejs encoding
		const mp3Buffer = await createMp3File(combinedPcmBuffer, {
			channels: 1, // Mono audio
			sampleRate: 24000, // 24kHz sample rate (Gemini's output)
			bitDepth: 16, // 16-bit depth
		});

		// Convert MP3 buffer to data URL
		const dataUrl = `data:audio/mpeg;base64,${uint8ArrayToBase64(mp3Buffer)}`;
		logger.debug("MP3 file created", {
			mp3BufferLength: mp3Buffer.length,
		});

		// Use the filename from the job (already includes smart title/domain logic)
		const filename = job.filename!;
		logger.debug("Using job filename", { jobId, filename });

		// Download using chrome.downloads API with data URL
		logger.debug("Starting download", { jobId, filename });
		const downloadId = await chrome.downloads.download({
			url: dataUrl,
			filename: filename,
			saveAs: false,
		});
		logger.debug("Download initiated", { jobId, downloadId, filename });
	},
	"downloadAudio",
);

// Browser-compatible helper function to create MP3 file from PCM data using lamejs
const createMp3File = (
	pcmData: Uint8Array,
	options: { channels: number; sampleRate: number; bitDepth: number },
): Promise<Uint8Array> => {
	return new Promise((resolve) => {
		const { channels, sampleRate } = options;
		
		// Initialize MP3 encoder (mono, sample rate, 128kbps bitrate)
		const mp3encoder = new lamejs.Mp3Encoder(channels, sampleRate, 128);
		
		// Convert Uint8Array to Int16Array (lamejs expects 16-bit samples)
		const int16Samples = new Int16Array(pcmData.length / 2);
		for (let i = 0; i < int16Samples.length; i++) {
			// Convert two bytes to signed 16-bit integer (little-endian)
			int16Samples[i] = (pcmData[i * 2 + 1] << 8) | pcmData[i * 2];
		}
		
		// Encode audio in chunks for better performance with large files
		const mp3Data: Uint8Array[] = [];
		const chunkSize = 1152; // MP3 frame size
		
		for (let i = 0; i < int16Samples.length; i += chunkSize) {
			const chunk = int16Samples.slice(i, i + chunkSize);
			const mp3buf = mp3encoder.encodeBuffer(chunk);
			if (mp3buf.length > 0) {
				mp3Data.push(mp3buf);
			}
		}
		
		// Flush the encoder
		const mp3buf = mp3encoder.flush();
		if (mp3buf.length > 0) {
			mp3Data.push(mp3buf);
		}
		
		// Combine all MP3 chunks into single buffer
		let totalLength = 0;
		for (const chunk of mp3Data) {
			totalLength += chunk.length;
		}
		
		const finalMp3Buffer = new Uint8Array(totalLength);
		let offset = 0;
		for (const chunk of mp3Data) {
			finalMp3Buffer.set(chunk, offset);
			offset += chunk.length;
		}
		
		resolve(finalMp3Buffer);
	});
};

// Notification helper function
const showNotification = (
	options: chrome.notifications.NotificationOptions & { type: "basic" },
) => {
	const notificationId = `listen-later-${Date.now()}`;

	chrome.notifications.create(notificationId, options, (notificationId) => {
		if (chrome.runtime.lastError) {
			const errorMessage =
				chrome.runtime.lastError.message || "Unknown notification error";
			logger.error("Failed to show notification", {
				error: errorMessage,
				notificationId,
				options: { title: options.title, message: options.message },
			});
		} else {
			logger.debug("Notification shown", { notificationId });
		}
	});

	// Auto-clear notification after 10 seconds
	setTimeout(() => {
		chrome.notifications.clear(notificationId);
	}, 10000);
};

// Badge management function
const updateExtensionBadge = async () => {
	try {
		const state = await getExtensionState();
		const activeJobCount = state.activeJobs.filter(
			(job) => job.status === "processing",
		).length;

		if (activeJobCount > 0) {
			await chrome.action.setBadgeText({ text: activeJobCount.toString() });
			await chrome.action.setBadgeBackgroundColor({ color: "#4285f4" });
		} else {
			await chrome.action.setBadgeText({ text: "" });
		}

		logger.debug("Extension badge updated", { activeJobCount });
	} catch (error) {
		logger.error("Failed to update extension badge", error);
	}
};
