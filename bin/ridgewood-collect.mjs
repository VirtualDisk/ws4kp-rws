#!/usr/bin/env node
// One collector cycle for the Ridgewood headway screen: read the accumulated arrival
// history, poll the MTA realtime feeds, fold in whatever arrived since the last run, and
// write both the history and the rendered screen payload back to shared storage.
//
// This exits when it is done. It is driven by the ridgewood-headway-collector Argo
// CronWorkflow (zoe-infra-v2) rather than by the web server, because the
// broadcast container is only alive during broadcasts and a 24-hour average collected only
// while on air would describe the broadcast schedule rather than the trains.
import 'dotenv/config';
import { collect } from '../src/ridgewood-headway.mjs';

try {
	const { state, payload } = await collect();

	const observed = payload.stations
		.flatMap((station) => station.directions)
		.filter((direction) => direction.avgMinutes !== null).length;

	console.log(`Ridgewood collector: ${Object.keys(state.arrivals).length} arrivals held, ${Object.keys(state.pending).length} predictions pending, ${observed}/10 directions reporting`);
} catch (error) {
	console.error(`Ridgewood collector: ${error.message}`);
	process.exit(1);
}
