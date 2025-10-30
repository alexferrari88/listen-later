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

// Helper function to check if a job is active (preparing or processing)
const isActiveJob = (job: ProcessingJob): boolean => {
	return job.status === "preparing" || job.status === "processing";
};

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

	// Real-time timer effect for active jobs
	useEffect(() => {
		const hasActiveJobs = allJobs.some(isActiveJob);

		if (hasActiveJobs) {
			// Update current time every second to refresh elapsed time display
			intervalRef.current = setInterval(() => {
				setCurrentTime(Date.now());
			}, 1000);
		} else if (intervalRef.current) {
			// Clear interval when no active jobs
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

	const formatElapsedTime = (startTime: number, endTime?: number): string => {
		const effectiveEndTime = endTime ?? currentTime;
		const elapsed = Math.max(0, Math.floor((effectiveEndTime - startTime) / 1000));
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
				return { emoji: "⏳", text: "Processing", color: COLORS.primary };
			case "success":
				return { emoji: "✅", text: "Completed", color: COLORS.success };
			case "error":
				return { emoji: "❌", text: "Failed", color: COLORS.error };
			default:
				return { emoji: "⏳", text: "Processing", color: COLORS.primary };
		}
	};

	const getProcessingStage = (
		message?: string,
	): { stage: string; emoji: string; progress: number } => {
		if (!message) return { stage: "Processing", emoji: "⚙️", progress: 5 };

		const lowerMessage = message.toLowerCase();

		if (
			lowerMessage.includes("extraction") ||
			lowerMessage.includes("analyzing") ||
			lowerMessage.includes("loading") ||
			lowerMessage.includes("content processing")
		) {
			return { stage: "Extracting content", emoji: "📄", progress: 8 };
		} else if (
			lowerMessage.includes("preparing speech") ||
			lowerMessage.includes("starting speech") ||
			lowerMessage.includes("preparing")
		) {
			return { stage: "Preparing request", emoji: "🔧", progress: 12 };
		} else if (
			lowerMessage.includes("connecting to gemini") ||
			lowerMessage.includes("connecting to ai") ||
			lowerMessage.includes("sending to ai") ||
			lowerMessage.includes("contacting")
		) {
			return { stage: "AI is generating speech", emoji: "🤖", progress: 15 };
		} else if (
			lowerMessage.includes("speech") ||
			lowerMessage.includes("ai") ||
			lowerMessage.includes("generating") ||
			lowerMessage.includes("gemini")
		) {
			return { stage: "AI is generating speech", emoji: "🎙️", progress: 50 };
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
			return { stage: "Finalizing download", emoji: "📥", progress: 95 };
		}
		return { stage: "Processing", emoji: "⚙️", progress: 20 };
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
		const elapsed = formatElapsedTime(job.startTime, job.completedAt);
		const stageInfo = getProcessingStage(job.message);

		return (
			<div
				style={{
					...jobCardStyle,
					...(isCurrentTab ? currentTabJobStyle : {}),
					...(isActiveJob(job) ? processingJobCardStyle : {}),
					...(isActiveJob(job) &&
					stageInfo.stage.includes("generating speech")
						? { animation: "workingGlow 3s infinite ease-in-out" }
						: {}),
				}}
			>
				<div style={jobHeaderStyle}>
					<div style={jobStatusStyle}>
						<span
							style={{
								fontSize: "16px",
								...(isActiveJob(job) ? pulsingEmojiStyle : {}),
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

				{isActiveJob(job) && (
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
						{job.text && (
							<div
								style={{
									...contentInfoStyle,
									...(stageInfo.stage.includes("generating speech")
										? { animation: "activeWork 2s infinite ease-in-out" }
										: {}),
								}}
							>
								<span>
									Processing ~{Math.round(job.text.split(" ").length)} words
								</span>
								{stageInfo.stage.includes("generating speech") && (
									<span style={timeEstimateStyle}>
										• Expected:{" "}
										{job.text.split(" ").length < 500
											? "30s-2min"
											: job.text.split(" ").length < 1500
												? "1-4min"
												: "3-8min"}
									</span>
								)}
							</div>
						)}
						<div style={connectionStatusStyle}>
							<div style={connectionDotStyle}></div>
							<span>Processing normally • {elapsed} elapsed</span>
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
					{isActiveJob(job) && (
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
					{!isActiveJob(job) && (
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
					<h2 style={titleStyle}>🎧 Listen Later</h2>
				</div>
				<div style={contentStyle}>
					<p style={{ ...TYPOGRAPHY.body, color: COLORS.textSecondary }}>
						Loading...
					</p>
				</div>
			</div>
		);
	}

	// Options not configured view
	if (!isOptionsConfigured) {
		return (
			<div style={containerStyle}>
				<div style={headerStyle}>
					<h2 style={titleStyle}>🎧 Listen Later</h2>
				</div>
				<div style={contentStyle}>
					<div style={warningStyle}>
						<p
							style={{
								margin: `0 0 ${SPACING.m} 0`,
								...TYPOGRAPHY.subtitle,
								color: COLORS.text,
							}}
						>
							⚠️ Configuration Required
						</p>
						<p
							style={{
								margin: `0 0 ${SPACING.l} 0`,
								...TYPOGRAPHY.body,
								color: COLORS.textSecondary,
							}}
						>
							Please configure your Gemini API key in the options page.
						</p>
						<button onClick={openOptionsPage} style={primaryButtonStyle}>
							⚙️ Open Settings
						</button>
					</div>
				</div>
			</div>
		);
	}

	// Get active job for current tab
	const currentTabJob =
		currentTabJobs.find(isActiveJob) ||
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
					🎧 Listen Later
				</h2>
				<div style={{ display: "flex", alignItems: "center", gap: SPACING.s }}>
					{allJobs.length > 0 && allJobs.some(isActiveJob) && (
						<div
							style={{
								...headerBadgeStyle,
								animation: "breathe 2s infinite ease-in-out",
							}}
						>
							<span style={{ fontSize: "8px" }}>●</span>
							{allJobs.filter(isActiveJob).length} active
						</div>
					)}
					<button
						onClick={openOptionsPage}
						style={{
							background: "none",
							border: "none",
							cursor: "pointer",
							fontSize: "20px",
							padding: SPACING.xs,
							opacity: 0.7,
							transition: "opacity 0.2s ease",
						}}
						title="Settings"
					>
						⚙️
					</button>
				</div>
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
							style={{
								margin: `0 0 ${SPACING.l} 0`,
								...TYPOGRAPHY.body,
								color: COLORS.textSecondary,
							}}
						>
							Convert the current page to speech
						</p>
						<button onClick={handleGenerateClick} style={primaryButtonStyle}>
							🎙️ Generate Speech
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
				{(allJobs.length > 0 || !hasCurrentTabJob) && (
					<div style={actionButtonsStyle}>
						{!hasCurrentTabJob && (
							<button onClick={openOptionsPage} style={secondaryButtonStyle}>
								📋 Settings
							</button>
						)}
						{completedJobs.length > 0 && (
							<button onClick={handleCleanupJobs} style={cleanupButtonStyle}>
								Clear Completed ({completedJobs.length})
							</button>
						)}
						{allJobs.length > 0 && (
							<button onClick={handleClearAllJobs} style={clearAllButtonStyle}>
								🗑️ Clear All ({allJobs.length})
							</button>
						)}
					</div>
				)}
			</div>
		</div>
	);
};

// Design System Constants
const SPACING = {
	xs: "4px",
	s: "8px",
	m: "16px",
	l: "24px",
	xl: "32px",
};

const TYPOGRAPHY = {
	title: { fontSize: "18px", fontWeight: "600" as const },
	subtitle: { fontSize: "14px", fontWeight: "500" as const },
	body: { fontSize: "13px", fontWeight: "400" as const },
	caption: { fontSize: "11px", fontWeight: "400" as const },
	tiny: { fontSize: "10px", fontWeight: "400" as const },
};

const COLORS = {
	primary: "#4285f4",
	success: "#34A853",
	error: "#EA4335",
	warning: "#FBBC04",
	text: "#202124",
	textSecondary: "#5F6368",
	border: "#DADCE0",
	background: "#FFFFFF",
	backgroundSecondary: "#F8F9FA",
};

// Styles
const containerStyle: React.CSSProperties = {
	width: "420px",
	minHeight: "200px",
	fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif",
};

const headerStyle: React.CSSProperties = {
	padding: "16px 24px",
	borderBottom: `1px solid ${COLORS.border}`,
	backgroundColor: COLORS.backgroundSecondary,
	display: "flex",
	justifyContent: "space-between",
	alignItems: "center",
};

const titleStyle: React.CSSProperties = {
	margin: 0,
	...TYPOGRAPHY.title,
	color: COLORS.text,
	display: "flex",
	alignItems: "center",
	gap: SPACING.s,
};

const contentStyle: React.CSSProperties = {
	padding: SPACING.l,
};

const primaryButtonStyle: React.CSSProperties = {
	padding: "12px 24px",
	backgroundColor: COLORS.primary,
	color: "white",
	border: "none",
	borderRadius: "8px",
	...TYPOGRAPHY.subtitle,
	cursor: "pointer",
	width: "100%",
	transition: "all 0.2s ease",
	boxShadow: "0 1px 3px rgba(0, 0, 0, 0.1)",
};

const secondaryButtonStyle: React.CSSProperties = {
	padding: "10px 20px",
	backgroundColor: "transparent",
	color: COLORS.textSecondary,
	border: `1px solid ${COLORS.border}`,
	borderRadius: "6px",
	...TYPOGRAPHY.body,
	cursor: "pointer",
	flex: 1,
	transition: "all 0.2s ease",
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
	padding: SPACING.l,
	backgroundColor: "#FFF9E6",
	border: `2px solid ${COLORS.warning}`,
	borderRadius: "12px",
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
	backgroundColor: COLORS.success,
	color: "white",
	...TYPOGRAPHY.caption,
	fontWeight: "600" as const,
	padding: "4px 12px",
	borderRadius: "12px",
	display: "flex",
	alignItems: "center",
	gap: SPACING.xs,
};

const currentTabSectionStyle: React.CSSProperties = {
	marginBottom: SPACING.m,
};

const sectionTitleStyle: React.CSSProperties = {
	margin: `0 0 ${SPACING.m} 0`,
	...TYPOGRAPHY.subtitle,
	fontWeight: "700" as const,
	color: COLORS.text,
	textTransform: "uppercase" as const,
	letterSpacing: "0.5px",
	fontSize: "11px",
};

const idleSectionStyle: React.CSSProperties = {
	textAlign: "center",
	marginBottom: SPACING.m,
};

const otherJobsSectionStyle: React.CSSProperties = {
	marginBottom: "15px",
};

const collapsibleButtonStyle: React.CSSProperties = {
	width: "100%",
	padding: "12px 16px",
	backgroundColor: COLORS.backgroundSecondary,
	border: `1px solid ${COLORS.border}`,
	borderRadius: "8px",
	...TYPOGRAPHY.body,
	fontWeight: "500" as const,
	cursor: "pointer",
	display: "flex",
	justifyContent: "space-between",
	alignItems: "center",
	color: COLORS.text,
	transition: "all 0.2s ease",
};

const otherJobsListStyle: React.CSSProperties = {
	marginTop: "10px",
	display: "flex",
	flexDirection: "column",
	gap: "8px",
};

const actionButtonsStyle: React.CSSProperties = {
	display: "flex",
	gap: SPACING.m,
	marginTop: SPACING.l,
	paddingTop: SPACING.l,
	borderTop: `1px solid ${COLORS.border}`,
};

const cleanupButtonStyle: React.CSSProperties = {
	padding: "10px 20px",
	backgroundColor: COLORS.backgroundSecondary,
	color: COLORS.textSecondary,
	border: `1px solid ${COLORS.border}`,
	borderRadius: "6px",
	...TYPOGRAPHY.body,
	cursor: "pointer",
	flex: 1,
	transition: "all 0.2s ease",
};

const clearAllButtonStyle: React.CSSProperties = {
	padding: "10px 20px",
	backgroundColor: COLORS.error,
	color: "white",
	border: "none",
	borderRadius: "6px",
	...TYPOGRAPHY.body,
	cursor: "pointer",
	flex: 1,
	transition: "all 0.2s ease",
	boxShadow: "0 1px 3px rgba(234, 67, 53, 0.3)",
};

// Job Card Styles
const jobCardStyle: React.CSSProperties = {
	padding: SPACING.m,
	border: `2px solid ${COLORS.border}`,
	borderRadius: "12px",
	backgroundColor: COLORS.background,
	boxShadow: "0 1px 3px rgba(0, 0, 0, 0.05)",
	transition: "all 0.2s ease",
};

const currentTabJobStyle: React.CSSProperties = {
	border: `3px solid ${COLORS.primary}`,
	backgroundColor: "#F8FBFF",
	boxShadow: "0 2px 8px rgba(66, 133, 244, 0.15)",
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
	gap: SPACING.s,
	marginBottom: SPACING.s,
};

const progressBarStyle: React.CSSProperties = {
	flex: 1,
	height: "8px",
	backgroundColor: COLORS.border,
	borderRadius: "4px",
	overflow: "hidden",
};

const progressFillStyle: React.CSSProperties = {
	height: "100%",
	backgroundColor: COLORS.primary,
	borderRadius: "4px",
	transition: "width 0.3s ease",
};

const progressTextStyle: React.CSSProperties = {
	...TYPOGRAPHY.caption,
	fontWeight: "600" as const,
	color: COLORS.primary,
	minWidth: "40px",
	textAlign: "right" as const,
};

const jobErrorStyle: React.CSSProperties = {
	...TYPOGRAPHY.body,
	color: COLORS.error,
	marginBottom: SPACING.s,
	fontWeight: "500" as const,
};

const jobSuccessStyle: React.CSSProperties = {
	...TYPOGRAPHY.body,
	color: COLORS.success,
	marginBottom: SPACING.s,
	fontWeight: "500" as const,
};

const jobActionsStyle: React.CSSProperties = {
	display: "flex",
	gap: SPACING.s,
	justifyContent: "flex-end",
	marginTop: SPACING.s,
};

const jobActionButtonStyle: React.CSSProperties = {
	padding: "6px 12px",
	backgroundColor: COLORS.primary,
	color: "white",
	border: "none",
	borderRadius: "6px",
	...TYPOGRAPHY.caption,
	fontWeight: "600" as const,
	cursor: "pointer",
	transition: "all 0.2s ease",
};

const jobRemoveButtonStyle: React.CSSProperties = {
	padding: "6px 12px",
	backgroundColor: "transparent",
	color: COLORS.textSecondary,
	border: `1px solid ${COLORS.border}`,
	borderRadius: "6px",
	...TYPOGRAPHY.caption,
	cursor: "pointer",
	transition: "all 0.2s ease",
};

const jobCancelButtonStyle: React.CSSProperties = {
	padding: "6px 12px",
	backgroundColor: COLORS.warning,
	color: COLORS.text,
	border: "none",
	borderRadius: "6px",
	...TYPOGRAPHY.caption,
	fontWeight: "600" as const,
	cursor: "pointer",
	transition: "all 0.2s ease",
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
	fontSize: "16px",
	marginRight: SPACING.s,
};

const stageTitleStyle: React.CSSProperties = {
	...TYPOGRAPHY.body,
	fontWeight: "600" as const,
	color: COLORS.primary,
	marginBottom: SPACING.s,
};

const stageProgressBarStyle: React.CSSProperties = {
	width: "100%",
	height: "6px",
	backgroundColor: COLORS.border,
	borderRadius: "3px",
	overflow: "hidden",
	marginTop: SPACING.xs,
};

const stageProgressFillStyle: React.CSSProperties = {
	height: "100%",
	background: `linear-gradient(90deg, ${COLORS.primary} 25%, #66a3ff 50%, ${COLORS.primary} 75%)`,
	backgroundSize: "200% 100%",
	borderRadius: "3px",
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
	backgroundColor: COLORS.warning,
	color: COLORS.text,
	border: "none",
	borderRadius: "6px",
	...TYPOGRAPHY.caption,
	fontWeight: "600" as const,
	cursor: "pointer",
	boxShadow: "0 1px 3px rgba(251, 188, 4, 0.3)",
	transition: "all 0.2s ease",
};

// Content awareness styles
const contentInfoStyle: React.CSSProperties = {
	...TYPOGRAPHY.caption,
	color: COLORS.textSecondary,
	backgroundColor: COLORS.backgroundSecondary,
	padding: `${SPACING.s} ${SPACING.m}`,
	borderRadius: "6px",
	marginBottom: SPACING.s,
	border: `1px solid ${COLORS.border}`,
};

const timeEstimateStyle: React.CSSProperties = {
	color: COLORS.primary,
	fontWeight: "600" as const,
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
	
	@keyframes activeWork {
		0% { 
			opacity: 1; 
			transform: scale(1);
		}
		25% { 
			opacity: 0.8; 
			transform: scale(1.02);
		}
		50% { 
			opacity: 0.9; 
			transform: scale(0.98);
		}
		75% { 
			opacity: 0.85; 
			transform: scale(1.01);
		}
		100% { 
			opacity: 1; 
			transform: scale(1);
		}
	}
	
	@keyframes workingGlow {
		0% { 
			border-color: rgba(66, 133, 244, 0.3);
			box-shadow: 0 0 5px rgba(66, 133, 244, 0.2);
		}
		50% { 
			border-color: rgba(76, 175, 80, 0.4);
			box-shadow: 0 0 15px rgba(76, 175, 80, 0.3);
		}
		100% { 
			border-color: rgba(66, 133, 244, 0.3);
			box-shadow: 0 0 5px rgba(66, 133, 244, 0.2);
		}
	}
`;
if (!document.head.querySelector('style[data-listen-later="animations"]')) {
	styleSheet.setAttribute("data-listen-later", "animations");
	document.head.appendChild(styleSheet);
}

export default Popup;
