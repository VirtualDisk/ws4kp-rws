// Observed train headway for the Ridgewood, Queens M/L stations.
//
// "Average minutes between trains over the last 24 hours" is a property of what actually
// ran, so it can come neither from the static GTFS schedule nor from a single point-in-time
// realtime request. Arrivals are instead accumulated over time from the MTA's GTFS-realtime
// trip-updates feeds by a collector that runs on its own schedule (bin/ridgewood-collect.mjs,
// driven by an Argo CronWorkflow) and shares its state with the broadcast container through
// object storage.
//
// The collector is deliberately not run in-process by the web server: that container is only
// alive during broadcasts, so a 24-hour window it filled itself would really be "the hours
// we happened to be on air" and the day-over-day comparison would be two biased samples.
//
// An arrival is recorded at its last *predicted* time rather than at the moment the
// collector noticed the trip leave the feed, so collection cadence does not affect
// timestamp accuracy. The MTA predicts trips more than twenty minutes ahead, which is why a
// five-minute cron still sees every train several times and misses none.
import https from 'https';
import { readFile, writeFile, rename } from 'fs/promises';
import { dirname } from 'path';
import { mkdirSync } from 'fs';
import GtfsRealtimeBindings from 'gtfs-realtime-bindings';
import { isConfigured as s3Configured, getObject, putObject } from './s3-store.mjs';
import { ROUTE_COLORS } from '../server/scripts/modules/utils/mta-colors.mjs';

const { transit_realtime: transitRealtime } = GtfsRealtimeBindings;

// the M runs on the B/D/F/M feed, the L has its own; neither requires an API key. each
// feed is paired with the stop-id prefix it covers so that one feed failing cannot be
// mistaken for its trains having passed the stops the other feed knows nothing about
const FEEDS = [
	{ url: 'https://api-endpoint.mta.info/Dataservice/mtagtfsfeeds/nyct%2Fgtfs-bdfm', prefix: 'M' },
	{ url: 'https://api-endpoint.mta.info/Dataservice/mtagtfsfeeds/nyct%2Fgtfs-l', prefix: 'L' },
];

// every station in Ridgewood, Queens served by the subway, in geographic order along the M.
// GTFS stop ids suffix the direction: N is railroad-north (Manhattan-bound at these stops),
// S is railroad-south. The labels are what a rider reads off the platform sign.
const STATIONS = [
	{
		id: 'M04',
		name: 'Fresh Pond Rd',
		route: 'M',
		directions: [{ stopId: 'M04N', label: 'Manhattan' }, { stopId: 'M04S', label: 'Middle Vlg' }],
	},
	{
		id: 'M05',
		name: 'Forest Av',
		route: 'M',
		directions: [{ stopId: 'M05N', label: 'Manhattan' }, { stopId: 'M05S', label: 'Middle Vlg' }],
	},
	{
		id: 'M06',
		name: 'Seneca Av',
		route: 'M',
		directions: [{ stopId: 'M06N', label: 'Manhattan' }, { stopId: 'M06S', label: 'Middle Vlg' }],
	},
	{
		id: 'M08',
		name: 'Myrtle-Wyckoff Avs',
		route: 'M',
		directions: [{ stopId: 'M08N', label: 'Manhattan' }, { stopId: 'M08S', label: 'Middle Vlg' }],
	},
	{
		id: 'L17',
		name: 'Myrtle-Wyckoff Avs',
		route: 'L',
		directions: [{ stopId: 'L17N', label: '8 Av' }, { stopId: 'L17S', label: 'Canarsie' }],
	},
];

const TRACKED_STOP_IDS = new Set(STATIONS.flatMap((station) => station.directions.map((direction) => direction.stopId)));

// the raw arrival history, read and written only by the collector
const STATE_KEY = process.env.WS4KP_HEADWAY_STATE_KEY ?? 'ridgewood/headway-state.json';
// the rendered screen payload, written by the collector and read by the web server
const PAYLOAD_KEY = process.env.WS4KP_HEADWAY_PAYLOAD_KEY ?? 'ridgewood/ridgewood-transit.json';
// local fallback so the collector can be run against a working copy without object storage
const LOCAL_DIR = process.env.WS4KP_HEADWAY_LOCAL_DIR ?? './data';

const SECOND = 1000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

// arrivals older than this are outside both comparison windows
const RETENTION_SECONDS = (2 * DAY) / SECOND;
// a prediction that stops appearing without ever reaching its arrival time (cancelled or
// rerouted trip) is abandoned rather than recorded
const PENDING_MAX_AGE_SECONDS = (2 * HOUR) / SECOND;
// a window with fewer arrivals than this has too few gaps to average meaningfully
const MIN_SAMPLES = 3;

