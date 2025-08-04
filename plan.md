### **Implementation Plan: "Page-to-Speech" Chrome Extension**

This plan is structured to build the extension from the inside out, starting with core logic and data structures before moving to the user interface. This ensures that the UI has a functional backend to connect to as it's being developed.

#### **Phase 1: Project Scaffolding & Foundational Setup**

**Goal:** Initialize the project, install all dependencies, configure the development environment, and create the core file structure.

* **Task 1.1: Initialize WXT Project**
  * **Action:** Run `npm create wxt@latest` to generate the project skeleton with TypeScript and React.
  * **Spec Reference:** Section 2 (Technology Stack).

* **Task 1.2: Install Additional Dependencies**
  * **Action:** Install `biome` for linting/formatting. Note: `vitest` and `playwright` are typically included or easily added via WXT tooling.
  * **Spec Reference:** Section 2 (Technology Stack).

* **Task 1.3: Download and Place Readability.js**
  * **Action:** Obtain the `Readability.js` script from Mozilla's repository and place it in the `lib/` directory.
  * **Spec Reference:** Section 4 (File Structure).

* **Task 1.4: Define Entrypoints and File Structure**
  * **Action:** Create the empty files for all entrypoints as defined in the spec: `entrypoints/background.ts`, `entrypoints/content.ts`, `entrypoints/popup/main.tsx`, and `entrypoints/options/main.tsx`.
  * **Spec Reference:** Section 4 (File Structure).

* **Task 1.5: Define Data Models and Storage Wrappers**
  * **Action:** Create the `lib/storage.ts` file. Inside, define and export the `ExtensionState` and `ExtensionOptions` TypeScript interfaces. Implement simple, typed helper functions to get and set these objects in `chrome.storage.local`.
  * **Spec Reference:** Section 6 (Data Models) and Section 3 (State Management).

#### **Phase 2: Core Backend Logic (Background Script)**

**Goal:** Implement the primary business logic of the extension within the background service worker.

* **Task 2.1: Implement Initial State and Message Listener**
  * **Action:** In `background.ts`, set up the main listener for `chrome.runtime.onMessage`. It should initially handle a `START_TTS` message type.
  * **Spec Reference:** Section 5.B (Detailed Logic Flow).

* **Task 2.2: Implement Content Script Injection and State Update**
  * **Action:** Upon receiving `START_TTS`, the background script should immediately update the state in storage to `{ status: 'processing' }` using the storage wrapper. Then, use `chrome.scripting.executeScript` to inject `content.ts` into the active tab.
  * **Spec Reference:** Section 5.B.6.

* **Task 2.3: Implement Content Script Logic**
  * **Action:** In `content.ts`, import `Readability.js`. Instantiate a new `Readability` object with the page's DOM. Send the result (either `{ type: 'CONTENT_EXTRACTED', text: ... }` or `{ type: 'CONTENT_ERROR', error: ... }`) back to the background script via `chrome.runtime.sendMessage`.
  * **Spec Reference:** Section 5.B.7.

* **Task 2.4: Implement Gemini API Call Logic**
  * **Action:** In `background.ts`, upon receiving the `CONTENT_EXTRACTED` message, create a function that retrieves the user's settings (API key, model, voice) from storage. This function will then make a `fetch` request to the Gemini API endpoint.
  * **Spec Reference:** Section 5.B.9.

* **Task 2.5: Implement MP3 Download Handler**
  * **Action:** On a successful Gemini API response, decode the audio data, create a `Blob`, generate an object URL, and trigger the download using the `chrome.downloads.download()` API.
  * **Spec Reference:** Section 5.B.9.

#### **Phase 3: Frontend User Interface (Options & Popup)**

**Goal:** Build the React components for the user-facing parts of the extension.

* **Task 3.1: Build the Options Page UI**
  * **Action:** Create the `Options.tsx` component. It should render a form with input fields for the API Key, Model Name, and Voice, along with a "Save" button.
  * **Spec Reference:** Section 4 (File Structure) and Section 5.A.

* **Task 3.2: Implement Options Page Logic**
  * **Action:** Add state management (`useState`) to the `Options.tsx` component. The "Save" button's `onClick` handler will use the storage wrappers from `lib/storage.ts` to persist the settings. It should also load existing settings when the component mounts.
  * **Spec Reference:** Section 5.A.

* **Task 3.3: Build the Static Popup UI**
  * **Action:** Create the `Popup.tsx` component. Design the different visual states based on the `ExtensionState` model: the idle view ("Generate Speech" button), the processing view (a loading indicator and status message), and the error view (an error message).
  * **Spec Reference:** Section 4 (File Structure) and Section 5.B.3.

#### **Phase 4: Integration and State Synchronization**

**Goal:** Connect the frontend and backend, making the UI fully reactive to changes in the extension's state.

* **Task 4.1: Connect Popup "Generate" Button**
  * **Action:** In `Popup.tsx`, make the "Generate Speech" button's `onClick` handler send the `START_TTS` message to the background script using `chrome.runtime.sendMessage`.
  * **Spec Reference:** Section 5.B.5.

* **Task 4.2: Implement Reactive State in Popup**
  * **Action:** In `Popup.tsx`, use a `useEffect` hook to read the initial state from `chrome.storage.local` upon mounting. Set up a listener for `chrome.storage.onChanged` to update the component's local state whenever the `ExtensionState` object changes in storage. This will make the UI react automatically to progress and errors from the background script.
  * **Spec Reference:** Section 3 (State Management) and Section 5.C.

#### **Phase 5: Error Handling & Refinement**

**Goal:** Make the extension robust by implementing comprehensive error handling and displaying clear feedback to the user.

* **Task 5.1: Implement Backend Error Handling**
  * **Action:** In `background.ts`, wrap the content script injection and the Gemini API call in `try...catch` blocks. If an error occurs (e.g., Readability fails, API key is invalid), update the state in storage to `{ status: 'error', message: 'Descriptive error message' }`.
  * **Spec Reference:** Section 5.B.8 and 5.B.9.

* **Task 5.2: Display Errors in Popup**
  * **Action:** Ensure the `Popup.tsx` component correctly renders the `message` property from the `ExtensionState` when the status is `'error'`. Add a "Dismiss" or "Try Again" button that resets the state to `'idle'`.
  * **Spec Reference:** Section 3 (Popup UI).

#### **Phase 6: Testing & Finalization**

**Goal:** Verify the extension's functionality through automated testing and prepare it for use.

* **Task 6.1: Write Unit Tests (Vitest)**
  * **Action:** Write basic unit tests for the storage wrapper functions in `lib/storage.ts` to ensure they correctly interact with a mocked `chrome.storage` API.
  * **Spec Reference:** Section 2 (Technology Stack).

* **Task 6.2: Write End-to-End Tests (Playwright)**
  * **Action:** Create an E2E test that:
        1. Launches the browser with the extension installed.
        2. Navigates to the options page to set a dummy API key.
        3. Navigates to a sample article page.
        4. Clicks the extension icon and the "Generate Speech" button.
        5. Asserts that the UI enters a "processing" state.
  * **Spec Reference:** Section 2 (Technology Stack).

* **Task 6.3: Final Configuration and Review**
  * **Action:** Review the `manifest.json` generated by WXT to ensure all necessary permissions (`storage`, `activeTab`, `scripting`, `downloads`) are present. Add a `128x128` icon to the `public/` directory. Run `biome` one last time to format and lint the entire codebase.
  * **Spec Reference:** Section 4 (File Structure).
