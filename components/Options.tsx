import type React from "react";
import { useCallback, useEffect, useState } from "react";
import { logger } from "../lib/logger";
import {
	addSpeechStylePrompt,
	deleteSpeechStylePrompt,
	type ExtensionOptions,
	getDefaultExtensionOptions,
	getExtensionOptions,
	setDefaultSpeechStylePrompt,
	setExtensionOptions,
	type SpeechStylePrompt,
	substituteSpeechStyleTemplate,
	updateSpeechStylePrompt,
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
		voice: "Aoede",
		speechStylePrompts: [],
		defaultPromptId: "documentary",
	});
	const [isLoading, setIsLoading] = useState(true);
	const [isSaving, setIsSaving] = useState(false);
	const [saveMessage, setSaveMessage] = useState("");
	
	// Prompt management state
	const [editingPrompt, setEditingPrompt] = useState<SpeechStylePrompt | null>(null);
	const [showAddPrompt, setShowAddPrompt] = useState(false);
	const [promptPreview, setPromptPreview] = useState("");

	// Load existing options on mount
	useEffect(() => {
		const loadOptions = async () => {
			try {
				logger.debug("Loading extension options");
				const existingOptions = await getExtensionOptions();
				if (existingOptions) {
					logger.debug("Loaded existing options", {
						hasApiKey: !!existingOptions.apiKey,
						modelName: existingOptions.modelName,
						voice: existingOptions.voice,
					});
					setOptions(existingOptions);
				} else {
					logger.debug("No existing options, using defaults");
					const defaultOptions = await getDefaultExtensionOptions();
					setOptions(defaultOptions);
				}
			} catch (error) {
				logger.error("Failed to load options:", error);
				const defaultOptions = await getDefaultExtensionOptions();
				setOptions(defaultOptions);
			} finally {
				setIsLoading(false);
			}
		};

		loadOptions();
	}, []);

	const handleInputChange = (field: keyof ExtensionOptions, value: string) => {
		logger.debug("Option changed", {
			field,
			value: field === "apiKey" ? "[REDACTED]" : value,
		});
		setOptions((prev) => ({
			...prev,
			[field]: value,
		}));
	};

	const handleSave = async () => {
		setIsSaving(true);
		setSaveMessage("");
		logger.debug("Saving options", {
			hasApiKey: !!options.apiKey,
			modelName: options.modelName,
			voice: options.voice,
		});

		try {
			await setExtensionOptions(options);
			logger.info("Options saved successfully");
			setSaveMessage("Settings saved successfully!");
			setTimeout(() => setSaveMessage(""), 3000);
		} catch (error) {
			logger.error("Failed to save options:", error);
			setSaveMessage("Failed to save settings. Please try again.");
		} finally {
			setIsSaving(false);
		}
	};

	// Prompt management functions
	const handleAddPrompt = async (prompt: Omit<SpeechStylePrompt, 'id'>) => {
		try {
			const promptId = await addSpeechStylePrompt(prompt);
			const updatedOptions = await getExtensionOptions();
			if (updatedOptions) {
				setOptions(updatedOptions);
			}
			setShowAddPrompt(false);
			setSaveMessage("Prompt added successfully!");
			setTimeout(() => setSaveMessage(""), 3000);
		} catch (error) {
			logger.error("Failed to add prompt:", error);
			setSaveMessage("Failed to add prompt. Please try again.");
		}
	};

	const handleEditPrompt = async (promptId: string, updates: Partial<Omit<SpeechStylePrompt, 'id'>>) => {
		try {
			await updateSpeechStylePrompt(promptId, updates);
			const updatedOptions = await getExtensionOptions();
			if (updatedOptions) {
				setOptions(updatedOptions);
			}
			setEditingPrompt(null);
			setSaveMessage("Prompt updated successfully!");
			setTimeout(() => setSaveMessage(""), 3000);
		} catch (error) {
			logger.error("Failed to update prompt:", error);
			setSaveMessage("Failed to update prompt. Please try again.");
		}
	};

	const handleDeletePrompt = async (promptId: string) => {
		if (!confirm("Are you sure you want to delete this prompt?")) return;
		
		try {
			await deleteSpeechStylePrompt(promptId);
			const updatedOptions = await getExtensionOptions();
			if (updatedOptions) {
				setOptions(updatedOptions);
			}
			setSaveMessage("Prompt deleted successfully!");
			setTimeout(() => setSaveMessage(""), 3000);
		} catch (error) {
			logger.error("Failed to delete prompt:", error);
			setSaveMessage("Failed to delete prompt. Please try again.");
		}
	};

	const handleSetDefaultPrompt = async (promptId: string) => {
		try {
			await setDefaultSpeechStylePrompt(promptId);
			const updatedOptions = await getExtensionOptions();
			if (updatedOptions) {
				setOptions(updatedOptions);
			}
			setSaveMessage("Default prompt updated!");
			setTimeout(() => setSaveMessage(""), 3000);
		} catch (error) {
			logger.error("Failed to set default prompt:", error);
			setSaveMessage("Failed to set default prompt. Please try again.");
		}
	};

	const updatePromptPreview = useCallback((template: string) => {
		try {
			const sampleText = "This is a sample article about technology and innovation.";
			const preview = substituteSpeechStyleTemplate(template, sampleText);
			setPromptPreview(preview);
		} catch (error) {
			console.error("Error in updatePromptPreview:", error);
			setPromptPreview("Error generating preview");
		}
	}, []);

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

				{/* Speech Style Prompts Section */}
				<div style={{ marginBottom: "30px" }}>
					<label
						style={{
							display: "block",
							marginBottom: "12px",
							fontWeight: "bold",
							fontSize: "16px",
						}}
					>
						Speech Style Prompts
					</label>
					
					{/* Default Prompt Selector */}
					<div style={{ marginBottom: "15px" }}>
						<label
							htmlFor="defaultPrompt"
							style={{
								display: "block",
								marginBottom: "6px",
								fontWeight: "500",
								fontSize: "14px",
							}}
						>
							Default Prompt
						</label>
						<select
							id="defaultPrompt"
							value={options.defaultPromptId}
							onChange={(e) => handleSetDefaultPrompt(e.target.value)}
							style={{
								width: "100%",
								padding: "8px",
								border: "1px solid #ccc",
								borderRadius: "4px",
								fontSize: "14px",
							}}
						>
							{options.speechStylePrompts.map((prompt) => (
								<option key={prompt.id} value={prompt.id}>
									{prompt.name}
								</option>
							))}
						</select>
						<small style={{ color: "#666", marginTop: "4px", display: "block" }}>
							This prompt will be used by default when generating speech
						</small>
					</div>

					{/* Prompts List */}
					<div style={{ marginBottom: "15px" }}>
						<div style={{ 
							display: "flex", 
							justifyContent: "space-between", 
							alignItems: "center",
							marginBottom: "10px"
						}}>
							<span style={{ fontWeight: "500", fontSize: "14px" }}>
								Available Prompts ({options.speechStylePrompts.length})
							</span>
							<button
								type="button"
								onClick={() => setShowAddPrompt(true)}
								style={{
									padding: "6px 12px",
									backgroundColor: "#4285f4",
									color: "white",
									border: "none",
									borderRadius: "4px",
									fontSize: "12px",
									cursor: "pointer",
								}}
							>
								+ Add Prompt
							</button>
						</div>

						{/* Prompt Cards */}
						<div style={{ 
							maxHeight: "300px", 
							overflowY: "auto",
							border: "1px solid #e0e0e0",
							borderRadius: "4px",
							padding: "8px"
						}}>
							{options.speechStylePrompts.map((prompt) => (
								<div
									key={prompt.id}
									style={{
										border: "1px solid #e0e0e0",
										borderRadius: "4px",
										padding: "12px",
										marginBottom: "8px",
										backgroundColor: prompt.id === options.defaultPromptId ? "#f0f8ff" : "#fafafa",
									}}
								>
									<div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
										<div style={{ flex: 1 }}>
											<div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "4px" }}>
												<strong style={{ fontSize: "14px" }}>{prompt.name}</strong>
												{prompt.id === options.defaultPromptId && (
													<span style={{
														fontSize: "10px",
														padding: "2px 6px",
														backgroundColor: "#4285f4",
														color: "white",
														borderRadius: "2px"
													}}>
														DEFAULT
													</span>
												)}
												{prompt.isDefault && (
													<span style={{
														fontSize: "10px",
														padding: "2px 6px",
														backgroundColor: "#28a745",
														color: "white",
														borderRadius: "2px"
													}}>
														BUILT-IN
													</span>
												)}
											</div>
											<p style={{ fontSize: "12px", color: "#666", margin: "0 0 6px 0" }}>
												{prompt.description}
											</p>
											<p style={{ 
												fontSize: "11px", 
												color: "#999", 
												margin: "0",
												fontFamily: "monospace",
												backgroundColor: "#f5f5f5",
												padding: "4px",
												borderRadius: "2px",
												wordBreak: "break-word"
											}}>
												{prompt.template}
											</p>
										</div>
										<div style={{ display: "flex", gap: "4px", marginLeft: "12px" }}>
											{!prompt.isDefault && (
												<>
													<button
														type="button"
														onClick={() => setEditingPrompt(prompt)}
														style={{
															padding: "4px 8px",
															backgroundColor: "transparent",
															color: "#666",
															border: "1px solid #ccc",
															borderRadius: "2px",
															fontSize: "11px",
															cursor: "pointer",
														}}
													>
														Edit
													</button>
													<button
														type="button"
														onClick={() => handleDeletePrompt(prompt.id)}
														style={{
															padding: "4px 8px",
															backgroundColor: "transparent",
															color: "#dc3545",
															border: "1px solid #dc3545",
															borderRadius: "2px",
															fontSize: "11px",
															cursor: "pointer",
														}}
													>
														Delete
													</button>
												</>
											)}
											{prompt.id !== options.defaultPromptId && (
												<button
													type="button"
													onClick={() => handleSetDefaultPrompt(prompt.id)}
													style={{
														padding: "4px 8px",
														backgroundColor: "transparent",
														color: "#4285f4",
														border: "1px solid #4285f4",
														borderRadius: "2px",
														fontSize: "11px",
														cursor: "pointer",
													}}
												>
													Set Default
												</button>
											)}
										</div>
									</div>
								</div>
							))}
						</div>
					</div>
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

			{/* Add Prompt Modal */}
			{showAddPrompt && <PromptModal
				title="Add New Speech Style Prompt"
				onSave={handleAddPrompt}
				onCancel={() => setShowAddPrompt(false)}
				updatePreview={updatePromptPreview}
				preview={promptPreview}
			/>}

			{/* Edit Prompt Modal */}
			{editingPrompt && <PromptModal
				title="Edit Speech Style Prompt"
				prompt={editingPrompt}
				onSave={(prompt) => handleEditPrompt(editingPrompt.id, prompt)}
				onCancel={() => setEditingPrompt(null)}
				updatePreview={updatePromptPreview}
				preview={promptPreview}
			/>}
		</div>
	);
};

