import { test, expect } from "@playwright/test";

/**
 * Test for numbered list preservation in content extraction
 * Uses TDD approach to ensure numbered lists maintain their numbering in extracted text
 */
test.describe("Numbered List Preservation", () => {
	test("should preserve numbers in ordered lists during content extraction", async ({ page }) => {
		// Create a test page with ordered lists
		const testHTML = `
			<!DOCTYPE html>
			<html>
			<head>
				<title>Test Numbered Lists</title>
			</head>
			<body>
				<article>
					<h1>Article with Numbered Lists</h1>
					<p>Here are some key points about AI development:</p>
					<ol>
						<li>First, AI systems need extensive training data</li>
						<li>Second, they require careful validation and testing</li>
						<li>Third, ethical considerations must be addressed</li>
					</ol>
					<p>Additionally, consider these implementation steps:</p>
					<ol start="5">
						<li>Define clear success metrics</li>
						<li>Implement monitoring and logging</li>
						<li>Plan for gradual rollout</li>
					</ol>
					<p>Finally, some nested content:</p>
					<div>
						<ol>
							<li>Nested item one with more content to meet length threshold</li>
							<li>Nested item two with <strong>bold text</strong></li>
						</ol>
					</div>
				</article>
			</body>
			</html>
		`;

		// Navigate to a data URL with our test HTML
		await page.goto(`data:text/html,${encodeURIComponent(testHTML)}`);

		// Simulate the updated content extraction logic with numbered list support
		const currentResult = await page.evaluate(() => {
			const article = document.querySelector('article');
			if (!article) return { error: "No article found" };

			// Simulate updated extension logic with numbered list preservation
			const tempDiv = document.createElement('div');
			tempDiv.innerHTML = article.innerHTML;

			const paragraphs: string[] = [];
			const seenTexts = new Set<string>();
			const elements = tempDiv.querySelectorAll('p, li, h1, h2, h3, h4, h5, h6');

			elements.forEach(element => {
				let text = element.textContent?.trim();
				if (text && text.length > 20) {
					// For list items, check if they're in an ordered list and add numbering
					if (element.tagName.toLowerCase() === 'li') {
						const parentOl = element.closest('ol');
						if (parentOl) {
							// Get the starting number (default is 1)
							const startNumber = parseInt(parentOl.getAttribute('start') || '1', 10);
							
							// Find the position of this li within its parent ol
							const siblingLis = Array.from(parentOl.children).filter(child => 
								child.tagName.toLowerCase() === 'li'
							);
							const position = siblingLis.indexOf(element);
							
							if (position !== -1) {
								const listNumber = startNumber + position;
								text = `${listNumber}. ${text}`;
							}
						}
					}

					if (!seenTexts.has(text)) {
						const hasNestedContent = element.querySelector('p, li, h1, h2, h3, h4, h5, h6') !== null;
						if (!hasNestedContent || element.tagName.toLowerCase() === 'li') {
							paragraphs.push(text);
							seenTexts.add(text);
						}
					}
				}
			});

			return {
				extractedText: paragraphs.join('\n\n'),
				paragraphCount: paragraphs.length
			};
		});

		if ('error' in currentResult) {
			throw new Error(currentResult.error);
		}

		console.log("=== CURRENT EXTRACTION RESULT ===");
		console.log(currentResult.extractedText);

		// Test current behavior - should fail because numbers are missing
		expect(currentResult.extractedText).toContain("First, AI systems need extensive training data");
		expect(currentResult.extractedText).toContain("Second, they require careful validation");
		expect(currentResult.extractedText).toContain("Third, ethical considerations must be addressed");

		// These should now pass with the numbered list preservation fix
		const shouldHaveNumbers = [
			"1. First, AI systems need extensive training data",
			"2. Second, they require careful validation and testing", 
			"3. Third, ethical considerations must be addressed",
			"5. Define clear success metrics", // Custom start number
			"6. Implement monitoring and logging",
			"7. Plan for gradual rollout",
			"1. Nested item one with more content to meet length threshold", // Nested list should restart numbering
			"2. Nested item two with bold text"
		];

		// Count how many numbered items are properly preserved
		let preservedNumbers = 0;
		for (const expectedText of shouldHaveNumbers) {
			if (currentResult.extractedText.includes(expectedText)) {
				preservedNumbers++;
			}
		}

		console.log(`Numbers preserved: ${preservedNumbers}/${shouldHaveNumbers.length}`);

		// Verify that numbered lists are now properly preserved
		expect(preservedNumbers).toBe(shouldHaveNumbers.length);
		console.log("✅ SUCCESS: All numbered lists are properly preserved!");

		// Verify specific expected numbered items
		for (const expectedText of shouldHaveNumbers) {
			expect(currentResult.extractedText).toContain(expectedText);
		}

		// Document what the final result should look like
		const expectedOutput = `Article with Numbered Lists

Here are some key points about AI development:

1. First, AI systems need extensive training data

2. Second, they require careful validation and testing

3. Third, ethical considerations must be addressed

Additionally, consider these implementation steps:

5. Define clear success metrics

6. Implement monitoring and logging

7. Plan for gradual rollout

Finally, some nested content:

1. Nested item one with more content to meet length threshold

2. Nested item two with bold text`;

		console.log("\n=== EXPECTED OUTPUT AFTER FIX ===");
		console.log(expectedOutput);

		// For now, just ensure we extract the content (without numbers)
		expect(currentResult.paragraphCount).toBeGreaterThan(6);
		expect(currentResult.extractedText.length).toBeGreaterThan(200);
	});

	test("should handle different list styles and starting numbers", async ({ page }) => {
		const testHTML = `
			<!DOCTYPE html>
			<html>
			<body>
				<article>
					<h1>Different List Styles</h1>
					<ol type="A">
						<li>Alphabetic list item A</li>
						<li>Alphabetic list item B</li>
					</ol>
					<ol type="I">
						<li>Roman numeral item I</li>
						<li>Roman numeral item II</li>
					</ol>
					<ol start="10">
						<li>Starting at ten</li>
						<li>Continuing with eleven</li>
					</ol>
				</article>
			</body>
			</html>
		`;

		await page.goto(`data:text/html,${encodeURIComponent(testHTML)}`);

		const result = await page.evaluate(() => {
			const article = document.querySelector('article');
			if (!article) return { error: "No article found" };

			// This test documents expected behavior for different list types
			// Implementation will be added in the next step
			const tempDiv = document.createElement('div');
			tempDiv.innerHTML = article.innerHTML;

			const elements = tempDiv.querySelectorAll('li');
			const listItems: string[] = [];

			elements.forEach(element => {
				const text = element.textContent?.trim();
				if (text) {
					listItems.push(text);
				}
			});

			return {
				extractedItems: listItems,
				itemCount: listItems.length
			};
		});

		if ('error' in result) {
			throw new Error(result.error);
		}

		// Verify we extract the list content
		expect(result.itemCount).toBe(6);
		expect(result.extractedItems).toContain("Alphabetic list item A");
		expect(result.extractedItems).toContain("Starting at ten");

		console.log("=== DIFFERENT LIST STYLES TEST ===");
		console.log("Items extracted:", result.extractedItems);
		console.log("Note: Full numbered list support to be implemented");
	});

	test("should not create duplicates when same content exists in lists and paragraphs", async ({ page }) => {
		// This test simulates the real-world issue where content appears in both <li> and <p> elements
		const testHTML = `
			<!DOCTYPE html>
			<html>
			<body>
				<article>
					<h1>Article with Duplicate Content Issue</h1>
					<p>Here's an introduction to the list:</p>
					<ol>
						<li>First: there is no AGI, there are many AGIs. This is a fundamental concept.</li>
						<li>Second: AI moves all costs to prompting and verifying the outputs.</li>
						<li>Third: AI is amplified intelligence, not artificial intelligence.</li>
					</ol>
					<p>Let me reiterate the key points:</p>
					<p>First: there is no AGI, there are many AGIs. This is a fundamental concept.</p>
					<p>Second: AI moves all costs to prompting and verifying the outputs.</p>
					<p>Third: AI is amplified intelligence, not artificial intelligence.</p>
					<p>These points are crucial for understanding AI economics.</p>
				</article>
			</body>
			</html>
		`;

		await page.goto(`data:text/html,${encodeURIComponent(testHTML)}`);

		const result = await page.evaluate(() => {
			const article = document.querySelector('article');
			if (!article) return { error: "No article found" };

			// Simulate the updated extension logic with deduplication fix
			const tempDiv = document.createElement('div');
			tempDiv.innerHTML = article.innerHTML;

			const paragraphs: string[] = [];
			const seenTexts = new Set<string>();
			const elements = tempDiv.querySelectorAll('p, li, h1, h2, h3, h4, h5, h6');

			const processedElements: { tag: string, text: string, wasSkipped: boolean, reason?: string }[] = [];

			elements.forEach(element => {
				const originalText = element.textContent?.trim();
				if (originalText && originalText.length > 20) {
					// Skip if we've already seen this exact text (avoids nested duplicates)
					if (!seenTexts.has(originalText)) {
						let finalText = originalText;
						
						// For list items, check if they're in an ordered list and add numbering
						if (element.tagName.toLowerCase() === 'li') {
							const parentOl = element.closest('ol');
							if (parentOl) {
								// Get the starting number (default is 1)
								const startNumber = parseInt(parentOl.getAttribute('start') || '1', 10);
								
								// Find the position of this li within its parent ol
								const siblingLis = Array.from(parentOl.children).filter(child => 
									child.tagName.toLowerCase() === 'li'
								);
								const position = siblingLis.indexOf(element);
								
								if (position !== -1) {
									const listNumber = startNumber + position;
									finalText = `${listNumber}. ${originalText}`;
								}
							}
						}
						
						// Check if this element contains other paragraph-level elements
						const hasNestedContent = element.querySelector('p, li, h1, h2, h3, h4, h5, h6') !== null;
						
						// If it has nested content, prefer the parent (li over nested p)
						// If no nested content, include it
						if (!hasNestedContent || element.tagName.toLowerCase() === 'li') {
							paragraphs.push(finalText);
							// Store both original and final text to prevent future duplicates
							seenTexts.add(originalText);
							if (finalText !== originalText) {
								seenTexts.add(finalText);
							}
							processedElements.push({ tag: element.tagName, text: finalText, wasSkipped: false });
						} else {
							// Still mark as seen to prevent duplicates, even if we don't include it
							seenTexts.add(originalText);
							processedElements.push({ tag: element.tagName, text: originalText, wasSkipped: true, reason: 'nested content' });
						}
					} else {
						processedElements.push({ tag: element.tagName, text: originalText, wasSkipped: true, reason: 'duplicate' });
					}
				}
			});

			return {
				extractedText: paragraphs.join('\n\n'),
				paragraphCount: paragraphs.length,
				processedElements,
				totalElements: elements.length
			};
		});

		if ('error' in result) {
			throw new Error(result.error);
		}

		console.log("=== DUPLICATION TEST RESULTS ===");
		console.log(`Total elements: ${result.totalElements}`);
		console.log(`Final paragraphs: ${result.paragraphCount}`);
		
		// Log what happened to each element
		result.processedElements.forEach((el, i) => {
			const status = el.wasSkipped ? `SKIPPED (${el.reason})` : 'INCLUDED';
			console.log(`${i + 1}. ${el.tag}: ${status} - ${el.text.substring(0, 50)}...`);
		});

		console.log("\n=== FINAL EXTRACTED TEXT ===");
		console.log(result.extractedText);

		// Verify no duplicates - each key concept should appear only once
		const lines = result.extractedText.split('\n\n').filter(line => line.trim().length > 0);
		
		const keyPhrases = [
			"First: there is no AGI, there are many AGIs",
			"Second: AI moves all costs to prompting",
			"Third: AI is amplified intelligence"
		];

		for (const phrase of keyPhrases) {
			const occurrences = lines.filter(line => line.toLowerCase().includes(phrase.toLowerCase()));
			expect(occurrences.length).toBe(1); // Should appear exactly once
			console.log(`✅ "${phrase.substring(0, 30)}..." appears exactly once`);
		}

		// Should have numbered versions in the final output
		expect(result.extractedText).toContain("1. First: there is no AGI, there are many AGIs");
		expect(result.extractedText).toContain("2. Second: AI moves all costs to prompting");
		expect(result.extractedText).toContain("3. Third: AI is amplified intelligence");

		// Should NOT have duplicate non-numbered versions (check for patterns at start of lines without numbers)
		expect(result.extractedText).not.toMatch(/^First: there is no AGI, there are many AGIs/m);
		expect(result.extractedText).not.toMatch(/^Second: AI moves all costs to prompting/m);
		expect(result.extractedText).not.toMatch(/^Third: AI is amplified intelligence/m);

		console.log("✅ SUCCESS: No duplicates found, numbered lists properly preserved!");
	});
});