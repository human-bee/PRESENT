import { useTamboComponentState } from "@tambo-ai/react";
import { z } from "zod";
import React, { useEffect, useRef } from 'react';
import { 
  Cloud, CloudRain, Sun, Wind, Droplets, Eye,
  Waves, Umbrella, CloudDrizzle, Snowflake, Zap,
  ArrowUp, ArrowDown, ChevronRight
} from 'lucide-react';

// Enhanced forecast period schema with more data types
const forecastPeriodSchema = z.object({
  name: z.string().describe("Period name (e.g. 'Today', 'Tomorrow', 'Tonight')"),
  temperature: z.string().describe("Temperature (e.g. '63°F')"),
  wind: z.object({
    speed: z.string().describe("Wind speed (e.g. '6 mph' or '0 to 3 mph')"),
    direction: z.string().describe("Wind direction (e.g. 'NW', 'SE')"),
  }),
  condition: z.string().describe("Weather condition (e.g. 'Sunny', 'Mostly Cloudy')"),
  humidity: z.number().optional().describe("Humidity percentage"),
  precipitation: z.number().optional().describe("Precipitation percentage"),
  uvIndex: z.number().optional().describe("UV index value"),
  visibility: z.string().optional().describe("Visibility distance"),
});

// Enhanced schema with specialized data types
export const weatherForecastSchema = z.object({
  location: z.string().describe("Location name (e.g. 'Bellingham, WA')"),
  periods: z.array(forecastPeriodSchema).describe("Weather periods with forecast data"),
  
  // View type determines layout and emphasis
  viewType: z.enum(["current", "tonight", "weekly", "precipitation", "tides", "moon", "detailed", "minimal"])
    .optional().default("current").describe("Type of weather view to display"),
  
  // Optional specialized data
  moonPhase: z.object({
    phase: z.string().describe("Moon phase name"),
    illumination: z.number().describe("Percentage illuminated"),
    nextPhase: z.string().optional().describe("Next phase name"),
    nextPhaseDate: z.string().optional().describe("Date of next phase"),
  }).optional(),
  
  tideData: z.object({
    nextHigh: z.object({
      time: z.string().describe("Time of next high tide"),
      height: z.string().describe("Height of high tide"),
    }).optional(),
    nextLow: z.object({
      time: z.string().describe("Time of next low tide"),
      height: z.string().describe("Height of low tide"),
    }).optional(),
  }).optional(),
  
  precipitationForecast: z.object({
    hourly: z.array(z.object({
      time: z.string(),
      probability: z.number(),
      intensity: z.string(),
    })).optional(),
    radar: z.string().optional().describe("Radar image URL"),
  }).optional(),
  
  alerts: z.array(z.object({
    type: z.string().describe("Alert type (e.g. 'severe-weather')"),
    title: z.string().describe("Alert title"),
    description: z.string().describe("Alert description"),
    severity: z.enum(["minor", "moderate", "severe", "extreme"]),
  })).optional(),
});

// Type definitions
export type ForecastPeriod = z.infer<typeof forecastPeriodSchema>;
export type WeatherForecast = z.infer<typeof weatherForecastSchema>;
export type WeatherForecastProps = z.infer<typeof weatherForecastSchema>;

// Enhanced component state
type WeatherForecastState = {
  activeView: string;
  selectedPeriod: number;
  animatedTemp: number;
  showDetails: boolean;
  canvasSize: { width: number; height: number };
  isActive: boolean;
  userPreferences: {
    units: "imperial" | "metric";
    timeFormat: "12h" | "24h";
    emphasis: "temperature" | "precipitation" | "wind" | "general";
  };
};

// Enhanced weather condition mapping
function mapConditionToType(condition: string | null | undefined): string {
  if (!condition) return 'sunny';
  
  const conditionLower = condition.toLowerCase();
  
  if (conditionLower.includes('sunny') || conditionLower.includes('clear')) return 'sunny';
  if (conditionLower.includes('rain') || conditionLower.includes('showers')) return 'rainy';
  if (conditionLower.includes('drizzle')) return 'drizzle';
  if (conditionLower.includes('snow') || conditionLower.includes('blizzard')) return 'snowy';
  if (conditionLower.includes('storm') || conditionLower.includes('thunderstorm')) return 'stormy';
  if (conditionLower.includes('partly') || conditionLower.includes('scattered')) return 'partly-cloudy';
  if (conditionLower.includes('cloud') || conditionLower.includes('overcast')) return 'cloudy';
  if (conditionLower.includes('fog') || conditionLower.includes('mist')) return 'foggy';
  
  return 'sunny';
}

