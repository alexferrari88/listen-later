# Repository Guidelines

## Project Structure & Module Organization
Runtime code lives in `entrypoints/` (`background.ts`, `content.ts`, `popup/`, `options/`). Shared UI belongs in `components/`, reusable logic in `lib/`, and static art or manifest-ready files in `assets/` and `public/`. Keep unit specs in `tests/`, Playwright flows in `e2e/`, and inspect `playwright-report/` or `test-results/` when automation fails.

## Build, Test, and Development Commands
Use pnpm consistently (`pnpm install`). Common workflows:
- `pnpm dev` / `pnpm dev:firefox` — launch the hot-reload dev server for Chrome or Firefox.
- `pnpm build` / `pnpm build:firefox` — produce the optimized bundle in `.output/**`.
- `pnpm zip` / `pnpm zip:firefox` — emit store-ready archives after a successful build.
- `pnpm test`, `pnpm test:run`, `pnpm test:ui` — run Vitest suites (watch, single-shot, or UI).
- `pnpm e2e`, `pnpm e2e:headed`, `pnpm e2e:debug` — execute Playwright specs headlessly, visually, or with debugger tools.

## Coding Style & Naming Conventions
Biome (`biome.json`) is the source of truth: tabs for indentation, double quotes in JS/TS, and auto-organized imports. Prefer TypeScript everywhere; React components in `components/` and `entrypoints/**/` use `PascalCase.tsx`, hooks and helpers use `camelCase.ts`. Run `pnpm biome check .` before reviews and fix any lint or format violations before committing.

## Testing Guidelines
Vitest covers logic-level work; mirror source paths (e.g., `lib/audio.ts` → `tests/audio.test.ts`) and name files `*.test.ts`. Keep mocks lightweight to avoid WXT bundling issues. Playwright specs in `e2e/` validate article-to-audio flows defined by `playwright.config.ts`; prefer deterministic fixtures over live sites. Run `pnpm test && pnpm e2e` before pushing, and provide at least one unit spec plus, when UI-affecting, an E2E scenario.

## Commit & Pull Request Guidelines
Follow the recorded Conventional Commit style (`fix:`, `chore:`, `test:`) to keep history machine-parsable. PR descriptions should note user impact, link issues, and list verification steps (`pnpm test`, `pnpm e2e`, manual browsers). Add screenshots for popup/options UI edits and audio samples whenever encoding changes. Keep refactors and features in separate commits for faster review.

## Security & Configuration Tips
Never hardcode Gemini API keys; the options page writes them to extension storage, and secrets should be injected via `wxt.config.ts` env helpers when testing. Treat downloaded MP3 fixtures as temporary and avoid committing them. Scrub article content from logs before sharing, and run `pnpm clean` ahead of packaging so no stale credentials ship inside `.output`.
