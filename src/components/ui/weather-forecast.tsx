import { useTamboComponentState } from "@tambo-ai/react";
import { z } from "zod";
import React, { useEffect } from 'react';
import { Cloud, CloudRain, CloudSnow, Sun, Wind, Droplets, Eye, Gauge } from 'lucide-react';

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
  selectedDay: number;
  animatedTemp: number;
};

// Map weather conditions to simplified types for icons
function mapConditionToType(condition: string | null | undefined): string {
  // Handle null/undefined conditions
  if (!condition) {
    return 'sunny'; // default fallback
  }
  
  const conditionLower = condition.toLowerCase();
  
  if (conditionLower.includes('sunny') || conditionLower.includes('clear')) {
    return 'sunny';
  }
  if (conditionLower.includes('rain') || conditionLower.includes('showers')) {
    return 'rainy';
  }
  if (conditionLower.includes('snow') || conditionLower.includes('blizzard')) {
    return 'snowy';
  }
  if (conditionLower.includes('storm') || conditionLower.includes('thunderstorm')) {
    return 'stormy';
  }
  if (conditionLower.includes('partly') || conditionLower.includes('scattered')) {
    return 'partly-cloudy';
  }
  if (conditionLower.includes('cloud') || conditionLower.includes('overcast')) {
    return 'cloudy';
  }
  
  return 'sunny'; // default
}

// Extract numeric temperature from string
function extractTemperature(tempStr: string | null | undefined): number {
  if (!tempStr) return 70; // default fallback
  const match = tempStr.match(/(\d+)/);
  return match ? parseInt(match[1]) : 70;
}

// Calculate precipitation percentage based on condition
function calculatePrecipitation(condition: string | null | undefined): number {
  if (!condition) return 0;
  
  const conditionLower = condition.toLowerCase();
  
  if (conditionLower.includes('rain') || conditionLower.includes('showers')) {
    if (conditionLower.includes('heavy') || conditionLower.includes('steady')) {
      return 80;
    }
    if (conditionLower.includes('light') || conditionLower.includes('scattered')) {
      return 40;
    }
    return 60;
  }
  if (conditionLower.includes('storm') || conditionLower.includes('thunderstorm')) {
    return 90;
  }
  if (conditionLower.includes('snow') || conditionLower.includes('blizzard')) {
    return 70;
  }
  if (conditionLower.includes('drizzle') || conditionLower.includes('mist')) {
    return 30;
  }
  if (conditionLower.includes('partly') || conditionLower.includes('chance')) {
    return 20;
  }
  if (conditionLower.includes('cloud') || conditionLower.includes('overcast')) {
    return 10;
  }
  
  return 0; // sunny/clear
}

// Weather icon component with animations
const WeatherIcon = ({ condition, size = 48 }: { condition: string | null | undefined; size?: number }) => {
  const iconProps = { size, className: "transition-all duration-500" };
  const conditionType = mapConditionToType(condition);
  
  switch (conditionType) {
    case 'sunny':
      return <Sun {...iconProps} className={`${iconProps.className} text-white animate-spin-slow`} />;
    case 'cloudy':
      return <Cloud {...iconProps} className={`${iconProps.className} text-gray-300 animate-float`} />;
    case 'rainy':
      return <CloudRain {...iconProps} className={`${iconProps.className} text-gray-400 animate-float`} />;
    case 'stormy':
      return (
        <div className="relative">
          <CloudRain {...iconProps} className={`${iconProps.className} text-gray-500`} />
          <div className="absolute inset-0 animate-flash" />
        </div>
      );
    case 'snowy':
      return <CloudSnow {...iconProps} className={`${iconProps.className} text-white animate-float`} />;
    case 'partly-cloudy':
      return (
        <div className="relative">
          <Cloud {...iconProps} className={`${iconProps.className} text-gray-400`} />
          <Sun size={Math.floor(size * 0.66)} className="absolute -top-2 -right-2 text-white animate-spin-slow" />
        </div>
      );
    default:
      return <Sun {...iconProps} className={`${iconProps.className} text-white`} />;
  }
};

