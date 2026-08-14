// NYCT subway status for the M and L lines
import STATUS from './status.mjs';
import { fetchSubwayAlerts, routeStatus } from './utils/mta.mjs';
import WeatherDisplay from './weatherdisplay.mjs';
import { registerDisplay } from './navigation.mjs';

const ROUTES = ['M', 'L'];

class Transit extends WeatherDisplay {
	constructor(navId, elemId, defaultActive) {
		super(navId, elemId, 'Transit Info', defaultActive);
		this.timing.totalScreens = 1;
	}

	async getData(weatherParameters, refresh) {
		if (!super.getData(weatherParameters, refresh)) return;

		const feed = await fetchSubwayAlerts(() => this.stillWaiting());

		if (!feed?.entity) {
			this.setStatus(STATUS.failed);
			return;
		}

		// the feed stamps its own generation time; prefer it over the local clock so the
		// active-period math matches what the MTA considers "now"
		const nowSeconds = feed.header?.timestamp ?? Math.floor(Date.now() / 1000);

		this.data = { routes: ROUTES.map((route) => routeStatus(feed, route, nowSeconds)) };

		this.getDataCallback();
		this.setStatus(STATUS.loaded);
		this.drawCanvas();
	}

	drawCanvas() {
		super.drawCanvas();
		if (!this.data) return;

		const routes = this.data.routes.map((route) => {
			const line = this.fillTemplate('route-line', {
				bullet: route.route,
				status: route.status,
				detail: route.detail,
			});
			line.querySelector('.bullet').style.backgroundColor = route.color;
			if (route.good) line.classList.add('good');
			return line;
		});

		const list = this.elem.querySelector('.route-lines');
		list.innerHTML = '';
		list.append(...routes);

		this.finishDraw();
	}
}

registerDisplay(new Transit(16, 'transit', true));
