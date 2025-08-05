// Data Models for storage
import { logger } from './logger';

// For extension operational state
export interface ExtensionState {
	status: "idle" | "processing" | "success" | "error";
	message?: string; // For progress updates or error messages
}

// For user-configured settings
export interface ExtensionOptions {
	apiKey: string;
	modelName: string;
	voice: string;
}

// Storage keys
const STORAGE_KEYS = {
	STATE: "extensionState",
	OPTIONS: "extensionOptions",
} as const;

// Helper functions for ExtensionState

export async function getExtensionState(): Promise<ExtensionState> {
	const result = await chrome.storage.local.get(STORAGE_KEYS.STATE);
	return result[STORAGE_KEYS.STATE] || { status: "idle" };
}

export async function setExtensionState(
	state: Partial<ExtensionState>,
): Promise<void> {
	const currentState = await getExtensionState();
	const newState = { ...currentState, ...state };
	logger.debug("Setting extension state", { from: currentState, to: newState });
	await chrome.storage.local.set({ [STORAGE_KEYS.STATE]: newState });
}

export async function resetExtensionState(): Promise<void> {
	logger.debug("Resetting extension state to idle");
	await setExtensionState({ status: "idle", message: undefined });
}

// Helper functions for ExtensionOptions

export async function getExtensionOptions(): Promise<ExtensionOptions | null> {
	const result = await chrome.storage.local.get(STORAGE_KEYS.OPTIONS);
	const stored = result[STORAGE_KEYS.OPTIONS];
	
	if (!stored) return null;
	
	// If apiKey looks encrypted (base64 without periods/slashes, different pattern than typical API keys), decrypt it
	if (stored.apiKey && stored.apiKey.length > 10 && /^[A-Za-z0-9+/]+=*$/.test(stored.apiKey) && !stored.apiKey.startsWith('AI')) {
		try {
			const deviceKey = await getDeviceKey();
			const decrypted = simpleDecrypt(stored.apiKey, deviceKey);
			return {
				...stored,
				apiKey: decrypted
			};
		} catch (error) {
			console.error("Failed to decrypt API key:", error);
			// Return as-is if decryption fails (backward compatibility)
			return stored;
		}
	}
	
	return stored;
}

export async function setExtensionOptions(
	options: ExtensionOptions,
): Promise<void> {
	// Encrypt the API key before storing
	if (options.apiKey) {
		try {
			const deviceKey = await getDeviceKey();
			const encryptedOptions = {
				...options,
				apiKey: simpleEncrypt(options.apiKey, deviceKey)
			};
			await chrome.storage.local.set({ [STORAGE_KEYS.OPTIONS]: encryptedOptions });
		} catch (error) {
			console.error("Failed to encrypt API key:", error);
			// Fall back to unencrypted storage if encryption fails
			await chrome.storage.local.set({ [STORAGE_KEYS.OPTIONS]: options });
		}
	} else {
		await chrome.storage.local.set({ [STORAGE_KEYS.OPTIONS]: options });
	}
}

export async function getDefaultExtensionOptions(): ExtensionOptions {
	return {
		apiKey: "",
		modelName: "gemini-2.5-flash-preview-tts",
		voice: "Kore",
	};
}

// Utility function to check if options are configured
export async function areOptionsConfigured(): Promise<boolean> {
	const options = await getExtensionOptions();
	return options !== null && options.apiKey.trim() !== "";
}

// Security utility to sanitize error messages
export function sanitizeErrorMessage(error: unknown): string {
	if (error instanceof Error) {
		// Log full error for debugging
		console.error("Internal error:", error);
		
		// Return user-friendly message
		if (error.message.includes("API key") || error.message.includes("key")) {
			return "Please check your API key configuration";
		}
		if (error.message.includes("network") || error.message.includes("fetch") || error.message.includes("Failed to fetch")) {
			return "Network connection error. Please try again";
		}
		if (error.message.includes("quota") || error.message.includes("limit") || error.message.includes("429")) {
			return "API usage limit reached. Please try again later";
		}
		if (error.message.includes("401") || error.message.includes("403")) {
			return "Authentication error. Please check your API key";
		}
		if (error.message.includes("400")) {
			return "Invalid request. Please try again";
		}
		return "An error occurred. Please try again";
	}
	return "An unexpected error occurred";
}

// Basic encryption utilities for API key storage
async function getDeviceKey(): Promise<string> {
	const userAgent = navigator.userAgent || "test-env";
	const timestamp = chrome?.runtime?.getManifest?.()?.version || "1.0.0";
	return btoa(userAgent + timestamp).slice(0, 32);
}

function simpleEncrypt(text: string, key: string): string {
	return btoa(text.split('').map((char, i) => 
		String.fromCharCode(char.charCodeAt(0) ^ key.charCodeAt(i % key.length))
	).join(''));
}

function simpleDecrypt(encrypted: string, key: string): string {
	return atob(encrypted).split('').map((char, i) => 
		String.fromCharCode(char.charCodeAt(0) ^ key.charCodeAt(i % key.length))
	).join('');
}
