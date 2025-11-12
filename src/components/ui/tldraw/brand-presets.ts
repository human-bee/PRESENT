export type PresetName = 'Hero' | 'Callout' | 'Quiet' | 'Wire' | 'Label'

export type Preset = {
  font: 'mono' | 'sans' | 'serif'
  size: 's' | 'm' | 'l' | 'xl'
  dash: 'solid' | 'dashed' | 'dotted'
  color: 'black' | 'grey' | 'violet' | 'blue' | 'green' | 'yellow' | 'red'
  fill?: 'none' | 'semi' | 'solid'
  opacity?: number
}

export const BRAND_PRESETS: Record<PresetName, Preset> = {
  Hero: { font: 'mono', size: 'xl', dash: 'solid', color: 'red', fill: 'none', opacity: 1 },
  Callout: { font: 'mono', size: 'm', dash: 'dotted', color: 'yellow', fill: 'semi', opacity: 0.2 },
  Quiet: { font: 'sans', size: 's', dash: 'solid', color: 'grey', fill: 'none', opacity: 0.8 },
  Wire: { font: 'mono', size: 'm', dash: 'solid', color: 'grey', fill: 'none', opacity: 1 },
  Label: { font: 'mono', size: 's', dash: 'solid', color: 'red', fill: 'solid', opacity: 0.12 },
}

