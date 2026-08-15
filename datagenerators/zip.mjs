// minimal zip reader (central directory + local file headers), just enough to
// pull specific named entries out of a standard (non-zip64, DEFLATE/store only)
// archive without adding a dependency for the one datagenerator that needs it
import zlib from 'zlib';

const EOCD_SIG = 0x06054b50;
const CD_SIG = 0x02014b50;
const LOCAL_SIG = 0x04034b50;

const findEndOfCentralDirectory = (buffer) => {
	// the EOCD record is at the end of the file, but a zip comment (rare, empty
	// here) can follow it, so scan backward for the signature instead of
	// assuming a fixed offset from the end
	const maxCommentLength = 65535;
	const searchStart = Math.max(0, buffer.length - 22 - maxCommentLength);
	for (let i = buffer.length - 22; i >= searchStart; i -= 1) {
		if (buffer.readUInt32LE(i) === EOCD_SIG) return i;
	}
	throw new Error('End of central directory record not found; not a valid zip file');
};

// extract only the requested entries (by exact name) as Buffers, keyed by name
const readZipEntries = (buffer, names) => {
	const wanted = new Set(names);
	const result = {};

	const eocdOffset = findEndOfCentralDirectory(buffer);
	const totalEntries = buffer.readUInt16LE(eocdOffset + 10);
	const cdOffset = buffer.readUInt32LE(eocdOffset + 16);

	let offset = cdOffset;
	for (let i = 0; i < totalEntries && wanted.size > 0; i += 1) {
		if (buffer.readUInt32LE(offset) !== CD_SIG) {
			throw new Error(`Central directory entry ${i} has an unexpected signature`);
		}
		const compressionMethod = buffer.readUInt16LE(offset + 10);
		const compressedSize = buffer.readUInt32LE(offset + 20);
		const fileNameLength = buffer.readUInt16LE(offset + 28);
		const extraLength = buffer.readUInt16LE(offset + 30);
		const commentLength = buffer.readUInt16LE(offset + 32);
		const localHeaderOffset = buffer.readUInt32LE(offset + 42);
		const fileName = buffer.toString('utf8', offset + 46, offset + 46 + fileNameLength);

		if (wanted.has(fileName)) {
			result[fileName] = readLocalEntry(buffer, localHeaderOffset, compressionMethod, compressedSize);
			wanted.delete(fileName);
		}

		offset += 46 + fileNameLength + extraLength + commentLength;
	}

	return result;
};

const readLocalEntry = (buffer, localHeaderOffset, compressionMethod, compressedSize) => {
	if (buffer.readUInt32LE(localHeaderOffset) !== LOCAL_SIG) {
		throw new Error('Local file header has an unexpected signature');
	}
	const fileNameLength = buffer.readUInt16LE(localHeaderOffset + 26);
	const extraLength = buffer.readUInt16LE(localHeaderOffset + 28);
	const dataStart = localHeaderOffset + 30 + fileNameLength + extraLength;
	const compressed = buffer.subarray(dataStart, dataStart + compressedSize);

	if (compressionMethod === 0) return compressed;
	if (compressionMethod === 8) return zlib.inflateRawSync(compressed);
	throw new Error(`Unsupported zip compression method: ${compressionMethod}`);
};

export default readZipEntries;
