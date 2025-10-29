type UsageRecord = {
	timestamp: number;
	tokens: number;
};

export type RateLimiterConfig = {
	maxRequestsPerMinute: number;
	maxTokensPerMinute: number;
	windowMs?: number;
	minWaitMs?: number;
};

export type ScheduleOptions = {
	onThrottle?: (waitMs: number, attempt: number) => void | Promise<void>;
};

const DEFAULT_WINDOW_MS = 60_000;
const DEFAULT_MIN_WAIT_MS = 500;

const delay = (ms: number): Promise<void> =>
	new Promise((resolve) => {
		setTimeout(resolve, ms);
	});

export class SlidingWindowRateLimiter {
	private readonly maxRequestsPerMinute: number;

	private readonly maxTokensPerMinute: number;

	private readonly windowMs: number;

	private readonly minWaitMs: number;

	private requestTimestamps: number[] = [];

	private tokenUsage: UsageRecord[] = [];

	private tokenTotal = 0;

	constructor({
		maxRequestsPerMinute,
		maxTokensPerMinute,
		windowMs = DEFAULT_WINDOW_MS,
		minWaitMs = DEFAULT_MIN_WAIT_MS,
	}: RateLimiterConfig) {
		if (maxRequestsPerMinute <= 0) {
			throw new Error("maxRequestsPerMinute must be greater than 0");
		}
		if (maxTokensPerMinute <= 0) {
			throw new Error("maxTokensPerMinute must be greater than 0");
		}

		this.maxRequestsPerMinute = maxRequestsPerMinute;
		this.maxTokensPerMinute = maxTokensPerMinute;
		this.windowMs = windowMs;
		this.minWaitMs = Math.max(1, minWaitMs);
	}

	async schedule<T>(
		task: () => Promise<T>,
		requestTokens: number,
		options?: ScheduleOptions,
	): Promise<T> {
		await this.acquire(requestTokens, options);
		return task();
	}

	private async acquire(
		requestTokens: number,
		options?: ScheduleOptions,
	): Promise<void> {
		if (requestTokens > this.maxTokensPerMinute) {
			throw new Error(
				`Request requires ${requestTokens} tokens which exceeds the per-minute limit of ${this.maxTokensPerMinute}.`,
			);
		}

		let attempt = 0;
		while (true) {
			attempt++;
			const now = Date.now();
			this.prune(now);

			if (this.canProceed(requestTokens)) {
				this.registerRequest(now, requestTokens);
				return;
			}

			const waitMs = this.calculateWaitMs(now, requestTokens);
			if (options?.onThrottle) {
				await options.onThrottle(waitMs, attempt);
			}
			await delay(waitMs);
		}
	}

	private canProceed(requestTokens: number): boolean {
		const underRequestLimit =
			this.requestTimestamps.length < this.maxRequestsPerMinute;
		const underTokenLimit =
			this.tokenTotal + requestTokens <= this.maxTokensPerMinute;
		return underRequestLimit && underTokenLimit;
	}

	private registerRequest(timestamp: number, tokens: number): void {
		this.requestTimestamps.push(timestamp);
		this.tokenUsage.push({ timestamp, tokens });
		this.tokenTotal += tokens;
	}

	private prune(now: number): void {
		while (
			this.requestTimestamps.length > 0 &&
			now - this.requestTimestamps[0] >= this.windowMs
		) {
			this.requestTimestamps.shift();
		}

		while (
			this.tokenUsage.length > 0 &&
			now - this.tokenUsage[0].timestamp >= this.windowMs
		) {
			const expired = this.tokenUsage.shift();
			if (expired) {
				this.tokenTotal -= expired.tokens;
			}
		}
	}

	private calculateWaitMs(now: number, requestTokens: number): number {
		let requestWait = 0;
		if (this.requestTimestamps.length >= this.maxRequestsPerMinute) {
			const oldestRequest = this.requestTimestamps[0];
			requestWait = Math.max(0, this.windowMs - (now - oldestRequest));
		}

		let tokensWait = 0;
		if (this.tokenTotal + requestTokens > this.maxTokensPerMinute) {
			let tokensNeeded =
				this.tokenTotal + requestTokens - this.maxTokensPerMinute;
			for (const record of this.tokenUsage) {
				tokensNeeded -= record.tokens;
				const expiryMs = Math.max(0, this.windowMs - (now - record.timestamp));
				tokensWait = expiryMs;
				if (tokensNeeded <= 0) {
					break;
				}
			}
		}

		const waitMs = Math.max(requestWait, tokensWait, this.minWaitMs);
		return waitMs;
	}
}

export const createRateLimiter = (config?: Partial<RateLimiterConfig>) => {
	const resolvedConfig: RateLimiterConfig = {
		maxRequestsPerMinute: config?.maxRequestsPerMinute ?? 10,
		maxTokensPerMinute: config?.maxTokensPerMinute ?? 10_000,
		windowMs: config?.windowMs ?? DEFAULT_WINDOW_MS,
		minWaitMs: config?.minWaitMs ?? DEFAULT_MIN_WAIT_MS,
	};

	return new SlidingWindowRateLimiter(resolvedConfig);
};
