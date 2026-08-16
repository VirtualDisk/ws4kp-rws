// Minimal S3 client for the two operations the Ridgewood headway collector needs: read an
// object and write an object. The AWS SDK would bring roughly fifty transitive packages
// into every image built from this repo -- including the broadcast container, which only
// ever reads one small JSON file -- so the SigV4 signing is done directly here instead.
//
// Path-style addressing is used throughout, which is what MinIO expects and what AWS still
// accepts for existing buckets.
import { createHash, createHmac } from 'crypto';

const ALGORITHM = 'AWS4-HMAC-SHA256';
const SERVICE = 's3';

const config = () => ({
	endpoint: process.env.WS4KP_S3_ENDPOINT,
	bucket: process.env.WS4KP_S3_BUCKET,
	region: process.env.WS4KP_S3_REGION ?? 'us-east-1',
	accessKeyId: process.env.WS4KP_S3_ACCESS_KEY_ID,
	secretAccessKey: process.env.WS4KP_S3_SECRET_ACCESS_KEY,
});

// the collector and the server both fall back to a local file when S3 is unconfigured, so
// this doubles as the "am I running against object storage" test
const isConfigured = () => {
	const {
		endpoint, bucket, accessKeyId, secretAccessKey,
	} = config();
	return !!(endpoint && bucket && accessKeyId && secretAccessKey);
};

const sha256Hex = (data) => createHash('sha256').update(data).digest('hex');
const hmac = (key, data) => createHmac('sha256', key).update(data).digest();

// SigV4 timestamps come in two flavors: the full instant and the date alone for the scope
const timestamps = () => {
	const amzDate = new Date().toISOString().replace(/[:-]|\.\d{3}/g, '');
	return { amzDate, dateStamp: amzDate.slice(0, 8) };
};

// the signing key is derived once per request from the date, region and service; it is the
// secret that never leaves this process, unlike the signature it produces
const signingKey = (secretAccessKey, dateStamp, region) => {
	const dateKey = hmac(`AWS4${secretAccessKey}`, dateStamp);
	const regionKey = hmac(dateKey, region);
	const serviceKey = hmac(regionKey, SERVICE);
	return hmac(serviceKey, 'aws4_request');
};

// build the Authorization header for one request; only the three headers below are signed,
// which is the minimum S3 requires
const authorize = ({
	method, path, host, payloadHash, amzDate, dateStamp, region, accessKeyId, secretAccessKey,
}) => {
	const canonicalHeaders = `host:${host}\nx-amz-content-sha256:${payloadHash}\nx-amz-date:${amzDate}\n`;
	const signedHeaders = 'host;x-amz-content-sha256;x-amz-date';
	const canonicalRequest = [method, path, '', canonicalHeaders, signedHeaders, payloadHash].join('\n');

	const scope = `${dateStamp}/${region}/${SERVICE}/aws4_request`;
	const stringToSign = [ALGORITHM, amzDate, scope, sha256Hex(canonicalRequest)].join('\n');
	const signature = createHmac('sha256', signingKey(secretAccessKey, dateStamp, region)).update(stringToSign).digest('hex');

	return `${ALGORITHM} Credential=${accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;
};

// each path segment is escaped individually so that a key containing a slash keeps its
// slashes in the canonical request, which is what S3 signs
const encodeKey = (key) => key.split('/').map((segment) => encodeURIComponent(segment)).join('/');

const request = async (method, key, body) => {
	const {
		endpoint, bucket, region, accessKeyId, secretAccessKey,
	} = config();

	const url = new URL(`${endpoint.replace(/\/$/, '')}/${bucket}/${encodeKey(key)}`);
	const payload = body ?? '';
	const payloadHash = sha256Hex(payload);
	const { amzDate, dateStamp } = timestamps();

	const headers = {
		host: url.host,
		'x-amz-date': amzDate,
		'x-amz-content-sha256': payloadHash,
		Authorization: authorize({
			method,
			path: url.pathname,
			host: url.host,
			payloadHash,
			amzDate,
			dateStamp,
			region,
			accessKeyId,
			secretAccessKey,
		}),
	};

	if (method === 'PUT') headers['content-type'] = 'application/json';

	return fetch(url, {
		method, headers, body: body ?? undefined, signal: AbortSignal.timeout(15000),
	});
};

// a missing object is an expected state on the first ever collector run, so it is reported
// as null rather than as an error
const getObject = async (key) => {
	const response = await request('GET', key);
	if (response.status === 404) return null;
	if (!response.ok) throw new Error(`S3 GET ${key} failed: ${response.status} ${await response.text()}`);
	return response.text();
};

const putObject = async (key, body) => {
	const response = await request('PUT', key, body);
	if (!response.ok) throw new Error(`S3 PUT ${key} failed: ${response.status} ${await response.text()}`);
};

export { isConfigured, getObject, putObject };
