import { 
	getExtensionOptions, 
	sanitizeErrorMessage,
	createJob,
	updateJob,
	getJob,
	canStartNewJob,
	cleanupOldJobs,
	type ProcessingJob 
} from "../lib/storage";
import { logger, withAsyncLogging } from "../lib/logger";

export default defineBackground(() => {
	logger.info("Background script initialized");
	logger.debug("Environment mode:", import.meta.env.MODE);

	// Open options page on install
	chrome.runtime.onInstalled.addListener((details) => {
		logger.debug("Extension installed/updated", { reason: details.reason });
		if (details.reason === "install") {
			logger.info("Opening options page on first install");
			chrome.runtime.openOptionsPage();
		}
	});

	// Periodic cleanup of old jobs
	setInterval(async () => {
		try {
			await cleanupOldJobs();
		} catch (error) {
			logger.error("Failed to cleanup old jobs", error);
		}
	}, 60000); // Run every minute

	// Main message listener
	chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
		logger.background.message(message.type, { 
			message, 
			sender: {
				tab: sender.tab?.id,
				url: sender.tab?.url,
				frameId: sender.frameId
			}
		});
		handleMessage(message, sender, sendResponse);
		return true; // Keep the message channel open for async responses
	});
});

const handleMessage = withAsyncLogging(async (
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
					title: message.title
				});
				await handleContentExtracted(message.jobId, message.text, message.title, sendResponse);
				break;
			case "CONTENT_EXTRACTED_FOR_REVIEW":
				logger.debug("Handling CONTENT_EXTRACTED_FOR_REVIEW message", {
					jobId: message.jobId,
					textLength: message.text?.length,
					title: message.title
				});
				await handleContentExtractedForReview(message.jobId, message.text, message.title, sendResponse);
				break;
			case "MODAL_CONFIRMED":
				logger.debug("Handling MODAL_CONFIRMED message", {
					jobId: message.jobId,
					textLength: message.text?.length
				});
				await handleModalConfirmed(message.jobId, message.text, sendResponse);
				break;
			case "MODAL_CANCELLED":
				logger.debug("Handling MODAL_CANCELLED message", {
					jobId: message.jobId
				});
				await handleModalCancelled(message.jobId, sendResponse);
				break;
			case "CONTENT_ERROR":
				logger.debug("Handling CONTENT_ERROR message", { 
					jobId: message.jobId,
					error: message.error 
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
}, 'handleMessage');

const handleStartTTS = withAsyncLogging(async (tab: chrome.tabs.Tab | undefined, sendResponse: (response?: any) => void) => {
	logger.debug("Starting TTS process");
	
	// Check if we can start a new job
	if (!(await canStartNewJob())) {
		throw new Error("Maximum concurrent jobs (3) already running. Please wait for one to complete.");
	}

	// Use provided tab or get active tab
	let targetTab = tab;
	if (!targetTab) {
		logger.debug("No tab provided, querying for active tab");
		const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
		targetTab = activeTab;
	}

	logger.debug("Target tab found", {
		id: targetTab?.id,
		url: targetTab?.url,
		title: targetTab?.title
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

	logger.debug("Created job for TTS process", { jobId: job.id, tabId: targetTab.id });

	// Inject Readability.js first, then content script
	try {
		// Update job status for Readability injection
		await updateJob(job.id, {
			message: "Loading page analysis tools...",
		});
		
		logger.background.injection("Starting Readability.js injection", { tabId: targetTab.id, jobId: job.id });
		// First inject Readability.js into isolated world
		await chrome.scripting.executeScript({
			target: { tabId: targetTab.id },
			files: ["lib/readability.js"],
		});
		logger.background.injection("Readability.js injected successfully");

		// Update job status for content script injection
		await updateJob(job.id, {
			message: "Analyzing page content...",
		});

		logger.background.injection("Starting content script injection", { tabId: targetTab.id, jobId: job.id });
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
				errorMessage = "Cannot access this page. Try a different page or check if it's a restricted site.";
			} else if (error.message.includes("tab")) {
				errorMessage = "Tab was closed or is no longer available. Please try again.";
			} else if (error.message.includes("frame")) {
				errorMessage = "Cannot inject script into this page frame. Try refreshing the page.";
			}
		}
		
		// Update job status to error with specific message
		await updateJob(job.id, {
			status: "error",
			message: errorMessage,
		});
		
		throw new Error(errorMessage);
	}
}, 'handleStartTTS');

