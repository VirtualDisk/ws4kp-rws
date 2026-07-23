// NYISO real-time zonal LBMP (locational marginal price) pricing
import STATUS from './status.mjs';
import { fetchNyisoCsv, latestRows, zoneDisplayName } from './utils/nyiso.mjs';
import { DateTime } from '../vendor/auto/luxon.mjs';
import WeatherDisplay from './weatherdisplay.mjs';
import { registerDisplay } from './navigation.mjs';

class NyisoPricing extends WeatherDisplay {
	constructor(navId, elemId, defaultActive) {
		super(navId, elemId, 'Grid Pricing', defaultActive);
		this.timing.totalScreens = 1;
	}

	async getData(weatherParameters, refresh) {
		if (!super.getData(weatherParameters, refresh)) return;

		const rows = await fetchNyisoCsv('realtime', DateTime.local(), () => this.stillWaiting(), 'realtime_zone');
		const latest = latestRows(rows);

		if (latest.length === 0) {
			this.setStatus(STATUS.failed);
			return;
		}

		const zones = latest
			.map((row) => ({ name: zoneDisplayName(row.Name), price: parseFloat(row['LBMP ($/MWHr)']) }))
			.filter((zone) => !Number.isNaN(zone.price))
			.sort((a, b) => b.price - a.price);

		this.data = { zones };

		this.getDataCallback();
		this.setStatus(STATUS.loaded);
		this.drawCanvas();
	}

	drawCanvas() {
		super.drawCanvas();
		if (!this.data) return;

		const { zones } = this.data;

		const rows = zones.map((zone) => this.fillTemplate('price-row', {
			name: zone.name,
			price: `$${zone.price.toFixed(2)}`,
		}));

		const list = this.elem.querySelector('.price-lines');
		list.innerHTML = '';
		list.append(...rows);

		this.finishDraw();
	}
}

registerDisplay(new NyisoPricing(15, 'nyiso-pricing', true));
