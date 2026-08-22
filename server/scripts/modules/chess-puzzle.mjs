// the Lichess puzzle of the day, drawn as a board position
import STATUS from './status.mjs';
import { fetchDailyPuzzle, parseDailyPuzzle } from './utils/lichess.mjs';
import WeatherDisplay from './weatherdisplay.mjs';
import { registerDisplay } from './navigation.mjs';

class ChessPuzzle extends WeatherDisplay {
	constructor(navId, elemId, defaultActive) {
		super(navId, elemId, 'Chess Puzzle', defaultActive);
		this.timing.totalScreens = 1;
	}

	async getData(weatherParameters, refresh) {
		if (!super.getData(weatherParameters, refresh)) return;

		const payload = await fetchDailyPuzzle(() => this.stillWaiting());
		const puzzle = parseDailyPuzzle(payload);

		if (!puzzle) {
			this.setStatus(STATUS.failed);
			return;
		}

		this.data = puzzle;

		this.getDataCallback();
		this.setStatus(STATUS.loaded);
		this.drawCanvas();
	}

	drawCanvas() {
		super.drawCanvas();
		if (!this.data) return;

		const squares = this.data.squares.map((square) => {
			const cell = this.fillTemplate('square', { glyph: square.piece?.glyph ?? '' });
			// the white-fill layer is drawn by CSS from this attribute (see _chess-puzzle.scss)
			cell.querySelector('.glyph').dataset.fill = square.piece?.fill ?? '';
			cell.classList.add(square.light ? 'light' : 'dark');
			if (square.highlight) cell.classList.add('last-move');
			if (square.piece) cell.classList.add(square.piece.white ? 'white-piece' : 'black-piece');
			return cell;
		});

		const board = this.elem.querySelector('.board');
		board.innerHTML = '';
		board.append(...squares);

		this.elem.querySelector('.to-move').innerHTML = this.data.whiteToMove ? 'White to Move' : 'Black to Move';
		// a puzzle with no rating is not something the endpoint returns today, but the label
		// would read "Rating undefined" if it ever did
		this.elem.querySelector('.rating').innerHTML = typeof this.data.rating === 'number' ? `Rating ${this.data.rating}` : '';
		this.elem.querySelector('.themes').innerHTML = this.data.themes.join('<br/>');

		this.finishDraw();
	}
}

registerDisplay(new ChessPuzzle(18, 'chess-puzzle', true));
