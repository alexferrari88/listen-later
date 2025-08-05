# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Listen Later is a Chrome extension that converts web articles to speech using Google Gemini API. It uses a background-first architecture where the background script manages state and coordinates between the popup UI, content scripts, and API calls.

### Project Maturity & Scope

This is a personal hobby project in MVP (Minimum Viable Product) stage. Development prioritizes simplicity and functionality over enterprise-grade practices. Features are implemented with a "get it working" mindset rather than production-scale architecture. This context should guide all development decisions toward pragmatic, straightforward solutions.

## Development Commands

### Core Development
- `pnpm dev` - Start development server for Chrome (auto-reloads extension)
- `pnpm dev:firefox` - Start development server for Firefox
- `pnpm build` - Build production version for Chrome
- `pnpm build:firefox` - Build production version for Firefox

### Testing & Quality
- `pnpm test` - Run unit tests with Vitest
- `pnpm test:ui` - Run tests with Vitest UI
- `pnpm test:run` - Run tests once without watch mode
- `pnpm e2e` - Run Playwright end-to-end tests
- `pnpm e2e:headed` - Run E2E tests with browser UI
- `pnpm e2e:debug` - Run E2E tests in debug mode

### Code Quality
- Use Biome for linting and formatting (configured with tabs, double quotes)
- Biome automatically organizes imports on save
- E2E tests require single worker mode due to extension testing constraints

### Distribution
- `pnpm zip` - Create distribution ZIP for Chrome Web Store
- `pnpm zip:firefox` - Create distribution ZIP for Firefox Add-ons

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

**⚠️ CRITICAL: Content Script Match Patterns**
- NEVER use `matches: ['<all_urls>']` in content scripts - this causes mass tab reloads on extension install
- Use restrictive patterns like `matches: ['http://localhost/*']` for programmatically injected scripts
- Chrome prepares extension context for all matching tabs during installation, causing system freezes
- Since we use programmatic injection, the match pattern should be minimal and non-disruptive

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

## Available MCP Tools

Claude Code has access to additional development tools through MCP (Model Context Protocol):

- **Context7**: Fetch up-to-date documentation and code examples for any library or framework
- **Playwright Browser**: Automated browser testing and web page interaction capabilities

These tools extend Claude's capabilities beyond the core development environment, enabling real-time documentation lookup and browser automation for testing and debugging.

## Development Notes

- WXT handles manifest generation and build process
- Extension auto-reloads during development with `pnpm dev`
- Background script runs as service worker (Manifest V3)
- State persistence allows users to close/reopen popup without losing progress

## Common Issues & Debugging

### React JSX Template Literal Syntax Error

**Issue**: Using `${variable}` directly in JSX text content causes React to interpret it as JavaScript template literal syntax, looking for a variable in scope and throwing errors like "An error occurred in the component".

**Example of problematic code**:
```jsx
<small>Use ${content} as placeholder</small>  // ❌ React looks for 'content' variable
```

**Solution**: Escape template literals in JSX using string literals in curly braces:
```jsx
<small>Use {'${content}'} as placeholder</small>  // ✅ Renders as literal text
```

**Root Cause**: JSX interprets `${...}` as JavaScript template literal syntax, not literal text. This commonly occurs when displaying instructions about template variables to users.

**Debugging Pattern**: When React components crash with generic error messages, check for unescaped template literal syntax in JSX text content.