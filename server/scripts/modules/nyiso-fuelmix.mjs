// NYISO real-time fuel mix
import STATUS from './status.mjs';
import { fetchNyisoCsv, latestRows } from './utils/nyiso.mjs';
import { DateTime } from '../vendor/auto/luxon.mjs';
import WeatherDisplay from './weatherdisplay.mjs';
import { registerDisplay } from './navigation.mjs';

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

		this.finishDraw();
	}
}

registerDisplay(new NyisoFuelMix(13, 'nyiso-fuelmix', true));
