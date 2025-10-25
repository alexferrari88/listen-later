# Listen Later

A Chrome extension that converts web articles into speech using Google Gemini API, allowing you to listen to content on the go.

## Features

- 🎧 Convert any webpage to speech using Google Gemini TTS
- 📖 Intelligent content extraction using Mozilla's Readability.js
- 💾 Download generated audio as MP3 files
- ✂️ Automatically chunks long articles into sub-10-minute batches to bypass Gemini's ~11-minute per-call audio ceiling and stitches them into a single MP3
- ⚙️ Configurable voice settings and API options
- 🔄 Persistent state management across sessions
- 🎨 Clean, React-based user interface

## Installation

### From Source

1. Clone the repository:
```bash
git clone https://github.com/alexferrari88/listen-later.git
cd listen-later
```

2. Install dependencies:
```bash
pnpm install
```

3. Build the extension:
```bash
pnpm build
```

4. Load the extension in Chrome:
   - Open Chrome and navigate to `chrome://extensions/`
   - Enable "Developer mode"
   - Click "Load unpacked" and select the `.output/chrome-mv3` directory

## Configuration

1. Click the extension icon and select "Options"
2. Configure your settings:
   - **API Key**: Your Google Gemini API key
   - **Model Name**: The Gemini model to use (default: `gemini-1.5-flash`)
   - **Voice**: Voice selection for speech synthesis

## Usage

1. Navigate to any webpage with readable content
2. Click the Listen Later extension icon
3. Click "Generate Speech" to start the conversion process
4. The extension will:
   - Extract the main article content
   - Send it to Google Gemini for speech synthesis
   - Prompt you to download the resulting MP3 file

## Development

### Prerequisites

- Node.js (v18+ recommended)
- pnpm
- Chrome or Chromium browser

### Available Scripts

- `pnpm dev` - Start development server for Chrome
- `pnpm dev:firefox` - Start development server for Firefox
- `pnpm build` - Build production version
- `pnpm build:firefox` - Build for Firefox
- `pnpm test` - Run unit tests with Vitest
- `pnpm test:ui` - Run tests with Vitest UI
- `pnpm test:run` - Run tests once without watch mode
- `pnpm e2e` - Run Playwright end-to-end tests
- `pnpm e2e:headed` - Run E2E tests with browser UI
- `pnpm e2e:debug` - Run E2E tests in debug mode
- `pnpm clean` - Remove build output directory
- `pnpm zip` - Create distribution ZIP for Chrome Web Store
- `pnpm zip:firefox` - Create distribution ZIP for Firefox Add-ons

### Technology Stack

- **Framework**: [WXT](https://wxt.dev/) - Modern web extension framework
- **Language**: TypeScript
- **UI**: React 19
- **Linting/Formatting**: Biome
- **Unit Testing**: Vitest
- **E2E Testing**: Playwright
- **Content Extraction**: Mozilla Readability.js

### Architecture

The extension follows a background-first architecture:

- **Background Script**: Manages state, API calls, and coordination
- **Popup**: React-based UI that reflects background state
- **Content Script**: Extracts article content from webpages
- **Options Page**: Configuration interface for API settings

## Project Structure

```
├── entrypoints/
│   ├── background.ts      # Background service worker
│   ├── content.ts         # Content script for text extraction
│   ├── popup/            # Popup UI components
│   └── options/          # Options page components
├── components/           # React components
├── lib/                 # Utilities and libraries
└── public/              # Static assets
```

## Contributing

1. Fork the repository
2. Create a feature branch: `git checkout -b feature-name`
3. Make your changes and add tests
4. Run the test suite: `pnpm test && pnpm e2e`
5. Commit your changes: `git commit -m 'Add feature'`
6. Push to the branch: `git push origin feature-name`
7. Submit a pull request

## License

ISC License - see the LICENSE file for details.

## Privacy & Security

- API keys are stored locally in Chrome's secure extension storage
- No data is transmitted to third parties except Google Gemini API
- Content extraction happens locally in your browser
- Generated audio files are saved directly to your device
