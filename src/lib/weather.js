// Wetter über Open-Meteo (kostenlos, ohne Schlüssel).

const forecastBase = () => process.env.WEATHER_API_BASE || 'https://api.open-meteo.com';
const geocodingBase = () => process.env.GEOCODING_API_BASE || 'https://geocoding-api.open-meteo.com';

// WMO-Wettercodes -> Beschreibung + Symbolname für das Dashboard
const CODES = {
  0: ['Klar', 'klar'],
  1: ['Überwiegend klar', 'heiter'],
  2: ['Teils bewölkt', 'wolkig'],
  3: ['Bedeckt', 'bedeckt'],
  45: ['Nebel', 'nebel'],
  48: ['Reifnebel', 'nebel'],
  51: ['Leichter Nieselregen', 'regen'],
  53: ['Nieselregen', 'regen'],
  55: ['Starker Nieselregen', 'regen'],
  56: ['Gefrierender Niesel', 'regen'],
  57: ['Gefrierender Niesel', 'regen'],
  61: ['Leichter Regen', 'regen'],
  63: ['Regen', 'regen'],
  65: ['Starker Regen', 'regen'],
  66: ['Gefrierender Regen', 'regen'],
  67: ['Gefrierender Regen', 'regen'],
  71: ['Leichter Schneefall', 'schnee'],
  73: ['Schneefall', 'schnee'],
  75: ['Starker Schneefall', 'schnee'],
  77: ['Schneegriesel', 'schnee'],
  80: ['Regenschauer', 'regen'],
  81: ['Regenschauer', 'regen'],
  82: ['Heftige Regenschauer', 'regen'],
  85: ['Schneeschauer', 'schnee'],
  86: ['Schneeschauer', 'schnee'],
  95: ['Gewitter', 'gewitter'],
  96: ['Gewitter mit Hagel', 'gewitter'],
  99: ['Gewitter mit Hagel', 'gewitter'],
};

export function describeCode(code) {
  const [text, icon] = CODES[code] || ['Unbekannt', 'wolkig'];
  return { text, icon };
}

async function getJson(url) {
  let res;
  try {
    res = await fetch(url, { signal: AbortSignal.timeout(15000), headers: { 'User-Agent': 'assistent-agent' } });
  } catch (err) {
    throw new Error(`Der Wetterdienst ist nicht erreichbar (${err.cause?.code || err.name}).`);
  }
  if (!res.ok) throw new Error(`Der Wetterdienst antwortet mit Status ${res.status}.`);
  return res.json();
}

export async function searchPlaces(query) {
  const q = String(query || '').trim();
  if (q.length < 2) return [];
  const url = `${geocodingBase()}/v1/search?name=${encodeURIComponent(q)}&count=6&language=de&format=json`;
  const data = await getJson(url);
  return (data.results || []).map((r) => ({
    name: r.name,
    region: [r.admin1, r.country].filter(Boolean).join(', '),
    latitude: r.latitude,
    longitude: r.longitude,
    timezone: r.timezone || null,
  }));
}

export async function forecast({ latitude, longitude }) {
  const params = new URLSearchParams({
    latitude: String(latitude),
    longitude: String(longitude),
    current: 'temperature_2m,apparent_temperature,weather_code,is_day,wind_speed_10m,precipitation',
    hourly: 'temperature_2m,precipitation_probability,weather_code',
    daily: 'weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max,sunrise,sunset',
    timezone: 'auto',
    forecast_days: '3',
    wind_speed_unit: 'kmh',
  });
  const d = await getJson(`${forecastBase()}/v1/forecast?${params}`);
  const cur = d.current || {};
  const day = (i) => ({
    date: d.daily?.time?.[i],
    ...describeCode(d.daily?.weather_code?.[i]),
    max: d.daily?.temperature_2m_max?.[i],
    min: d.daily?.temperature_2m_min?.[i],
    rainChance: d.daily?.precipitation_probability_max?.[i],
    sunrise: d.daily?.sunrise?.[i]?.slice(11, 16) || null,
    sunset: d.daily?.sunset?.[i]?.slice(11, 16) || null,
  });
  const hours = (d.hourly?.time || []).map((t, i) => ({
    time: t,
    temp: d.hourly.temperature_2m?.[i],
    rainChance: d.hourly.precipitation_probability?.[i],
    ...describeCode(d.hourly.weather_code?.[i]),
  }));
  return {
    current: {
      temp: cur.temperature_2m,
      feelsLike: cur.apparent_temperature,
      wind: cur.wind_speed_10m,
      isDay: cur.is_day === 1,
      ...describeCode(cur.weather_code),
    },
    today: day(0),
    tomorrow: day(1),
    days: [day(0), day(1), day(2)].filter((x) => x.date),
    hours: hours.slice(0, 72),
    timezone: d.timezone,
  };
}
