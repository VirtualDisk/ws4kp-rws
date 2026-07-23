// NYISO real-time load / demand by zone
import STATUS from './status.mjs';
import { fetchNyisoCsv, latestRows, zoneDisplayName } from './utils/nyiso.mjs';
import { DateTime } from '../vendor/auto/luxon.mjs';
import WeatherDisplay from './weatherdisplay.mjs';
import { registerDisplay } from './navigation.mjs';

class NyisoLoad extends WeatherDisplay {
	constructor(navId, elemId, defaultActive) {
		super(navId, elemId, 'Grid Load', defaultActive);
		this.timing.totalScreens = 1;
	}

	async getData(weatherParameters, refresh) {
		if (!super.getData(weatherParameters, refresh)) return;

		const rows = await fetchNyisoCsv('pal', DateTime.local(), () => this.stillWaiting());
		const latest = latestRows(rows);

		if (latest.length === 0) {
			this.setStatus(STATUS.failed);
			return;
		}

		const zones = latest
			.map((row) => ({ name: zoneDisplayName(row.Name), mw: parseFloat(row.Load) }))
			.filter((zone) => !Number.isNaN(zone.mw))
			.sort((a, b) => b.mw - a.mw);

		const totalMw = zones.reduce((sum, zone) => sum + zone.mw, 0);

		this.data = { zones, totalMw };

		this.getDataCallback();
		this.setStatus(STATUS.loaded);
		this.drawCanvas();
	}

	drawCanvas() {
		super.drawCanvas();
		if (!this.data) return;

		const { zones, totalMw } = this.data;

		this.elem.querySelector('.total-value').innerHTML = `${Math.round(totalMw).toLocaleString()} MW`;

		const rows = zones.map((zone) => this.fillTemplate('zone-row', {
			name: zone.name,
			mw: `${Math.round(zone.mw).toLocaleString()} MW`,
		}));

		const list = this.elem.querySelector('.zone-lines');
		list.innerHTML = '';
		list.append(...rows);

		this.finishDraw();
	}
}

registerDisplay(new NyisoLoad(14, 'nyiso-load', true));
