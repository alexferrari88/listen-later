import type React from "react";
import { useEffect, useState } from "react";
import type { ProcessingJob } from "../lib/storage";

interface TextPreviewModalProps {
	job: ProcessingJob;
	onConfirm: (editedText: string) => void;
	onCancel: () => void;
}

const TextPreviewModal: React.FC<TextPreviewModalProps> = ({
	job,
	onConfirm,
	onCancel,
}) => {
	const [editedText, setEditedText] = useState(job.text || "");
	const [isConfirming, setIsConfirming] = useState(false);

	useEffect(() => {
		setEditedText(job.text || "");
	}, [job.text]);

	useEffect(() => {
		const handleKeydown = (e: KeyboardEvent) => {
			if (e.key === "Escape") {
				handleCancel();
			}
		};

		document.addEventListener("keydown", handleKeydown);

		return () => {
			document.removeEventListener("keydown", handleKeydown);
		};
	}, [handleCancel]);

	const handleConfirm = async () => {
		if (!editedText.trim()) {
			return;
		}
		setIsConfirming(true);
		try {
			await onConfirm(editedText);
		} finally {
			setIsConfirming(false);
		}
	};

	const handleCancel = () => {
		onCancel();
	};

	const characterCount = editedText.length;
	const wordCount = editedText
		.trim()
		.split(/\s+/)
		.filter((word) => word.length > 0).length;

	return (
		<div
			style={overlayStyle}
			onClick={handleCancel}
			onKeyDown={(e) => {
				if (e.key === "Enter" || e.key === " ") {
					handleCancel();
				}
			}}
			role="button"
			tabIndex={0}
		>
			<div
				style={modalStyle}
				onClick={(e) => e.stopPropagation()}
				onKeyDown={(e) => e.stopPropagation()}
				role="dialog"
				tabIndex={-1}
			>
				<div style={headerStyle}>
					<h3 style={titleStyle}>Review Extracted Text</h3>
					<div style={articleInfoStyle}>
						{job.tabInfo.articleTitle || job.tabInfo.title}
					</div>
				</div>

				<div style={contentStyle}>
					<div style={instructionsStyle}>
						Review and edit the extracted text below. Make any necessary
						corrections before generating speech.
					</div>

					<textarea
						value={editedText}
						onChange={(e) => setEditedText(e.target.value)}
						style={textareaStyle}
						placeholder="Extracted text will appear here..."
						disabled={isConfirming}
					/>

					<div style={statsStyle}>
						<span style={statStyle}>
							{characterCount.toLocaleString()} characters
						</span>
						<span style={statStyle}>{wordCount.toLocaleString()} words</span>
						<span style={statStyle}>
							~{Math.ceil(wordCount / 150)} min read
						</span>
					</div>
				</div>

				<div style={actionsStyle}>
					<button
						type="button"
						onClick={handleCancel}
						style={cancelButtonStyle}
						disabled={isConfirming}
					>
						Cancel
					</button>
					<button
						type="button"
						onClick={handleConfirm}
						style={{
							...confirmButtonStyle,
							...(isConfirming ? confirmingButtonStyle : {}),
						}}
						disabled={!editedText.trim() || isConfirming}
					>
						{isConfirming ? "Confirming..." : "Confirm & Generate Speech"}
					</button>
				</div>
			</div>
		</div>
	);
};

const overlayStyle: React.CSSProperties = {
	position: "fixed",
	top: 0,
	left: 0,
	right: 0,
	bottom: 0,
	backgroundColor: "rgba(0, 0, 0, 0.5)",
	display: "flex",
	alignItems: "center",
	justifyContent: "center",
	zIndex: 1000,
};

const modalStyle: React.CSSProperties = {
	backgroundColor: "white",
	borderRadius: "8px",
	width: "90vw",
	maxWidth: "600px",
	maxHeight: "80vh",
	display: "flex",
	flexDirection: "column",
	boxShadow: "0 4px 12px rgba(0, 0, 0, 0.3)",
	fontFamily: "Arial, sans-serif",
};

const headerStyle: React.CSSProperties = {
	padding: "20px 20px 15px 20px",
	borderBottom: "1px solid #e0e0e0",
	backgroundColor: "#f8f9fa",
	borderRadius: "8px 8px 0 0",
};

const titleStyle: React.CSSProperties = {
	margin: "0 0 8px 0",
	fontSize: "18px",
	fontWeight: "600",
	color: "#333",
};

const articleInfoStyle: React.CSSProperties = {
	fontSize: "14px",
	color: "#666",
	fontWeight: "500",
	lineHeight: "1.3",
};

const contentStyle: React.CSSProperties = {
	padding: "20px",
	flex: 1,
	display: "flex",
	flexDirection: "column",
	minHeight: 0,
};

const instructionsStyle: React.CSSProperties = {
	fontSize: "14px",
	color: "#666",
	marginBottom: "15px",
	lineHeight: "1.4",
};

const textareaStyle: React.CSSProperties = {
	width: "100%",
	flex: 1,
	minHeight: "200px",
	padding: "12px",
	border: "2px solid #e0e0e0",
	borderRadius: "6px",
	fontSize: "14px",
	fontFamily: "Arial, sans-serif",
	lineHeight: "1.5",
	resize: "none",
	outline: "none",
	backgroundColor: "#fafafa",
};

const statsStyle: React.CSSProperties = {
	display: "flex",
	gap: "15px",
	marginTop: "10px",
	fontSize: "12px",
	color: "#666",
};

const statStyle: React.CSSProperties = {
	fontWeight: "500",
};

const actionsStyle: React.CSSProperties = {
	padding: "15px 20px",
	borderTop: "1px solid #e0e0e0",
	display: "flex",
	gap: "10px",
	justifyContent: "flex-end",
};

const cancelButtonStyle: React.CSSProperties = {
	padding: "10px 16px",
	backgroundColor: "transparent",
	color: "#666",
	border: "1px solid #ccc",
	borderRadius: "4px",
	fontSize: "14px",
	cursor: "pointer",
	fontWeight: "500",
};

const confirmButtonStyle: React.CSSProperties = {
	padding: "10px 16px",
	backgroundColor: "#4285f4",
	color: "white",
	border: "none",
	borderRadius: "4px",
	fontSize: "14px",
	cursor: "pointer",
	fontWeight: "500",
	minWidth: "180px",
};

const confirmingButtonStyle: React.CSSProperties = {
	backgroundColor: "#ccc",
	cursor: "not-allowed",
};

export default TextPreviewModal;
