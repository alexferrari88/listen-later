// Data Models for storage
import { logger } from "./logger";

// Tab metadata for job tracking
export interface TabInfo {
	url: string;
	title: string;
	domain: string;
	articleTitle?: string;
	selectedPromptId?: string;
}

// Individual processing job
export interface ProcessingJob {
	id: string; // unique job ID
	tabId?: number; // original tab ID (may be undefined if tab closed)
	tabInfo: TabInfo;
	status: "preparing" | "processing" | "success" | "error";
	message?: string;
	progress?: number; // 0-100 percentage progress
	startTime: number;
	text?: string; // for retry capability
	filename?: string; // generated filename
}

// Extension state with job management
export interface ExtensionState {
	activeJobs: ProcessingJob[];
	maxConcurrentJobs: number;
}

// Speech style prompt configuration
export interface SpeechStylePrompt {
	id: string;
	name: string;
	description: string;
	template: string; // Template with ${content} placeholder
	isDefault?: boolean;
}

// For user-configured settings
export interface ExtensionOptions {
	apiKey: string;
	modelName: string;
	voice: string;
	speechStylePrompts: SpeechStylePrompt[];
	defaultPromptId: string;
}

// Rate limiting data structures
export interface RateLimitEntry {
	tabId: number;
	origin: string;
	timestamps: number[]; // Array of request timestamps within the window
	windowStart: number; // Start of current sliding window
}

export interface RateLimitStorage {
	entries: { [key: string]: RateLimitEntry }; // key format: "tabId:origin"
	lastCleanup: number;
}

// Storage keys
const STORAGE_KEYS = {
	STATE: "extensionState",
	OPTIONS: "extensionOptions",
	RATE_LIMITS: "rateLimits",
} as const;

// Constants
const MAX_CONCURRENT_JOBS = 3;
const PREPARING_JOB_CLEANUP_TIME = 10 * 60 * 1000; // 10 minutes in milliseconds
const SUCCESS_JOB_CLEANUP_TIME = 5 * 60 * 1000; // 5 minutes in milliseconds
const ERROR_JOB_CLEANUP_TIME = 24 * 60 * 60 * 1000; // 24 hours in milliseconds

// Rate limiting constants
const RATE_LIMIT_WINDOW_MS = 60 * 1000; // 60 seconds sliding window
const RATE_LIMIT_MAX_REQUESTS = 5; // Maximum 5 requests per window per tab/origin
const RATE_LIMIT_CLEANUP_INTERVAL = 5 * 60 * 1000; // Cleanup every 5 minutes

// Helper functions for ExtensionState

export async function getExtensionState(): Promise<ExtensionState> {
	const result = await chrome.storage.local.get(STORAGE_KEYS.STATE);
	return (
		result[STORAGE_KEYS.STATE] || {
			activeJobs: [],
			maxConcurrentJobs: MAX_CONCURRENT_JOBS,
		}
	);
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
	logger.debug("Resetting extension state");
	await setExtensionState({
		activeJobs: [],
		maxConcurrentJobs: MAX_CONCURRENT_JOBS,
	});
}

// Helper functions for ExtensionOptions

export async function getExtensionOptions(): Promise<ExtensionOptions | null> {
	const result = await chrome.storage.local.get(STORAGE_KEYS.OPTIONS);
	const stored = result[STORAGE_KEYS.OPTIONS];

	if (!stored) return null;

	// Ensure backward compatibility by adding default prompts if missing
	let options = stored;
	if (!options.speechStylePrompts || options.speechStylePrompts.length === 0) {
		options = {
			...options,
			speechStylePrompts: [...DEFAULT_SPEECH_STYLE_PROMPTS],
			defaultPromptId: options.defaultPromptId || "documentary",
		};
	}

	// If apiKey looks encrypted, decrypt it
	if (
		options.apiKey &&
		options.apiKey.length > 10 &&
		/^[A-Za-z0-9+/]+=*$/.test(options.apiKey) &&
		!options.apiKey.startsWith("AI")
	) {
		try {
			// Try new secure decryption first
			let decrypted: string;
			try {
				decrypted = await secureDecrypt(options.apiKey);
			} catch (error) {
				// Fall back to legacy decryption for backward compatibility
				logger.debug("New decryption failed, trying legacy decryption", error);
				const deviceKey = await getLegacyDeviceKey();
				decrypted = legacyDecrypt(options.apiKey, deviceKey);
			}
			
			return {
				...options,
				apiKey: decrypted,
			};
		} catch (error) {
			console.error("Failed to decrypt API key:", error);
			// Return as-is if decryption fails (backward compatibility)
			return options;
		}
	}

	return options;
}

