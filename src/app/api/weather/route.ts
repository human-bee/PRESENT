import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

export const runtime = 'nodejs';

type ForecastPeriod = {
  name: string;
  temperature: string;
  wind: { speed: string; direction: string };
  condition: string;
  precipitation?: number;
};

const QuerySchema = z.object({
  location: z.string().trim().min(1),
  days: z.coerce.number().int().min(1).max(14).optional().default(7),
});

function toCompass(deg: number): string {
  if (!Number.isFinite(deg)) return '';
  const dirs = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'] as const;
  const idx = Math.round(((deg % 360) / 45)) % 8;
  return dirs[idx] || 'N';
}

function weatherCodeToText(code: number): string {
  // Open-Meteo weather codes:
  // https://open-meteo.com/en/docs
  if (!Number.isFinite(code)) return 'Unknown';
  if (code === 0) return 'Clear';
  if (code === 1) return 'Mainly Clear';
  if (code === 2) return 'Partly Cloudy';
  if (code === 3) return 'Overcast';
  if (code === 45 || code === 48) return 'Fog';
  if (code === 51 || code === 53 || code === 55) return 'Drizzle';
  if (code === 56 || code === 57) return 'Freezing Drizzle';
  if (code === 61 || code === 63 || code === 65) return 'Rain';
  if (code === 66 || code === 67) return 'Freezing Rain';
  if (code === 71 || code === 73 || code === 75) return 'Snow';
  if (code === 77) return 'Snow Grains';
  if (code === 80 || code === 81 || code === 82) return 'Rain Showers';
  if (code === 85 || code === 86) return 'Snow Showers';
  if (code === 95) return 'Thunderstorm';
  if (code === 96 || code === 99) return 'Thunderstorm (Hail)';
  return 'Unknown';
}

async function fetchJson(url: string) {
  const res = await fetch(url, { method: 'GET' });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} - ${text.slice(0, 160)}`);
  }
  try {
    return JSON.parse(text) as any;
  } catch {
    throw new Error(`Invalid JSON from upstream`);
  }
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const parsed = QuerySchema.safeParse({
    location: searchParams.get('location') ?? undefined,
    days: searchParams.get('days') ?? undefined,
  });
  if (!parsed.success) {
    return NextResponse.json({ error: 'Bad request' }, { status: 400 });
  }

  const { location, days } = parsed.data;

  try {
    const geoUrl = new URL('https://geocoding-api.open-meteo.com/v1/search');
    geoUrl.searchParams.set('name', location);
    geoUrl.searchParams.set('count', '1');
    geoUrl.searchParams.set('language', 'en');
    geoUrl.searchParams.set('format', 'json');
    const geo = await fetchJson(geoUrl.toString());
    const first = Array.isArray(geo?.results) ? geo.results[0] : null;
    if (!first || typeof first?.latitude !== 'number' || typeof first?.longitude !== 'number') {
      return NextResponse.json({ error: 'Location not found' }, { status: 404 });
    }

    const labelParts = [first.name, first.admin1, first.country].filter(
      (v) => typeof v === 'string' && v.trim().length > 0,
    );
    const label = labelParts.slice(0, 2).join(', ');

    const forecastUrl = new URL('https://api.open-meteo.com/v1/forecast');
    forecastUrl.searchParams.set('latitude', String(first.latitude));
    forecastUrl.searchParams.set('longitude', String(first.longitude));
    forecastUrl.searchParams.set(
      'daily',
      [
        'weathercode',
        'temperature_2m_max',
        'temperature_2m_min',
        'precipitation_probability_max',
        'windspeed_10m_max',
        'winddirection_10m_dominant',
      ].join(','),
    );
    forecastUrl.searchParams.set('timezone', 'auto');
    forecastUrl.searchParams.set('forecast_days', String(days));
    forecastUrl.searchParams.set('temperature_unit', 'fahrenheit');
    forecastUrl.searchParams.set('windspeed_unit', 'mph');

    const forecast = await fetchJson(forecastUrl.toString());
    const daily = forecast?.daily;
    const times: string[] = Array.isArray(daily?.time) ? daily.time : [];
    const weathercodes: number[] = Array.isArray(daily?.weathercode) ? daily.weathercode : [];
    const tMax: number[] = Array.isArray(daily?.temperature_2m_max) ? daily.temperature_2m_max : [];
    const tMin: number[] = Array.isArray(daily?.temperature_2m_min) ? daily.temperature_2m_min : [];
    const precip: number[] = Array.isArray(daily?.precipitation_probability_max)
      ? daily.precipitation_probability_max
      : [];
    const windSpeed: number[] = Array.isArray(daily?.windspeed_10m_max) ? daily.windspeed_10m_max : [];
    const windDir: number[] = Array.isArray(daily?.winddirection_10m_dominant)
      ? daily.winddirection_10m_dominant
      : [];

    const periods: ForecastPeriod[] = times.map((dateIso, idx) => {
      const date = new Date(dateIso);
      const name =
        idx === 0
          ? 'Today'
          : idx === 1
            ? 'Tomorrow'
            : date.toLocaleDateString(undefined, { weekday: 'long' });
      const max = Number.isFinite(tMax[idx]) ? Math.round(tMax[idx]) : null;
      const min = Number.isFinite(tMin[idx]) ? Math.round(tMin[idx]) : null;
      const tempText =
        max != null && min != null ? `${max}°F / ${min}°F` : max != null ? `${max}°F` : '—';
      const speed = Number.isFinite(windSpeed[idx]) ? `${Math.round(windSpeed[idx])} mph` : '—';
      const direction = Number.isFinite(windDir[idx]) ? toCompass(windDir[idx]) : '';
      const p = Number.isFinite(precip[idx]) ? Math.max(0, Math.min(100, Math.round(precip[idx]))) : undefined;
      const code = Number.isFinite(weathercodes[idx]) ? weathercodes[idx] : NaN;
      const condition = weatherCodeToText(code);
      return {
        name,
        temperature: tempText,
        wind: { speed, direction: direction || '—' },
        condition,
        precipitation: p,
      };
    });

    return NextResponse.json({ location: label || location, periods });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message }, { status: 502 });
  }
}

