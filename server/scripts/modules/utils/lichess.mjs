// shared utilities for fetching and interpreting the Lichess puzzle of the day
// source: https://lichess.org/api/puzzle/daily -- a public, unauthenticated endpoint that
// returns the puzzle position as a FEN alongside the game it was taken from
import { safeJson } from './fetch.mjs';

const DAILY_PUZZLE_URL = 'https://lichess.org/api/puzzle/daily';

// the puzzle payload carries a full FEN, so the PGN in the same response never has to be
// replayed; only the placement field and the side to move are needed to draw the board
const PIECE_GLYPHS = {
	k: '♚',
	q: '♛',
	r: '♜',
	b: '♝',
	n: '♞',
	p: '♟',
};

const FILES = 'abcdefgh';

// lichess writes themes in camelCase ("veryLong", "mateIn2"); split them into words so they
// read as prose on the display
const humanizeTheme = (theme) => theme
	.replace(/([a-z])([A-Z0-9])/g, '$1 $2')
	.replace(/^./, (first) => first.toUpperCase());

// expand a FEN placement field into 64 squares, index 0 = a8, index 63 = h1, matching the
// order FEN itself uses
const parsePlacement = (placement) => {
	const squares = [];
	placement.split('/').forEach((rank) => {
		rank.split('').forEach((character) => {
			if (character >= '1' && character <= '8') {
				squares.push(...new Array(Number(character)).fill(null));
				return;
			}
			squares.push({
				glyph: PIECE_GLYPHS[character.toLowerCase()],
				// FEN spells white pieces in upper case
				white: character === character.toUpperCase(),
			});
		});
	});
	return squares;
};

// algebraic square name for a FEN-order index, so the last move's from/to squares (given as
// UCI, e.g. "b1b5") can be matched against the board
const squareName = (index) => `${FILES[index % 8]}${8 - Math.floor(index / 8)}`;

// a UCI move is two concatenated square names; anything else (including a missing move on a
// puzzle drawn from the opening position) yields no highlight
const moveSquares = (uci) => {
	if (typeof uci !== 'string' || uci.length < 4) return [];
	return [uci.slice(0, 2), uci.slice(2, 4)];
};

// turn the daily-puzzle response into everything the display needs: the 64 squares in the
// order they are drawn, who moves, and the descriptive text beside the board
const parseDailyPuzzle = (payload) => {
	const fen = payload?.puzzle?.fen;
	if (typeof fen !== 'string') return null;

	const [placement, sideToMove] = fen.split(' ');
	if (!placement || !sideToMove) return null;

	const whiteToMove = sideToMove === 'w';
	const highlighted = moveSquares(payload?.puzzle?.lastMove);

	const squares = parsePlacement(placement).map((piece, index) => {
		const name = squareName(index);
		return {
			piece,
			name,
			// a8 is light; the file/rank parity alternates from there
			light: ((index % 8) + Math.floor(index / 8)) % 2 === 0,
			highlight: highlighted.includes(name),
		};
	});

	// draw the board from the moving side's point of view, the orientation a player would
	// actually be looking at while solving it
	if (!whiteToMove) squares.reverse();

	return {
		squares,
		whiteToMove,
		rating: payload?.puzzle?.rating,
		// two themes is all that fits beside a 240px board without wrapping past the ticker
		themes: (payload?.puzzle?.themes ?? []).slice(0, 2).map(humanizeTheme),
	};
};

const fetchDailyPuzzle = async (stillWaiting) => safeJson(DAILY_PUZZLE_URL, { retryCount: 2, stillWaiting });

export {
	fetchDailyPuzzle,
	parseDailyPuzzle,
};