export async function setExtensionOptions(
	options: ExtensionOptions,
): Promise<void> {
	// Encrypt the API key before storing
	if (options.apiKey) {
		try {
			const encryptedOptions = {
				...options,
				apiKey: await secureEncrypt(options.apiKey),
			};
			await chrome.storage.local.set({
				[STORAGE_KEYS.OPTIONS]: encryptedOptions,
			});
		} catch (error) {
			console.error("Failed to encrypt API key:", error);
			// Fall back to unencrypted storage if encryption fails
			await chrome.storage.local.set({ [STORAGE_KEYS.OPTIONS]: options });
		}
	} else {
		await chrome.storage.local.set({ [STORAGE_KEYS.OPTIONS]: options });
	}
}

// Default speech style prompts
export const DEFAULT_SPEECH_STYLE_PROMPTS: SpeechStylePrompt[] = [
	{
		id: "documentary",
		name: "Documentary Style",
		description: "Professional, authoritative, and well-paced narration",
		template:
			"Narrate the following text in a professional, authoritative, and well-paced documentary style: ${content}:",
		isDefault: true,
	},
	{
		id: "conversational",
		name: "Conversational",
		description: "Friendly, casual tone as if explaining to a friend",
		template:
			"Read this text in a friendly, conversational tone as if explaining to a friend: ${content}:",
	},
	{
		id: "news",
		name: "News Report",
		description: "Clear, professional news reporting style",
		template:
			"Present this information as a clear, professional news report: ${content}:",
	},
	{
		id: "audiobook",
		name: "Audiobook",
		description: "Engaging audiobook narration with appropriate pacing",
		template:
			"Narrate this text in an engaging audiobook style with appropriate pacing: ${content}:",
	},
	{
		id: "podcast",
		name: "Podcast Style",
		description: "Casual, engaging podcast presentation",
		template:
			"Read the following in an engaging, conversational, and friendly tone, as if you were hosting a podcast: ${content}:",
	},
];

export async function getDefaultExtensionOptions(): Promise<ExtensionOptions> {
	return {
		apiKey: "",
		modelName: "gemini-2.5-flash-preview-tts",
		voice: "Aoede",
		speechStylePrompts: [...DEFAULT_SPEECH_STYLE_PROMPTS],
		defaultPromptId: "documentary",
	};
}

// Utility function to check if options are configured
export async function areOptionsConfigured(): Promise<boolean> {
	const options = await getExtensionOptions();
	return options !== null && options.apiKey.trim() !== "";
}

// Job Management Functions

