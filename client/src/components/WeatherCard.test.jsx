import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { WeatherCard, parseWeather } from './WeatherCard.jsx';
import { Markdown } from './Markdown.jsx';

afterEach(cleanup);

const forecast = {
  current_units: { temperature_2m: '°F' },
  current: { time: '2026-10-24T13:30', temperature_2m: 49.9, weather_code: 3 },
  daily: {
    time: ['2026-10-24', '2026-10-25', '2026-10-26'],
    weather_code: [3, 63, 0],
    temperature_2m_max: [52.2, 52.7, 54.5],
    temperature_2m_min: [38.3, 44.9, 46.9],
    precipitation_probability_max: [5, 57, 19],
  },
};
const block = JSON.stringify({ place: 'Seattle, WA', forecast });

describe('parseWeather', () => {
  it('reads the place, current conditions and each day', () => {
    expect(parseWeather(block)).toEqual({
      place: 'Seattle, WA',
      unit: 'F',
      current: { temp: 50, condition: 'Cloudy', icon: '☁️' },
      days: [
        { day: 'Sat', high: 52, low: 38, rain: 5, condition: 'Cloudy', icon: '☁️' },
        { day: 'Sun', high: 53, low: 45, rain: 57, condition: 'Rain', icon: '🌧️' },
        { day: 'Mon', high: 55, low: 47, rain: 19, condition: 'Clear', icon: '☀️' },
      ],
    });
  });

  it('returns null for anything that is not a forecast', () => {
    expect(parseWeather('not json')).toBeNull();
    expect(parseWeather('{"place":"Seattle"}')).toBeNull();
    expect(parseWeather(JSON.stringify({ place: 'X', forecast: { daily: {} } }))).toBeNull();
  });
});

describe('WeatherCard', () => {
  it('shows the place, temperature, condition and the days', () => {
    render(<WeatherCard weather={parseWeather(block)} />);
    expect(screen.getByText('Seattle, WA')).toBeInTheDocument();
    expect(screen.getByText('50°')).toBeInTheDocument();
    expect(screen.getAllByText('Cloudy').length).toBeGreaterThan(0);
    expect(screen.getByText('Sun')).toBeInTheDocument();
    expect(screen.getByText('57%')).toBeInTheDocument();
    expect(screen.getByText(/Open-Meteo/)).toBeInTheDocument();
  });
});

describe('Markdown weather blocks', () => {
  it('renders a weather block as a card when visuals are on', () => {
    render(<Markdown text={'```weather\n' + block + '\n```'} renderVisuals />);
    expect(screen.getByRole('figure', { name: 'Weather for Seattle, WA' })).toBeInTheDocument();
  });

  it('keeps a broken weather block as code', () => {
    const { container } = render(<Markdown text={'```weather\n{oops\n```'} renderVisuals />);
    expect(container.querySelector('pre')).not.toBeNull();
    expect(screen.queryByRole('figure')).toBeNull();
  });
});
