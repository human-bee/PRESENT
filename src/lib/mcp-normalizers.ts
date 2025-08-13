// Generic MCP normalizers used by sub-agents to produce canonical props

export type NormalizedForecast = {
  location?: string;
  periods: Array<{
    name: string;
    temperature: string;
    wind: { speed: string; direction: string };
    condition: string;
    humidity?: number | null;
    precipitation?: number | null;
    uvIndex?: number | null;
    visibility?: string | null;
  }>;
  alerts?: Array<{
    type: string;
    title: string;
    description: string;
    severity: 'minor' | 'moderate' | 'severe' | 'extreme';
  }> | null;
};

function toTitleCase(s: string) {
  return s.replace(/(^|\s)\w/g, (m) => m.toUpperCase());
}

// Try to coerce many possible shapes into our canonical WeatherForecast props
export function normalizeWeatherForecast(raw: any, location?: string): NormalizedForecast {
  // Case 1: Already in canonical form
  if (raw && Array.isArray(raw.periods)) {
    return { location: raw.location || location, periods: raw.periods, alerts: raw.alerts ?? null } as NormalizedForecast;
  }

  // Case 2: NOAA style { properties: { periods: [...] } } or { periods: [...] } with different keys
  const periodsLike = raw?.properties?.periods || raw?.periods || raw?.forecast || [];
  if (Array.isArray(periodsLike) && periodsLike.length > 0) {
    const periods = periodsLike.map((p: any, idx: number) => ({
      name: String(p.name ?? p.period ?? `Period ${idx + 1}`),
      temperature: typeof p.temperature === 'number' ? `${p.temperature}°F` : String(p.temperature ?? p.temp ?? ''),
      wind: {
        speed: String(p.windSpeed ?? p.wind?.speed ?? p.wind_speed ?? ''),
        direction: String(p.windDirection ?? p.wind?.direction ?? p.wind_dir ?? ''),
      },
      condition: toTitleCase(String(p.shortForecast ?? p.condition ?? p.summary ?? '')),
      humidity: typeof p.humidity === 'number' ? p.humidity : undefined,
      precipitation: typeof p.precipitation === 'number' ? p.precipitation : undefined,
      uvIndex: typeof p.uvIndex === 'number' ? p.uvIndex : undefined,
      visibility: p.visibility ? String(p.visibility) : undefined,
    }));
    return { location: raw.location || raw.city || location, periods, alerts: raw.alerts ?? null };
  }

  // Case 3: Plain text blob (e.g., tool returned string). Parse sections delimited by lines or dashes
  if (typeof raw === 'string') {
    const segments = raw
      .split(/---+|\n\n|\r\n\r\n/)
      .map((s) => s.trim())
      .filter(Boolean);
    const periods = segments.map((seg, idx) => {
      const nameMatch = seg.match(/^(.*?):/);
      const name = nameMatch ? nameMatch[1].trim() : `Period ${idx + 1}`;
      const tempMatch = seg.match(/Temperature:\s*([^\n]+)/i);
      const windMatch = seg.match(/Wind:\s*([^\n]+)/i);
      const condMatch = seg.match(/\n\s*([A-Za-z ].*?)\s*$/);
      let windSpeed = '', windDir = '';
      if (windMatch) {
        const wind = windMatch[1].trim();
        const parts = wind.split(/\s+/);
        // e.g. "5 mph SW" → speed = "5 mph", dir = "SW"
        if (parts.length >= 3) {
          windSpeed = parts.slice(0, 2).join(' ');
          windDir = parts.slice(2).join(' ');
        } else {
          windSpeed = wind;
        }
      }
      return {
        name,
        temperature: tempMatch ? tempMatch[1].trim() : '',
        wind: { speed: windSpeed, direction: windDir },
        condition: toTitleCase((condMatch?.[1] || '').trim()),
      };
    }).filter(p => p.temperature || p.condition);

    return { location, periods, alerts: null };
  }

  // Fallback: empty data so component shows loading fallback gracefully
  return { location, periods: [], alerts: null };
}


