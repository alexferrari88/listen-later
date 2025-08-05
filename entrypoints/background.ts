import { getExtensionOptions, setExtensionState, sanitizeErrorMessage } from "../lib/storage";
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
				await handleStartTTS(sendResponse);
				break;
			case "CONTENT_EXTRACTED":
				logger.debug("Handling CONTENT_EXTRACTED message", {
					textLength: message.text?.length,
					title: message.title
				});
				await handleContentExtracted(message.text, sendResponse);
				break;
			case "CONTENT_ERROR":
				logger.debug("Handling CONTENT_ERROR message", { error: message.error });
				await handleContentError(message.error, sendResponse);
				break;
			default:
				logger.warn("Unknown message type:", message.type);
				sendResponse({ success: false, error: "Unknown message type" });
		}
	} catch (error) {
		logger.error("Error handling message:", error);
		const sanitizedMessage = sanitizeErrorMessage(error);
		await setExtensionState({
			status: "error",
			message: sanitizedMessage,
		});
		sendResponse({
			success: false,
			error: sanitizedMessage,
		});
	}
}, 'handleMessage');

const handleStartTTS = withAsyncLogging(async (sendResponse: (response?: any) => void) => {
	logger.debug("Starting TTS process");
	
	// Update state to processing
	const initialState = {
		status: "processing" as const,
		message: "Initializing content extraction...",
	};
	logger.background.state(initialState);
	await setExtensionState(initialState);

	// Get active tab
	logger.debug("Querying for active tab");
	const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
	logger.debug("Active tab found", {
		id: tab?.id,
		url: tab?.url,
		title: tab?.title
	});

	if (!tab?.id) {
		throw new Error("No active tab found");
	}

	// Inject Readability.js first, then content script
	try {
		// Update status for Readability injection
		await setExtensionState({
			status: "processing",
			message: "Loading page analysis tools...",
		});
		
		logger.background.injection("Starting Readability.js injection", { tabId: tab.id });
		// First inject Readability.js into isolated world
		await chrome.scripting.executeScript({
			target: { tabId: tab.id },
			files: ["lib/readability.js"],
		});
		logger.background.injection("Readability.js injected successfully");

		// Update status for content script injection
		await setExtensionState({
			status: "processing",
			message: "Analyzing page content...",
		});

		logger.background.injection("Starting content script injection", { tabId: tab.id });
		// Then inject content script (which can now use Readability and Chrome APIs)
		await chrome.scripting.executeScript({
			target: { tabId: tab.id },
			files: ["content.js"],
		});
		logger.background.injection("Content script injected successfully");

		sendResponse({ success: true });
	} catch (error) {
		logger.background.injection("Injection failed", error);
		throw new Error(
			`Failed to inject content script: ${error instanceof Error ? error.message : "Unknown error"}`,
		);
	}
}, 'handleStartTTS');

const handleContentExtracted = withAsyncLogging(async (
	text: string,
	sendResponse: (response?: any) => void,
) => {
	logger.debug("Content extracted, preparing for speech generation", {
		textLength: text.length,
		preview: text.substring(0, 100) + '...'
	});
	
	const processingState = {
		status: "processing" as const,
		message: "Preparing speech generation request...",
	};
	logger.background.state(processingState);
	await setExtensionState(processingState);

	try {
		await generateSpeech(text);
		sendResponse({ success: true });
	} catch (error) {
		throw error;
	}
}, 'handleContentExtracted');

const handleContentError = withAsyncLogging(async (
	error: string,
	sendResponse: (response?: any) => void,
) => {
	logger.debug("Content extraction error received", { error });
	
	const sanitizedMessage = sanitizeErrorMessage(new Error(error));
	const errorState = {
		status: "error" as const,
		message: sanitizedMessage,
	};
	logger.background.state(errorState);
	await setExtensionState(errorState);
	sendResponse({ success: false, error: sanitizedMessage });
}, 'handleContentError');

const generateSpeech = withAsyncLogging(async (text: string) => {
	logger.debug("Starting speech generation", { textLength: text.length });
	
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

	// Update status for API call
	await setExtensionState({
		status: "processing",
		message: "Sending text to AI for speech generation...",
	});

	// Make API call to Gemini
	const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${options.modelName}:generateContent`;
	logger.background.api(endpoint, undefined, {
		modelName: options.modelName,
		voice: options.voice,
		textLength: text.length
	});
	
	const requestBody = {
		contents: [
			{
				parts: [
					{
						text: `Please read the following text aloud: ${text}`,
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
	
	// Update status during API call
	await setExtensionState({
		status: "processing",
		message: "AI is generating speech - this may take 30-60 seconds...",
	});
	
	const response = await fetch(endpoint, {
		method: "POST",
		headers: {
			"Content-Type": "application/json",
			"x-goog-api-key": options.apiKey,
		},
		body: JSON.stringify(requestBody),
	});

	logger.background.api(endpoint, response.status);
	
	if (!response.ok) {
		const errorData = await response.json().catch(() => ({}));
		logger.error("API request failed", {
			status: response.status,
			statusText: response.statusText,
			errorData
		});
		throw new Error(
			`API error: ${response.status} ${response.statusText}. ${errorData.error?.message || ""}`,
		);
	}

	const data = await response.json();
	logger.debug("API response received", {
		hasCandidates: !!data.candidates,
		candidateCount: data.candidates?.length || 0,
		hasAudioData: !!data.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data
	});
	
	const audioData = data.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;

	if (!audioData) {
		logger.error("No audio data in API response", data);
		throw new Error("No audio data received from Gemini API");
	}

	// Convert base64 to blob and download
	logger.debug("Starting audio download", { audioDataLength: audioData.length });
	
	// Update status for download
	await setExtensionState({
		status: "processing",
		message: "Preparing audio file for download...",
	});
	
	await downloadAudio(audioData);

	const successState = {
		status: "success" as const,
		message: "Speech generated and downloaded successfully!",
	};
	logger.background.state(successState);
	await setExtensionState(successState);
}, 'generateSpeech');

const downloadAudio = withAsyncLogging(async (base64Data: string) => {
	logger.debug("Converting base64 to binary", { dataLength: base64Data.length });
	
	// Decode base64 to binary
	const binaryString = atob(base64Data);
	const bytes = new Uint8Array(binaryString.length);
	for (let i = 0; i < binaryString.length; i++) {
		bytes[i] = binaryString.charCodeAt(i);
	}
	logger.debug("Binary conversion complete", { byteLength: bytes.length });

	// Create blob and object URL
	const blob = new Blob([bytes], { type: "audio/wav" });
	const url = URL.createObjectURL(blob);
	logger.debug("Blob created", { size: blob.size, type: blob.type });

	// Generate filename with timestamp
	const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
	const filename = `listen-later-${timestamp}.wav`;
	logger.debug("Generated filename", { filename });

	// Download using chrome.downloads API
	logger.debug("Starting download", { filename, url });
	const downloadId = await chrome.downloads.download({
		url: url,
		filename: filename,
		saveAs: false,
	});
	logger.debug("Download initiated", { downloadId });

	// Clean up object URL
	URL.revokeObjectURL(url);
	logger.debug("Object URL cleaned up");
}, 'downloadAudio');
