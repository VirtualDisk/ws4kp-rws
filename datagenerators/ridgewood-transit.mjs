// average train arrival frequency (headway) for the Ridgewood, Queens M/L stations,
// computed from the MTA's published static GTFS schedule rather than realtime data --
// "average" arrival time is a schedule property, not something a point-in-time feed
// (like the subway-alerts feed transit.mjs uses) can answer.
import https from 'https';
import { writeFile } from 'fs/promises';
import readZipEntries from './zip.mjs';
import { ROUTE_COLORS } from '../server/scripts/modules/utils/mta.mjs';

// the MTA's published URL (web.mta.info/.../google_transit.zip) 301/302-redirects here;
// fetching the S3 object directly avoids teaching this one-off script a redirect chain
const GTFS_URL = 'https://rrgtfsfeeds.s3.amazonaws.com/gtfs_subway.zip';

// binary-safe fetch -- datagenerators/https.mjs concatenates the response as a utf8
// string, which would corrupt zip bytes, so this stays local to this generator
const getBinary = (url) => new Promise((resolve, reject) => {
	https.get(url, { headers: { 'user-agent': '(WeatherStar 4000+ data generator, ws4000@netbymatt.com)' } }, (res) => {
		if (res.statusCode !== 200) {
			reject(new Error(`Unable to get: ${url} (status ${res.statusCode})`));
			return;
		}
		const chunks = [];
		res.on('data', (chunk) => chunks.push(chunk));
		res.on('end', () => resolve(Buffer.concat(chunks)));
	}).on('error', reject);
});

// every station in Ridgewood, Queens served by the subway, in geographic order along the M
const STATIONS = [
	{
		id: 'M04', name: 'Fresh Pond Rd', route: 'M', stopIds: ['M04N', 'M04S'],
	},
	{
		id: 'M05', name: 'Forest Av', route: 'M', stopIds: ['M05N', 'M05S'],
	},
	{
		id: 'M06', name: 'Seneca Av', route: 'M', stopIds: ['M06N', 'M06S'],
	},
	{
		id: 'M08', name: 'Myrtle-Wyckoff Avs', route: 'M', stopIds: ['M08N', 'M08S'],
	},
	{
		id: 'L17', name: 'Myrtle-Wyckoff Avs', route: 'L', stopIds: ['L17N', 'L17S'],
	},
];

const ALL_STOP_IDS = new Set(STATIONS.flatMap((station) => station.stopIds));

// GTFS static's trips.txt/stop_times.txt for these two routes contain no quoted or
// comma-embedded fields (confirmed against the live feed), so a plain split is safe
// and avoids pulling in a CSV parser for a two-column read
const parseRows = (text) => text.split('\n').filter((line) => line.length > 0).map((line) => line.split(','));

// GTFS times can exceed 24:00:00 for a trip that departed the prior service day, which
// is fine here since every value within one service_id stays on the same relative clock
const timeToSeconds = (hhmmss) => {
	const [h, m, s] = hhmmss.split(':').map(Number);
	return (h * 3600) + (m * 60) + s;
};

// average gap between consecutive sorted arrivals, in minutes; a station needs at least
// two arrivals in the service day to have a meaningful average
const averageHeadwayMinutes = (secondsList) => {
	if (secondsList.length < 2) return null;
	const sorted = [...secondsList].sort((a, b) => a - b);
	const gaps = sorted.slice(1).map((seconds, i) => seconds - sorted[i]);
	const averageSeconds = gaps.reduce((sum, gap) => sum + gap, 0) / gaps.length;
	return Math.round((averageSeconds / 60) * 10) / 10;
};

console.log('Downloading MTA static GTFS schedule...');
const zipBuffer = await getBinary(GTFS_URL);

console.log('Extracting trips.txt and stop_times.txt...');
const { 'trips.txt': tripsText, 'stop_times.txt': stopTimesText } = readZipEntries(zipBuffer, ['trips.txt', 'stop_times.txt']);

// trip_id -> service_id, restricted to the M and L routes so stop_times parsing below
// can ignore every other route's trips with a cheap Map lookup
const tripsRows = parseRows(tripsText.toString('utf8'));
const tripHeader = tripsRows.shift();
const routeIdx = tripHeader.indexOf('route_id');
const tripIdIdx = tripHeader.indexOf('trip_id');
const serviceIdIdx = tripHeader.indexOf('service_id');

const tripServiceById = new Map();
tripsRows.forEach((row) => {
	if (row[routeIdx] !== 'M' && row[routeIdx] !== 'L') return;
	tripServiceById.set(row[tripIdIdx], row[serviceIdIdx]);
});

console.log(`Found ${tripServiceById.size} M/L trips`);

// (stop_id, service_id) -> list of arrival seconds
const arrivalsByStopService = new Map();

const stopTimesRows = parseRows(stopTimesText.toString('utf8'));
const stopTimesHeader = stopTimesRows.shift();
const stStopIdx = stopTimesHeader.indexOf('stop_id');
const stTripIdx = stopTimesHeader.indexOf('trip_id');
const stArrivalIdx = stopTimesHeader.indexOf('arrival_time');

stopTimesRows.forEach((row) => {
	const stopId = row[stStopIdx];
	if (!ALL_STOP_IDS.has(stopId)) return;
	const serviceId = tripServiceById.get(row[stTripIdx]);
	if (!serviceId) return;

	const key = `${stopId}|${serviceId}`;
	const list = arrivalsByStopService.get(key) ?? [];
	list.push(timeToSeconds(row[stArrivalIdx]));
	arrivalsByStopService.set(key, list);
});

// both directions' arrivals for one service day can be pooled directly -- the two
// platforms are simultaneous, so merging them is just "how often does any train
// come through this station" for that day
const secondsFor = (stopIds, serviceId) => stopIds.flatMap((stopId) => arrivalsByStopService.get(`${stopId}|${serviceId}`) ?? []);

// Saturday and Sunday are two distinct 24-hour schedules, not two simultaneous feeds --
// pooling their raw timestamps together would double-count arrivals within the same
// clock window and halve the apparent headway, so each day's average is computed on
// its own and the two results are averaged instead
const averageOfAverages = (values) => {
	const present = values.filter((value) => value !== null);
	if (present.length === 0) return null;
	return Math.round((present.reduce((sum, value) => sum + value, 0) / present.length) * 10) / 10;
};

const stations = STATIONS.map((station) => ({
	id: station.id,
	name: station.name,
	route: station.route,
	color: ROUTE_COLORS[station.route],
	weekdayAvgMinutes: averageHeadwayMinutes(secondsFor(station.stopIds, 'Weekday')),
	weekendAvgMinutes: averageOfAverages([
		averageHeadwayMinutes(secondsFor(station.stopIds, 'Saturday')),
		averageHeadwayMinutes(secondsFor(station.stopIds, 'Sunday')),
	]),
}));

const output = {
	generatedAt: new Date().toISOString(),
	stations,
};

await writeFile('./datagenerators/output/ridgewood-transit.json', JSON.stringify(output, null, '\t'));
console.log('Wrote datagenerators/output/ridgewood-transit.json');
console.table(stations);
