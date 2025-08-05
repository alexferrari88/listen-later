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
	retryJob,
	updateJob,
} from "../lib/storage";
import TextPreviewModal from "./TextPreviewModal";

const Popup: React.FC = () => {
	const [allJobs, setAllJobs] = useState<ProcessingJob[]>([]);
	const [currentTabId, setCurrentTabId] = useState<number | null>(null);
	const [currentTabJobs, setCurrentTabJobs] = useState<ProcessingJob[]>([]);
	const [otherJobs, setOtherJobs] = useState<ProcessingJob[]>([]);
	const [showOtherJobs, setShowOtherJobs] = useState(false);
	const [isOptionsConfigured, setIsOptionsConfigured] = useState(false);
	const [isLoading, setIsLoading] = useState(true);
	const [modalJob, setModalJob] = useState<ProcessingJob | null>(null);
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

				// Check for jobs awaiting confirmation
				checkForAwaitingConfirmationJobs(extensionState.activeJobs);
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

				// Check for jobs awaiting confirmation
				checkForAwaitingConfirmationJobs(newState.activeJobs);
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

	// Check for jobs awaiting confirmation and show modal
	const checkForAwaitingConfirmationJobs = (jobs: ProcessingJob[]) => {
		const awaitingJob = jobs.find(job => job.status === "awaiting_confirmation");
		if (awaitingJob && !modalJob) {
			logger.debug("Found job awaiting confirmation, showing modal", { jobId: awaitingJob.id });
			setModalJob(awaitingJob);
		} else if (!awaitingJob && modalJob) {
			logger.debug("No more jobs awaiting confirmation, hiding modal");
			setModalJob(null);
		}
	};

	// Handle modal confirmation - send user text to background
	const handleModalConfirm = async (editedText: string) => {
		if (!modalJob) return;
		
		try {
			logger.popup.action("User confirmed text for TTS", { 
				jobId: modalJob.id,
				textLength: editedText.length 
			});
			await chrome.runtime.sendMessage({
				type: "CONFIRM_TEXT_FOR_TTS",
				jobId: modalJob.id,
				text: editedText,
			});
			setModalJob(null);
		} catch (error) {
			logger.error("Failed to send CONFIRM_TEXT_FOR_TTS message:", error);
		}
	};

	// Handle modal cancellation - set job to error
	const handleModalCancel = async () => {
		if (!modalJob) return;
		
		try {
			logger.popup.action("User cancelled text confirmation", { jobId: modalJob.id });
			await updateJob(modalJob.id, {
				status: "error",
				message: "Text review cancelled by user",
			});
			setModalJob(null);
		} catch (error) {
			logger.error("Failed to cancel job:", error);
		}
	};

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

	const formatElapsedTime = (startTime: number): string => {
		const elapsed = Math.floor((Date.now() - startTime) / 1000);
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
			case "awaiting_confirmation":
				return { emoji: "📝", text: "Review Required", color: "#ea8600" };
			case "success":
				return { emoji: "✅", text: "Completed", color: "#137333" };
			case "error":
				return { emoji: "❌", text: "Failed", color: "#d93025" };
			default:
				return { emoji: "⏳", text: "Processing", color: "#4285f4" };
		}
	};

	const getProcessingStage = (message?: string): string => {
		if (!message) return "Processing";
		if (
			message.includes("extraction") ||
			message.includes("Analyzing") ||
			message.includes("Loading")
		) {
			return "Extracting content";
		} else if (
			message.includes("speech") ||
			message.includes("AI") ||
			message.includes("generating")
		) {
			return "Generating speech";
		} else if (
			message.includes("download") ||
			message.includes("Preparing audio")
		) {
			return "Finalizing";
		}
		return "Processing";
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
		const stage = getProcessingStage(job.message);

		return (
			<div
				style={{
					...jobCardStyle,
					...(isCurrentTab ? currentTabJobStyle : {}),
				}}
			>
				<div style={jobHeaderStyle}>
					<div style={jobStatusStyle}>
						<span style={{ fontSize: "16px" }}>{status.emoji}</span>
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

				{showTabInfo && <div style={jobTitleStyle}>{displayName}</div>}

				{job.status === "processing" && (
					<div style={jobMessageStyle}>
						{stage}: {job.message}
					</div>
				)}

				{job.status === "error" && (
					<div style={jobErrorStyle}>{job.message}</div>
				)}

				{job.status === "success" && job.filename && (
					<div style={jobSuccessStyle}>Downloaded: {job.filename}</div>
				)}

				<div style={jobActionsStyle}>
					{job.status === "error" && (
						<button
							onClick={() => handleRetryJob(job.id)}
							style={jobActionButtonStyle}
						>
							Retry
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
				<h2 style={titleStyle}>Listen Later</h2>
				{allJobs.length > 0 && (
					<div style={headerBadgeStyle}>
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
					{completedJobs.length > 0 && (
						<button onClick={handleCleanupJobs} style={cleanupButtonStyle}>
							Clear Completed ({completedJobs.length})
						</button>
					)}
				</div>
			</div>
			
			{/* Text Preview Modal */}
			{modalJob && (
				<TextPreviewModal
					job={modalJob}
					onConfirm={handleModalConfirm}
					onCancel={handleModalCancel}
				/>
			)}
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

const jobMessageStyle: React.CSSProperties = {
	fontSize: "12px",
	color: "#666",
	marginBottom: "8px",
	fontStyle: "italic",
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
	styleSheet.setAttribute("data-listen-later", "animations");
	document.head.appendChild(styleSheet);
}

export default Popup;
