// NYISO grid outlook of the week: trailing actual daily peak load + upcoming forecast peak load
import STATUS from './status.mjs';
import { safePromiseAll, safeJson } from './utils/fetch.mjs';
import {
	fetchNyisoCsv, dailyPeakAndAverage, dailyForecastPeak,
} from './utils/nyiso.mjs';
import { DateTime } from '../vendor/auto/luxon.mjs';
import WeatherDisplay from './weatherdisplay.mjs';
import { registerDisplay } from './navigation.mjs';
import { distance as calcDistance } from './utils/calc.mjs';
import { temperature } from './utils/units.mjs';
import filterExpiredPeriods from './utils/forecast-utils.mjs';
import settings from './settings.mjs';

const PAST_DAYS = 6;
const NEAREST_STATIONS_TO_TRY = 5;

// closest stations to the display's location, nearest first
const getNearestStations = (weatherParameters) => Object.values(window.StationInfo ?? {})
	.map((station) => ({ ...station, distance: calcDistance(station.lat, station.lon, weatherParameters.latitude, weatherParameters.longitude) }))
	.sort((a, b) => a.distance - b.distance)
	.slice(0, NEAREST_STATIONS_TO_TRY);

// try stations in distance order until one returns observations for the requested range
const getHistoricalHighsByDate = async (weatherParameters, start, end, stillWaiting) => {
	const stations = getNearestStations(weatherParameters);
	const temperatureConverter = temperature();

	// eslint-disable-next-line no-restricted-syntax
	for (const station of stations) {
		// eslint-disable-next-line no-await-in-loop
		const observations = await safeJson(`https://api.weather.gov/stations/${station.id}/observations`, {
			data: { start: start.toUTC().toISO(), end: end.toUTC().toISO(), limit: 500 },
			retryCount: 1,
			stillWaiting,
		});

		const features = observations?.features;
		if (features?.length) {
			const highsByDate = new Map();
			features.forEach((feature) => {
				const value = feature.properties?.temperature?.value;
				const { timestamp } = feature.properties ?? {};
				if (value === null || value === undefined || !timestamp) return;
				const dateKey = DateTime.fromISO(timestamp).toISODate();
				if (!highsByDate.has(dateKey) || value > highsByDate.get(dateKey)) {
					highsByDate.set(dateKey, value);
				}
			});
			// convert Celsius (station observations are always SI) to display units
			highsByDate.forEach((celsiusValue, dateKey) => highsByDate.set(dateKey, temperatureConverter(celsiusValue)));
			return highsByDate;
		}
	}

	return new Map();
};

// flatten NWS 12-hour forecast periods into a day -> high temperature map
const getForecastHighsByDate = async (weatherParameters, stillWaiting) => {
	const forecast = await safeJson(weatherParameters.forecast, {
		data: { units: settings.units.value },
		retryCount: 2,
		stillWaiting,
	});

	const periods = forecast?.properties?.periods;
	if (!periods) return new Map();

	const activePeriods = filterExpiredPeriods(periods, weatherParameters.forecast);
	const highsByDate = new Map();
	activePeriods.forEach((period) => {
		if (!period.isDaytime) return;
		const dateKey = DateTime.fromISO(period.startTime).toISODate();
		if (!highsByDate.has(dateKey)) highsByDate.set(dateKey, period.temperature);
	});
	return highsByDate;
};

class NyisoOutlook extends WeatherDisplay {
	constructor(navId, elemId, defaultActive) {
		super(navId, elemId, 'Grid Outlook', defaultActive);
		this.timing.totalScreens = 1;
	}