// Weather forecast component
export function WeatherForecast(props: WeatherForecastProps) {
  // Use Tambo state for component state
  const [state, setState] = useTamboComponentState<WeatherForecastState>(
    "weather-forecast",
    { 
      expandedView: false,
      selectedDay: 0,
      animatedTemp: 70,
    }
  );

  // Access data directly from props (Tambo will handle streaming at the provider level)
  const location = props.location;
  const periods = props.periods || [];
  
  // Check if component should show loading state (no data yet)
  const isLoading = !location || periods.length === 0;
  const currentPeriod = periods[state?.selectedDay || 0] || periods[0];

  // Animate temperature changes
  useEffect(() => {
    if (currentPeriod && state) {
      const timer = setTimeout(() => {
        const newTemp = extractTemperature(currentPeriod.temperature);
        setState({ ...state, animatedTemp: newTemp });
      }, 100);
      return () => clearTimeout(timer);
    }
  }, [currentPeriod?.temperature, state, setState]);

  // Get periods to display based on expanded state
  const displayPeriods = state?.expandedView ? periods : periods.slice(0, 7);

  // Handle day selection
  const selectDay = (index: number) => {
    if (!state) return;
    setState({ ...state, selectedDay: index });
  };

  // Show loading state if no data yet
  if (isLoading || !currentPeriod) {
    return (
      <div className="w-full max-w-md mx-auto p-6 bg-black rounded-3xl shadow-2xl flex items-center justify-center h-96 border border-gray-800">
        <div className="animate-pulse text-white text-xl">Loading weather...</div>
      </div>
    );
  }

  const currentPrecipitation = calculatePrecipitation(currentPeriod.condition);

  return (
    <div className="w-full max-w-md mx-auto">
      {/* Custom animations */}
      <style jsx>{`
        @keyframes float {
          0%, 100% { transform: translateY(0); }
          50% { transform: translateY(-10px); }
        }
        @keyframes spin-slow {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
        @keyframes flash {
          0%, 100% { opacity: 0; }
          50% { opacity: 0.3; background: white; }
        }
        @keyframes gradient-shift {
          0%, 100% { background-position: 0% 50%; }
          50% { background-position: 100% 50%; }
        }
        .animate-float {
          animation: float 3s ease-in-out infinite;
        }
        .animate-spin-slow {
          animation: spin-slow 20s linear infinite;
        }
        .animate-flash {
          animation: flash 2s ease-in-out infinite;
        }
        .animate-gradient {
          background-size: 200% 200%;
          animation: gradient-shift 5s ease infinite;
        }
      `}</style>

      {/* Main weather card */}
      <div className="relative overflow-hidden bg-black rounded-3xl shadow-2xl p-6 transition-all duration-500 hover:shadow-3xl transform hover:scale-105 border border-gray-800">
        {/* Animated background gradient */}
        <div className="absolute inset-0 bg-gradient-to-br from-gray-900 via-black to-gray-800 animate-gradient opacity-50" />
        
        {/* Animated background elements */}
        <div className="absolute inset-0 opacity-10">
          <div className="absolute top-10 left-10 w-32 h-32 bg-white rounded-full blur-3xl animate-float" />
          <div className="absolute bottom-10 right-10 w-24 h-24 bg-white rounded-full blur-2xl animate-float" style={{ animationDelay: '1s' }} />
        </div>

        {/* Header */}
        <div className="relative z-10 text-white mb-6">
          <h2 className="text-2xl font-bold mb-1">
            {location || 'Weather Forecast'}
          </h2>
          <p className="text-sm opacity-80">
            {new Date().toLocaleDateString('en-US', { 
              weekday: 'long', 
              year: 'numeric', 
              month: 'long', 
              day: 'numeric' 
            })}
          </p>
        </div>

        {/* Current weather display */}
        <div className="relative z-10 text-center text-white mb-8">
          <div className="mb-4 flex justify-center">
            <WeatherIcon condition={currentPeriod.condition} size={80} />
          </div>
          <div className="text-6xl font-bold mb-2 transition-all duration-300">
            {state?.animatedTemp || extractTemperature(currentPeriod.temperature || "")}°
          </div>
          <p className="text-xl capitalize opacity-90">{currentPeriod.condition || 'Unknown'}</p>
          <p className="text-sm opacity-80">H: {currentPeriod.temperature || 'N/A'} L: {extractTemperature(currentPeriod.temperature || "") - 13}°</p>
        </div>

        {/* Weather details */}
        <div className="relative z-10 grid grid-cols-3 gap-4 mb-6 text-white">
          <div className="text-center bg-white bg-opacity-10 rounded-xl p-3 backdrop-blur-sm transition-all duration-300 hover:bg-opacity-15 border border-gray-700">
            <Wind size={24} className="mx-auto mb-1" />
            <p className="text-xs opacity-80">Wind</p>
            <p className="font-semibold">
              {currentPeriod.wind?.speed || '12 mph'}
            </p>
          </div>
          <div className="text-center bg-white bg-opacity-10 rounded-xl p-3 backdrop-blur-sm transition-all duration-300 hover:bg-opacity-15 border border-gray-700">
            <Droplets size={24} className="mx-auto mb-1" />
            <p className="text-xs opacity-80">Humidity</p>
            <p className="font-semibold">65%</p>
          </div>
          <div className="text-center bg-white bg-opacity-10 rounded-xl p-3 backdrop-blur-sm transition-all duration-300 hover:bg-opacity-15 border border-gray-700">
            <Eye size={24} className="mx-auto mb-1" />
            <p className="text-xs opacity-80">Visibility</p>
            <p className="font-semibold">10 mi</p>
          </div>
        </div>

        {/* Forecast periods */}
        {displayPeriods.length > 1 && (
          <div className="relative z-10">
            <h3 className="text-white text-sm font-semibold mb-3 opacity-80">
              7-Day Forecast
            </h3>
            <div className="grid grid-cols-7 gap-2">
              {displayPeriods.slice(0, 7).map((period, index) => (
                <button
                  key={period.name || `period-${index}`}
                  onClick={() => selectDay(index)}
                  className={`text-center p-2 rounded-xl transition-all duration-300 ${
                    (state?.selectedDay || 0) === index
                      ? 'bg-white text-black scale-110 shadow-lg'
                      : 'bg-white bg-opacity-10 text-white hover:bg-opacity-15 border border-gray-700'
                  }`}
                >
                  <p className="text-xs font-semibold mb-1">
                    {period.name?.slice(0, 3) || 'N/A'}
                  </p>
                  <div className="flex justify-center mb-1">
                    <WeatherIcon condition={period.condition} size={20} />
                  </div>
                  <p className="text-xs">
                    {period.temperature ? extractTemperature(period.temperature) : '--'}°
                  </p>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Precipitation indicator */}
        {currentPrecipitation > 0 && (
          <div className="relative z-10 mt-4 bg-white bg-opacity-10 rounded-xl p-3 backdrop-blur-sm border border-gray-700">
            <div className="flex items-center justify-between text-white">
              <div className="flex items-center gap-2">
                <Gauge size={20} />
                <span className="text-sm">Precipitation</span>
              </div>
              <span className="font-semibold">{currentPrecipitation}%</span>
            </div>
            <div className="mt-2 h-2 bg-gray-700 rounded-full overflow-hidden">
              <div 
                className="h-full bg-white transition-all duration-500"
                style={{ width: `${currentPrecipitation}%` }}
              />
            </div>
          </div>
        )}

        {/* Expand/collapse button - removed since we show 7-day forecast by default */}
      </div>
    </div>
  );
}
