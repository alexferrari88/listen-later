### **Technical Specification: "Page-to-Speech" Chrome Extension**

#### **1. Project Overview**

The goal is to create a simple, single-purpose Chrome extension that extracts the main content from the current webpage, synthesizes it into speech using the Google Gemini API, and prompts the user to download the resulting MP3 file. The extension will feature a persistent state to show progress, an options page for configuration, and clear error handling.

#### **2. Technology Stack**

* **Framework:** WXT (Vite for Chrome Extensions)
* **Language:** TypeScript
* **UI:** React
* **Linting/Formatting:** Biome
* **Unit Testing:** Vitest
* **E2E Testing:** Playwright

#### **3. Core Architecture & Concepts**

The extension will be built using a "background-first" architecture to handle state persistence. The popup's UI will be a reflection of the state managed by the background script.

* **Background Script (`background.ts`):** This is the extension's core. It will run as a persistent service worker. Its responsibilities include:
  * Managing the application's state (e.g., `'idle'`, `'processing'`, `'error'`).
  * Listening for messages from the popup and content scripts.
  * Executing the content script on the active tab.
  * Making the API call to the Gemini API.
  * Handling the API response and triggering the MP3 download.
  * Storing all state and user settings in `chrome.storage.local`.

* **Popup UI (`popup/`):** The popup is a "dumb" view. It is responsible for:
  * Reading the current state from `chrome.storage.local` upon opening.
  * Rendering the UI based on the current state (e.g., showing a "Generate" button, a loading indicator, or an error message).
  * Sending a "start process" message to the background script when the user clicks the button.
  * It will **not** contain any business logic for text extraction or API calls.

* **Content Script (`content.ts`):** This script will be programmatically injected into the active tab by the background script. Its sole purpose is to:
  * Access the page's DOM.
  * Use the bundled `Readability.js` library to extract the main article content.
  * Send the extracted text (or an error message if it fails) back to the background script.

* **Options Page (`options/`):** A static HTML page for configuration. It will:
  * Provide input fields for the Gemini API Key, Model Name, and Voice.
  * Save these settings securely to `chrome.storage.local`.

* **State Management:** `chrome.storage.local` will be the single source of truth. The background script writes to it, and the popup and options pages read from it. The popup will use the `chrome.storage.onChanged` event to reactively update its UI if it's open when the state changes.

* **API Key Storage:** The Gemini API key will be stored using `chrome.storage.local`. This storage is sandboxed to the extension and is not accessible by other websites or extensions. While not truly "encrypted" on disk in a cryptographic sense, it is the standard secure method for storing sensitive user data within a Chrome extension's context.

#### **4. File Structure (WXT Convention)**

```
/
├── wxt.config.ts         # WXT configuration
├── package.json
├── public/
│   └── icon-128.png      # Extension icon
├── entrypoints/
│   ├── background.ts     # Main background script (service worker)
│   ├── popup/
│   │   ├── index.html    # Popup HTML shell
│   │   └── main.tsx      # React entry point for the popup
│   ├── options/
│   │   ├── index.html    # Options page HTML
│   │   └── main.tsx      # React entry point for options
│   └── content.ts        # Content script for Readability
├── components/
│   ├── Popup.tsx         # Main popup component
│   └── Options.tsx       # Main options component
└── lib/
    ├── readability.js    # Mozilla's Readability.js library
    └── storage.ts        # Typed wrappers for chrome.storage API
```

#### **5. Detailed Logic Flow**

**A. Configuration (Options Page)**

1. User opens the extension's options page.
2. The `Options.tsx` component renders, providing fields for:
    * API Key (input type `password`)
    * Model Name (text input, default value `gemini-1.5-flash`)
    * Voice (text input, with suggestions like `echo`, `onyx`, `shimmer`, etc.)
3. On "Save", the component saves the configuration object to `chrome.storage.local`.

**B. Text-to-Speech Process (Popup)**

1. User clicks the extension icon in the toolbar.
2. The `Popup.tsx` component mounts. It immediately reads the current state from `chrome.storage.local`.
3. **State: 'idle'**: The popup displays a single button: "Generate Speech".
4. User clicks "Generate Speech".
5. The popup sends a message to the background script: `chrome.runtime.sendMessage({ type: 'START_TTS' })`.
6. The `background.ts` script receives the message.
    * It immediately updates the state in storage: `chrome.storage.local.set({ status: 'processing' })`.
    * If the popup is open, its `onChanged` listener will fire, and the UI will re-render to show a loading/processing state (e.g., "Extracting text...", "Synthesizing audio...").
    * It programmatically executes `content.ts` on the currently active tab.
7. The `content.ts` script runs on the webpage.
    * It uses `Readability.js` on `document.body`.
    * **Success:** It sends the extracted article text back to the background script: `chrome.runtime.sendMessage({ type: 'CONTENT_EXTRACTED', text: '...' })`.
    * **Failure:** It sends an error message: `chrome.runtime.sendMessage({ type: 'CONTENT_ERROR', error: 'Could not find main content.' })`.
8. The `background.ts` script receives the message from the content script.
    * **If `CONTENT_ERROR`**: It updates storage: `{ status: 'error', message: '...' }` and stops.
    * **If `CONTENT_EXTRACTED`**: It proceeds to call the Gemini API, sending the text and the user's configured model/voice.
9. **Gemini API Call:**
    * **Success:** The API returns audio data (likely a base64 string). The background script decodes it into a `Blob`, creates a URL with `URL.createObjectURL()`, and uses the `chrome.downloads.download()` API to prompt a "Save As" dialog for `article.mp3`. It then updates storage: `{ status: 'success' }`. After a few seconds, it should reset the state back to `{ status: 'idle' }`.
    * **Failure:** The background script catches the API error and updates storage: `{ status: 'error', message: 'Gemini API Error: ...' }`.

**C. Persistent State Handling**

* If the user closes the popup during the `'processing'` state and reopens it, the `Popup.tsx` component will mount, read the `'processing'` state from storage, and immediately display the correct loading UI. The process continues uninterrupted in the background.

#### **6. Data Models (for `storage.ts`)**

```typescript
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
```