export function generateJobId(): string {
	return `job_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

export function generateFilename(tabInfo: TabInfo): string {
	// Use article title first, then page title, then domain as fallback
	let title = "";
	if (tabInfo.articleTitle && tabInfo.articleTitle.trim()) {
		title = tabInfo.articleTitle.trim();
	} else if (tabInfo.title && tabInfo.title.trim()) {
		title = tabInfo.title.trim();
	} else {
		title = tabInfo.domain;
	}

	// Sanitize the title first to prevent security issues
	const sanitizedTitle = sanitizeFilename(title);
	
	// Start building the filename with the sanitized title
	let filename = sanitizedTitle;

	// If there's space left (keeping some buffer for domain), append domain
	const maxTitleLength = 70; // Leave room for domain and separators
	if (sanitizedTitle.length < maxTitleLength && sanitizedTitle !== tabInfo.domain) {
		const remainingSpace = maxTitleLength - sanitizedTitle.length - 3; // 3 chars for " - "
		if (remainingSpace > 10) { // Only add domain if we have reasonable space
			filename = `${sanitizedTitle} - ${tabInfo.domain}`;
		}
	}

	// Truncate if needed while preserving the extension
	const truncated = filename.substring(0, 80); // Max 80 chars for filename part

	return `${truncated}.mp3`;
}

// Comprehensive filename sanitization to prevent path traversal and security issues
function sanitizeFilename(filename: string): string {
	// Remove null bytes and control characters (0x00-0x1f)
	let sanitized = filename.replace(/[\x00-\x1f]/g, "");
	
	// Remove path traversal sequences
	sanitized = sanitized.replace(/\.\./g, ""); // Remove ..
	sanitized = sanitized.replace(/\.\//g, ""); // Remove ./
	sanitized = sanitized.replace(/\\+/g, "/"); // Replace backslashes with forward slash first
	sanitized = sanitized.replace(/\/+/g, "/"); // Consolidate multiple slashes
	sanitized = sanitized.replace(/\//g, " "); // Replace slashes with spaces
	
	// Replace filesystem-incompatible characters with spaces
	sanitized = sanitized.replace(/[<>:"|?*]/g, " ");
	
	// Remove leading and trailing dots and spaces
	sanitized = sanitized.replace(/^[.\s]+|[.\s]+$/g, "");
	
	// Remove any remaining leading dots (hidden files)
	sanitized = sanitized.replace(/^\.+/, "");
	
	// Handle edge cases where sanitization results in empty or invalid names
	if (!sanitized || sanitized === "." || sanitized === "..") {
		sanitized = "unnamed_file";
	}
	
	// Final check - if empty after all sanitization, provide fallback
	if (!sanitized) {
		sanitized = "unnamed_file";
	}
	
	// Handle Windows reserved names (case-insensitive) - must be after cleaning
	const reservedNames = /^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])$/i;
	if (reservedNames.test(sanitized)) {
		sanitized = `file_${sanitized}`;
	}
	
	// Normalize whitespace - collapse multiple spaces and trim
	sanitized = sanitized.replace(/\s+/g, " ").trim();
	
	return sanitized;
}

export function extractDomain(url: string): string {
	try {
		return new URL(url).hostname.replace(/^www\./, "");
	} catch {
		return "unknown-domain";
	}
}

export async function createJob(
	tabId: number,
	url: string,
	title: string,
	text: string,
	articleTitle?: string,
): Promise<ProcessingJob> {
	const tabInfo: TabInfo = {
		url,
		title,
		domain: extractDomain(url),
		articleTitle,
	};

	const job: ProcessingJob = {
		id: generateJobId(),
		tabId,
		tabInfo,
		status: "preparing",
		message: "Starting content processing...",
		startTime: Date.now(),
		text,
		filename: generateFilename(tabInfo),
	};

	const state = await getExtensionState();
	state.activeJobs.push(job);
	await setExtensionState(state);

	logger.debug("Created new job", {
		jobId: job.id,
		tabId,
		filename: job.filename,
	});
	return job;
}

export async function updateJob(
	jobId: string,
	updates: Partial<ProcessingJob>,
): Promise<void> {
	const state = await getExtensionState();
	const jobIndex = state.activeJobs.findIndex((job) => job.id === jobId);

	if (jobIndex === -1) {
		logger.warn("Job not found for update", { jobId });
		return;
	}

	state.activeJobs[jobIndex] = { ...state.activeJobs[jobIndex], ...updates };
	await setExtensionState(state);

	logger.debug("Updated job", { jobId, updates });
}

export async function getJob(jobId: string): Promise<ProcessingJob | null> {
	const state = await getExtensionState();
	return state.activeJobs.find((job) => job.id === jobId) || null;
}

export async function getJobsForTab(tabId: number): Promise<ProcessingJob[]> {
	const state = await getExtensionState();
	return state.activeJobs.filter((job) => job.tabId === tabId);
}

export async function getJobsByStatus(
	status: ProcessingJob["status"],
): Promise<ProcessingJob[]> {
	const state = await getExtensionState();
	return state.activeJobs.filter((job) => job.status === status);
}

export async function getProcessingJobs(): Promise<ProcessingJob[]> {
	return getJobsByStatus("processing");
}

export async function canStartNewJob(): Promise<boolean> {
	const processingJobs = await getProcessingJobs();
	const state = await getExtensionState();
	return processingJobs.length < state.maxConcurrentJobs;
}

export async function removeJob(jobId: string): Promise<void> {
	const state = await getExtensionState();
	state.activeJobs = state.activeJobs.filter((job) => job.id !== jobId);
	await setExtensionState(state);

	logger.debug("Removed job", { jobId });
}

export async function cleanupOldJobs(): Promise<void> {
	const state = await getExtensionState();
	const now = Date.now();
	const initialCount = state.activeJobs.length;

	// Remove jobs based on status and age
	state.activeJobs = state.activeJobs.filter((job) => {
		if (job.status === "processing") return true; // Always keep processing jobs

		const jobAge = now - job.startTime;
		if (job.status === "preparing") {
			return jobAge < PREPARING_JOB_CLEANUP_TIME; // Clean preparing jobs after 10 minutes
		}
		if (job.status === "success") {
			return jobAge < SUCCESS_JOB_CLEANUP_TIME; // Clean success jobs after 5 minutes
		}
		if (job.status === "error") {
			return jobAge < ERROR_JOB_CLEANUP_TIME; // Clean error jobs after 24 hours
		}

		// Fallback for unknown statuses
		return jobAge < SUCCESS_JOB_CLEANUP_TIME;
	});

	const removedCount = initialCount - state.activeJobs.length;
	if (removedCount > 0) {
		await setExtensionState(state);
		logger.debug("Cleaned up old jobs", {
			removedCount,
			remaining: state.activeJobs.length,
			breakdown: {
				preparing: state.activeJobs.filter((j) => j.status === "preparing")
					.length,
				processing: state.activeJobs.filter((j) => j.status === "processing")
					.length,
				success: state.activeJobs.filter((j) => j.status === "success").length,
				error: state.activeJobs.filter((j) => j.status === "error").length,
			},
		});
	}
}

export async function retryJob(jobId: string): Promise<ProcessingJob | null> {
	const job = await getJob(jobId);
	if (!job || !job.text) {
		logger.warn("Cannot retry job - job not found or no text", { jobId });
		return null;
	}

	// Create new job with same content but new ID
	const newJob = await createJob(
		job.tabId || 0,
		job.tabInfo.url,
		job.tabInfo.title,
		job.text,
		job.tabInfo.articleTitle,
	);

	// Remove old job
	await removeJob(jobId);

	logger.debug("Retried job", { oldJobId: jobId, newJobId: newJob.id });
	return newJob;
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
		if (
			error.message.includes("network") ||
			error.message.includes("fetch") ||
			error.message.includes("Failed to fetch")
		) {
			return "Network connection error. Please try again";
		}
		if (
			error.message.includes("quota") ||
			error.message.includes("limit") ||
			error.message.includes("429")
		) {
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

// Speech Style Prompt Management Functions

export async function getSpeechStylePromptById(promptId: string): Promise<SpeechStylePrompt | null> {
	const options = await getExtensionOptions();
	if (!options || !options.speechStylePrompts) return null;
	
	return options.speechStylePrompts.find(prompt => prompt.id === promptId) || null;
}

export async function addSpeechStylePrompt(prompt: Omit<SpeechStylePrompt, 'id'>): Promise<string> {
	const options = await getExtensionOptions();
	if (!options) throw new Error("Options not initialized");
	
	// Generate unique ID
	const id = `custom_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
	const newPrompt: SpeechStylePrompt = { ...prompt, id };
	
	const updatedOptions = {
		...options,
		speechStylePrompts: [...options.speechStylePrompts, newPrompt],
	};
	
	await setExtensionOptions(updatedOptions);
	return id;
}

