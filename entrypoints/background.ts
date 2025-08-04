import { getExtensionOptions, setExtensionState, sanitizeErrorMessage } from "../lib/storage";

export default defineBackground(() => {
	console.log("Background script initialized");

	// Main message listener
	chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
		handleMessage(message, sender, sendResponse);
		return true; // Keep the message channel open for async responses
	});
});

async function handleMessage(
	message: any,
	sender: chrome.runtime.MessageSender,
	sendResponse: (response?: any) => void,
) {
	try {
		switch (message.type) {
			case "START_TTS":
				await handleStartTTS(sendResponse);
				break;
			case "CONTENT_EXTRACTED":
				await handleContentExtracted(message.text, sendResponse);
				break;
			case "CONTENT_ERROR":
				await handleContentError(message.error, sendResponse);
				break;
			default:
				console.warn("Unknown message type:", message.type);
				sendResponse({ success: false, error: "Unknown message type" });
		}
	} catch (error) {
		console.error("Error handling message:", error);
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
}

async function handleStartTTS(sendResponse: (response?: any) => void) {
	// Update state to processing
	await setExtensionState({
		status: "processing",
		message: "Starting content extraction...",
	});

	// Get active tab
	const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

	if (!tab?.id) {
		throw new Error("No active tab found");
	}

	// Inject Readability.js first, then content script
	try {
		// First inject Readability.js
		await chrome.scripting.executeScript({
			target: { tabId: tab.id },
			files: ["lib/readability.js"],
			world: "MAIN",
		});

		// Then inject content script (which can now use window.Readability)
		await chrome.scripting.executeScript({
			target: { tabId: tab.id },
			files: ["content.js"],
			world: "MAIN",
		});

		sendResponse({ success: true });
	} catch (error) {
		throw new Error(
			`Failed to inject content script: ${error instanceof Error ? error.message : "Unknown error"}`,
		);
	}
}

async function handleContentExtracted(
	text: string,
	sendResponse: (response?: any) => void,
) {
	await setExtensionState({
		status: "processing",
		message: "Generating speech...",
	});

	try {
		await generateSpeech(text);
		sendResponse({ success: true });
	} catch (error) {
		throw error;
	}
}

async function handleContentError(
	error: string,
	sendResponse: (response?: any) => void,
) {
	const sanitizedMessage = sanitizeErrorMessage(new Error(error));
	await setExtensionState({
		status: "error",
		message: sanitizedMessage,
	});
	sendResponse({ success: false, error: sanitizedMessage });
}

async function generateSpeech(text: string) {
	// Get user options
	const options = await getExtensionOptions();

	if (!options || !options.apiKey) {
		throw new Error(
			"API key not configured. Please set up your options first.",
		);
	}

	// Make API call to Gemini
	const response = await fetch(
		`https://generativelanguage.googleapis.com/v1beta/models/${options.modelName}:generateContent`,
		{
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				"x-goog-api-key": options.apiKey,
			},
			body: JSON.stringify({
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
			}),
		},
	);

	if (!response.ok) {
		const errorData = await response.json().catch(() => ({}));
		throw new Error(
			`API error: ${response.status} ${response.statusText}. ${errorData.error?.message || ""}`,
		);
	}

	const data = await response.json();
	const audioData = data.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;

	if (!audioData) {
		throw new Error("No audio data received from Gemini API");
	}

	// Convert base64 to blob and download
	await downloadAudio(audioData);

	await setExtensionState({
		status: "success",
		message: "Speech generated and downloaded successfully!",
	});
}

async function downloadAudio(base64Data: string) {
	// Decode base64 to binary
	const binaryString = atob(base64Data);
	const bytes = new Uint8Array(binaryString.length);
	for (let i = 0; i < binaryString.length; i++) {
		bytes[i] = binaryString.charCodeAt(i);
	}

	// Create blob and object URL
	const blob = new Blob([bytes], { type: "audio/wav" });
	const url = URL.createObjectURL(blob);

	// Generate filename with timestamp
	const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
	const filename = `listen-later-${timestamp}.wav`;

	// Download using chrome.downloads API
	await chrome.downloads.download({
		url: url,
		filename: filename,
		saveAs: false,
	});

	// Clean up object URL
	URL.revokeObjectURL(url);
}
