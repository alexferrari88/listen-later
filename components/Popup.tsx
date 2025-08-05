import type React from "react";
import { useEffect, useState, useRef } from "react";
import {
	areOptionsConfigured,
	type ExtensionState,
	getExtensionState,
	resetExtensionState,
} from "../lib/storage";
import { logger } from "../lib/logger";

const Popup: React.FC = () => {
	const [state, setState] = useState<ExtensionState>({ status: "idle" });
	const [isOptionsConfigured, setIsOptionsConfigured] = useState(false);
	const [isLoading, setIsLoading] = useState(true);
	const [elapsedTime, setElapsedTime] = useState(0);
	const [processingStage, setProcessingStage] = useState<string>("");
	const intervalRef = useRef<NodeJS.Timeout | null>(null);
	const startTimeRef = useRef<number | null>(null);

	// Load initial state and check if options are configured
	useEffect(() => {
		const loadState = async () => {
			try {
				logger.popup.action("Loading initial state");
				const [currentState, optionsConfigured] = await Promise.all([
					getExtensionState(),
					areOptionsConfigured(),
				]);
				logger.popup.state(currentState);
				logger.debug("Options configured:", optionsConfigured);
				setState(currentState);
				setIsOptionsConfigured(optionsConfigured);
			} catch (error) {
				logger.error("Failed to load popup state:", error);
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
			logger.debug("Storage changed", changes);
			if (changes.extensionState) {
				logger.popup.state(changes.extensionState.newValue);
				setState(changes.extensionState.newValue);
			}
			if (changes.extensionOptions) {
				logger.debug("Options changed, rechecking configuration");
				// Re-check if options are configured when they change
				areOptionsConfigured().then((configured) => {
					logger.debug("Options rechecked, configured:", configured);
					setIsOptionsConfigured(configured);
				});
			}
		};

		chrome.storage.onChanged.addListener(handleStorageChange);
		return () => chrome.storage.onChanged.removeListener(handleStorageChange);
	}, []);

	// Timer effect for processing state
	useEffect(() => {
		if (state.status === "processing") {
			// Start timer
			startTimeRef.current = Date.now();
			setElapsedTime(0);
			
			// Update processing stage based on message
			const message = state.message || "";
			if (message.includes("extraction") || message.includes("Analyzing") || message.includes("Loading")) {
				setProcessingStage("Extracting content");
			} else if (message.includes("speech") || message.includes("AI") || message.includes("generating")) {
				setProcessingStage("Generating speech");
			} else if (message.includes("download") || message.includes("Preparing audio")) {
				setProcessingStage("Finalizing");
			} else {
				setProcessingStage("Processing");
			}
			
			intervalRef.current = setInterval(() => {
				if (startTimeRef.current) {
					const elapsed = Math.floor((Date.now() - startTimeRef.current) / 1000);
					setElapsedTime(elapsed);
				}
			}, 1000);
		} else {
			// Clear timer
			if (intervalRef.current) {
				clearInterval(intervalRef.current);
				intervalRef.current = null;
			}
			startTimeRef.current = null;
			setElapsedTime(0);
			setProcessingStage("");
		}

		return () => {
			if (intervalRef.current) {
				clearInterval(intervalRef.current);
			}
		};
	}, [state.status, state.message]);

	const handleGenerateClick = async () => {
		try {
			logger.popup.action("Generate speech button clicked");
			await chrome.runtime.sendMessage({ type: "START_TTS" });
			logger.debug("START_TTS message sent successfully");
		} catch (error) {
			logger.error("Failed to send START_TTS message:", error);
		}
	};

	const handleTryAgain = async () => {
		try {
			logger.popup.action("Try again button clicked");
			await resetExtensionState();
			logger.debug("Extension state reset successfully");
		} catch (error) {
			logger.error("Failed to reset state:", error);
		}
	};

	const handleCancel = async () => {
		try {
			logger.popup.action("Cancel button clicked");
			await resetExtensionState();
			logger.debug("Processing cancelled successfully");
		} catch (error) {
			logger.error("Failed to cancel processing:", error);
		}
	};

	const formatElapsedTime = (seconds: number): string => {
		if (seconds < 60) {
			return `${seconds}s`;
		}
		const minutes = Math.floor(seconds / 60);
		const remainingSeconds = seconds % 60;
		return `${minutes}m ${remainingSeconds}s`;
	};

	const openOptionsPage = () => {
		logger.popup.action("Settings button clicked");
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
		const isLongRunning = elapsedTime > 10;
		const estimatedTime = processingStage.includes("speech") ? "30-60s" : "5-10s";
		
		return (
			<div style={containerStyle}>
				<div style={headerStyle}>
					<h2 style={titleStyle}>Listen Later</h2>
				</div>
				<div style={contentStyle}>
					<div style={processingStyle}>
						{/* Animated loading indicator */}
						<div style={loadingIndicatorStyle}>
							<div style={modernSpinnerStyle}></div>
						</div>
						
						{/* Stage indicator */}
						<div style={stageIndicatorStyle}>
							<div style={stageProgressStyle}>
								<div 
									style={{
										...stageStepStyle, 
										...(processingStage.includes("content") ? activeStageStyle : {}),
										...(processingStage.includes("speech") || processingStage.includes("Finalizing") ? { backgroundColor: "#4caf50", border: "2px solid #4caf50", color: "white" } : {})
									}}
								>
									1
								</div>
								<div style={stageLineStyle}></div>
								<div 
									style={{
										...stageStepStyle, 
										...(processingStage.includes("speech") ? activeStageStyle : {}),
										...(processingStage.includes("Finalizing") ? { backgroundColor: "#4caf50", border: "2px solid #4caf50", color: "white" } : {})
									}}
								>
									2
								</div>
								<div style={stageLineStyle}></div>
								<div 
									style={{
										...stageStepStyle, 
										...(processingStage.includes("Finalizing") ? activeStageStyle : {})
									}}
								>
									3
								</div>
							</div>
							<div style={stageLabelStyle}>
								<span style={stageLabelTextStyle}>Extract</span>
								<span style={stageLabelTextStyle}>Generate</span>
								<span style={stageLabelTextStyle}>Download</span>
							</div>
						</div>
						
						{/* Status text */}
						<p style={processingTitleStyle}>{processingStage}</p>
						<p style={processingSubtitleStyle}>
							{state.message || "This may take a moment..."}
						</p>
						
						{/* Time and progress info */}
						<div style={timeInfoStyle}>
							<div style={timeElapsedStyle}>
								Time elapsed: {formatElapsedTime(elapsedTime)}
							</div>
							{!isLongRunning && (
								<div style={estimateStyle}>
									Estimated: {estimatedTime}
								</div>
							)}
							{isLongRunning && (
								<div style={longRunningStyle}>
									⏳ AI processing takes time - please wait
								</div>
							)}
						</div>
						
						{/* Cancel button */}
						<div style={{ marginTop: "20px" }}>
							<button onClick={handleCancel} style={cancelButtonStyle}>
								Cancel
							</button>
						</div>
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

// New improved processing styles
const loadingIndicatorStyle: React.CSSProperties = {
	marginBottom: "20px",
};

const modernSpinnerStyle: React.CSSProperties = {
	width: "40px",
	height: "40px",
	border: "4px solid #e3e3e3",
	borderTop: "4px solid #4285f4",
	borderRadius: "50%",
	animation: "spin 1s linear infinite",
	margin: "0 auto",
};

const stageIndicatorStyle: React.CSSProperties = {
	marginBottom: "20px",
};

const stageProgressStyle: React.CSSProperties = {
	display: "flex",
	alignItems: "center",
	justifyContent: "center",
	gap: "0",
};

const stageStepStyle: React.CSSProperties = {
	width: "30px",
	height: "30px",
	borderRadius: "50%",
	border: "2px solid #e0e0e0",
	backgroundColor: "#f5f5f5",
	color: "#999",
	display: "flex",
	alignItems: "center",
	justifyContent: "center",
	fontSize: "14px",
	fontWeight: "500",
};

const activeStageStyle: React.CSSProperties = {
	border: "2px solid #4285f4",
	backgroundColor: "#4285f4",
	color: "white",
	animation: "pulse 2s infinite",
};

const stageLineStyle: React.CSSProperties = {
	width: "40px",
	height: "2px",
	backgroundColor: "#e0e0e0",
};

const processingTitleStyle: React.CSSProperties = {
	margin: "0 0 8px 0",
	fontSize: "16px",
	fontWeight: "500",
	color: "#4285f4",
};

const processingSubtitleStyle: React.CSSProperties = {
	margin: "0 0 15px 0",
	fontSize: "14px",
	color: "#666",
};

const timeInfoStyle: React.CSSProperties = {
	backgroundColor: "#f8f9fa",
	padding: "12px",
	borderRadius: "8px",
	border: "1px solid #e0e0e0",
};

const timeElapsedStyle: React.CSSProperties = {
	fontSize: "14px",
	color: "#333",
	fontWeight: "500",
	marginBottom: "4px",
};

const estimateStyle: React.CSSProperties = {
	fontSize: "12px",
	color: "#666",
};

const longRunningStyle: React.CSSProperties = {
	fontSize: "12px",
	color: "#ea8600",
	fontStyle: "italic",
};

const cancelButtonStyle: React.CSSProperties = {
	padding: "8px 16px",
	backgroundColor: "transparent",
	color: "#666",
	border: "1px solid #ccc",
	borderRadius: "4px",
	fontSize: "14px",
	cursor: "pointer",
	fontWeight: "400",
};

const stageLabelStyle: React.CSSProperties = {
	display: "flex",
	justifyContent: "space-between",
	marginTop: "8px",
	padding: "0 15px",
};

const stageLabelTextStyle: React.CSSProperties = {
	fontSize: "11px",
	color: "#666",
	fontWeight: "500",
};

// Add CSS animations
const styleSheet = document.createElement("style");
styleSheet.textContent = `
	@keyframes spin {
		0% { transform: rotate(0deg); }
		100% { transform: rotate(360deg); }
	}
	
	@keyframes pulse {
		0% { box-shadow: 0 0 0 0 rgba(66, 133, 244, 0.7); }
		70% { box-shadow: 0 0 0 10px rgba(66, 133, 244, 0); }
		100% { box-shadow: 0 0 0 0 rgba(66, 133, 244, 0); }
	}
`;
if (!document.head.querySelector('style[data-listen-later="animations"]')) {
	styleSheet.setAttribute('data-listen-later', 'animations');
	document.head.appendChild(styleSheet);
}

export default Popup;
