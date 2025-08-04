import type React from "react";
import { useEffect, useState } from "react";
import {
	type ExtensionOptions,
	getDefaultExtensionOptions,
	getExtensionOptions,
	setExtensionOptions,
} from "../lib/storage";

const SUPPORTED_MODELS = [
	"gemini-2.5-flash-preview-tts",
	"gemini-2.5-pro-preview-tts",
];

const VOICE_OPTIONS = [
	{ name: "Zephyr", description: "Bright" },
	{ name: "Puck", description: "Upbeat" },
	{ name: "Charon", description: "Informative" },
	{ name: "Kore", description: "Firm" },
	{ name: "Fenrir", description: "Excitable" },
	{ name: "Leda", description: "Youthful" },
	{ name: "Orus", description: "Firm" },
	{ name: "Aoede", description: "Breezy" },
	{ name: "Callirrhoe", description: "Easy-going" },
	{ name: "Autonoe", description: "Bright" },
	{ name: "Enceladus", description: "Breathy" },
	{ name: "Iapetus", description: "Clear" },
	{ name: "Umbriel", description: "Easy-going" },
	{ name: "Algieba", description: "Smooth" },
	{ name: "Despina", description: "Smooth" },
	{ name: "Erinome", description: "Clear" },
	{ name: "Algenib", description: "Gravelly" },
	{ name: "Rasalgethi", description: "Informative" },
	{ name: "Laomedeia", description: "Upbeat" },
	{ name: "Achernar", description: "Soft" },
	{ name: "Alnilam", description: "Firm" },
	{ name: "Schedar", description: "Even" },
	{ name: "Gacrux", description: "Mature" },
	{ name: "Pulcherrima", description: "Forward" },
	{ name: "Achird", description: "Friendly" },
	{ name: "Zubenelgenubi", description: "Casual" },
	{ name: "Vindemiatrix", description: "Gentle" },
	{ name: "Sadachbia", description: "Lively" },
	{ name: "Sadaltager", description: "Knowledgeable" },
	{ name: "Sulafat", description: "Warm" },
];