export async function updateSpeechStylePrompt(promptId: string, updates: Partial<Omit<SpeechStylePrompt, 'id'>>): Promise<void> {
	const options = await getExtensionOptions();
	if (!options) throw new Error("Options not initialized");
	
	const promptIndex = options.speechStylePrompts.findIndex(p => p.id === promptId);
	if (promptIndex === -1) throw new Error(`Prompt with ID ${promptId} not found`);
	
	const updatedPrompts = options.speechStylePrompts.map(prompt => 
		prompt.id === promptId ? { ...prompt, ...updates } : prompt
	);
	
	const updatedOptions = {
		...options,
		speechStylePrompts: updatedPrompts,
	};
	
	await setExtensionOptions(updatedOptions);
}

export async function deleteSpeechStylePrompt(promptId: string): Promise<void> {
	const options = await getExtensionOptions();
	if (!options) throw new Error("Options not initialized");
	
	// Don't allow deleting default prompts
	const prompt = options.speechStylePrompts.find(p => p.id === promptId);
	if (prompt?.isDefault) {
		throw new Error("Cannot delete default prompts");
	}
	
	const updatedPrompts = options.speechStylePrompts.filter(p => p.id !== promptId);
	
	// If we're deleting the current default prompt, reset to documentary
	let updatedDefaultPromptId = options.defaultPromptId;
	if (options.defaultPromptId === promptId) {
		updatedDefaultPromptId = "documentary";
	}
	
	const updatedOptions = {
		...options,
		speechStylePrompts: updatedPrompts,
		defaultPromptId: updatedDefaultPromptId,
	};
	
	await setExtensionOptions(updatedOptions);
}

