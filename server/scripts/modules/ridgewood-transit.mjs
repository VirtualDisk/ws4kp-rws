// average minutes between trains at the Ridgewood, Queens M/L stations, computed
// offline from the MTA's static GTFS schedule (see datagenerators/ridgewood-transit.mjs)
// rather than fetched live -- there's no realtime endpoint that answers "average"
import STATUS from './status.mjs';
import { loadData } from './utils/data-loader.mjs';
import WeatherDisplay from './weatherdisplay.mjs';
import { registerDisplay } from './navigation.mjs';

const formatMinutes = (minutes) => (typeof minutes === 'number' ? `${minutes.toFixed(1)} min` : 'N/A');

class RidgewoodTransit extends WeatherDisplay {
	constructor(navId, elemId, defaultActive) {
		super(navId, elemId, 'Ridgewood Transit', defaultActive);
		this.timing.totalScreens = 1;
	}

	async getData(weatherParameters, refresh) {
		if (!super.getData(weatherParameters, refresh)) return;

		let data;
		try {
			data = await loadData('ridgewood-transit');
		} catch (error) {
			console.error(`Unable to load ridgewood-transit data: ${error.message}`);
		}

		if (!data?.stations?.length) {
			this.setStatus(STATUS.failed);
			return;
		}

		this.data = data.stations;

		this.getDataCallback();
		this.setStatus(STATUS.loaded);
		this.drawCanvas();
	}

	drawCanvas() {
		super.drawCanvas();
		if (!this.data) return;

		const rows = this.data.map((station) => {
			const row = this.fillTemplate('station-row', {
				bullet: station.route,
				name: station.name,
				weekday: formatMinutes(station.weekdayAvgMinutes),
				weekend: formatMinutes(station.weekendAvgMinutes),
			});
			row.querySelector('.bullet').style.backgroundColor = station.color;
			return row;
		});

		const list = this.elem.querySelector('.station-lines');
		list.innerHTML = '';
		list.append(...rows);

		this.finishDraw();
	}
}

registerDisplay(new RidgewoodTransit(17, 'ridgewood-transit', true));
