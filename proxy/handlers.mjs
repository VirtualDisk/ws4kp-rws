// Consolidated proxy handlers for all external API requests with caching

import cache from './cache.mjs';
import OVERRIDES from '../src/overrides.mjs';

// Weather.gov API proxy (catch-all for any Weather.gov API endpoint)
export const weatherProxy = async (req, res) => {
	await cache.handleRequest(req, res, 'https://api.weather.gov', {
		serviceName: 'Weather.gov',
		skipParams: ['u'],
	});
};

// Radar proxy for weather radar images
export const radarProxy = async (req, res) => {
	await cache.handleRequest(req, res, 'https://radar.weather.gov', {
		serviceName: 'Radar',
		skipParams: ['u'],
		encoding: 'binary', // Radar images are binary data
	});
};

// SPC (Storm Prediction Center) outlook proxy
export const outlookProxy = async (req, res) => {
	await cache.handleRequest(req, res, 'https://www.spc.noaa.gov', {
		serviceName: 'SPC Outlook',
		skipParams: ['u'],
	});
};

// Iowa State Mesonet proxy with configurable host
export const mesonetProxy = async (req, res) => {
	// Determine if this is a binary file (images)
	const isBinary = req.path.match(/\.(png|jpg|jpeg|gif|webp|ico)$/i);

	// Use override radar host if provided, otherwise default to mesonet
	const radarHost = OVERRIDES.RADAR_HOST || 'mesonet.agron.iastate.edu';

	await cache.handleRequest(req, res, `https://${radarHost}`, {
		serviceName: `Iowa State Mesonet (${radarHost})`,
		skipParams: [], // No parameters to skip for Mesonet
		encoding: isBinary ? 'binary' : 'utf8', // Use binary encoding for images
	});
};

// Legacy forecast.weather.gov API proxy
export const forecastProxy = async (req, res) => {
	await cache.handleRequest(req, res, 'https://forecast.weather.gov', {
		serviceName: 'Forecast.weather.gov',
		skipParams: ['u'],
	});
};

// MTA public GTFS-realtime subway service alerts proxy. The upstream sends permissive CORS
// headers, so this exists for caching and request logging rather than for browser access.
export const mtaProxy = async (req, res) => {
	await cache.handleRequest(req, res, 'https://api-endpoint.mta.info', {
		serviceName: 'MTA',
		skipParams: [],
	});
};

// NYISO (New York Independent System Operator) public CSV data proxy
export const nyisoProxy = async (req, res) => {
	await cache.handleRequest(req, res, 'https://mis.nyiso.com', {
		serviceName: 'NYISO',
		skipParams: [],
	});
};

// Lichess public puzzle API proxy. Like the MTA feed above, the upstream sends permissive
// CORS headers, so this exists for caching and request logging rather than for browser
// access -- static deployments fetch lichess.org directly.
export const lichessProxy = async (req, res) => {
	await cache.handleRequest(req, res, 'https://lichess.org', {
		serviceName: 'Lichess',
		skipParams: [],
	});
};