const handleContentExtracted = withAsyncLogging(async (
	jobId: string,
	text: string,
	articleTitle: string,
	sendResponse: (response?: any) => void,
) => {
	logger.debug("Content extracted, preparing for speech generation", {
		jobId,
		textLength: text.length,
		articleTitle,
		preview: text.substring(0, 100) + '...'
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
		message: "Preparing speech generation request...",
	});

	try {
		await generateSpeechWithTimeout(jobId);
		sendResponse({ success: true });
	} catch (error) {
		throw error;
	}
}, 'handleContentExtracted');

const handleContentExtractedForReview = withAsyncLogging(async (
	jobId: string,
	text: string,
	articleTitle: string,
	sendResponse: (response?: any) => void,
) => {
	logger.debug("Content extracted for review, showing modal in page", {
		jobId,
		textLength: text.length,
		articleTitle,
		preview: text.substring(0, 100) + '...'
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
		logger.debug("Injecting modal content script", { tabId: job.tabId, jobId });
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
}, 'handleContentExtractedForReview');

const handleModalConfirmed = withAsyncLogging(async (
	jobId: string,
	userText: string,
	sendResponse: (response?: any) => void,
) => {
	logger.debug("User confirmed text for TTS from modal", {
		jobId,
		textLength: userText.length,
		preview: userText.substring(0, 100) + '...'
	});
	
	// Get the job and update it with user-confirmed text
	const job = await getJob(jobId);
	if (!job) {
		throw new Error(`Job ${jobId} not found`);
	}

	// Update job with user-confirmed text and set status back to processing
	await updateJob(jobId, {
		text: userText,
		status: "processing",
		message: "Preparing speech generation request...",
	});

	try {
		await generateSpeechWithTimeout(jobId);
		sendResponse({ success: true });
	} catch (error) {
		throw error;
	}
}, 'handleModalConfirmed');

const handleModalCancelled = withAsyncLogging(async (
	jobId: string,
	sendResponse: (response?: any) => void,
) => {
	logger.debug("User cancelled text confirmation from modal", { jobId });
	
	// Update job status to error
	await updateJob(jobId, {
		status: "error",
		message: "Text review cancelled by user",
	});
	
	sendResponse({ success: true });
}, 'handleModalCancelled');

const handleContentError = withAsyncLogging(async (
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
	
	sendResponse({ success: false, error: sanitizedMessage });
}, 'handleContentError');

const generateSpeechWithTimeout = withAsyncLogging(async (jobId: string) => {
	const TIMEOUT_MS = 45 * 60 * 1000; // 45 minutes
	
	const timeoutPromise = new Promise<never>((_, reject) => {
		setTimeout(() => {
			reject(new Error(`Speech generation timed out after 45 minutes. This may happen with very long articles. You can try again or break the content into smaller parts.`));
		}, TIMEOUT_MS);
	});
	
	try {
		await Promise.race([generateSpeech(jobId), timeoutPromise]);
	} catch (error) {
		// Update job status on timeout or other errors
		await updateJob(jobId, {
			status: "error",
			message: error instanceof Error ? error.message : "Speech generation failed",
		});
		throw error;
	}
}, 'generateSpeechWithTimeout');

const generateSpeech = withAsyncLogging(async (jobId: string) => {
	// Get the job data
	const job = await getJob(jobId);
	if (!job || !job.text) {
		throw new Error(`Job ${jobId} not found or missing text`);
	}

	logger.debug("Starting speech generation", { 
		jobId,
		textLength: job.text.length,
		filename: job.filename
	});
	
	// Get user options
	logger.debug("Loading extension options");
	const options = await getExtensionOptions();
	logger.debug("Extension options loaded", {
		hasApiKey: !!options?.apiKey,
		modelName: options?.modelName,
		voice: options?.voice
	});

	if (!options || !options.apiKey) {
		throw new Error(
			"API key not configured. Please set up your options first.",
		);
	}

	// Update job status for API call
	await updateJob(jobId, {
		message: "Sending text to AI for speech generation...",
	});

	// Make API call to Gemini
	const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${options.modelName}:generateContent`;
	logger.background.api(endpoint, undefined, {
		jobId,
		modelName: options.modelName,
		voice: options.voice,
		textLength: job.text.length
	});
	
	const requestBody = {
		contents: [
			{
				parts: [
					{
						text: `Please read the following text aloud: ${job.text}`,
					},
				],
			},
		],
		generationConfig: {
			responseModalities: ["AUDIO"],
			speechConfig: {
				voiceConfig: {
					prebuiltVoiceConfig: {
						voiceName: options.voice,
					},
				},
			},
		},
	};
	logger.debug("Sending API request", { endpoint, requestBody });
	
	// Update job status during API call
	await updateJob(jobId, {
		message: "AI is generating speech - this may take 30-60 seconds...",
	});
	
	let response: Response;
	try {
		response = await fetch(endpoint, {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				"x-goog-api-key": options.apiKey,
			},
			body: JSON.stringify(requestBody),
		});
	} catch (error) {
		logger.error("Network error during API call", { jobId, error });
		throw new Error(
			"Network error occurred. Please check your internet connection and try again."
		);
	}

	logger.background.api(endpoint, response.status);
	
	if (!response.ok) {
		let errorData: any = {};
		try {
			errorData = await response.json();
		} catch {
			// Response body is not JSON, ignore
		}
		
		logger.error("API request failed", {
			jobId,
			status: response.status,
			statusText: response.statusText,
			errorData
		});
		
		// Provide more specific error messages based on status code
		let errorMessage = `API error: ${response.status} ${response.statusText}`;
		if (response.status === 401) {
			errorMessage = "API key is invalid or expired. Please check your API key in settings.";
		} else if (response.status === 403) {
			errorMessage = "API access forbidden. Please verify your API key permissions.";
		} else if (response.status === 429) {
			errorMessage = "API rate limit exceeded. Please wait a few minutes and try again.";
		} else if (response.status === 400) {
			errorMessage = "Invalid request sent to API. The content might be too long or contain unsupported characters.";
		} else if (response.status >= 500) {
			errorMessage = "Gemini API is currently experiencing issues. Please try again later.";
		} else if (errorData.error?.message) {
			errorMessage = `API error: ${errorData.error.message}`;
		}
		
		throw new Error(errorMessage);
	}

	let data: any;
	try {
		data = await response.json();
	} catch (error) {
		logger.error("Failed to parse API response JSON", { jobId, error });
		throw new Error("Received invalid response from Gemini API. Please try again.");
	}
	
	logger.debug("API response received", {
		jobId,
		hasCandidates: !!data.candidates,
		candidateCount: data.candidates?.length || 0,
		hasAudioData: !!data.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data
	});
	
	const audioData = data.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;

	if (!audioData) {
		logger.error("No audio data in API response", { jobId, data });
		throw new Error("No audio data received from Gemini API");
	}

	// Convert base64 to blob and download
	logger.debug("Starting audio download", { 
		jobId,
		audioDataLength: audioData.length,
		filename: job.filename
	});
	
	// Update job status for download
	await updateJob(jobId, {
		message: "Preparing audio file for download...",
	});
	
	await downloadAudio(jobId, audioData);

	// Update job to success status
	await updateJob(jobId, {
		status: "success",
		message: "Speech generated and downloaded successfully!",
	});
	
	logger.debug("Speech generation completed successfully", { jobId });
}, 'generateSpeech');

const downloadAudio = withAsyncLogging(async (jobId: string, base64Data: string) => {
	// Get the job to access the filename
	const job = await getJob(jobId);
	if (!job) {
		throw new Error(`Job ${jobId} not found`);
	}

	logger.debug("Converting base64 to data URL", { 
		jobId,
		dataLength: base64Data.length,
		filename: job.filename
	});
	
	// Create data URL directly from base64 data
	const dataUrl = `data:audio/wav;base64,${base64Data}`;
	logger.debug("Data URL created");

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
}, 'downloadAudio');