export async function setDefaultSpeechStylePrompt(promptId: string): Promise<void> {
	const options = await getExtensionOptions();
	if (!options) throw new Error("Options not initialized");
	
	// Verify the prompt exists
	const promptExists = options.speechStylePrompts.some(p => p.id === promptId);
	if (!promptExists) {
		throw new Error(`Prompt with ID ${promptId} not found`);
	}
	
	const updatedOptions = {
		...options,
		defaultPromptId: promptId,
	};
	
	await setExtensionOptions(updatedOptions);
}

export function substituteSpeechStyleTemplate(template: string, content: string): string {
	return template.replace(/\$\{content\}/g, content);
}

// Cryptographically secure encryption utilities for API key storage
// Uses WebCrypto API with AES-GCM encryption and PBKDF2 key derivation

interface EncryptedData {
	v: number; // version for future migration support
	data: string; // base64 encoded encrypted data
	iv: string; // base64 encoded initialization vector
	salt: string; // base64 encoded salt
}

// Generate cryptographic key using PBKDF2
async function deriveKey(password: string, salt: Uint8Array): Promise<CryptoKey> {
	const encoder = new TextEncoder();
	const keyMaterial = await crypto.subtle.importKey(
		"raw",
		encoder.encode(password),
		{ name: "PBKDF2" },
		false,
		["deriveKey"]
	);
	
	return crypto.subtle.deriveKey(
		{
			name: "PBKDF2",
			salt: salt,
			iterations: 100000,
			hash: "SHA-256"
		},
		keyMaterial,
		{ name: "AES-GCM", length: 256 },
		false,
		["encrypt", "decrypt"]
	);
}

// Get device-specific password for key derivation
async function getDevicePassword(): Promise<string> {
	const userAgent = navigator.userAgent || "test-env";
	const version = chrome?.runtime?.getManifest?.()?.version || "1.0.0";
	return `listen-later-${userAgent}-${version}`;
}

// Encrypt text using AES-GCM
async function secureEncrypt(text: string): Promise<string> {
	const encoder = new TextEncoder();
	const data = encoder.encode(text);
	
	// Generate random salt and IV
	const salt = crypto.getRandomValues(new Uint8Array(16));
	const iv = crypto.getRandomValues(new Uint8Array(12));
	
	// Derive key from device-specific password
	const password = await getDevicePassword();
	const key = await deriveKey(password, salt);
	
	// Encrypt the data
	const encrypted = await crypto.subtle.encrypt(
		{ name: "AES-GCM", iv: iv },
		key,
		data
	);
	
	// Package the encrypted data with metadata
	const result: EncryptedData = {
		v: 1,
		data: btoa(String.fromCharCode(...new Uint8Array(encrypted))),
		iv: btoa(String.fromCharCode(...iv)),
		salt: btoa(String.fromCharCode(...salt))
	};
	
	return btoa(JSON.stringify(result));
}

// Decrypt text using AES-GCM
async function secureDecrypt(encryptedText: string): Promise<string> {
	try {
		const parsed: EncryptedData = JSON.parse(atob(encryptedText));
		
		// Check version for future migration support
		if (parsed.v !== 1) {
			throw new Error(`Unsupported encryption version: ${parsed.v}`);
		}
		
		// Reconstruct binary data from base64
		const data = new Uint8Array(
			atob(parsed.data).split('').map(c => c.charCodeAt(0))
		);
		const iv = new Uint8Array(
			atob(parsed.iv).split('').map(c => c.charCodeAt(0))
		);
		const salt = new Uint8Array(
			atob(parsed.salt).split('').map(c => c.charCodeAt(0))
		);
		
		// Derive key from device-specific password
		const password = await getDevicePassword();
		const key = await deriveKey(password, salt);
		
		// Decrypt the data
		const decrypted = await crypto.subtle.decrypt(
			{ name: "AES-GCM", iv: iv },
			key,
			data
		);
		
		const decoder = new TextDecoder();
		return decoder.decode(decrypted);
	} catch (error) {
		logger.error("Failed to decrypt data", error);
		throw new Error("Decryption failed");
	}
}

