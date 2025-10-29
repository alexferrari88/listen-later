import { describe, expect, it, vi } from "vitest";
import { SlidingWindowRateLimiter } from "../lib/rateLimiter";

describe("SlidingWindowRateLimiter", () => {
	it("executes tasks immediately when within limits", async () => {
		const limiter = new SlidingWindowRateLimiter({
			maxRequestsPerMinute: 3,
			maxTokensPerMinute: 100,
			windowMs: 1_000,
			minWaitMs: 1,
		});

		const task = vi.fn(async () => "ok");

		const results = await Promise.all([
			limiter.schedule(task, 10),
			limiter.schedule(task, 15),
		]);

		expect(results).toEqual(["ok", "ok"]);
		expect(task).toHaveBeenCalledTimes(2);
	});

	it("enforces the maximum requests per window", async () => {
		vi.useFakeTimers();
		try {
			const limiter = new SlidingWindowRateLimiter({
				maxRequestsPerMinute: 2,
				maxTokensPerMinute: 100,
				windowMs: 1_000,
				minWaitMs: 1,
			});

			const startTimes: number[] = [];
			const tasks = ["a", "b", "c"].map((label) =>
				limiter.schedule(async () => {
					startTimes.push(Date.now());
					return label;
				}, 10),
			);

			await vi.advanceTimersByTimeAsync(0);
			expect(startTimes).toHaveLength(2);

			await vi.advanceTimersByTimeAsync(1_000);
			const results = await Promise.all(tasks);

			expect(results).toEqual(["a", "b", "c"]);
			expect(startTimes).toHaveLength(3);
			expect(startTimes[2]).toBeGreaterThanOrEqual(1_000);
		} finally {
			vi.useRealTimers();
		}
	});

	it("enforces the maximum token budget per window", async () => {
		vi.useFakeTimers();
		try {
			const limiter = new SlidingWindowRateLimiter({
				maxRequestsPerMinute: 10,
				maxTokensPerMinute: 15,
				windowMs: 1_000,
				minWaitMs: 1,
			});

			const startTimes: number[] = [];
			const tasks = [
				limiter.schedule(async () => {
					startTimes.push(Date.now());
					return "first";
				}, 10),
				limiter.schedule(
					async () => {
						startTimes.push(Date.now());
						return "second";
					},
					10,
				),
			];

			await vi.advanceTimersByTimeAsync(0);
			expect(startTimes).toHaveLength(1);

			await vi.advanceTimersByTimeAsync(1_000);
			const results = await Promise.all(tasks);

			expect(results).toEqual(["first", "second"]);
			expect(startTimes).toHaveLength(2);
			expect(startTimes[1]).toBeGreaterThanOrEqual(1_000);
		} finally {
			vi.useRealTimers();
		}
	});

	it("throws if a single request exceeds the configured token limit", async () => {
		const limiter = new SlidingWindowRateLimiter({
			maxRequestsPerMinute: 10,
			maxTokensPerMinute: 100,
			windowMs: 1_000,
			minWaitMs: 1,
		});

		await expect(
			limiter.schedule(async () => "too big", 200),
		).rejects.toThrow(/exceeds the per-minute limit/i);
	});
});
