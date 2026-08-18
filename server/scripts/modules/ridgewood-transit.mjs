// average minutes between trains at the Ridgewood, Queens M/L stations, per direction,
// observed over the trailing 24 hours and compared against the 24 hours before that.
// the numbers are computed server-side by src/ridgewood-headway.mjs, which polls the MTA's
// GTFS-realtime trip updates -- there is no static or point-in-time source for "average"
import STATUS from './status.mjs';
import { loadData } from './utils/data-loader.mjs';
import WeatherDisplay from './weatherdisplay.mjs';
import { registerDisplay } from './navigation.mjs';

// whole minutes with a trailing 'm', matching how the countdowns read on the MTA's own
// platform signs. a direction with too few observed arrivals shows a placeholder rather
// than a fabricated average; this is the normal state for the first day the poller runs
const formatMinutes = (minutes) => (typeof minutes === 'number' ? `${Math.round(minutes)}m` : '--');

// the change reads as a delta, so it carries an explicit sign; rounded the same way as the
// value it sits next to. no prior 24-hour window means no comparison to show at all
const formatChange = (minutes) => {
	if (typeof minutes !== 'number') return '';
	const rounded = Math.round(minutes);
	if (rounded === 0) return '0m';
	return `${rounded > 0 ? '+' : '-'}${Math.abs(rounded)}m`;
};

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
			const [first, second] = station.directions ?? [];
			const row = this.fillTemplate('station-row', {
				bullet: station.route,
				name: station.name,
				'dir-1-label': first?.label ?? '',
				'dir-1-value': formatMinutes(first?.avgMinutes),
				'dir-1-change': formatChange(first?.changeMinutes),
				'dir-2-label': second?.label ?? '',
				'dir-2-value': formatMinutes(second?.avgMinutes),
				'dir-2-change': formatChange(second?.changeMinutes),
			});
			row.querySelector('.bullet').style.backgroundColor = station.color;

			// a longer wait than yesterday is worse service, so the sign drives the color
			[[first, '.dir-1 .change'], [second, '.dir-2 .change']].forEach(([direction, selector]) => {
				const change = direction?.changeMinutes;
				if (typeof change !== 'number' || change === 0) return;
				row.querySelector(selector).classList.add(change > 0 ? 'worse' : 'better');
			});

			return row;
		});

		const list = this.elem.querySelector('.station-lines');
		list.innerHTML = '';
		list.append(...rows);

		this.finishDraw();
	}
}

registerDisplay(new RidgewoodTransit(17, 'ridgewood-transit', true));