// binary-safe fetch -- the feeds are protobuf, so the response cannot be decoded as utf8
// on the way in the way the JSON alerts feed in utils/mta.mjs can be
const getBinary = (url) => new Promise((resolve, reject) => {
	const request = https.get(url, { headers: { 'user-agent': '(WeatherStar 4000+, ws4000@netbymatt.com)' } }, (res) => {
		if (res.statusCode !== 200) {
			res.resume();
			reject(new Error(`Unable to get: ${url} (status ${res.statusCode})`));
			return;
		}
		const chunks = [];
		res.on('data', (chunk) => chunks.push(chunk));
		res.on('end', () => resolve(Buffer.concat(chunks)));
	});
	request.setTimeout(15 * SECOND, () => request.destroy(new Error(`Timeout getting: ${url}`)));
	request.on('error', reject);
});

// protobuf int64 fields decode as long objects when the value exceeds 32 bits; the feeds'
// timestamps are seconds since epoch and fit comfortably in a JS number either way
const toNumber = (value) => {
	if (value === null || value === undefined) return null;
	const number = typeof value === 'number' ? value : Number(value.toString());
	return Number.isFinite(number) ? number : null;
};

// average gap between consecutive arrivals, in minutes rounded to 0.1; n arrivals give
// n-1 gaps, so a window needs at least two entries before any average exists
const averageHeadwayMinutes = (timestamps) => {
	if (timestamps.length < 2) return null;
	const sorted = [...timestamps].sort((a, b) => a - b);
	const gaps = sorted.slice(1).map((timestamp, i) => timestamp - sorted[i]);
	const averageSeconds = gaps.reduce((sum, gap) => sum + gap, 0) / gaps.length;
	return Math.round((averageSeconds / 60) * 10) / 10;
};

// an empty history; arrivals are keyed "tripId|stopId" so a trip re-observed across runs
// cannot double-count, and pending holds predictions that have not yet come to pass
const emptyState = () => ({ observedSince: null, arrivals: {}, pending: {} });

// state survives between collector runs in object storage, or on local disk when S3 is not
// configured -- both hold the same JSON, so a working copy can be seeded from a bucket
const readState = async () => {
	let text = null;
	try {
		if (s3Configured()) {
			text = await getObject(STATE_KEY);
		} else {
			text = await readFile(`${LOCAL_DIR}/headway-state.json`, 'utf8');
		}
	} catch (error) {
		if (error.code !== 'ENOENT') throw error;
	}
	if (!text) return emptyState();

	const parsed = JSON.parse(text);
	return {
		observedSince: parsed.observedSince ?? null,
		arrivals: parsed.arrivals ?? {},
		pending: parsed.pending ?? {},
	};
};

// the local path writes through a temp file so a crash mid-write cannot leave truncated
// JSON behind; S3 object writes are already atomic
const writeLocal = async (name, body) => {
	const path = `${LOCAL_DIR}/${name}`;
	mkdirSync(dirname(path), { recursive: true });
	await writeFile(`${path}.tmp`, body);
	await rename(`${path}.tmp`, path);
};

const writeState = async (state) => {
	const body = JSON.stringify(state);
	if (s3Configured()) return putObject(STATE_KEY, body);
	return writeLocal('headway-state.json', body);
};

const writePayload = async (payload) => {
	const body = JSON.stringify(payload);
	if (s3Configured()) return putObject(PAYLOAD_KEY, body);
	return writeLocal('ridgewood-transit.json', body);
};

// the payload the broadcast container serves; read straight through without recomputation,
// since the collector has already done the arithmetic
const readPayload = async () => {
	if (s3Configured()) {
		const text = await getObject(PAYLOAD_KEY);
		return text ? JSON.parse(text) : null;
	}
	try {
		return JSON.parse(await readFile(`${LOCAL_DIR}/ridgewood-transit.json`, 'utf8'));
	} catch (error) {
		if (error.code === 'ENOENT') return null;
		throw error;
	}
};

