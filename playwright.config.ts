import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
	testDir: "./e2e",
	fullyParallel: false, // Extensions need sequential testing
	forbidOnly: !!process.env.CI,
	retries: process.env.CI ? 2 : 0,
	workers: 1, // Extension testing requires single worker
	reporter: "list",
	use: {
		trace: "on-first-retry",
		headless: true, // Try headless first for CI compatibility
	},

	projects: [
		{
			name: "chromium-extension",
			use: {
				...devices["Desktop Chrome"],
				headless: true, // Try headless for CI compatibility
			},
		},
	],
});