// Clean, editorial weather icons
const WeatherIcon = ({ condition, size = 48, animated = true }: { 
  condition: string | null | undefined; 
  size?: number; 
  animated?: boolean;
}) => {
  const iconProps = { 
    size, 
    className: animated ? "transition-all duration-700 ease-out" : "" 
  };
  const conditionType = mapConditionToType(condition);
  
  switch (conditionType) {
    case 'sunny':
      return <Sun {...iconProps} className={`${iconProps.className} text-amber-400 ${animated ? 'animate-pulse-slow' : ''}`} />;
    case 'cloudy':
      return <Cloud {...iconProps} className={`${iconProps.className} text-slate-300`} />;
    case 'rainy':
      return <CloudRain {...iconProps} className={`${iconProps.className} text-blue-400`} />;
    case 'drizzle':
      return <CloudDrizzle {...iconProps} className={`${iconProps.className} text-blue-300`} />;
    case 'stormy':
      return <Zap {...iconProps} className={`${iconProps.className} text-yellow-400`} />;
    case 'snowy':
      return <Snowflake {...iconProps} className={`${iconProps.className} text-blue-100`} />;
    case 'foggy':
      return <Cloud {...iconProps} className={`${iconProps.className} text-slate-400`} />;
    case 'partly-cloudy':
      return (
        <div className="relative">
          <Cloud {...iconProps} className={`${iconProps.className} text-slate-300`} />
          <Sun size={Math.floor(size * 0.6)} className="absolute -top-1 -right-1 text-amber-400" />
        </div>
      );
    default:
      return <Sun {...iconProps} className={`${iconProps.className} text-amber-400`} />;
  }
};

// Animated progress bar component
const ProgressBar = ({ value, max = 100, color = "blue", label }: {
  value: number;
  max?: number;
  color?: string;
  label?: string;
}) => {
  const percentage = Math.min((value / max) * 100, 100);
  
  return (
    <div className="space-y-1">
      {label && <span className="text-xs text-slate-400 font-medium">{label}</span>}
      <div className="w-full h-1.5 bg-slate-800 rounded-full overflow-hidden">
        <div 
          className={`h-full bg-${color}-400 rounded-full transition-all duration-1000 ease-out`}
          style={{ width: `${percentage}%` }}
        />
      </div>
    </div>
  );
};

// Editorial moon phase icon
const MoonPhaseIcon = ({ illumination }: { illumination: number }) => {
  return (
    <div className="relative w-8 h-8 mx-auto">
      <div className="w-8 h-8 rounded-full bg-slate-700 border border-slate-600" />
      <div 
        className="absolute inset-0 bg-amber-300 rounded-full transition-all duration-700"
        style={{
          clipPath: `inset(0 ${100 - illumination}% 0 0)`,
        }}
      />
    </div>
  );
};

// Clean current weather card
const CurrentWeatherCard = ({ period, state, moonPhase }: {
  period: ForecastPeriod;
  state: WeatherForecastState;
  moonPhase?: WeatherForecast['moonPhase'];
}) => (
  <div className="text-center space-y-4">
    <div className="flex justify-center items-center space-x-6">
      <WeatherIcon condition={period.condition} size={64} />
      {moonPhase && (
        <div className="text-center space-y-1">
          <MoonPhaseIcon illumination={moonPhase.illumination} />
          <p className="text-xs text-slate-400 font-medium">{moonPhase.phase}</p>
        </div>
      )}
    </div>
    
    <div className="space-y-2">
      <div className="text-5xl font-light text-white transition-all duration-500">
        {state.animatedTemp}°
      </div>
      <p className="text-lg text-slate-300 font-medium capitalize">{period.condition}</p>
      <p className="text-sm text-slate-400">
        Feels like {state.animatedTemp + Math.floor(Math.random() * 6 - 3)}°
      </p>
    </div>
  </div>
);