	async getData(weatherParameters, refresh) {
		if (!super.getData(weatherParameters, refresh)) return;

		const today = DateTime.local().startOf('day');

		// trailing actual days, oldest first, not including today (today's totals are still accumulating)
		const pastDates = Array.from({ length: PAST_DAYS }, (_, i) => today.minus({ days: PAST_DAYS - i }));
		const pastPromises = pastDates.map((date) => fetchNyisoCsv('pal', date, () => this.stillWaiting()));

		// forecast days: today and tomorrow (NYISO only publishes day-ahead forecasts)
		const forecastDates = [today, today.plus({ days: 1 })];
		const forecastPromises = forecastDates.map((date) => fetchNyisoCsv('isolf', date, () => this.stillWaiting()));

		// yesterday's actual load used for the "previous day's consumption" stat
		const yesterdayPromise = fetchNyisoCsv('pal', today.minus({ days: 1 }), () => this.stillWaiting());

		// daily peak temperatures: historical highs (past days) come from the nearest station's
		// observation history, upcoming highs (today/tomorrow) come from the NWS forecast
		const historicalHighsPromise = getHistoricalHighsByDate(
			weatherParameters,
			pastDates[0],
			today.plus({ days: 1 }),
			() => this.stillWaiting(),
		);
		const forecastHighsPromise = getForecastHighsByDate(weatherParameters, () => this.stillWaiting());

		const [pastResults, forecastResults, yesterdayRows, historicalHighs, forecastHighs] = await safePromiseAll([
			safePromiseAll(pastPromises),
			safePromiseAll(forecastPromises),
			yesterdayPromise,
			historicalHighsPromise,
			forecastHighsPromise,
		]);

		const pastBars = pastDates.map((date, i) => {
			const rows = pastResults[i] ?? [];
			const { peak } = dailyPeakAndAverage(rows);
			return {
				label: date.toFormat('ccc'), peak, date, forecast: false, high: historicalHighs?.get(date.toISODate()) ?? null,
			};
		}).filter((bar) => bar.peak !== null);

		const forecastBars = forecastDates.map((date, i) => {
			const rows = forecastResults[i] ?? [];
			const peak = dailyForecastPeak(rows);
			return {
				label: date.toFormat('ccc'), peak, date, forecast: true, high: forecastHighs?.get(date.toISODate()) ?? null,
			};
		}).filter((bar) => bar.peak !== null);

		const bars = [...pastBars, ...forecastBars];

		if (bars.length === 0) {
			this.setStatus(STATUS.failed);
			return;
		}

		const { peak: yesterdayPeak, average: yesterdayAverage } = dailyPeakAndAverage(yesterdayRows ?? []);

		this.data = {
			bars,
			yesterdayPeak,
			yesterdayAverage,
		};

		this.getDataCallback();
		this.setStatus(STATUS.loaded);
		this.drawCanvas();
	}

	drawCanvas() {
		super.drawCanvas();
		if (!this.data) return;

		const { bars, yesterdayPeak, yesterdayAverage } = this.data;

		this.elem.querySelector('.peak-value').innerHTML = yesterdayPeak !== null ? `${Math.round(yesterdayPeak).toLocaleString()} MW` : 'N/A';
		this.elem.querySelector('.avg-value').innerHTML = yesterdayAverage !== null
			? `${(yesterdayAverage * 24 / 1000).toFixed(1)} GWh`
			: 'N/A';

		const maxValue = Math.max(...bars.map((bar) => bar.peak));
		const temperatureUnits = temperature().units;
		const barsContainer = this.elem.querySelector('.bars');
		barsContainer.innerHTML = '';

		bars.forEach((bar) => {
			const column = document.createElement('div');
			column.classList.add('bar-column');
			if (bar.forecast) column.classList.add('forecast');

			const barEl = document.createElement('div');
			barEl.classList.add('bar');
			barEl.style.height = `${Math.max(2, Math.round((bar.peak / maxValue) * 80))}%`;

			const valueLabel = document.createElement('div');
			valueLabel.classList.add('value-label');
			valueLabel.innerHTML = Math.round(bar.peak).toLocaleString();

			const dayLabel = document.createElement('div');
			dayLabel.classList.add('day-label');
			dayLabel.innerHTML = bar.forecast ? `${bar.label}*` : bar.label;

			const highLabel = document.createElement('div');
			highLabel.classList.add('high-label');
			highLabel.innerHTML = bar.high !== null ? `${Math.round(bar.high)}°${temperatureUnits}` : '';

			barEl.append(valueLabel);
			column.append(barEl, dayLabel, highLabel);
			barsContainer.append(column);
		});

		this.finishDraw();
	}
}

registerDisplay(new NyisoOutlook(12, 'nyiso-outlook', true));
