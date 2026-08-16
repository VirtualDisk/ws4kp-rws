// shared utilities for fetching and interpreting MTA subway service alerts
// source: MTA's public GTFS-realtime service alerts feed, published as JSON
import { safeJson } from './fetch.mjs';
import { ROUTE_COLORS } from './mta-colors.mjs';

const SUBWAY_ALERTS_URL = 'https://api-endpoint.mta.info/Dataservice/mtagtfsfeeds/camsys%2Fsubway-alerts.json';

// the feed labels every alert with a mercury alert_type; these are ranked so that a route
// carrying several simultaneous alerts reports its most disruptive condition first
const ALERT_TYPE_PRIORITY = [
	'Suspended',
	'Part Suspended',
	'Delays',
	'Reroute',
	'Stops Skipped',
	'Express to Local',
	'Local to Express',
	'Reduced Service',
	'Special Schedule',
	'Slow Speeds',
	'Some Delays',
	'Extra Service',
	'Boarding Change',
	'Station Notice',
];

const GOOD_SERVICE = 'Good Service';

// strip the "Planned - " prefix the feed uses for scheduled work so the status reads like the
// wording riders see in stations
const normalizeAlertType = (alertType) => (alertType ?? '').replace(/^Planned\s*-\s*/, '').trim();

const alertPriority = (alertType) => {
	const index = ALERT_TYPE_PRIORITY.indexOf(normalizeAlertType(alertType));
	return index === -1 ? ALERT_TYPE_PRIORITY.length : index;
};

// an alert applies right now when any of its active periods brackets the current time; a period
// with no end runs indefinitely, and an alert with no periods at all is treated as in effect
const isActiveNow = (alert, nowSeconds) => {
	const periods = alert?.active_period;
	if (!Array.isArray(periods) || periods.length === 0) return true;
	return periods.some((period) => {
		const start = period?.start ?? 0;
		const end = period?.end ?? Number.MAX_SAFE_INTEGER;
		return start <= nowSeconds && end >= nowSeconds;
	});
};

// pull the plain-text (non-html) translation out of a GTFS translated string
const plainText = (translatedString) => {
	const translations = translatedString?.translation;
	if (!Array.isArray(translations)) return '';
	const english = translations.find((translation) => translation.language === 'en');
	return (english ?? translations[0])?.text ?? '';
};

// the feed writes route references as bracketed bullets, e.g. "[M] trains"; the screen has no
// inline bullet graphics so render them as bare route letters instead
const stripBullets = (text) => text.replace(/\[([^\]]{1,3})\]/g, '$1');

// collapse the multi-paragraph alert text into a single line of prose
const singleLine = (text) => stripBullets(text).replace(/\s+/g, ' ').trim();

const fetchSubwayAlerts = async (stillWaiting) => safeJson(SUBWAY_ALERTS_URL, { retryCount: 2, stillWaiting });

// every currently active alert that names the given route, most disruptive first
const activeAlertsForRoute = (feed, route, nowSeconds) => {
	const entities = feed?.entity;
	if (!Array.isArray(entities)) return [];

	return entities
		.map((entity) => entity?.alert)
		.filter((alert) => alert)
		.filter((alert) => (alert.informed_entity ?? []).some((informed) => informed?.route_id === route))
		.filter((alert) => isActiveNow(alert, nowSeconds))
		.map((alert) => ({
			alertType: normalizeAlertType(alert['transit_realtime.mercury_alert']?.alert_type),
			header: singleLine(plainText(alert.header_text)),
			priority: alertPriority(alert['transit_realtime.mercury_alert']?.alert_type),
		}))
		.sort((a, b) => a.priority - b.priority);
};

// condense a route's active alerts into the status line and supporting detail shown on screen
const routeStatus = (feed, route, nowSeconds) => {
	const alerts = activeAlertsForRoute(feed, route, nowSeconds);

	if (alerts.length === 0) {
		return {
			route,
			color: ROUTE_COLORS[route],
			status: GOOD_SERVICE,
			detail: '',
			good: true,
			alertCount: 0,
		};
	}

	const [worst] = alerts;

	return {
		route,
		color: ROUTE_COLORS[route],
		status: worst.alertType || 'Service Change',
		detail: worst.header,
		good: false,
		alertCount: alerts.length,
	};
};

export {
	SUBWAY_ALERTS_URL,
	ROUTE_COLORS,
	GOOD_SERVICE,
	fetchSubwayAlerts,
	activeAlertsForRoute,
	routeStatus,
};