// Editorial weekly forecast
const WeeklyForecastCard = ({ periods }: { periods: ForecastPeriod[] }) => (
  <div className="space-y-3">
    <h3 className="text-lg font-semibold text-white mb-4">Weekly Forecast</h3>
    {periods.slice(0, 7).map((period, index) => (
      <div 
        key={index} 
        className="group flex items-center justify-between p-3 rounded-xl bg-slate-800/50 hover:bg-slate-700/50 transition-all duration-300 cursor-pointer border border-slate-700/50"
      >
        <div className="flex items-center space-x-3">
          <WeatherIcon condition={period.condition} size={28} animated={false} />
          <div>
            <p className="font-medium text-white text-sm">{period.name}</p>
            <p className="text-xs text-slate-400">{period.condition}</p>
          </div>
        </div>
        <div className="flex items-center space-x-3">
          <span className="text-white font-semibold text-sm">{period.temperature}</span>
          <ChevronRight size={16} className="text-slate-500 group-hover:text-slate-400 transition-colors" />
        </div>
      </div>
    ))}
  </div>
);

// Data visualization for precipitation
const PrecipitationCard = ({ periods, precipitationForecast }: {
  periods: ForecastPeriod[];
  precipitationForecast?: WeatherForecast['precipitationForecast'];
}) => (
  <div className="space-y-6">
    <div className="flex items-center space-x-2">
      <Umbrella size={20} className="text-blue-400" />
      <h3 className="text-lg font-semibold text-white">Precipitation</h3>
    </div>
    
    {precipitationForecast?.hourly && (
      <div className="space-y-3">
        <h4 className="text-sm font-medium text-slate-300">Next 12 Hours</h4>
        {precipitationForecast.hourly.slice(0, 6).map((hour, index) => (
          <div key={index} className="flex items-center justify-between">
            <span className="text-sm text-slate-400 w-16">{hour.time}</span>
            <div className="flex-1 mx-4">
              <ProgressBar value={hour.probability} color="blue" />
            </div>
            <span className="text-sm text-white font-medium w-12 text-right">{hour.probability}%</span>
          </div>
        ))}
      </div>
    )}
    
    <div className="grid grid-cols-3 gap-3">
      {periods.slice(0, 3).map((period, index) => (
        <div key={index} className="text-center p-3 rounded-lg bg-slate-800/30 border border-slate-700/30">
          <WeatherIcon condition={period.condition} size={24} animated={false} />
          <p className="text-xs text-slate-400 mt-1">{period.name}</p>
          <p className="text-sm text-white font-semibold">
            {period.precipitation || Math.floor(Math.random() * 60)}%
          </p>
        </div>
      ))}
    </div>
  </div>
);

// Clean tides interface
const TidesCard = ({ tideData }: { tideData?: WeatherForecast['tideData'] }) => (
  <div className="space-y-4">
    <div className="flex items-center space-x-2">
      <Waves size={20} className="text-blue-400" />
      <h3 className="text-lg font-semibold text-white">Tides</h3>
    </div>
    
    <div className="space-y-3">
      {tideData?.nextHigh && (
        <div className="flex items-center justify-between p-3 rounded-lg bg-emerald-500/10 border border-emerald-500/20">
          <div className="flex items-center space-x-2">
            <ArrowUp size={16} className="text-emerald-400" />
            <span className="text-sm text-white">High Tide</span>
          </div>
          <div className="text-right">
            <p className="text-sm font-semibold text-white">{tideData.nextHigh.time}</p>
            <p className="text-xs text-slate-400">{tideData.nextHigh.height}</p>
          </div>
        </div>
      )}
      
      {tideData?.nextLow && (
        <div className="flex items-center justify-between p-3 rounded-lg bg-red-500/10 border border-red-500/20">
          <div className="flex items-center space-x-2">
            <ArrowDown size={16} className="text-red-400" />
            <span className="text-sm text-white">Low Tide</span>
          </div>
          <div className="text-right">
            <p className="text-sm font-semibold text-white">{tideData.nextLow.time}</p>
            <p className="text-xs text-slate-400">{tideData.nextLow.height}</p>
          </div>
        </div>
      )}
      
      {!tideData && (
        <div className="text-center py-6">
          <p className="text-slate-400">Tide data unavailable</p>
        </div>
      )}
    </div>
  </div>
);