// Legacy XOR decryption for backward compatibility
function legacyDecrypt(encrypted: string, key: string): string {
	return atob(encrypted)
		.split("")
		.map((char, i) =>
			String.fromCharCode(char.charCodeAt(0) ^ key.charCodeAt(i % key.length)),
		)
		.join("");
}

// Generate legacy device key for backward compatibility
async function getLegacyDeviceKey(): Promise<string> {
	const userAgent = navigator.userAgent || "test-env";
	const timestamp = chrome?.runtime?.getManifest?.()?.version || "1.0.0";
	return btoa(userAgent + timestamp).slice(0, 32);
}

// Rate Limiting Functions

async function getRateLimitStorage(): Promise<RateLimitStorage> {
	const result = await chrome.storage.local.get(STORAGE_KEYS.RATE_LIMITS);
	return result[STORAGE_KEYS.RATE_LIMITS] || {
		entries: {},
		lastCleanup: Date.now(),
	};
}

async function setRateLimitStorage(storage: RateLimitStorage): Promise<void> {
	await chrome.storage.local.set({ [STORAGE_KEYS.RATE_LIMITS]: storage });
}

function getRateLimitKey(tabId: number, origin: string): string {
	return `${tabId}:${origin}`;
}

export async function checkRateLimit(tabId: number, origin: string): Promise<{ allowed: boolean; error?: string }> {
	const now = Date.now();
	const storage = await getRateLimitStorage();
	const key = getRateLimitKey(tabId, origin);
	
	let entry = storage.entries[key];
	
	if (!entry) {
		// First request from this tab/origin
		entry = {
			tabId,
			origin,
			timestamps: [now],
			windowStart: now,
		};
		storage.entries[key] = entry;
		await setRateLimitStorage(storage);
		return { allowed: true };
	}
	
	// Clean up old timestamps outside the sliding window
	const windowStart = now - RATE_LIMIT_WINDOW_MS;
	entry.timestamps = entry.timestamps.filter(timestamp => timestamp >= windowStart);
	entry.windowStart = windowStart;
	
	// Check if we're at the limit
	if (entry.timestamps.length >= RATE_LIMIT_MAX_REQUESTS) {
		logger.warn("Rate limit exceeded", {
			tabId,
			origin,
			requestCount: entry.timestamps.length,
			windowMs: RATE_LIMIT_WINDOW_MS,
			maxRequests: RATE_LIMIT_MAX_REQUESTS,
		});
		
		return {
			allowed: false,
			error: `Rate limit exceeded. Maximum ${RATE_LIMIT_MAX_REQUESTS} requests per ${RATE_LIMIT_WINDOW_MS / 1000} seconds. Please wait before trying again.`,
		};
	}
	
	// Add current request timestamp
	entry.timestamps.push(now);
	storage.entries[key] = entry;
	await setRateLimitStorage(storage);
	
	logger.debug("Rate limit check passed", {
		tabId,
		origin,
		requestCount: entry.timestamps.length,
		maxRequests: RATE_LIMIT_MAX_REQUESTS,
	});
	
	return { allowed: true };
}

export async function cleanupRateLimitData(): Promise<void> {
	const now = Date.now();
	const storage = await getRateLimitStorage();
	
	// Only cleanup if it's been more than the cleanup interval since last cleanup
	if (now - storage.lastCleanup < RATE_LIMIT_CLEANUP_INTERVAL) {
		return;
	}
	
	const initialEntryCount = Object.keys(storage.entries).length;
	const cutoffTime = now - (RATE_LIMIT_WINDOW_MS * 2); // Keep data for 2x window duration
	
	// Remove entries that are completely expired
	for (const [key, entry] of Object.entries(storage.entries)) {
		// Remove entries where all timestamps are older than cutoff
		entry.timestamps = entry.timestamps.filter(timestamp => timestamp >= cutoffTime);
		
		if (entry.timestamps.length === 0) {
			delete storage.entries[key];
		}
	}
	
	storage.lastCleanup = now;
	const finalEntryCount = Object.keys(storage.entries).length;
	
	if (initialEntryCount !== finalEntryCount) {
		await setRateLimitStorage(storage);
		logger.debug("Cleaned up rate limit data", {
			removedEntries: initialEntryCount - finalEntryCount,
			remainingEntries: finalEntryCount,
		});
	}
}
