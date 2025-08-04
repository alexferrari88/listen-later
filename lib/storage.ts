// Data Models for storage

// For extension operational state
export interface ExtensionState {
  status: 'idle' | 'processing' | 'success' | 'error';
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
  STATE: 'extensionState',
  OPTIONS: 'extensionOptions',
} as const;

// Helper functions for ExtensionState

export async function getExtensionState(): Promise<ExtensionState> {
  const result = await chrome.storage.local.get(STORAGE_KEYS.STATE);
  return result[STORAGE_KEYS.STATE] || { status: 'idle' };
}

export async function setExtensionState(state: Partial<ExtensionState>): Promise<void> {
  const currentState = await getExtensionState();
  const newState = { ...currentState, ...state };
  await chrome.storage.local.set({ [STORAGE_KEYS.STATE]: newState });
}

export async function resetExtensionState(): Promise<void> {
  await setExtensionState({ status: 'idle', message: undefined });
}

// Helper functions for ExtensionOptions

export async function getExtensionOptions(): Promise<ExtensionOptions | null> {
  const result = await chrome.storage.local.get(STORAGE_KEYS.OPTIONS);
  return result[STORAGE_KEYS.OPTIONS] || null;
}

export async function setExtensionOptions(options: ExtensionOptions): Promise<void> {
  await chrome.storage.local.set({ [STORAGE_KEYS.OPTIONS]: options });
}

export async function getDefaultExtensionOptions(): ExtensionOptions {
  return {
    apiKey: '',
    modelName: 'gemini-1.5-flash',
    voice: 'echo',
  };
}

// Utility function to check if options are configured
export async function areOptionsConfigured(): Promise<boolean> {
  const options = await getExtensionOptions();
  return options !== null && options.apiKey.trim() !== '';
}