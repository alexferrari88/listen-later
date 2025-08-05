import { defineConfig } from "wxt";

export default defineConfig({
	modules: ["@wxt-dev/module-react"],
	manifest: {
		name: "Listen Later",
		description: "Convert web articles to speech using AI. Extract text from any webpage and generate high-quality audio using Google Gemini API.",
		permissions: [
			"storage",
			"activeTab",
			"scripting",
			"downloads",
			"notifications",
		],
		icons: {
			16: "/icon-16.png",
			32: "/icon-32.png", 
			48: "/icon-48.png",
			128: "/icon-128.png",
		},
	},
});
