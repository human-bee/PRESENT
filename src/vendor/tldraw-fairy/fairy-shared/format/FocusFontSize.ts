import z from 'zod'

// Copied from tldraw default shape constants to avoid pulling the full tldraw
// package (which includes React) into server-only routes.
const FONT_SIZES = {
	s: 18,
	m: 24,
	l: 36,
	xl: 44,
} as const

export const FocusFontSizeSchema = z.number()

/**
 * Calculates the closest predefined font size and scale combination to achieve a target font size
 * @param targetFontSize - The desired font size in pixels
 * @returns An object containing the closest predefined font size key and the scale factor
 */
export function convertFocusFontSizeToTldrawFontSize(targetFontSize: number) {
	const fontSizeEntries = Object.entries(FONT_SIZES)
	let closestSize = fontSizeEntries[0]
	let minDifference = Math.abs(targetFontSize - closestSize[1])

	for (const [size, fontSize] of fontSizeEntries) {
		const difference = Math.abs(targetFontSize - fontSize)
		if (difference < minDifference) {
			minDifference = difference
			closestSize = [size, fontSize]
		}
	}

	const textSize = closestSize[0] as keyof typeof FONT_SIZES
	const baseFontSize = closestSize[1]
	const scale = targetFontSize / baseFontSize

	return { textSize, scale }
}

/**
 * Converts a tldraw font size and scale to a simple font size
 * @param textSize - The tldraw font size
 * @param scale - The tldraw scale
 * @returns The simple font size
 */
export function convertTldrawFontSizeToFocusFontSize(
	textSize: keyof typeof FONT_SIZES,
	scale: number
) {
	return Math.round(FONT_SIZES[textSize] * scale)
}
