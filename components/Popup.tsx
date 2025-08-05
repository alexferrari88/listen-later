import type React from "react";
import { useEffect, useRef, useState } from "react";
import { logger } from "../lib/logger";
import {
	areOptionsConfigured,
	cleanupOldJobs,
	type ExtensionState,
	getExtensionState,
	getJobsByStatus,
	getJobsForTab,
	type ProcessingJob,
	removeJob,
	resetExtensionState,
	retryJob,
	updateJob,
} from "../lib/storage";

const Popup: React.FC = () => {
	const [allJobs, setAllJobs] = useState<ProcessingJob[]>([]);
	const [currentTabId, setCurrentTabId] = useState<number | null>(null);
	const [currentTabJobs, setCurrentTabJobs] = useState<ProcessingJob[]>([]);
	const [otherJobs, setOtherJobs] = useState<ProcessingJob[]>([]);
	const [showOtherJobs, setShowOtherJobs] = useState(false);
	const [isOptionsConfigured, setIsOptionsConfigured] = useState(false);
	const [isLoading, setIsLoading] = useState(true);
	const [currentTime, setCurrentTime] = useState(Date.now());
	const intervalRef = useRef<NodeJS.Timeout | null>(null);

	// Load initial state and check if options are configured
	useEffect(() => {
		const loadState = async () => {
			try {
				logger.popup.action("Loading initial state");

				// Get current tab ID
				const [tab] = await chrome.tabs.query({
					active: true,
					currentWindow: true,
				});
				const tabId = tab?.id || null;
				setCurrentTabId(tabId);

				// Load jobs and options
				const [extensionState, optionsConfigured] = await Promise.all([
					getExtensionState(),
					areOptionsConfigured(),
				]);

				logger.debug("Options configured:", optionsConfigured);
				logger.debug("Current tab ID:", tabId);
				logger.debug("Total jobs found:", extensionState.activeJobs.length);

				setAllJobs(extensionState.activeJobs);
				setIsOptionsConfigured(optionsConfigured);

				// Separate current tab jobs from others
				if (tabId) {
					const tabJobs = extensionState.activeJobs.filter(
						(job) => job.tabId === tabId,
					);
					const otherTabJobs = extensionState.activeJobs.filter(
						(job) => job.tabId !== tabId,
					);
					setCurrentTabJobs(tabJobs);
					setOtherJobs(otherTabJobs);
					logger.debug("Current tab jobs:", tabJobs.length);
					logger.debug("Other tab jobs:", otherTabJobs.length);
				}
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
			if (changes.extensionState && changes.extensionState.newValue) {
				const newState: ExtensionState = changes.extensionState.newValue;
				logger.debug("Jobs updated", { totalJobs: newState.activeJobs.length });

				setAllJobs(newState.activeJobs);

				// Update current tab and other jobs
				if (currentTabId) {
					const tabJobs = newState.activeJobs.filter(
						(job) => job.tabId === currentTabId,
					);
					const otherTabJobs = newState.activeJobs.filter(
						(job) => job.tabId !== currentTabId,
					);
					setCurrentTabJobs(tabJobs);
					setOtherJobs(otherTabJobs);
					logger.debug("Updated job distribution", {
						currentTabJobs: tabJobs.length,
						otherJobs: otherTabJobs.length,
					});
				}
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
	}, [currentTabId]);

	// Real-time timer effect for processing jobs
	useEffect(() => {
		const hasProcessingJobs = allJobs.some(
			(job) => job.status === "processing",
		);

		if (hasProcessingJobs) {
			// Update current time every second to refresh elapsed time display
			intervalRef.current = setInterval(() => {
				setCurrentTime(Date.now());
			}, 1000);
		} else if (intervalRef.current) {
			// Clear interval when no processing jobs
			clearInterval(intervalRef.current);
			intervalRef.current = null;
		}

		return () => {
			if (intervalRef.current) {
				clearInterval(intervalRef.current);
				intervalRef.current = null;
			}
		};
	}, [allJobs]);

	// Cleanup effect
	useEffect(() => {
		return () => {
			if (intervalRef.current) {
				clearInterval(intervalRef.current);
			}
		};
	}, []);

	const handleGenerateClick = async () => {
		try {
			logger.popup.action("Generate speech button clicked");
			await chrome.runtime.sendMessage({ type: "START_TTS" });
			logger.debug("START_TTS message sent successfully");
		} catch (error) {
			logger.error("Failed to send START_TTS message:", error);
		}
	};

	const handleRetryJob = async (jobId: string) => {
		try {
			logger.popup.action("Retry job button clicked", { jobId });
			await retryJob(jobId);
			logger.debug("Job retried successfully", { jobId });
		} catch (error) {
			logger.error("Failed to retry job:", error);
		}
	};

	const handleRemoveJob = async (jobId: string) => {
		try {
			logger.popup.action("Remove job button clicked", { jobId });
			await removeJob(jobId);
			logger.debug("Job removed successfully", { jobId });
		} catch (error) {
			logger.error("Failed to remove job:", error);
		}
	};

	const handleCleanupJobs = async () => {
		try {
			logger.popup.action("Cleanup jobs button clicked");
			await cleanupOldJobs();
			logger.debug("Old jobs cleaned up successfully");
		} catch (error) {
			logger.error("Failed to cleanup jobs:", error);
		}
	};

	const handleCancelJob = async (jobId: string) => {
		try {
			logger.popup.action("Cancel job button clicked", { jobId });
			// Send message to background to handle cancellation and show notification
			await chrome.runtime.sendMessage({
				type: "CANCEL_JOB",
				jobId: jobId,
			});
			logger.debug("Job cancelled successfully", { jobId });
		} catch (error) {
			logger.error("Failed to cancel job:", error);
			// Fallback to local update if background message fails
			await updateJob(jobId, {
				status: "error",
				message: "Cancelled by user",
			});
		}
	};

	const handleClearAllJobs = async () => {
		try {
			logger.popup.action("Clear all jobs button clicked");
			await resetExtensionState();
			logger.debug("All jobs cleared successfully");
		} catch (error) {
			logger.error("Failed to clear all jobs:", error);
		}
	};

	const formatElapsedTime = (startTime: number): string => {
		const elapsed = Math.floor((currentTime - startTime) / 1000);
		if (elapsed < 60) {
			return `${elapsed}s`;
		}
		const minutes = Math.floor(elapsed / 60);
		const remainingSeconds = elapsed % 60;
		return `${minutes}m ${remainingSeconds}s`;
	};

	const getJobDisplayName = (job: ProcessingJob): string => {
		return job.tabInfo.articleTitle || job.tabInfo.title || job.tabInfo.domain;
	};

	const getJobStatus = (
		job: ProcessingJob,
	): { emoji: string; text: string; color: string } => {
		switch (job.status) {
			case "processing":
				return { emoji: "⏳", text: "Processing", color: "#4285f4" };
			case "success":
				return { emoji: "✅", text: "Completed", color: "#137333" };
			case "error":
				return { emoji: "❌", text: "Failed", color: "#d93025" };
			default:
				return { emoji: "⏳", text: "Processing", color: "#4285f4" };
		}
	};

	const getProcessingStage = (
		message?: string,
	): { stage: string; emoji: string; progress: number } => {
		if (!message) return { stage: "Processing", emoji: "⚙️", progress: 10 };

		const lowerMessage = message.toLowerCase();

		if (
			lowerMessage.includes("extraction") ||
			lowerMessage.includes("analyzing") ||
			lowerMessage.includes("loading") ||
			lowerMessage.includes("content processing")
		) {
			return { stage: "Extracting content", emoji: "📄", progress: 20 };
		} else if (
			lowerMessage.includes("preparing speech") ||
			lowerMessage.includes("starting speech") ||
			lowerMessage.includes("preparing")
		) {
			return { stage: "Preparing request", emoji: "🔧", progress: 40 };
		} else if (
			lowerMessage.includes("connecting to gemini") ||
			lowerMessage.includes("sending to ai") ||
			lowerMessage.includes("contacting")
		) {
			return { stage: "Connecting to AI", emoji: "🔗", progress: 50 };
		} else if (
			lowerMessage.includes("speech") ||
			lowerMessage.includes("ai") ||
			lowerMessage.includes("generating") ||
			lowerMessage.includes("gemini")
		) {
			return { stage: "Generating speech", emoji: "🎙️", progress: 70 };
		} else if (
			lowerMessage.includes("processing audio") ||
			lowerMessage.includes("speech generated") ||
			lowerMessage.includes("converting")
		) {
			return { stage: "Processing audio", emoji: "🎵", progress: 85 };
		} else if (
			lowerMessage.includes("download") ||
			lowerMessage.includes("preparing audio") ||
			lowerMessage.includes("finalizing")
		) {
			return { stage: "Finalizing", emoji: "📥", progress: 95 };
		}
		return { stage: "Processing", emoji: "⚙️", progress: 30 };
	};

	const openOptionsPage = () => {
		logger.popup.action("Settings button clicked");
		chrome.runtime.openOptionsPage();
	};

	// Helper components
	const JobCard: React.FC<{
		job: ProcessingJob;
		isCurrentTab: boolean;
		showTabInfo: boolean;
	}> = ({ job, isCurrentTab, showTabInfo }) => {
		const status = getJobStatus(job);
		const displayName = getJobDisplayName(job);
		const elapsed = formatElapsedTime(job.startTime);
		const stageInfo = getProcessingStage(job.message);

		return (
			<div
				style={{
					...jobCardStyle,
					...(isCurrentTab ? currentTabJobStyle : {}),
					...(job.status === "processing" ? processingJobCardStyle : {}),
				}}
			>
				<div style={jobHeaderStyle}>
					<div style={jobStatusStyle}>
						<span
							style={{
								fontSize: "16px",
								...(job.status === "processing" ? pulsingEmojiStyle : {}),
							}}
						>
							{status.emoji}
						</span>
						<span
							style={{
								color: status.color,
								fontWeight: "500",
								fontSize: "14px",
							}}
						>
							{status.text}
						</span>
					</div>
					<div style={jobTimeStyle}>{elapsed}</div>
				</div>

				{showTabInfo && (
					<div>
						<div style={jobTitleStyle}>{displayName}</div>
						<div style={jobUrlStyle}>{job.tabInfo.url}</div>
					</div>
				)}

				{job.status === "processing" && (
					<div>
						<div style={stageIndicatorStyle}>
							<span style={stageEmojiStyle}>{stageInfo.emoji}</span>
							<span style={stageTitleStyle}>{stageInfo.stage}</span>
							<div style={stageProgressBarStyle}>
								<div
									style={{
										...stageProgressFillStyle,
										width: `${stageInfo.progress}%`,
									}}
								/>
							</div>
						</div>
						<div
							style={{
								...jobMessageStyle,
								animation: "breathe 2s infinite ease-in-out",
							}}
						>
							{job.message}
						</div>
						<div style={connectionStatusStyle}>
							<div style={connectionDotStyle}></div>
							<span>Active connection • {elapsed} elapsed</span>
						</div>
						{job.progress !== undefined && (
							<div style={progressContainerStyle}>
								<div style={progressBarStyle}>
									<div
										style={{
											...progressFillStyle,
											width: `${Math.max(0, Math.min(100, job.progress))}%`,
										}}
									/>
								</div>
								<div style={progressTextStyle}>{Math.round(job.progress)}%</div>
							</div>
						)}
					</div>
				)}

				{job.status === "error" && (
					<div style={errorContainerStyle}>
						<div style={errorHeaderStyle}>
							<span style={errorIconStyle}>⚠️</span>
							<span style={errorTitleStyle}>Processing Failed</span>
						</div>
						<div style={jobErrorStyle}>{job.message}</div>
						<div style={connectionStatusStyle}>
							<span>Failed • {elapsed} total</span>
						</div>
						<div style={errorHelpStyle}>
							Try checking your internet connection or API key settings
						</div>
					</div>
				)}

				{job.status === "success" && job.filename && (
					<div>
						<div style={jobSuccessStyle}>Downloaded: {job.filename}</div>
						<div style={connectionStatusStyle}>
							<span>Completed • {elapsed} total</span>
						</div>
					</div>
				)}

				<div style={jobActionsStyle}>
					{job.status === "processing" && (
						<button
							onClick={() => handleCancelJob(job.id)}
							style={jobCancelButtonStyle}
						>
							Cancel
						</button>
					)}
					{job.status === "error" && (
						<button
							onClick={() => handleRetryJob(job.id)}
							style={retryButtonStyle}
						>
							🔄 Retry
						</button>
					)}
					{job.status !== "processing" && (
						<button
							onClick={() => handleRemoveJob(job.id)}
							style={jobRemoveButtonStyle}
						>
							Remove
						</button>
					)}
				</div>
			</div>
		);
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

	// Get active job for current tab
	const currentTabJob =
		currentTabJobs.find((job) => job.status === "processing") ||
		currentTabJobs[0];
	const hasCurrentTabJob = !!currentTabJob;
	const hasOtherJobs = otherJobs.length > 0;
	const completedJobs = allJobs.filter(
		(job) => job.status === "success" || job.status === "error",
	);

	return (
		<div style={containerStyle}>
			<div style={headerStyle}>
				<h2 style={titleStyle}>
					Listen Later
					{allJobs.some((job) => job.status === "processing") && (
						<span style={activityDotStyle}>●</span>
					)}
				</h2>
				{allJobs.length > 0 && (
					<div
						style={{
							...headerBadgeStyle,
							...(allJobs.some((job) => job.status === "processing")
								? { animation: "breathe 2s infinite ease-in-out" }
								: {}),
						}}
					>
						{allJobs.filter((job) => job.status === "processing").length} active
					</div>
				)}
			</div>
			<div style={contentStyle}>
				{/* Current Tab Status */}
				{hasCurrentTabJob ? (
					<div style={currentTabSectionStyle}>
						<h3 style={sectionTitleStyle}>Current Page</h3>
						<JobCard
							job={currentTabJob}
							isCurrentTab={true}
							showTabInfo={false}
						/>
					</div>
				) : (
					<div style={idleSectionStyle}>
						<p
							style={{ margin: "0 0 20px 0", fontSize: "14px", color: "#666" }}
						>
							Convert the current page to speech
						</p>
						<button onClick={handleGenerateClick} style={primaryButtonStyle}>
							Generate Speech
						</button>
					</div>
				)}

				{/* Other Active Jobs */}
				{hasOtherJobs && (
					<div style={otherJobsSectionStyle}>
						<button
							onClick={() => setShowOtherJobs(!showOtherJobs)}
							style={collapsibleButtonStyle}
						>
							<span>Other Tabs ({otherJobs.length})</span>
							<span
								style={{
									transform: showOtherJobs ? "rotate(180deg)" : "rotate(0deg)",
								}}
							>
								▼
							</span>
						</button>
						{showOtherJobs && (
							<div style={otherJobsListStyle}>
								{otherJobs.map((job) => (
									<JobCard
										key={job.id}
										job={job}
										isCurrentTab={false}
										showTabInfo={true}
									/>
								))}
							</div>
						)}
					</div>
				)}

				{/* Action Buttons */}
				<div style={actionButtonsStyle}>
					{!hasCurrentTabJob && (
						<button onClick={openOptionsPage} style={secondaryButtonStyle}>
							Settings
						</button>
					)}
					{allJobs.length > 0 && (
						<button onClick={handleClearAllJobs} style={clearAllButtonStyle}>
							Clear All Jobs ({allJobs.length})
						</button>
					)}
					{completedJobs.length > 0 && (
						<button onClick={handleCleanupJobs} style={cleanupButtonStyle}>
							Clear Completed ({completedJobs.length})
						</button>
					)}
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
	minWidth: "120px",
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
	minWidth: "120px",
	alignSelf: "center",
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

// New job-based styles
const headerBadgeStyle: React.CSSProperties = {
	backgroundColor: "#4285f4",
	color: "white",
	fontSize: "12px",
	padding: "2px 8px",
	borderRadius: "12px",
	fontWeight: "500",
};

const currentTabSectionStyle: React.CSSProperties = {
	marginBottom: "15px",
};

const sectionTitleStyle: React.CSSProperties = {
	margin: "0 0 10px 0",
	fontSize: "14px",
	fontWeight: "600",
	color: "#333",
};

const idleSectionStyle: React.CSSProperties = {
	textAlign: "center",
	marginBottom: "15px",
};

const otherJobsSectionStyle: React.CSSProperties = {
	marginBottom: "15px",
};

const collapsibleButtonStyle: React.CSSProperties = {
	width: "100%",
	padding: "10px 12px",
	backgroundColor: "#f8f9fa",
	border: "1px solid #e0e0e0",
	borderRadius: "6px",
	fontSize: "14px",
	cursor: "pointer",
	display: "flex",
	justifyContent: "space-between",
	alignItems: "center",
	fontWeight: "500",
	color: "#333",
};

const otherJobsListStyle: React.CSSProperties = {
	marginTop: "10px",
	display: "flex",
	flexDirection: "column",
	gap: "8px",
};

const actionButtonsStyle: React.CSSProperties = {
	display: "flex",
	flexDirection: "column",
	gap: "10px",
	marginTop: "15px",
};

const cleanupButtonStyle: React.CSSProperties = {
	padding: "8px 12px",
	backgroundColor: "#f8f9fa",
	color: "#666",
	border: "1px solid #e0e0e0",
	borderRadius: "4px",
	fontSize: "12px",
	cursor: "pointer",
	fontWeight: "400",
};

const clearAllButtonStyle: React.CSSProperties = {
	padding: "8px 12px",
	backgroundColor: "#d93025",
	color: "white",
	border: "none",
	borderRadius: "4px",
	fontSize: "12px",
	cursor: "pointer",
	fontWeight: "500",
};

// Job Card Styles
const jobCardStyle: React.CSSProperties = {
	padding: "12px",
	border: "1px solid #e0e0e0",
	borderRadius: "8px",
	backgroundColor: "#ffffff",
};

const currentTabJobStyle: React.CSSProperties = {
	border: "2px solid #4285f4",
	backgroundColor: "#f8fbff",
};

const jobHeaderStyle: React.CSSProperties = {
	display: "flex",
	justifyContent: "space-between",
	alignItems: "center",
	marginBottom: "8px",
};

const jobStatusStyle: React.CSSProperties = {
	display: "flex",
	alignItems: "center",
	gap: "6px",
};

const jobTimeStyle: React.CSSProperties = {
	fontSize: "12px",
	color: "#666",
	fontWeight: "400",
};

const jobTitleStyle: React.CSSProperties = {
	fontSize: "13px",
	fontWeight: "500",
	color: "#333",
	marginBottom: "6px",
	lineHeight: "1.3",
};

const jobUrlStyle: React.CSSProperties = {
	fontSize: "11px",
	color: "#666",
	marginBottom: "6px",
	fontFamily: "monospace",
	overflow: "hidden",
	textOverflow: "ellipsis",
	whiteSpace: "nowrap",
};

const jobMessageStyle: React.CSSProperties = {
	fontSize: "12px",
	color: "#666",
	marginBottom: "8px",
	fontStyle: "italic",
};

const progressContainerStyle: React.CSSProperties = {
	display: "flex",
	alignItems: "center",
	gap: "8px",
	marginBottom: "8px",
};

const progressBarStyle: React.CSSProperties = {
	flex: 1,
	height: "6px",
	backgroundColor: "#e0e0e0",
	borderRadius: "3px",
	overflow: "hidden",
};

const progressFillStyle: React.CSSProperties = {
	height: "100%",
	backgroundColor: "#4285f4",
	borderRadius: "3px",
	transition: "width 0.3s ease",
};

const progressTextStyle: React.CSSProperties = {
	fontSize: "11px",
	color: "#666",
	fontWeight: "500",
	minWidth: "35px",
	textAlign: "right" as const,
};

const jobErrorStyle: React.CSSProperties = {
	fontSize: "12px",
	color: "#d93025",
	marginBottom: "8px",
	fontWeight: "400",
};

const jobSuccessStyle: React.CSSProperties = {
	fontSize: "12px",
	color: "#137333",
	marginBottom: "8px",
	fontWeight: "400",
};

const jobActionsStyle: React.CSSProperties = {
	display: "flex",
	gap: "8px",
	justifyContent: "flex-end",
};

const jobActionButtonStyle: React.CSSProperties = {
	padding: "4px 8px",
	backgroundColor: "#4285f4",
	color: "white",
	border: "none",
	borderRadius: "4px",
	fontSize: "12px",
	cursor: "pointer",
	fontWeight: "500",
};

const jobRemoveButtonStyle: React.CSSProperties = {
	padding: "4px 8px",
	backgroundColor: "transparent",
	color: "#666",
	border: "1px solid #ccc",
	borderRadius: "4px",
	fontSize: "12px",
	cursor: "pointer",
	fontWeight: "400",
};

const jobCancelButtonStyle: React.CSSProperties = {
	padding: "4px 8px",
	backgroundColor: "#ea8600",
	color: "white",
	border: "none",
	borderRadius: "4px",
	fontSize: "12px",
	cursor: "pointer",
	fontWeight: "500",
};

// Enhanced animation styles for processing jobs
const pulsingEmojiStyle: React.CSSProperties = {
	animation: "pulse 2s infinite",
};

const processingJobCardStyle: React.CSSProperties = {
	boxShadow: "0 0 0 2px rgba(66, 133, 244, 0.1)",
	animation: "subtlePulse 3s infinite ease-in-out",
};

// Stage indicator styles
const stageEmojiStyle: React.CSSProperties = {
	fontSize: "14px",
	marginRight: "6px",
};

const stageTitleStyle: React.CSSProperties = {
	fontSize: "13px",
	fontWeight: "600",
	color: "#4285f4",
	marginBottom: "6px",
};

const stageProgressBarStyle: React.CSSProperties = {
	width: "100%",
	height: "4px",
	backgroundColor: "#e0e0e0",
	borderRadius: "2px",
	overflow: "hidden",
	marginTop: "4px",
};

const stageProgressFillStyle: React.CSSProperties = {
	height: "100%",
	background: "linear-gradient(90deg, #4285f4 25%, #66a3ff 50%, #4285f4 75%)",
	backgroundSize: "200% 100%",
	borderRadius: "2px",
	transition: "width 0.5s ease-out",
	animation: "shimmer 2s infinite linear",
};

// Heartbeat and activity indicator styles
const activityDotStyle: React.CSSProperties = {
	color: "#4CAF50",
	fontSize: "12px",
	marginLeft: "8px",
	animation: "breathe 1.5s infinite ease-in-out",
};

const connectionStatusStyle: React.CSSProperties = {
	fontSize: "10px",
	color: "#666",
	marginTop: "2px",
	display: "flex",
	alignItems: "center",
	gap: "4px",
};

const connectionDotStyle: React.CSSProperties = {
	width: "6px",
	height: "6px",
	borderRadius: "50%",
	backgroundColor: "#4CAF50",
	animation: "breathe 2s infinite ease-in-out",
};

// Enhanced error handling styles
const errorContainerStyle: React.CSSProperties = {
	backgroundColor: "#fdf2f2",
	border: "1px solid #fecaca",
	borderRadius: "6px",
	padding: "8px",
	marginTop: "6px",
};

const errorHeaderStyle: React.CSSProperties = {
	display: "flex",
	alignItems: "center",
	marginBottom: "4px",
};

const errorIconStyle: React.CSSProperties = {
	fontSize: "14px",
	marginRight: "6px",
};

const errorTitleStyle: React.CSSProperties = {
	fontSize: "12px",
	fontWeight: "600",
	color: "#dc2626",
};

const errorHelpStyle: React.CSSProperties = {
	fontSize: "10px",
	color: "#7f1d1d",
	fontStyle: "italic",
	marginTop: "4px",
};

const retryButtonStyle: React.CSSProperties = {
	padding: "6px 12px",
	backgroundColor: "#f59e0b",
	color: "white",
	border: "none",
	borderRadius: "4px",
	fontSize: "12px",
	cursor: "pointer",
	fontWeight: "600",
	boxShadow: "0 1px 3px rgba(245, 158, 11, 0.3)",
	transition: "all 0.2s ease",
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
	
	@keyframes subtlePulse {
		0% { 
			box-shadow: 0 0 0 2px rgba(66, 133, 244, 0.1);
			transform: scale(1);
		}
		50% { 
			box-shadow: 0 0 0 4px rgba(66, 133, 244, 0.2);
			transform: scale(1.005);
		}
		100% { 
			box-shadow: 0 0 0 2px rgba(66, 133, 244, 0.1);
			transform: scale(1);
		}
	}
	
	@keyframes breathe {
		0% { opacity: 1; }
		50% { opacity: 0.7; }
		100% { opacity: 1; }
	}
	
	@keyframes shimmer {
		0% { background-position: -200% 0; }
		100% { background-position: 200% 0; }
	}
`;
if (!document.head.querySelector('style[data-listen-later="animations"]')) {
	styleSheet.setAttribute("data-listen-later", "animations");
	document.head.appendChild(styleSheet);
}

export default Popup;
