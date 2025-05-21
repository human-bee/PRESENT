import { z } from "zod";
import { useEffect, useState } from "react";

// Schema for a single wind data point
const windSchema = z.object({
  speed: z.string().nullable().optional(), // e.g. "6 mph" or "0 to 3 mph"
  direction: z.string().nullable().optional(), // e.g. "W", "SE", "SSW"
});

// Schema for a single forecast period
const forecastPeriodSchema = z.object({
  temperature: z.string().nullable().optional(), // e.g. "63°F"
  wind: windSchema.nullable().optional(),
  condition: z.string().nullable().optional(), // e.g. "Sunny", "Mostly Cloudy"
});

// Schema for the complete weather forecast
export const weatherForecastSchema = z.object({
  location: z.string().nullable().optional().describe("Location name (e.g. 'Bellingham, WA')"), // e.g. "Bellingham, WA"
  periods: z.record(z.string(), forecastPeriodSchema).nullable().optional().describe("Weather periods with forecast data"),
});

// Type definitions derived from the schemas
export type WindData = z.infer<typeof windSchema>;
export type ForecastPeriod = z.infer<typeof forecastPeriodSchema>;
export type WeatherForecast = z.infer<typeof weatherForecastSchema>;

// Component props
export type WeatherForecastProps = z.infer<typeof weatherForecastSchema>;

// Weather condition to icon mapping
const conditionIcons: Record<string, string> = {
  "Sunny": "☀️",
  "Mostly Sunny": "🌤️",
  "Partly Cloudy": "⛅",
  "Mostly Cloudy": "🌥️",
  "Cloudy": "☁️",
  "Light Rain": "🌦️",
  "Rain": "🌧️",
  "Chance Light Rain": "🌦️",
  "Slight Chance Light Rain": "🌦️",
};

// Get icon for weather condition
function getConditionIcon(condition: string | null | undefined): string {
  if (!condition) return "🌡️";
  
  // Try to find exact match first
  if (condition in conditionIcons) {
    return conditionIcons[condition];
  }
  
  // Try to find partial match
  for (const [key, icon] of Object.entries(conditionIcons)) {
    if (condition.includes(key)) {
      return icon;
    }
  }
  
  // Default icon
  return "🌡️";
}

// Weather forecast component
export function WeatherForecast(props: WeatherForecastProps) {
  // Create state to track the data
  const [location, setLocation] = useState<string | null | undefined>(props.location);
  const [periods, setPeriods] = useState<Record<string, ForecastPeriod> | null | undefined>(props.periods);
  
  // Update state when props change
  useEffect(() => {
    setLocation(props.location);
    setPeriods(props.periods);
  }, [props.location, props.periods]);
  
  // Handle loading state
  if (!location && !periods) {
    return (
      <div className="w-full max-w-3xl mx-auto bg-gradient-to-br from-blue-50 to-blue-100 rounded-lg shadow-md p-6 text-center">
        <div className="animate-pulse flex flex-col items-center">
          <div className="h-8 bg-blue-200 rounded w-3/4 mb-4"></div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 w-full">
            {[1, 2, 3].map((i) => (
              <div key={i} className="bg-white rounded-lg shadow p-4 h-40">
                <div className="h-5 bg-blue-100 rounded w-1/2 mb-3"></div>
                <div className="h-8 bg-blue-100 rounded w-3/4 mb-3"></div>
                <div className="h-4 bg-gray-100 rounded w-full mb-2"></div>
                <div className="h-4 bg-gray-100 rounded w-full"></div>
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  }
  
  // Get periods as entries or empty array if null/undefined
  const periodEntries = periods ? Object.entries(periods) : [];
  
  // Get first few periods to display
  const displayPeriods = periodEntries.slice(0, 5);
  
  return (
    <div className="w-full max-w-3xl mx-auto bg-gradient-to-br from-blue-50 to-blue-100 rounded-lg shadow-md p-6">
      <h2 className="text-2xl font-semibold mb-4 text-center text-blue-800">
        Weather Forecast {location ? `for ${location}` : ""}
      </h2>
      
      {displayPeriods.length > 0 ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {displayPeriods.map(([periodName, forecast]) => (
            <div 
              key={periodName}
              className="bg-white rounded-lg shadow p-4 transition-transform hover:scale-105"
            >
              <h3 className="text-lg font-medium mb-2 text-blue-700">{periodName}</h3>
              
              <div className="flex items-center mb-2">
                <span className="text-4xl mr-3">{getConditionIcon(forecast?.condition)}</span>
                <span className="text-lg">{forecast?.condition || "Unknown"}</span>
              </div>
              
              <div className="flex flex-col space-y-2 text-gray-700">
                <div className="flex items-center">
                  <span className="w-8">🌡️</span>
                  <span>{forecast?.temperature || "N/A"}</span>
                </div>
                
                <div className="flex items-center">
                  <span className="w-8">💨</span>
                  <span>
                    {forecast?.wind?.speed || "N/A"} {forecast?.wind?.direction || ""}
                  </span>
                </div>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="text-center text-gray-500 py-8">
          No forecast data available yet.
        </div>
      )}
      
      {periodEntries.length > 5 && (
        <div className="mt-4 text-center">
          <button className="text-blue-600 hover:text-blue-800 font-medium">
            View all {periodEntries.length} periods →
          </button>
        </div>
      )}
    </div>
  );
}
