// WMO weather codes as Open-Meteo reports them, grouped the way a forecast reads.
const CONDITIONS = [
  [[0], 'Clear', '☀️'],
  [[1], 'Mostly clear', '🌤️'],
  [[2], 'Partly cloudy', '⛅'],
  [[3], 'Cloudy', '☁️'],
  [[45, 48], 'Fog', '🌫️'],
  [[51, 53, 55, 56, 57], 'Drizzle', '🌦️'],
  [[61, 63, 65, 66, 67], 'Rain', '🌧️'],
  [[71, 73, 75, 77], 'Snow', '🌨️'],
  [[80, 81, 82], 'Showers', '🌦️'],
  [[85, 86], 'Snow showers', '🌨️'],
  [[95, 96, 99], 'Thunderstorms', '⛈️'],
];
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function condition(code) {
  const match = CONDITIONS.find(([codes]) => codes.includes(code));
  return match ? { condition: match[1], icon: match[2] } : { condition: 'Unknown', icon: '🌡️' };
}

// "2026-10-24" is a local calendar date; parsing it as UTC would shift the weekday.
function weekday(isoDate) {
  const [year, month, day] = isoDate.split('-').map(Number);
  return WEEKDAYS[new Date(year, month - 1, day).getDay()];
}

/**
 * Reads a ```weather block: {"place": "...", "forecast": <Open-Meteo JSON>}.
 * Returns null when it is not a usable forecast, so the block stays code.
 */
export function parseWeather(code) {
  let data;
  try {
    data = JSON.parse(code);
  } catch {
    return null;
  }
  const forecast = data?.forecast;
  const daily = forecast?.daily;
  if (!forecast?.current || !Array.isArray(daily?.time) || daily.time.length === 0) return null;
  return {
    place: String(data.place ?? ''),
    unit: String(forecast.current_units?.temperature_2m ?? '°F').includes('C') ? 'C' : 'F',
    current: { temp: Math.round(forecast.current.temperature_2m), ...condition(forecast.current.weather_code) },
    days: daily.time.map((date, i) => ({
      day: weekday(date),
      high: Math.round(daily.temperature_2m_max?.[i]),
      low: Math.round(daily.temperature_2m_min?.[i]),
      rain: daily.precipitation_probability_max?.[i] ?? null,
      ...condition(daily.weather_code?.[i]),
    })),
  };
}

/** A forecast card like the Claude app's: now on top, the coming days below. */
export function WeatherCard({ weather }) {
  const { place, unit, current, days } = weather;
  return (
    <figure className="weather-card" aria-label={`Weather for ${place}`}>
      <div className="weather-now">
        <div>
          <p className="weather-place">{place}</p>
          <p className="weather-temp">{current.temp}°</p>
        </div>
        <div className="weather-summary">
          <span className="weather-icon" aria-hidden="true">{current.icon}</span>
          <span>{current.condition}</span>
          <span className="weather-source">°{unit} · Weather data from Open-Meteo</span>
        </div>
      </div>
      <ol className="weather-days">
        {days.map((day, i) => (
          <li key={i} className="weather-day" title={day.condition}>
            <span className="weather-day-name">{day.day}</span>
            <span className="weather-icon" aria-label={day.condition}>{day.icon}</span>
            <span className="weather-day-temps">
              {day.high}° <span className="weather-low">{day.low}°</span>
            </span>
            {day.rain !== null && <span className="weather-rain">{day.rain}%</span>}
          </li>
        ))}
      </ol>
    </figure>
  );
}
