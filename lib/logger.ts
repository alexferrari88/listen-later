// Development logging utilities
// Only logs in development mode to avoid console spam in production

const isDev = import.meta.env.MODE === "development";

export const logger = {
	debug: (message: string, ...args: unknown[]) => {
		if (isDev) {
			console.log(`[DEBUG] ${message}`, ...args);
		}
	},

	info: (message: string, ...args: unknown[]) => {
		if (isDev) {
			console.log(`[INFO] ${message}`, ...args);
		}
	},

	warn: (message: string, ...args: unknown[]) => {
		if (isDev) {
			console.warn(`[WARN] ${message}`, ...args);
		}
	},

	error: (message: string, ...args: unknown[]) => {
		// Always log errors, even in production
		console.error(`[ERROR] ${message}`, ...args);
	},

	// Specific logging functions for different components
	background: {
		message: (type: string, data?: unknown) => {
			if (isDev) {
				console.log(`[BACKGROUND] Message received: ${type}`, data);
			}
		},

		state: (state: unknown) => {
			if (isDev) {
				console.log(`[BACKGROUND] State updated:`, state);
			}
		},

		api: (endpoint: string, status?: number, data?: unknown) => {
			if (isDev) {
				console.log(`[BACKGROUND] API call: ${endpoint}`, { status, data });
			}
		},

		injection: (status: string, details?: unknown) => {
			if (isDev) {
				console.log(`[BACKGROUND] Script injection: ${status}`, details);
			}
		},
	},

	popup: {
		state: (state: unknown) => {
			if (isDev) {
				console.log(`[POPUP] State changed:`, state);
			}
		},

		action: (action: string, data?: unknown) => {
			if (isDev) {
				console.log(`[POPUP] Action: ${action}`, data);
			}
		},
	},

	content: {
		extraction: (stage: string, data?: unknown) => {
			if (isDev) {
				console.log(`[CONTENT] Extraction ${stage}:`, data);
			}
		},

		readability: (data: unknown) => {
			if (isDev) {
				console.log(`[CONTENT] Readability result:`, {
					title: (data as any)?.title,
					length: (data as any)?.textContent?.length,
					hasContent: !!(data as any)?.textContent,
				});
			}
		},
	},
};

// Helper to log function entry/exit with timing
export const withLogging = <T extends unknown[], R>(
	fn: (...args: T) => R,
	name: string,
	component: "background" | "popup" | "content" = "background",
) => {
	return (...args: T): R => {
		if (isDev) {
			console.time(`[${component.toUpperCase()}] ${name}`);
			logger.debug(`${name} called with:`, args);
		}

		try {
			const result = fn(...args);

			if (isDev) {
				console.timeEnd(`[${component.toUpperCase()}] ${name}`);
				logger.debug(`${name} completed successfully`);
			}

			return result;
		} catch (error) {
			if (isDev) {
				console.timeEnd(`[${component.toUpperCase()}] ${name}`);
			}
			logger.error(`${name} failed:`, error);
			throw error;
		}
	};
};

// Helper to log async function entry/exit with timing
export const withAsyncLogging = <T extends unknown[], R>(
	fn: (...args: T) => Promise<R>,
	name: string,
	component: "background" | "popup" | "content" = "background",
) => {
	return async (...args: T): Promise<R> => {
		if (isDev) {
			console.time(`[${component.toUpperCase()}] ${name}`);
			logger.debug(`${name} called with:`, args);
		}

		try {
			const result = await fn(...args);

			if (isDev) {
				console.timeEnd(`[${component.toUpperCase()}] ${name}`);
				logger.debug(`${name} completed successfully`);
			}

			return result;
		} catch (error) {
			if (isDev) {
				console.timeEnd(`[${component.toUpperCase()}] ${name}`);
			}
			logger.error(`${name} failed:`, error);
			throw error;
		}
	};
};