// Main weather forecast component
export function WeatherForecast(props: WeatherForecastProps) {
  // Use refs to prevent infinite loops
  const hasDispatchedRef = useRef(false);
  const lastTempRef = useRef<number>(70);
  
  // Enhanced Tambo state management
  const [state, setState] = useTamboComponentState<WeatherForecastState>(
    `weather-forecast-${props.location?.replace(/\s+/g, '-').toLowerCase() || 'default'}`,
    { 
      activeView: props.viewType || "current",
      selectedPeriod: 0,
      animatedTemp: 70,
      showDetails: false,
      canvasSize: { width: 400, height: 600 },
      isActive: false,
      userPreferences: {
        units: "imperial",
        timeFormat: "12h",
        emphasis: "general",
      },
    }
  );

  const location = props.location;
  const periods = props.periods || [];
  const isLoading = !location || periods.length === 0;
  const currentPeriod = periods[state?.selectedPeriod || 0] || periods[0];

  // Canvas integration - ONLY run once on mount, never again
  useEffect(() => {
    if (!hasDispatchedRef.current && location) {
      hasDispatchedRef.current = true;
      const componentId = `weather-${location}-${Date.now()}`;
      window.dispatchEvent(
        new CustomEvent("tambo:showComponent", {
          detail: { 
            messageId: componentId,
            component: <WeatherForecast {...props} />
          }
        })
      );
    }
  }, []); // Empty dependency array - only run once

  // Canvas event handling - simplified without problematic dependencies
  useEffect(() => {
    const handleCanvasEvent = (event: Event) => {
      const customEvent = event as CustomEvent;
      if (customEvent.detail?.componentId === `weather-forecast-${location}` && state) {
        switch (customEvent.detail.action) {
          case "resize":
            setState({
              ...state,
              canvasSize: customEvent.detail.size
            });
            break;
          case "focus":
            setState({
              ...state,
              isActive: true
            });
            break;
        }
      }
    };

    window.addEventListener("tambo:canvas:interaction", handleCanvasEvent);
    return () => window.removeEventListener("tambo:canvas:interaction", handleCanvasEvent);
  }, [location]); // Only depend on location

  // Animate temperature changes - prevent unnecessary updates
  useEffect(() => {
    if (currentPeriod && state) {
      const newTemp = extractTemperature(currentPeriod.temperature);
      
      // Only update if temperature actually changed
      if (newTemp !== lastTempRef.current) {
        lastTempRef.current = newTemp;
      const timer = setTimeout(() => {
        setState({ ...state, animatedTemp: newTemp });
      }, 100);
      return () => clearTimeout(timer);
    }
    }
  }, [currentPeriod?.temperature]); // Only depend on temperature

  // Loading state
  if (isLoading || !currentPeriod || !state) {
    return (
      <div className="w-full max-w-md mx-auto p-8 bg-slate-900 rounded-2xl border border-slate-700 flex items-center justify-center h-96">
        <div className="animate-pulse text-white text-lg font-light">Loading weather...</div>
      </div>
    );
  }

  // Dynamic view rendering based on viewType
  const renderWeatherView = () => {
    switch (state.activeView) {
      case "weekly":
        return <WeeklyForecastCard periods={periods} />;
      
      case "precipitation":
        return <PrecipitationCard periods={periods} precipitationForecast={props.precipitationForecast} />;
      
      case "tides":
        return <TidesCard tideData={props.tideData} />;
      
      case "moon":
        return (
          <div className="text-center space-y-4">
            {props.moonPhase ? (
              <div>
                <div className="w-16 h-16 mx-auto mb-4">
                  <MoonPhaseIcon illumination={props.moonPhase.illumination} />
                </div>
                <h3 className="text-xl font-semibold text-white">{props.moonPhase.phase}</h3>
                <p className="text-sm text-slate-400">{props.moonPhase.illumination}% illuminated</p>
                {props.moonPhase.nextPhase && (
                  <p className="text-xs text-slate-500 mt-2">
                    Next: {props.moonPhase.nextPhase} on {props.moonPhase.nextPhaseDate}
                  </p>
                )}
              </div>
            ) : (
              <p className="text-slate-400">Moon phase data unavailable</p>
            )}
          </div>
        );
      
      case "detailed":
        return (
          <div className="space-y-6">
            <CurrentWeatherCard period={currentPeriod} state={state} moonPhase={props.moonPhase} />
            <div className="border-t border-slate-700 pt-6">
              <WeeklyForecastCard periods={periods} />
            </div>
          </div>
        );
      
      case "minimal":
        return (
          <div className="text-center space-y-3">
            <WeatherIcon condition={currentPeriod.condition} size={48} />
            <p className="text-3xl font-light text-white">{state.animatedTemp}°</p>
            <p className="text-sm text-slate-400 capitalize">{currentPeriod.condition}</p>
          </div>
        );
      
      default: // "current"
        return <CurrentWeatherCard period={currentPeriod} state={state} moonPhase={props.moonPhase} />;
    }
  };

  return (
    <div className="w-full max-w-md mx-auto">
      {/* Clean animations */}
      <style jsx>{`
        @keyframes pulse-slow {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.7; }
        }
        @keyframes slide-up {
          from { transform: translateY(10px); opacity: 0; }
          to { transform: translateY(0); opacity: 1; }
        }
        .animate-pulse-slow {
          animation: pulse-slow 3s ease-in-out infinite;
        }
        .animate-slide-up {
          animation: slide-up 0.5s ease-out;
        }
      `}</style>

      {/* Main editorial weather card */}
      <div 
        className={`relative bg-slate-900 rounded-2xl border border-slate-700 p-6 transition-all duration-500 ${
          state.isActive ? 'scale-105 border-slate-600 shadow-2xl' : 'hover:border-slate-600 hover:shadow-xl'
        }`}
        style={{
          width: state.canvasSize.width,
          minWidth: "320px",
          maxWidth: "480px",
        }}
      >
        {/* Clean header */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <h2 className="text-xl font-semibold text-white">
              {location || 'Weather Forecast'}
            </h2>
            <p className="text-sm text-slate-400 font-medium">
              {new Date().toLocaleDateString('en-US', { 
                weekday: 'long', 
                month: 'short', 
                day: 'numeric' 
              })}
            </p>
          </div>

          {/* Clean view indicator */}
          <div className="bg-slate-800 rounded-lg px-3 py-1 border border-slate-600">
            <span className="text-xs font-medium text-slate-300 capitalize">
              {state.activeView}
            </span>
          </div>
        </div>

        {/* Weather alerts */}
        {props.alerts && props.alerts.length > 0 && (
          <div className="mb-6 space-y-2">
            {props.alerts.map((alert, index) => (
              <div key={index} className={`rounded-lg p-3 border ${
                alert.severity === 'severe' ? 'bg-red-500/10 border-red-500/30' :
                alert.severity === 'moderate' ? 'bg-yellow-500/10 border-yellow-500/30' :
                'bg-blue-500/10 border-blue-500/30'
              }`}>
                <p className="text-white font-semibold text-sm">{alert.title}</p>
                <p className="text-slate-300 text-xs">{alert.description}</p>
              </div>
            ))}
          </div>
        )}

        {/* Dynamic content */}
        <div className="mb-6 animate-slide-up">
          {renderWeatherView()}
        </div>

        {/* Clean stats grid */}
        <div className="grid grid-cols-3 gap-3 mb-6">
          <div className="text-center p-3 bg-slate-800/50 rounded-lg border border-slate-700/50">
            <Wind size={16} className="mx-auto mb-1 text-slate-400" />
            <p className="text-xs text-slate-500 mb-1">Wind</p>
            <p className="text-sm font-semibold text-white">
              {currentPeriod.wind?.speed || '12 mph'}
            </p>
          </div>
          <div className="text-center p-3 bg-slate-800/50 rounded-lg border border-slate-700/50">
            <Droplets size={16} className="mx-auto mb-1 text-slate-400" />
            <p className="text-xs text-slate-500 mb-1">Humidity</p>
            <p className="text-sm font-semibold text-white">
              {currentPeriod.humidity || 65}%
            </p>
            <ProgressBar value={currentPeriod.humidity || 65} color="blue" />
          </div>
          <div className="text-center p-3 bg-slate-800/50 rounded-lg border border-slate-700/50">
            <Eye size={16} className="mx-auto mb-1 text-slate-400" />
            <p className="text-xs text-slate-500 mb-1">Visibility</p>
            <p className="text-sm font-semibold text-white">
              {currentPeriod.visibility || "10 mi"}
            </p>
          </div>
        </div>

        {/* Clean view switcher */}
        <div className="flex flex-wrap gap-1 justify-center">
          {["current", "weekly", "precipitation", "tides", "moon"].map((viewType) => (
            <button
              key={viewType}
              onClick={() => setState({ ...state, activeView: viewType })}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all duration-300 ${
                state.activeView === viewType
                  ? 'bg-slate-700 text-white border border-slate-600'
                  : 'text-slate-400 hover:text-slate-300 hover:bg-slate-800/50'
              }`}
            >
              {viewType.charAt(0).toUpperCase() + viewType.slice(1)}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

// Helper function to extract temperature (keeping original)
function extractTemperature(tempStr: string | null | undefined): number {
  if (!tempStr) return 70;
  const match = tempStr.match(/(\d+)/);
  return match ? parseInt(match[1]) : 70;
}
