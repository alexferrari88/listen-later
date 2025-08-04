import type React from "react";
import { useEffect, useState } from "react";
import {
	areOptionsConfigured,
	type ExtensionState,
	getExtensionState,
	resetExtensionState,
} from "../lib/storage";

const Popup: React.FC = () => {
	const [state, setState] = useState<ExtensionState>({ status: "idle" });
	const [isOptionsConfigured, setIsOptionsConfigured] = useState(false);
	const [isLoading, setIsLoading] = useState(true);

	// Load initial state and check if options are configured
	useEffect(() => {
		const loadState = async () => {
			try {
				const [currentState, optionsConfigured] = await Promise.all([
					getExtensionState(),
					areOptionsConfigured(),
				]);
				setState(currentState);
				setIsOptionsConfigured(optionsConfigured);
			} catch (error) {
				console.error("Failed to load popup state:", error);
			} finally {
				setIsLoading(false);
			}
		};

		loadState();
	}, []);

	// Listen for state changes in storage
	useEffect(() => {
		const handleStorageChange = (changes: {
			[key: string]: chrome.storage.StorageChange;
		}) => {
			if (changes.extensionState) {
				setState(changes.extensionState.newValue);
			}
			if (changes.extensionOptions) {
				// Re-check if options are configured when they change
				areOptionsConfigured().then(setIsOptionsConfigured);
			}
		};

		chrome.storage.onChanged.addListener(handleStorageChange);
		return () => chrome.storage.onChanged.removeListener(handleStorageChange);
	}, []);

	const handleGenerateClick = async () => {
		try {
			await chrome.runtime.sendMessage({ type: "START_TTS" });
		} catch (error) {
			console.error("Failed to send START_TTS message:", error);
		}
	};

	const handleTryAgain = async () => {
		try {
			await resetExtensionState();
		} catch (error) {
			console.error("Failed to reset state:", error);
		}
	};

	const openOptionsPage = () => {
		chrome.runtime.openOptionsPage();
	};

	if (isLoading) {
		return (
			<div style={containerStyle}>
				<div style={headerStyle}>
					<h2 style={titleStyle}>Listen Later</h2>
				</div>
				<div style={contentStyle}>
					<p>Loading...</p>
				</div>
			</div>
		);
	}

	// Options not configured view
	if (!isOptionsConfigured) {
		return (
			<div style={containerStyle}>
				<div style={headerStyle}>
					<h2 style={titleStyle}>Listen Later</h2>
				</div>
				<div style={contentStyle}>
					<div style={warningStyle}>
						<p style={{ margin: "0 0 15px 0" }}>⚠️ Configuration required</p>
						<p style={{ margin: "0 0 20px 0", fontSize: "14px" }}>
							Please configure your Gemini API key in the options page.
						</p>
						<button onClick={openOptionsPage} style={primaryButtonStyle}>
							Open Settings
						</button>
					</div>
				</div>
			</div>
		);
	}

	// Error state
	if (state.status === "error") {
		return (
			<div style={containerStyle}>
				<div style={headerStyle}>
					<h2 style={titleStyle}>Listen Later</h2>
				</div>
				<div style={contentStyle}>
					<div style={errorStyle}>
						<p style={{ margin: "0 0 10px 0" }}>❌ Error</p>
						<p style={{ margin: "0 0 20px 0", fontSize: "14px" }}>
							{state.message || "Something went wrong. Please try again."}
						</p>
						<div style={{ display: "flex", gap: "10px" }}>
							<button onClick={handleTryAgain} style={primaryButtonStyle}>
								Try Again
							</button>
							<button onClick={openOptionsPage} style={secondaryButtonStyle}>
								Settings
							</button>
						</div>
					</div>
				</div>
			</div>
		);
	}

	// Processing state
	if (state.status === "processing") {
		return (
			<div style={containerStyle}>
				<div style={headerStyle}>
					<h2 style={titleStyle}>Listen Later</h2>
				</div>
				<div style={contentStyle}>
					<div style={processingStyle}>
						<div style={spinnerStyle}>🔄</div>
						<p style={{ margin: "15px 0 10px 0" }}>Processing...</p>
						<p style={{ margin: "0", fontSize: "14px", color: "#666" }}>
							{state.message || "Converting page content to speech"}
						</p>
					</div>
				</div>
			</div>
		);
	}

	// Success state
	if (state.status === "success") {
		return (
			<div style={containerStyle}>
				<div style={headerStyle}>
					<h2 style={titleStyle}>Listen Later</h2>
				</div>
				<div style={contentStyle}>
					<div style={successStyle}>
						<p style={{ margin: "0 0 10px 0" }}>✅ Success!</p>
						<p style={{ margin: "0 0 20px 0", fontSize: "14px" }}>
							{state.message || "Audio file has been downloaded successfully."}
						</p>
						<div style={{ display: "flex", gap: "10px" }}>
							<button onClick={handleGenerateClick} style={primaryButtonStyle}>
								Generate Again
							</button>
							<button onClick={openOptionsPage} style={secondaryButtonStyle}>
								Settings
							</button>
						</div>
					</div>
				</div>
			</div>
		);
	}

	// Default idle state
	return (
		<div style={containerStyle}>
			<div style={headerStyle}>
				<h2 style={titleStyle}>Listen Later</h2>
			</div>
			<div style={contentStyle}>
				<p style={{ margin: "0 0 20px 0", fontSize: "14px", color: "#666" }}>
					Convert the current page to speech
				</p>
				<div style={{ display: "flex", gap: "10px" }}>
					<button onClick={handleGenerateClick} style={primaryButtonStyle}>
						Generate Speech
					</button>
					<button onClick={openOptionsPage} style={secondaryButtonStyle}>
						Settings
					</button>
				</div>
			</div>
		</div>
	);
};

// Styles
const containerStyle: React.CSSProperties = {
	width: "350px",
	minHeight: "200px",
	fontFamily: "Arial, sans-serif",
};

const headerStyle: React.CSSProperties = {
	padding: "15px 20px 10px 20px",
	borderBottom: "1px solid #e0e0e0",
	backgroundColor: "#f8f9fa",
};

const titleStyle: React.CSSProperties = {
	margin: 0,
	fontSize: "18px",
	color: "#333",
};

const contentStyle: React.CSSProperties = {
	padding: "20px",
};

const primaryButtonStyle: React.CSSProperties = {
	padding: "10px 16px",
	backgroundColor: "#4285f4",
	color: "white",
	border: "none",
	borderRadius: "4px",
	fontSize: "14px",
	cursor: "pointer",
	fontWeight: "500",
};

const secondaryButtonStyle: React.CSSProperties = {
	padding: "10px 16px",
	backgroundColor: "transparent",
	color: "#4285f4",
	border: "1px solid #4285f4",
	borderRadius: "4px",
	fontSize: "14px",
	cursor: "pointer",
	fontWeight: "500",
};

const errorStyle: React.CSSProperties = {
	textAlign: "center",
	color: "#d93025",
};

const successStyle: React.CSSProperties = {
	textAlign: "center",
	color: "#137333",
};

const processingStyle: React.CSSProperties = {
	textAlign: "center",
	color: "#666",
};

const warningStyle: React.CSSProperties = {
	textAlign: "center",
	color: "#ea8600",
};

const spinnerStyle: React.CSSProperties = {
	fontSize: "24px",
	animation: "spin 1s linear infinite",
};

export default Popup;
