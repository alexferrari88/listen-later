import { test, expect } from "@playwright/test";

const TARGET_URL = "https://balajis.com/p/ai-is-polytheistic-not-monotheistic?hide_intro_popup=true";

/**
 * Test that the deduplication fix eliminates the duplicate content issue
 */
test.describe("Deduplication Fix Validation", () => {
	test("extension extraction should have no duplicates", async ({ page }) => {
		await page.goto(TARGET_URL, { waitUntil: "domcontentloaded" });
		await page.waitForSelector("article, .post-content, [data-testid='post-content'], main", { timeout: 10000 });
		
		// Simulate the updated extension logic with deduplication
		const extensionResult = await page.evaluate(() => {
			const article = document.querySelector('article');
			if (!article) return { error: "No article found" };
			
			// Simulate the new extraction logic
			const tempDiv = document.createElement('div');
			tempDiv.innerHTML = article.innerHTML;
			
			// Extract text from paragraph-level elements, avoiding nested duplicates
			const paragraphs: string[] = [];
			const seenTexts = new Set<string>();
			const elements = tempDiv.querySelectorAll('p, li, h1, h2, h3, h4, h5, h6');
			
			const debugInfo = {
				totalElements: elements.length,
				processedElements: 0,
				skippedDuplicates: 0,
				skippedNested: 0
			};
			
			elements.forEach(element => {
				const text = element.textContent?.trim();
				if (text && text.length > 20) { // Only process substantial content
					debugInfo.processedElements++;
					
					// Skip if we've already seen this exact text (avoids nested duplicates)
					if (!seenTexts.has(text)) {
						// Check if this element contains other paragraph-level elements
						const hasNestedContent = element.querySelector('p, li, h1, h2, h3, h4, h5, h6') !== null;
						
						// If it has nested content, prefer the parent (li over nested p)
						// If no nested content, include it
						if (!hasNestedContent || element.tagName.toLowerCase() === 'li') {
							paragraphs.push(text);
							seenTexts.add(text);
						} else {
							debugInfo.skippedNested++;
						}
					} else {
						debugInfo.skippedDuplicates++;
					}
				}
			});
			
			const extractedText = paragraphs.join('\n\n');
			
			// Apply the same cleaning logic as extension
			const cleanText = extractedText
				// Remove URLs and email addresses
				.replace(/https?:\/\/[^\s]+/g, "")
				.replace(/[\w.-]+@[\w.-]+\.[a-zA-Z]{2,}/g, "")
				
				// Remove common social sharing text
				.replace(/\b(share on|tweet this|like this|follow us)\b[^\n.]*/gi, "")
				.replace(/\b(facebook|twitter|instagram|linkedin|pinterest)\b[^\n.]*/gi, "")
				
				// Remove navigation elements  
				.replace(/^(home|about|contact|menu|search|login|register)([|\s]+\w+)*$/gim, "")
				.replace(/\b(previous|next|page \d+( of \d+)?|more\.\.\.)\b[^\n.]*/gi, "")
				
				// Remove author/date metadata patterns
				.replace(/^(by |author:|published|updated|posted|written by)[^\n]*/gim, "")
				.replace(/^\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4}[^\n]*/gim, "")
				
				// Remove very short lines that are likely UI fragments (< 4 words)
				.replace(/^\s*\w+\s*\w*\s*\w*\s*$/gim, "")
				
				// Clean up whitespace while preserving paragraph structure
				.replace(/\n\s*\n\s*\n+/g, "\n\n")
				.replace(/[ \t]+/g, " ")
				.replace(/\n /g, "\n")
				.replace(/ \n/g, "\n")
				.trim()
				.substring(0, 100000);
			
			return {
				extractedText: cleanText,
				debugInfo,
				paragraphCount: paragraphs.length,
				cleanedLength: cleanText.length
			};
		});
		
		if ('error' in extensionResult) {
			throw new Error(extensionResult.error);
		}
		
		// Check for duplicates in the final result
		const lines = extensionResult.extractedText.split('\n\n').filter(line => line.trim().length > 0);
		const duplicates = [];
		
		for (let i = 0; i < lines.length; i++) {
			for (let j = i + 1; j < lines.length; j++) {
				if (lines[i] === lines[j]) {
					duplicates.push({
						content: lines[i].substring(0, 50) + "...",
						positions: [i, j]
					});
				}
			}
		}
		
		console.log("=== DEDUPLICATION TEST RESULTS ===");
		console.log(`Total elements found: ${extensionResult.debugInfo.totalElements}`);
		console.log(`Elements processed: ${extensionResult.debugInfo.processedElements}`);
		console.log(`Duplicates skipped: ${extensionResult.debugInfo.skippedDuplicates}`);
		console.log(`Nested elements skipped: ${extensionResult.debugInfo.skippedNested}`);
		console.log(`Final paragraph count: ${extensionResult.paragraphCount}`);
		console.log(`Final text length: ${extensionResult.cleanedLength}`);
		console.log(`Duplicates in final result: ${duplicates.length}`);
		
		if (duplicates.length > 0) {
			console.log("\n=== REMAINING DUPLICATES ===");
			duplicates.forEach((dup, i) => {
				console.log(`${i + 1}. "${dup.content}" at positions ${dup.positions}`);
			});
		}
		
		// Validate the fix worked
		expect(duplicates.length).toBe(0); // Should have no duplicates
		expect(extensionResult.paragraphCount).toBeGreaterThan(10); // Should have substantial content
		expect(extensionResult.cleanedLength).toBeGreaterThan(1000); // Should be substantial
		
		// Should contain key content without duplication
		const keyPhrases = [
			"First: there is no AGI, there are many AGIs",
			"AI is amplified intelligence",
			"probabilistic while crypto is deterministic"
		];
		
		for (const phrase of keyPhrases) {
			// Count occurrences - should be exactly 1 each
			const regex = new RegExp(phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
			const matches = extensionResult.extractedText.match(regex) || [];
			expect(matches.length).toBe(1); // Each key phrase should appear exactly once
		}
		
		console.log("\n=== SUCCESS ===");
		console.log("Deduplication fix validated - no duplicate content found!");
	});
});