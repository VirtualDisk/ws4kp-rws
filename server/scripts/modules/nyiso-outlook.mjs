// NYISO grid outlook of the week: trailing actual daily peak load + upcoming forecast peak load
import STATUS from './status.mjs';
import { safePromiseAll } from './utils/fetch.mjs';
import {
	fetchNyisoCsv, dailyPeakAndAverage, dailyForecastPeak,
} from './utils/nyiso.mjs';
import { DateTime } from '../vendor/auto/luxon.mjs';
import WeatherDisplay from './weatherdisplay.mjs';
import { registerDisplay } from './navigation.mjs';

const PAST_DAYS = 6;

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

		const [pastResults, forecastResults, yesterdayRows] = await safePromiseAll([
			safePromiseAll(pastPromises),
			safePromiseAll(forecastPromises),
			yesterdayPromise,
		]);

		const pastBars = pastDates.map((date, i) => {
			const rows = pastResults[i] ?? [];
			const { peak } = dailyPeakAndAverage(rows);
			return {
				label: date.toFormat('ccc'), peak, date, forecast: false,
			};
		}).filter((bar) => bar.peak !== null);

		const forecastBars = forecastDates.map((date, i) => {
			const rows = forecastResults[i] ?? [];
			const peak = dailyForecastPeak(rows);
			return {
				label: date.toFormat('ccc'), peak, date, forecast: true,
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
		const barsContainer = this.elem.querySelector('.bars');
		barsContainer.innerHTML = '';

		bars.forEach((bar) => {
			const column = document.createElement('div');
			column.classList.add('bar-column');
			if (bar.forecast) column.classList.add('forecast');

			const barEl = document.createElement('div');
			barEl.classList.add('bar');
			barEl.style.height = `${Math.max(2, Math.round((bar.peak / maxValue) * 100))}%`;

			const valueLabel = document.createElement('div');
			valueLabel.classList.add('value-label');
			valueLabel.innerHTML = Math.round(bar.peak).toLocaleString();

			const dayLabel = document.createElement('div');
			dayLabel.classList.add('day-label');
			dayLabel.innerHTML = bar.forecast ? `${bar.label}*` : bar.label;

			barEl.append(valueLabel);
			column.append(barEl, dayLabel);
			barsContainer.append(column);
		});

		this.finishDraw();
	}
}

registerDisplay(new NyisoOutlook(12, 'nyiso-outlook', true));
