// shared utilities for fetching and parsing NYISO public CSV reports
import { DateTime } from '../../vendor/auto/luxon.mjs';
import { safeText } from './fetch.mjs';

// NY control-area zones as published in NYISO's pal/isolf/realtime_zone reports
const ZONE_NAMES = {
	CAPITL: 'Capital',
	CENTRL: 'Central',
	DUNWOD: 'Dunwoodie',
	GENESE: 'Genesee',
	'HUD VL': 'Hudson Valley',
	LONGIL: 'Long Island',
	'MHK VL': 'Mohawk Valley',
	MILLWD: 'Millwood',
	'N.Y.C.': 'New York City',
	NORTH: 'North',
	WEST: 'West',
};

const formatDateYYYYMMDD = (date) => date.toFormat('yyyyLLdd');

// minimal quoted-CSV parser; NYISO reports never embed commas or quotes within a field
const parseCsv = (text) => {
	if (!text) return [];
	const lines = text.trim().split('\n').map((line) => line.replace(/\r$/, ''));
	if (lines.length < 2) return [];
	const headers = lines[0].split(',').map((cell) => cell.replace(/^"|"$/g, '').trim());
	return lines.slice(1).filter((line) => line.length > 0).map((line) => {
		const cells = line.split(',').map((cell) => cell.replace(/^"|"$/g, '').trim());
		const row = {};
		headers.forEach((header, index) => { row[header] = cells[index]; });
		return row;
	});
};

// fetch and parse a NYISO public CSV report for a given report type and date
// `report` is the directory name; `fileSuffix` is the filename suffix when it differs from the
// directory (e.g. directory "realtime" but filename "..._zone.csv")
const fetchNyisoCsv = async (report, date, stillWaiting, fileSuffix = report) => {
	const dateStr = formatDateYYYYMMDD(date);
	const url = `https://mis.nyiso.com/public/csv/${report}/${dateStr}${fileSuffix}.csv`;
	const text = await safeText(url, { retryCount: 2, stillWaiting });
	return parseCsv(text);
};

// sum every zone's Load column for each timestamp, returns Map<timestamp, totalMW>
const sumZonesByTimestamp = (rows, valueKey = 'Load') => {
	const totals = new Map();
	rows.forEach((row) => {
		const timestamp = row['Time Stamp'];
		const value = parseFloat(row[valueKey]);
		if (!timestamp || Number.isNaN(value)) return;
		totals.set(timestamp, (totals.get(timestamp) ?? 0) + value);
	});
	return totals;
};

// peak and average MW across a zonal (pal-style) report for a single day
const dailyPeakAndAverage = (rows, valueKey = 'Load') => {
	const totals = [...sumZonesByTimestamp(rows, valueKey).values()];
	if (totals.length === 0) return { peak: null, average: null };
	const peak = Math.max(...totals);
	const average = totals.reduce((sum, val) => sum + val, 0) / totals.length;
	return { peak, average };
};

// peak forecast MW from an isolf-style report (already has a NYISO total column)
const dailyForecastPeak = (rows) => {
	const totals = rows
		.map((row) => parseFloat(row.NYISO))
		.filter((val) => !Number.isNaN(val));
	if (totals.length === 0) return null;
	return Math.max(...totals);
};

// most recent timestamp present in a report
const latestTimestamp = (rows) => rows.reduce((latest, row) => {
	const timestamp = row['Time Stamp'];
	if (!timestamp) return latest;
	if (!latest || DateTime.fromFormat(timestamp, 'LL/dd/yyyy HH:mm:ss') > DateTime.fromFormat(latest, 'LL/dd/yyyy HH:mm:ss')) return timestamp;
	return latest;
}, null);

// rows matching the most recent timestamp in the report
const latestRows = (rows) => {
	const timestamp = latestTimestamp(rows);
	if (!timestamp) return [];
	return rows.filter((row) => row['Time Stamp'] === timestamp);
};

const zoneDisplayName = (name) => ZONE_NAMES[name] ?? name;

export {
	formatDateYYYYMMDD,
	parseCsv,
	fetchNyisoCsv,
	sumZonesByTimestamp,
	dailyPeakAndAverage,
	dailyForecastPeak,
	latestTimestamp,
	latestRows,
	zoneDisplayName,
};
