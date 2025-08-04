# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Listen Later is a Chrome extension that converts web articles to speech using Google Gemini API. It uses a background-first architecture where the background script manages state and coordinates between the popup UI, content scripts, and API calls.

## Development Commands

### Core Development
- `npm run dev` - Start development server for Chrome (auto-reloads extension)
- `npm run dev:firefox` - Start development server for Firefox
- `npm run build` - Build production version for Chrome
- `npm run build:firefox` - Build production version for Firefox

### Testing & Quality
- `npm run test` - Run unit tests with Vitest
- `npm run test:ui` - Run tests with Vitest UI
- `npm run test:run` - Run tests once without watch mode
- `npm run e2e` - Run Playwright end-to-end tests
- `npm run e2e:headed` - Run E2E tests with browser UI
- `npm run e2e:debug` - Run E2E tests in debug mode

### Code Quality
- Use Biome for linting and formatting (configured with tabs, double quotes)
- Biome automatically organizes imports on save
- E2E tests require single worker mode due to extension testing constraints

### Distribution
- `npm run zip` - Create distribution ZIP for Chrome Web Store
- `npm run zip:firefox` - Create distribution ZIP for Firefox Add-ons

## Architecture

### Background-First Design
The extension uses a "background-first" architecture where:
- **Background script** (`entrypoints/background.ts`) is the core coordinator
- **Popup** (`components/Popup.tsx`) is a reactive view that reflects background state
- **Content script** (`entrypoints/content.ts`) handles DOM text extraction
- **Options page** (`components/Options.tsx`) manages user configuration

### State Management
- Single source of truth: `chrome.storage.local`
- Background script writes state changes
- UI components read state and listen for `chrome.storage.onChanged` events
- State types defined in `lib/storage.ts`

### Key State Types
```typescript
interface ExtensionState {
  status: 'idle' | 'processing' | 'success' | 'error';
  message?: string;
}

interface ExtensionOptions {
  apiKey: string;
  modelName: string;
  voice: string;
}
```

### Message Flow
1. Popup sends `START_TTS` message to background
2. Background injects content script into active tab
3. Content script extracts text using Readability.js, sends `CONTENT_EXTRACTED`
4. Background calls Gemini API for speech synthesis
5. Background downloads generated audio and updates state

## Technology Stack

- **Framework**: WXT (modern web extension framework)
- **Language**: TypeScript
- **UI**: React 19
- **Linting/Formatting**: Biome (tabs, double quotes)
- **Unit Testing**: Vitest with jsdom environment
- **E2E Testing**: Playwright (headless, single worker)
- **Content Extraction**: Mozilla Readability.js

## Key Implementation Details

### Content Script Injection
- Content scripts are programmatically injected by background script
- Uses `chrome.scripting.executeScript()` to inject `content.js`
- Content script extracts main article content using bundled Readability.js

### API Integration
- Uses Google Gemini API with multimodal audio generation
- API endpoint: `https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent`
- Requests audio response using `responseModalities: ["AUDIO"]`
- Returns base64-encoded audio data that gets converted to downloadable WAV file

### Security
- API keys stored in `chrome.storage.local` (sandboxed to extension)
- Requires permissions: `storage`, `activeTab`, `scripting`, `downloads`
- No data transmitted to third parties except Gemini API

## Testing Strategy

### Unit Tests (Vitest)
- Test storage utilities and data transformation logic
- Exclude E2E tests from unit test runs
- Use jsdom environment for DOM testing

### E2E Tests (Playwright)
- Extension testing requires sequential execution (single worker)
- Uses headless Chrome for CI compatibility
- Tests full user workflows: popup interaction, content extraction, API calls

## File Structure Notes

- `entrypoints/` - WXT convention for extension entry points
- `components/` - React components (Popup, Options)
- `lib/` - Utilities (storage helpers, readability.js)
- `public/` - Static assets (icons)
- `.output/chrome-mv3/` - Built extension files for Chrome

## Development Notes

- WXT handles manifest generation and build process
- Extension auto-reloads during development with `npm run dev`
- Background script runs as service worker (Manifest V3)
- State persistence allows users to close/reopen popup without losing progress