// Prompt Modal Component
interface PromptModalProps {
	title: string;
	prompt?: SpeechStylePrompt;
	onSave: (prompt: Omit<SpeechStylePrompt, 'id'>) => void;
	onCancel: () => void;
	updatePreview: (template: string) => void;
	preview: string;
}

const PromptModal: React.FC<PromptModalProps> = ({ 
	title, 
	prompt, 
	onSave, 
	onCancel,
	updatePreview,
	preview
}) => {
	const [formData, setFormData] = useState({
		name: prompt?.name || "",
		description: prompt?.description || "",
		template: prompt?.template || "Narrate the following text in a ${content}",
	});

	useEffect(() => {
		updatePreview(formData.template);
	}, [formData.template, updatePreview]);

	const handleSubmit = (e: React.FormEvent) => {
		e.preventDefault();
		if (formData.name.trim() && formData.description.trim() && formData.template.trim()) {
			onSave({
				name: formData.name.trim(),
				description: formData.description.trim(),
				template: formData.template.trim(),
			});
		}
	};

	return (
		<div style={{
			position: "fixed",
			top: "0",
			left: "0",
			right: "0",
			bottom: "0",
			backgroundColor: "rgba(0, 0, 0, 0.5)",
			display: "flex",
			alignItems: "center",
			justifyContent: "center",
			zIndex: 1000,
		}}>
			<div style={{
				backgroundColor: "white",
				borderRadius: "8px",
				padding: "24px",
				width: "90vw",
				maxWidth: "600px",
				maxHeight: "80vh",
				overflow: "auto",
			}}>
				<h3 style={{ margin: "0 0 20px 0", fontSize: "18px" }}>{title}</h3>
				
				<form onSubmit={handleSubmit}>
					<div style={{ marginBottom: "15px" }}>
						<label style={{ display: "block", marginBottom: "6px", fontWeight: "500" }}>
							Prompt Name *
						</label>
						<input
							type="text"
							value={formData.name}
							onChange={(e) => setFormData(prev => ({ ...prev, name: e.target.value }))}
							placeholder="e.g., Casual Conversation"
							required
							style={{
								width: "100%",
								padding: "8px",
								border: "1px solid #ccc",
								borderRadius: "4px",
								fontSize: "14px",
							}}
						/>
					</div>

					<div style={{ marginBottom: "15px" }}>
						<label style={{ display: "block", marginBottom: "6px", fontWeight: "500" }}>
							Description *
						</label>
						<input
							type="text"
							value={formData.description}
							onChange={(e) => setFormData(prev => ({ ...prev, description: e.target.value }))}
							placeholder="e.g., Friendly, casual tone for everyday content"
							required
							style={{
								width: "100%",
								padding: "8px",
								border: "1px solid #ccc",
								borderRadius: "4px",
								fontSize: "14px",
							}}
						/>
					</div>

					<div style={{ marginBottom: "15px" }}>
						<label style={{ display: "block", marginBottom: "6px", fontWeight: "500" }}>
							Template *
						</label>
						<textarea
							value={formData.template}
							onChange={(e) => setFormData(prev => ({ ...prev, template: e.target.value }))}
							placeholder="Read this text in a casual, friendly tone: ${content}"
							required
							rows={3}
							style={{
								width: "100%",
								padding: "8px",
								border: "1px solid #ccc",
								borderRadius: "4px",
								fontSize: "14px",
								resize: "vertical",
							}}
						/>
						<small style={{ color: "#666", display: "block", marginTop: "4px" }}>
							Use {'${content}'} as a placeholder for the article text. End your prompt with a colon (:) for best results.
						</small>
					</div>

					{/* Preview Section */}
					{preview && (
						<div style={{ marginBottom: "20px" }}>
							<label style={{ display: "block", marginBottom: "6px", fontWeight: "500" }}>
								Preview
							</label>
							<div style={{
								padding: "12px",
								backgroundColor: "#f5f5f5",
								border: "1px solid #e0e0e0",
								borderRadius: "4px",
								fontSize: "12px",
								fontFamily: "monospace",
								wordBreak: "break-word",
								maxHeight: "120px",
								overflow: "auto",
							}}>
								{preview}
							</div>
						</div>
					)}

					<div style={{ display: "flex", gap: "10px", justifyContent: "flex-end" }}>
						<button
							type="button"
							onClick={onCancel}
							style={{
								padding: "10px 16px",
								backgroundColor: "transparent",
								color: "#666",
								border: "1px solid #ccc",
								borderRadius: "4px",
								fontSize: "14px",
								cursor: "pointer",
							}}
						>
							Cancel
						</button>
						<button
							type="submit"
							disabled={!formData.name.trim() || !formData.description.trim() || !formData.template.trim()}
							style={{
								padding: "10px 16px",
								backgroundColor: formData.name.trim() && formData.description.trim() && formData.template.trim() 
									? "#4285f4" : "#ccc",
								color: "white",
								border: "none",
								borderRadius: "4px",
								fontSize: "14px",
								cursor: formData.name.trim() && formData.description.trim() && formData.template.trim() 
									? "pointer" : "not-allowed",
							}}
						>
							{prompt ? "Update" : "Add"} Prompt
						</button>
					</div>
				</form>
			</div>
		</div>
	);
};

export default Options;