const Options: React.FC = () => {
	const [options, setOptions] = useState<ExtensionOptions>({
		apiKey: "",
		modelName: "gemini-2.5-flash-preview-tts",
		voice: "Kore",
	});
	const [isLoading, setIsLoading] = useState(true);
	const [isSaving, setIsSaving] = useState(false);
	const [saveMessage, setSaveMessage] = useState("");

	// Load existing options on mount
	useEffect(() => {
		const loadOptions = async () => {
			try {
				const existingOptions = await getExtensionOptions();
				if (existingOptions) {
					setOptions(existingOptions);
				} else {
					const defaultOptions = await getDefaultExtensionOptions();
					setOptions(defaultOptions);
				}
			} catch (error) {
				console.error("Failed to load options:", error);
				const defaultOptions = await getDefaultExtensionOptions();
				setOptions(defaultOptions);
			} finally {
				setIsLoading(false);
			}
		};

		loadOptions();
	}, []);

	const handleInputChange = (field: keyof ExtensionOptions, value: string) => {
		setOptions((prev) => ({
			...prev,
			[field]: value,
		}));
	};

	const handleSave = async () => {
		setIsSaving(true);
		setSaveMessage("");

		try {
			await setExtensionOptions(options);
			setSaveMessage("Settings saved successfully!");
			setTimeout(() => setSaveMessage(""), 3000);
		} catch (error) {
			console.error("Failed to save options:", error);
			setSaveMessage("Failed to save settings. Please try again.");
		} finally {
			setIsSaving(false);
		}
	};

	if (isLoading) {
		return (
			<div style={{ padding: "20px", textAlign: "center" }}>
				<h1>Listen Later - Options</h1>
				<p>Loading settings...</p>
			</div>
		);
	}

	return (
		<div style={{ padding: "20px", maxWidth: "600px", margin: "0 auto" }}>
			<h1>Listen Later - Options</h1>
			<p style={{ marginBottom: "30px", color: "#666" }}>
				Configure your Gemini API settings for text-to-speech conversion.
			</p>

			<form
				onSubmit={(e) => {
					e.preventDefault();
					handleSave();
				}}
			>
				<div style={{ marginBottom: "20px" }}>
					<label
						htmlFor="apiKey"
						style={{
							display: "block",
							marginBottom: "8px",
							fontWeight: "bold",
						}}
					>
						Gemini API Key *
					</label>
					<input
						id="apiKey"
						type="password"
						value={options.apiKey}
						onChange={(e) => handleInputChange("apiKey", e.target.value)}
						placeholder="Enter your Gemini API key"
						required
						style={{
							width: "100%",
							padding: "10px",
							border: "1px solid #ccc",
							borderRadius: "4px",
							fontSize: "14px",
						}}
					/>
					<small style={{ color: "#666", marginTop: "4px", display: "block" }}>
						Get your API key from{" "}
						<a
							href="https://aistudio.google.com/api_key"
							target="_blank"
							rel="noopener noreferrer"
						>
							Google AI Studio
						</a>
					</small>
				</div>

				<div style={{ marginBottom: "20px" }}>
					<label
						htmlFor="modelName"
						style={{
							display: "block",
							marginBottom: "8px",
							fontWeight: "bold",
						}}
					>
						Model
					</label>
					<select
						id="modelName"
						value={options.modelName}
						onChange={(e) => handleInputChange("modelName", e.target.value)}
						style={{
							width: "100%",
							padding: "10px",
							border: "1px solid #ccc",
							borderRadius: "4px",
							fontSize: "14px",
						}}
					>
						{SUPPORTED_MODELS.map((model) => (
							<option key={model} value={model}>
								{model}
							</option>
						))}
					</select>
				</div>

				<div style={{ marginBottom: "30px" }}>
					<label
						htmlFor="voice"
						style={{
							display: "block",
							marginBottom: "8px",
							fontWeight: "bold",
						}}
					>
						Voice
					</label>
					<select
						id="voice"
						value={options.voice}
						onChange={(e) => handleInputChange("voice", e.target.value)}
						style={{
							width: "100%",
							padding: "10px",
							border: "1px solid #ccc",
							borderRadius: "4px",
							fontSize: "14px",
						}}
					>
						{VOICE_OPTIONS.map((voice) => (
							<option key={voice.name} value={voice.name}>
								{voice.name} - {voice.description}
							</option>
						))}
					</select>
					<small style={{ color: "#666", marginTop: "4px", display: "block" }}>
						You can preview voices at{" "}
						<a
							href="https://aistudio.google.com/generate-speech"
							target="_blank"
							rel="noopener noreferrer"
						>
							AI Studio
						</a>
					</small>
				</div>

				<button
					type="submit"
					disabled={isSaving || !options.apiKey.trim()}
					style={{
						padding: "12px 24px",
						backgroundColor: options.apiKey.trim() ? "#4285f4" : "#ccc",
						color: "white",
						border: "none",
						borderRadius: "4px",
						fontSize: "16px",
						cursor: options.apiKey.trim() ? "pointer" : "not-allowed",
						marginRight: "10px",
					}}
				>
					{isSaving ? "Saving..." : "Save Settings"}
				</button>

				{saveMessage && (
					<div
						style={{
							marginTop: "15px",
							padding: "10px",
							borderRadius: "4px",
							backgroundColor: saveMessage.includes("successfully")
								? "#d4edda"
								: "#f8d7da",
							color: saveMessage.includes("successfully")
								? "#155724"
								: "#721c24",
							border: `1px solid ${
								saveMessage.includes("successfully") ? "#c3e6cb" : "#f5c6cb"
							}`,
						}}
					>
						{saveMessage}
					</div>
				)}
			</form>
		</div>
	);
};

export default Options;
