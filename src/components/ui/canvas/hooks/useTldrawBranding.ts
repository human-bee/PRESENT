'use client'

import { useEffect, useMemo, useRef } from 'react'
import * as TL from 'tldraw'
import type { Editor } from 'tldraw'

/**
 * TLDraw style presets you can choose from out of the box:
 *
 * Fonts (`TLFont`)
 * - 'draw'  – hand-drawn style
 * - 'mono'  – monospaced
 * - 'sans'  – default sans-serif
 * - 'serif' – serif
 *
 * Tip: To use a custom font family, load it with CSS (`@font-face` or a web font) and
 * then override the CSS that TLDraw uses for text rendering (global CSS). The style
 * prop here selects the built-in font “mode”, not an arbitrary family list.
 *
 * Sizes (`TLSize`)
 * - 's' | 'm' | 'l' | 'xl' – TLDraw’s semantic scale for stroke and text.
 *
 * Dashes (`TLDash`)
 * - 'solid' | 'dashed' | 'dotted'
 *
 * Colors (`TLColor`)
 * - Canonical v4 color names used by TLDraw’s style panel & chips. You can remap
 *   these names to your brand hex values via the `palette` option below.
 */
export type TLFont = 'draw' | 'mono' | 'sans' | 'serif'
export type TLSize = 's' | 'm' | 'l' | 'xl'
export type TLDash = 'solid' | 'dashed' | 'dotted'
export type TLColor =
  | 'black'
  | 'grey'
  | 'light-violet'
  | 'violet'
  | 'light-blue'
  | 'blue'
  | 'light-green'
  | 'green'
  | 'light-yellow'
  | 'yellow'
  | 'light-red'
  | 'red'

/**
 * Options for the branding hook.
 *
 * - `default*` fields apply to new shapes by setting the editor’s “next shape” styles on mount.
 * - `palette` lets you remap built-in color names to brand hexes (affects chips & defaults).
 * - `selectionCssVars` tweaks subtle canvas UI colors without replacing TLDraw components.
 */
export interface TldrawBrandingOptions {
  defaultFont: TLFont
  defaultSize: TLSize
  defaultDash: TLDash
  defaultColor: TLColor
  // Optional palette remaps: supply brand hexes per named color
  palette?: Partial<Record<TLColor, string>>
  // Toggle brand palette remapping on/off quickly (keep TL defaults)
  paletteEnabled?: boolean
  // Optional CSS vars nudges (e.g., selection color)
  selectionCssVars?: Partial<{
    '--tl-color-selection': string
    '--tl-color-selection-stroke': string
  }>
}

const DEFAULTS: TldrawBrandingOptions = {
  defaultFont: 'mono',
  defaultSize: 'm',
  defaultDash: 'dotted',
  // NOTE: TLDraw does not ship an explicit 'orange' slot.
  // We map 'yellow' to orange in the palette and also map 'red' to deep orange.
  // Default to the deeper orange (mapped via 'red').
  defaultColor: 'red',
  paletteEnabled: true,
}

/**
 * useTldrawBranding
 *
 * Central place to set TLDraw v4 defaults and tiny theme tweaks for this app.
 *
 * What it does
 * - Sets editor “next shape” styles on mount (font / size / dash / color).
 *   This influences all subsequently created shapes and tool defaults without
 *   mutating any existing shapes.
 * - Optionally remaps TLDraw’s named colors to your brand hex values via
 *   DefaultColorThemePalette (light mode). This changes chips and defaults
 *   everywhere the palette name is referenced.
 * - Optionally applies CSS variable nudges (e.g., selection fill/stroke) for
 *   subtle UI personalizations without replacing native menus/controls.
 *
 * Usage (example)
 * const branding = useTldrawBranding({
 *   defaultFont: 'serif',
 *   defaultSize: 'm',
 *   defaultDash: 'solid',
 *   defaultColor: 'violet',
 *   palette: { violet: '#6a5acd' },
 *   selectionCssVars: {
 *     '--tl-color-selection': '#7b66dc33',
 *     '--tl-color-selection-stroke': '#7b66dc',
 *   },
 * })
 *
 * <Tldraw onMount={(ed) => { branding.onMount(ed) }} />
 *
 * Notes
 * - Palette remaps are global for the page and affect all TLDraw instances
 *   (intended). Only the solid swatch is changed here for simplicity.
 * - For one-off, per-shape overrides, use editor.setStyleForSelectedShapes(...).
 * - For deeper UI changes, compose TLDraw `components` and `overrides`.
 */
export function useTldrawBranding(user?: Partial<TldrawBrandingOptions>) {
  const opts = useMemo<TldrawBrandingOptions>(() => ({ ...DEFAULTS, ...(user || {}) }), [user])
  const paletteApplied = useRef(false)
  const cssApplied = useRef(false)

  // Apply brand palette remaps once (module-scoped constants are safe to mutate before mount)
  useEffect(() => {
    if (!opts.palette || opts.paletteEnabled === false || paletteApplied.current) return
    try {
      const palette: any = (TL as any)?.DefaultColorThemePalette
      if (!palette?.lightMode) return
      for (const [name, hex] of Object.entries(opts.palette)) {
        if (!hex) continue
        // Remap the solid variant for the named color (light theme)
        // Keep tints/shades as-is for now.
        if (palette.lightMode?.[name]?.solid && typeof palette.lightMode[name].solid === 'string') {
          palette.lightMode[name].solid = hex
        }
      }
      paletteApplied.current = true
    } catch {
      // Non-fatal: palette remap is best-effort
    }
  }, [opts.palette])

  // Optionally apply CSS variable tweaks globally (selection colors, etc.)
  useEffect(() => {
    if (!opts.selectionCssVars || cssApplied.current) return
    const el = typeof document !== 'undefined' ? document.documentElement : undefined
    if (!el) return
    for (const [k, v] of Object.entries(opts.selectionCssVars)) {
      if (v) el.style.setProperty(k, v)
    }
    cssApplied.current = true
  }, [opts.selectionCssVars])

  function onMount(editor: Editor) {
    try {
      editor.setStyleForNextShapes((TL as any).DefaultFontStyle, opts.defaultFont)
      editor.setStyleForNextShapes((TL as any).DefaultSizeStyle, opts.defaultSize)
      editor.setStyleForNextShapes((TL as any).DefaultDashStyle, opts.defaultDash)
      editor.setStyleForNextShapes((TL as any).DefaultColorStyle, opts.defaultColor)
    } catch {
      // Ignore: if editor changes API, we don't want to crash the app
    }
  }

  return { onMount }
}
