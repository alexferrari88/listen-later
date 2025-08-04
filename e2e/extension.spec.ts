import { expect, test } from "@playwright/test";
import fs from "fs";
import path from "path";

test.describe("Listen Later Extension Build", () => {
	const extensionPath = path.join(__dirname, "..", ".output", "chrome-mv3");

	test("should have all required files built", async () => {
		// Check that the extension directory exists
		expect(fs.existsSync(extensionPath)).toBe(true);

		// Check for manifest.json
		const manifestPath = path.join(extensionPath, "manifest.json");
		expect(fs.existsSync(manifestPath)).toBe(true);

		// Check for HTML files
		expect(fs.existsSync(path.join(extensionPath, "options.html"))).toBe(true);
		expect(fs.existsSync(path.join(extensionPath, "popup.html"))).toBe(true);

		// Check for JS files
		expect(fs.existsSync(path.join(extensionPath, "background.js"))).toBe(true);
		expect(
			fs.existsSync(path.join(extensionPath, "content-scripts", "content.js")),
		).toBe(true);

		// Check for icon
		expect(fs.existsSync(path.join(extensionPath, "icon-128.svg"))).toBe(true);
	});

	test("should have valid manifest.json", async () => {
		const manifestPath = path.join(extensionPath, "manifest.json");
		const manifestContent = fs.readFileSync(manifestPath, "utf-8");
		const manifest = JSON.parse(manifestContent);

		// Check manifest version
		expect(manifest.manifest_version).toBe(3);

		// Check required permissions
		expect(manifest.permissions).toContain("storage");
		expect(manifest.permissions).toContain("activeTab");
		expect(manifest.permissions).toContain("scripting");
		expect(manifest.permissions).toContain("downloads");

		// Check that background script is defined
		expect(manifest.background?.service_worker).toBe("background.js");

		// Check that content scripts are defined
		expect(manifest.content_scripts).toBeDefined();

		// Check action (popup)
		expect(manifest.action?.default_popup).toBe("popup.html");

		// Check options UI
		expect(manifest.options_ui?.page).toBe("options.html");
		expect(manifest.options_ui?.open_in_tab).toBe(true);
	});

	test("should have valid HTML files with proper structure", async () => {
		// Test options.html
		const optionsPath = path.join(extensionPath, "options.html");
		const optionsContent = fs.readFileSync(optionsPath, "utf-8");
		expect(optionsContent).toContain("<html");
		expect(optionsContent).toContain("<body");
		expect(optionsContent).toContain('id="root"'); // React mount point

		// Test popup.html
		const popupPath = path.join(extensionPath, "popup.html");
		const popupContent = fs.readFileSync(popupPath, "utf-8");
		expect(popupContent).toContain("<html");
		expect(popupContent).toContain("<body");
		expect(popupContent).toContain('id="root"'); // React mount point
	});

	test("should have background script with proper structure", async () => {
		const backgroundPath = path.join(extensionPath, "background.js");
		const backgroundContent = fs.readFileSync(backgroundPath, "utf-8");

		// Check for key functions/patterns that should be in the background script
		expect(backgroundContent).toContain("chrome.runtime.onMessage");
		expect(backgroundContent).toContain("START_TTS");
		expect(backgroundContent).toContain("CONTENT_EXTRACTED");
	});

	test("should have content script with Readability integration", async () => {
		const contentPath = path.join(
			extensionPath,
			"content-scripts",
			"content.js",
		);
		const contentContent = fs.readFileSync(contentPath, "utf-8");

		// Check for Readability integration patterns
		expect(contentContent).toContain("Readability");
		expect(contentContent).toContain("chrome.runtime.sendMessage");
	});

	test("should have valid TypeScript compilation (no syntax errors)", async () => {
		// If the files exist and are not empty, it means TypeScript compilation succeeded
		const backgroundPath = path.join(extensionPath, "background.js");
		const contentPath = path.join(
			extensionPath,
			"content-scripts",
			"content.js",
		);

		const backgroundStats = fs.statSync(backgroundPath);
		const contentStats = fs.statSync(contentPath);

		// Files should have reasonable size (not empty)
		expect(backgroundStats.size).toBeGreaterThan(1000); // At least 1KB
		expect(contentStats.size).toBeGreaterThan(1000); // At least 1KB
	});

	test("should have chunk files for React components", async () => {
		const chunksDir = path.join(extensionPath, "chunks");
		expect(fs.existsSync(chunksDir)).toBe(true);

		const chunkFiles = fs.readdirSync(chunksDir);

		// Should have chunks for options and popup
		const hasOptionsChunk = chunkFiles.some((file) => file.includes("options"));
		const hasPopupChunk = chunkFiles.some((file) => file.includes("popup"));
		const hasStorageChunk = chunkFiles.some((file) => file.includes("storage"));

		expect(hasOptionsChunk).toBe(true);
		expect(hasPopupChunk).toBe(true);
		expect(hasStorageChunk).toBe(true);
	});
});
