import { useTamboComponentState } from "@tambo-ai/react";
import { z } from "zod";

// Define the forecast period schema
const forecastPeriodSchema = z.object({
  name: z.string().describe("Period name (e.g. 'Today', 'Tomorrow')"),
  temperature: z.string().describe("Temperature (e.g. '63°F')"),
  wind: z.object({
    speed: z.string().describe("Wind speed (e.g. '6 mph' or '0 to 3 mph')"),
    direction: z.string().describe("Wind direction (e.g. 'NW', 'SE')"),
  }),
  condition: z
    .string()
    .describe("Weather condition (e.g. 'Sunny', 'Mostly Cloudy')"),
});

// Schema for the complete weather forecast
export const weatherForecastSchema = z.object({
  location: z.string().describe("Location name (e.g. 'Bellingham, WA')"),
  periods: z
    .array(forecastPeriodSchema)
    .describe("Weather periods with forecast data"),
});

// Type definitions derived from the schemas
export type ForecastPeriod = z.infer<typeof forecastPeriodSchema>;
export type WeatherForecast = z.infer<typeof weatherForecastSchema>;

// Component props
export type WeatherForecastProps = z.infer<typeof weatherForecastSchema>;

// Component state type
type WeatherForecastState = {
  expandedView: boolean;
};

// Weather condition to icon mapping
const conditionIcons: Record<string, string> = {
  Sunny: "☀️",
  "Mostly Sunny": "🌤️",
  "Partly Cloudy": "⛅",
  "Mostly Cloudy": "🌥️",
  Cloudy: "☁️",
  "Light Rain": "🌦️",
  Rain: "🌧️",
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
  // Use Tambo state just for expandedView
  const [state, setState] = useTamboComponentState<WeatherForecastState>(
    "weather-forecast",
    { expandedView: false }
  );

  // Access data directly from props
  const periods = props.periods || [];

  // Get periods to display based on expanded state
  const displayPeriods = state?.expandedView ? periods : periods.slice(0, 6);

  // Toggle expanded view
  const toggleExpandedView = () => {
    if (!state) return;
    setState({ expandedView: !state.expandedView });
  };

  return (
    <div className="w-full max-w-3xl mx-auto bg-gradient-to-br from-blue-50 to-blue-100 rounded-lg shadow-md p-6">
      <h2 className="text-2xl font-semibold mb-4 text-center text-blue-800">
        Weather Forecast {props.location ? `for ${props.location}` : ""}
      </h2>

      {displayPeriods.length > 0 ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {displayPeriods.map((forecast) => (
            <div
              key={forecast.name}
              className="bg-white rounded-lg shadow p-4 transition-transform hover:scale-105"
            >
              <h3 className="text-lg font-medium mb-2 text-blue-700">
                {forecast.name}
              </h3>

              <div className="flex items-center mb-2">
                <span className="text-4xl mr-3">
                  {getConditionIcon(forecast.condition)}
                </span>
                <span className="text-lg">
                  {forecast.condition || "Unknown"}
                </span>
              </div>

              <div className="flex flex-col space-y-2 text-gray-700">
                <div className="flex items-center">
                  <span className="w-8">🌡️</span>
                  <span>{forecast.temperature || "N/A"}</span>
                </div>

                <div className="flex items-center">
                  <span className="w-8">💨</span>
                  <span>
                    {forecast.wind?.speed || "N/A"}{" "}
                    {forecast.wind?.direction || ""}
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

      {periods.length > 6 && (
        <div className="mt-4 text-center">
          <button
            className="text-blue-600 hover:text-blue-800 font-medium"
            onClick={toggleExpandedView}
          >
            {state?.expandedView
              ? `Show less ↑`
              : `View all ${periods.length} periods →`}
          </button>
        </div>
      )}
    </div>
  );
}
