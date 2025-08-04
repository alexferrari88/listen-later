import { defineConfig } from "wxt";

export default defineConfig({
	modules: ["@wxt-dev/module-react"],
	manifest: {
		permissions: ["storage", "activeTab", "scripting", "downloads"],
		web_accessible_resources: [
			{
				resources: ["lib/readability.js"],
				matches: ["*://*/*"],
			},
		],
	},
});
