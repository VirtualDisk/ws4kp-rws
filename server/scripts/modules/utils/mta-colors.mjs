// official NYCT route bullet colors, keyed by route id
//
// kept apart from mta.mjs so that server-side code (the Ridgewood headway collector) can
// use the palette without pulling in the browser fetch helpers mta.mjs depends on
const ROUTE_COLORS = {
	M: '#ff6319',
	L: '#a7a9ac',
};

export default ROUTE_COLORS;
export { ROUTE_COLORS };
