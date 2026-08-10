// NYISO real-time fuel mix
import STATUS from './status.mjs';
import { fetchNyisoCsv, latestRows } from './utils/nyiso.mjs';
import { DateTime } from '../vendor/auto/luxon.mjs';
import WeatherDisplay from './weatherdisplay.mjs';
import { registerDisplay } from './navigation.mjs';

// fixed colors per known NYISO fuel category so the pie stays consistent between refreshes
const FUEL_COLORS = {
	'Dual Fuel': '#c0692a',
	'Natural Gas': '#e0a030',
	Nuclear: '#c04040',
	'Other Fossil Fuels': '#806050',
	'Other Renewables': '#40a060',
	Wind: '#60c0e0',
	Hydro: '#3070c0',
};
const FALLBACK_COLOR = '#8888a0';
const fuelColor = (name) => FUEL_COLORS[name] ?? FALLBACK_COLOR;

class NyisoFuelMix extends WeatherDisplay {
	constructor(navId, elemId, defaultActive) {
		super(navId, elemId, 'Fuel Mix', defaultActive);
		this.timing.totalScreens = 1;
	}

	async getData(weatherParameters, refresh) {
		if (!super.getData(weatherParameters, refresh)) return;

		const rows = await fetchNyisoCsv('rtfuelmix', DateTime.local(), () => this.stillWaiting());
		const latest = latestRows(rows);

		if (latest.length === 0) {
			this.setStatus(STATUS.failed);
			return;
		}

		const fuels = latest
			.map((row) => ({ name: row['Fuel Category'], mw: parseFloat(row['Gen MW']) }))
			.filter((fuel) => !Number.isNaN(fuel.mw))
			.sort((a, b) => b.mw - a.mw);

		const totalMw = fuels.reduce((sum, fuel) => sum + fuel.mw, 0);

		this.data = { fuels, totalMw };

		this.getDataCallback();
		this.setStatus(STATUS.loaded);
		this.drawCanvas();
	}

	drawCanvas() {
		super.drawCanvas();
		if (!this.data) return;

		const { fuels, totalMw } = this.data;

		const rows = fuels.map((fuel) => this.fillTemplate('fuel-row', {
			name: fuel.name,
			mw: `${Math.round(fuel.mw).toLocaleString()} MW`,
			percent: `${totalMw ? Math.round((fuel.mw / totalMw) * 100) : 0}%`,
		}));

		const list = this.elem.querySelector('.fuel-lines');
		list.innerHTML = '';
		list.append(...rows);

		this.elem.querySelector('.total-value').innerHTML = `${Math.round(totalMw).toLocaleString()} MW`;

		this.drawPie(fuels, totalMw);

		this.finishDraw();
	}

	drawPie(fuels, totalMw) {
		const size = 320;
		const canvas = document.createElement('canvas');
		canvas.width = size;
		canvas.height = size;
		const ctx = canvas.getContext('2d');

		const centerX = size / 2;
		const centerY = size / 2;
		const radius = size / 2 - 4;

		let angle = -Math.PI / 2;
		fuels.forEach((fuel) => {
			if (!totalMw || fuel.mw <= 0) return;
			const slice = (fuel.mw / totalMw) * Math.PI * 2;
			ctx.beginPath();
			ctx.moveTo(centerX, centerY);
			ctx.arc(centerX, centerY, radius, angle, angle + slice);
			ctx.closePath();
			ctx.fillStyle = fuelColor(fuel.name);
			ctx.fill();
			angle += slice;
		});

		const img = this.elem.querySelector('.pie-chart img');
		img.src = canvas.toDataURL();
	}
}

registerDisplay(new NyisoFuelMix(13, 'nyiso-fuelmix', true));