// one pass over every feed, returning the predictions currently on offer for the tracked
// stops plus which feeds actually answered
const pollFeeds = async () => {
	const seen = {};
	const covered = new Set();
	let feedTimestamp = Math.floor(Date.now() / 1000);

	await Promise.all(FEEDS.map(async ({ url, prefix }) => {
		let feed;
		try {
			feed = transitRealtime.FeedMessage.decode(await getBinary(url));
		} catch (error) {
			console.error(`Ridgewood headway: ${error.message}`);
			return;
		}
		covered.add(prefix);

		// the feed stamps its own generation time; prefer it over the local clock so an
		// arrival is judged past by the same clock that produced the prediction
		const stamp = toNumber(feed.header?.timestamp);
		if (stamp) feedTimestamp = Math.min(feedTimestamp, stamp);

		(feed.entity ?? []).forEach((entity) => {
			const tripUpdate = entity?.tripUpdate;
			const tripId = tripUpdate?.trip?.tripId;
			if (!tripId) return;

			(tripUpdate.stopTimeUpdate ?? []).forEach((update) => {
				if (!TRACKED_STOP_IDS.has(update?.stopId)) return;
				const arrival = toNumber(update.arrival?.time) ?? toNumber(update.departure?.time);
				if (!arrival) return;
				seen[`${tripId}|${update.stopId}`] = { stopId: update.stopId, tripId, arrival };
			});
		});
	}));

	return { seen, covered, feedTimestamp };
};

// fold one poll into the history: a prediction that has left the feed either happened or was
// cancelled, and it happened if its last predicted arrival is at or before the feed's clock
const commit = (state, { seen, covered, feedTimestamp }) => {
	const now = Date.now() / 1000;
	const arrivals = { ...state.arrivals };
	const pending = {};

	Object.entries(state.pending).forEach(([key, entry]) => {
		if (seen[key]) return;
		// a stop whose feed failed this run simply went unobserved; leave it pending
		if (!covered.has(entry.stopId[0])) {
			if (now - entry.arrival <= PENDING_MAX_AGE_SECONDS) pending[key] = entry;
			return;
		}
		if (entry.arrival <= feedTimestamp) {
			if (!arrivals[key]) arrivals[key] = entry;
		}
		// the trip vanished while its arrival was still in the future: cancelled or rerouted
	});

	Object.entries(seen).forEach(([key, entry]) => {
		if (!arrivals[key]) pending[key] = entry;
	});

	const cutoff = now - RETENTION_SECONDS;
	Object.entries(arrivals).forEach(([key, entry]) => {
		if (entry.arrival < cutoff) delete arrivals[key];
	});

	return {
		observedSince: state.observedSince ?? new Date().toISOString(),
		arrivals,
		pending,
	};
};

// arrival timestamps at one stop inside [start, end)
const timestampsFor = (state, stopId, start, end) => Object.values(state.arrivals)
	.filter((arrival) => arrival.stopId === stopId && arrival.arrival >= start && arrival.arrival < end)
	.map((arrival) => arrival.arrival);

// average headway at one stop over the trailing 24 hours, and how that compares with the
// 24 hours before it
const statsFor = (state, stopId) => {
	const now = Date.now() / 1000;
	const day = DAY / SECOND;

	const recent = timestampsFor(state, stopId, now - day, now);
	const previous = timestampsFor(state, stopId, now - (2 * day), now - day);

	const avgMinutes = recent.length >= MIN_SAMPLES ? averageHeadwayMinutes(recent) : null;
	const previousMinutes = previous.length >= MIN_SAMPLES ? averageHeadwayMinutes(previous) : null;
	const changeMinutes = (avgMinutes !== null && previousMinutes !== null)
		? Math.round((avgMinutes - previousMinutes) * 10) / 10
		: null;

	return { avgMinutes, changeMinutes, sampleCount: recent.length };
};

// the payload served at /data/ridgewood-transit.json
const snapshot = (state) => ({
	generatedAt: new Date().toISOString(),
	observedSince: state.observedSince,
	stations: STATIONS.map((station) => ({
		id: station.id,
		name: station.name,
		route: station.route,
		color: ROUTE_COLORS[station.route],
		directions: station.directions.map((direction) => ({
			stopId: direction.stopId,
			label: direction.label,
			...statsFor(state, direction.stopId),
		})),
	})),
});

// one full collector cycle: read history, poll, fold, write history and rendered payload
const collect = async () => {
	const state = await readState();
	const poll = await pollFeeds();
	if (poll.covered.size === 0) throw new Error('no MTA feed could be read');

	const updated = commit(state, poll);
	const payload = snapshot(updated);

	await writeState(updated);
	await writePayload(payload);

	return { state: updated, payload };
};

export {
	STATIONS,
	averageHeadwayMinutes,
	pollFeeds,
	commit,
	snapshot,
	collect,
	readState,
	readPayload,
};
