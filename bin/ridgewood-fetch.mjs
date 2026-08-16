#!/usr/bin/env node
// Copy the collector's rendered headway payload out of object storage and onto disk.
//
// The broadcast image is nginx serving a static build, so it has no process that could read
// the payload at request time. This runs as an init container beside it and drops the file
// where the built site expects to find it (/data/ridgewood-transit.json), using the same
// image and the same credentials as the collector itself.
//
// A destination file is always written, even when the object is missing or unreadable: the
// consumer mounts it by subPath, and a path that does not exist when the main container
// starts becomes a directory rather than a file. An empty station list makes the display
// report a failed status, which is the right outcome and never blocks a broadcast.
import 'dotenv/config';
import { writeFile } from 'fs/promises';
import { readPayload } from '../src/ridgewood-headway.mjs';

const [destination] = process.argv.slice(2);

if (!destination) {
	console.error('Usage: ridgewood-fetch.mjs <destination-path>');
	process.exit(2);
}

const EMPTY = { generatedAt: null, observedSince: null, stations: [] };

let payload = EMPTY;

try {
	payload = (await readPayload()) ?? EMPTY;
} catch (error) {
	console.error(`Ridgewood fetch: ${error.message}`);
}

await writeFile(destination, JSON.stringify(payload));

if (payload.stations.length === 0) {
	console.warn(`Ridgewood fetch: no collected data available, wrote an empty ${destination}`);
} else {
	console.log(`Ridgewood fetch: wrote ${destination} (collected ${payload.generatedAt})`);
}
