// chessEngine.js — moteur d'échecs complet, sans dépendance externe.
// Représentation: board[row][col], row 0 = rangée 8 (haut, noirs), row 7 = rangée 1 (bas, blancs)
// col 0 = colonne a ... col 7 = colonne h
// Pièce: chaîne "wP","wN","wB","wR","wQ","wK","bP",... ou null

const FILES = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];

function squareToAlg(row, col) {
  return FILES[col] + (8 - row);
}
function algToSquare(alg) {
  const col = FILES.indexOf(alg[0]);
  const row = 8 - parseInt(alg[1], 10);
  return { row, col };
}
function isOnBoard(row, col) {
  return row >= 0 && row < 8 && col >= 0 && col < 8;
}
function colorOf(piece) {
  return piece ? piece[0] : null;
}
function typeOf(piece) {
  return piece ? piece[1] : null;
}
function opponent(color) {
  return color === 'w' ? 'b' : 'w';
}

function initialState() {
  const back = ['R', 'N', 'B', 'Q', 'K', 'B', 'N', 'R'];
  const board = new Array(8).fill(null).map(() => new Array(8).fill(null));
  for (let c = 0; c < 8; c++) {
    board[0][c] = 'b' + back[c];
    board[1][c] = 'bP';
    board[6][c] = 'wP';
    board[7][c] = 'w' + back[c];
  }
  return {
    board,
    turn: 'w',
    castling: { wK: true, wQ: true, bK: true, bQ: true },
    enPassant: null, // {row,col} square that can be captured onto
    halfmoveClock: 0,
    fullmoveNumber: 1,
    lastMove: null,
    history: [],
  };
}

function cloneState(state) {
  return {
    board: state.board.map((r) => r.slice()),
    turn: state.turn,
    castling: { ...state.castling },
    enPassant: state.enPassant ? { ...state.enPassant } : null,
    halfmoveClock: state.halfmoveClock,
    fullmoveNumber: state.fullmoveNumber,
    lastMove: state.lastMove,
    history: state.history.slice(),
  };
}

function findKing(state, color) {
  for (let r = 0; r < 8; r++)
    for (let c = 0; c < 8; c++)
      if (state.board[r][c] === color + 'K') return { row: r, col: c };
  return null;
}

// Est-ce que la case (row,col) est attaquée par une pièce de couleur byColor ?
function isSquareAttacked(state, row, col, byColor) {
  const board = state.board;
  // Pions
  const pawnDir = byColor === 'w' ? 1 : -1; // un pion blanc en (row+1,col±1) attaque (row,col)
  for (const dc of [-1, 1]) {
    const r = row + pawnDir;
    const c = col + dc;
    if (isOnBoard(r, c) && board[r][c] === byColor + 'P') return true;
  }
  // Cavaliers
  const knightOffsets = [
    [-2, -1], [-2, 1], [-1, -2], [-1, 2],
    [1, -2], [1, 2], [2, -1], [2, 1],
  ];
  for (const [dr, dc] of knightOffsets) {
    const r = row + dr, c = col + dc;
    if (isOnBoard(r, c) && board[r][c] === byColor + 'N') return true;
  }
  // Roi adverse (case adjacente)
  for (let dr = -1; dr <= 1; dr++)
    for (let dc = -1; dc <= 1; dc++) {
      if (dr === 0 && dc === 0) continue;
      const r = row + dr, c = col + dc;
      if (isOnBoard(r, c) && board[r][c] === byColor + 'K') return true;
    }
  // Lignes droites (tour/dame)
  const rookDirs = [[-1, 0], [1, 0], [0, -1], [0, 1]];
  for (const [dr, dc] of rookDirs) {
    let r = row + dr, c = col + dc;
    while (isOnBoard(r, c)) {
      const p = board[r][c];
      if (p) {
        if (colorOf(p) === byColor && (typeOf(p) === 'R' || typeOf(p) === 'Q')) return true;
        break;
      }
      r += dr; c += dc;
    }
  }
  // Diagonales (fou/dame)
  const bishopDirs = [[-1, -1], [-1, 1], [1, -1], [1, 1]];
  for (const [dr, dc] of bishopDirs) {
    let r = row + dr, c = col + dc;
    while (isOnBoard(r, c)) {
      const p = board[r][c];
      if (p) {
        if (colorOf(p) === byColor && (typeOf(p) === 'B' || typeOf(p) === 'Q')) return true;
        break;
      }
      r += dr; c += dc;
    }
  }
  return false;
}

function isInCheck(state, color) {
  const k = findKing(state, color);
  if (!k) return false;
  return isSquareAttacked(state, k.row, k.col, opponent(color));
}

// Génère les coups pseudo-légaux (sans vérifier l'échec au roi) pour la pièce en (row,col)
function pseudoMoves(state, row, col) {
  const board = state.board;
  const piece = board[row][col];
  if (!piece) return [];
  const color = colorOf(piece);
  const type = typeOf(piece);
  const moves = [];

  const addMove = (r, c, extra = {}) => {
    if (!isOnBoard(r, c)) return;
    const target = board[r][c];
    if (target && colorOf(target) === color) return;
    moves.push({ from: { row, col }, to: { row: r, col: c }, capture: !!target, ...extra });
  };

  if (type === 'P') {
    const dir = color === 'w' ? -1 : 1;
    const startRow = color === 'w' ? 6 : 1;
    const promoRow = color === 'w' ? 0 : 7;
    // avance simple
    if (isOnBoard(row + dir, col) && !board[row + dir][col]) {
      if (row + dir === promoRow) {
        for (const promo of ['Q', 'R', 'B', 'N'])
          moves.push({ from: { row, col }, to: { row: row + dir, col }, capture: false, promotion: promo });
      } else {
        moves.push({ from: { row, col }, to: { row: row + dir, col }, capture: false });
        // avance double
        if (row === startRow && !board[row + 2 * dir][col]) {
          moves.push({ from: { row, col }, to: { row: row + 2 * dir, col }, capture: false, double: true });
        }
      }
    }
    // captures diagonales
    for (const dc of [-1, 1]) {
      const r = row + dir, c = col + dc;
      if (!isOnBoard(r, c)) continue;
      const target = board[r][c];
      if (target && colorOf(target) !== color) {
        if (r === promoRow) {
          for (const promo of ['Q', 'R', 'B', 'N'])
            moves.push({ from: { row, col }, to: { row: r, col: c }, capture: true, promotion: promo });
        } else {
          moves.push({ from: { row, col }, to: { row: r, col: c }, capture: true });
        }
      } else if (state.enPassant && state.enPassant.row === r && state.enPassant.col === c) {
        moves.push({ from: { row, col }, to: { row: r, col: c }, capture: true, enPassant: true });
      }
    }
  } else if (type === 'N') {
    const offsets = [
      [-2, -1], [-2, 1], [-1, -2], [-1, 2],
      [1, -2], [1, 2], [2, -1], [2, 1],
    ];
    for (const [dr, dc] of offsets) addMove(row + dr, col + dc);
  } else if (type === 'B' || type === 'R' || type === 'Q') {
    const dirs = [];
    if (type !== 'R') dirs.push([-1, -1], [-1, 1], [1, -1], [1, 1]);
    if (type !== 'B') dirs.push([-1, 0], [1, 0], [0, -1], [0, 1]);
    for (const [dr, dc] of dirs) {
      let r = row + dr, c = col + dc;
      while (isOnBoard(r, c)) {
        const target = board[r][c];
        if (target) {
          if (colorOf(target) !== color) moves.push({ from: { row, col }, to: { row: r, col: c }, capture: true });
          break;
        }
        moves.push({ from: { row, col }, to: { row: r, col: c }, capture: false });
        r += dr; c += dc;
      }
    }
  } else if (type === 'K') {
    for (let dr = -1; dr <= 1; dr++)
      for (let dc = -1; dc <= 1; dc++) {
        if (dr === 0 && dc === 0) continue;
        addMove(row + dr, col + dc);
      }
    // roque
    const homeRow = color === 'w' ? 7 : 0;
    if (row === homeRow && col === 4 && !isInCheck(state, color)) {
      const rightK = color === 'w' ? state.castling.wK : state.castling.bK;
      const rightQ = color === 'w' ? state.castling.wQ : state.castling.bQ;
      if (rightK && !board[homeRow][5] && !board[homeRow][6] &&
          board[homeRow][7] === color + 'R' &&
          !isSquareAttacked(state, homeRow, 5, opponent(color)) &&
          !isSquareAttacked(state, homeRow, 6, opponent(color))) {
        moves.push({ from: { row, col }, to: { row: homeRow, col: 6 }, capture: false, castle: 'K' });
      }
      if (rightQ && !board[homeRow][1] && !board[homeRow][2] && !board[homeRow][3] &&
          board[homeRow][0] === color + 'R' &&
          !isSquareAttacked(state, homeRow, 3, opponent(color)) &&
          !isSquareAttacked(state, homeRow, 2, opponent(color))) {
        moves.push({ from: { row, col }, to: { row: homeRow, col: 2 }, capture: false, castle: 'Q' });
      }
    }
  }
  return moves;
}

// Applique un coup (déjà supposé légal) et renvoie un nouvel état
function applyMove(state, move) {
  const s = cloneState(state);
  const board = s.board;
  const piece = board[move.from.row][move.from.col];
  const color = colorOf(piece);
  const type = typeOf(piece);
  let captured = board[move.to.row][move.to.col];

  // en passant : la pièce capturée n'est pas sur la case d'arrivée
  if (move.enPassant) {
    const capRow = move.from.row;
    const capCol = move.to.col;
    captured = board[capRow][capCol];
    board[capRow][capCol] = null;
  }

  board[move.to.row][move.to.col] = move.promotion ? color + move.promotion : piece;
  board[move.from.row][move.from.col] = null;

  // roque : déplacer aussi la tour
  if (move.castle === 'K') {
    const homeRow = move.from.row;
    board[homeRow][5] = board[homeRow][7];
    board[homeRow][7] = null;
  } else if (move.castle === 'Q') {
    const homeRow = move.from.row;
    board[homeRow][3] = board[homeRow][0];
    board[homeRow][0] = null;
  }

  // droits de roque
  if (type === 'K') {
    if (color === 'w') { s.castling.wK = false; s.castling.wQ = false; }
    else { s.castling.bK = false; s.castling.bQ = false; }
  }
  const clearRookRight = (row, col) => {
    if (row === 7 && col === 0) s.castling.wQ = false;
    if (row === 7 && col === 7) s.castling.wK = false;
    if (row === 0 && col === 0) s.castling.bQ = false;
    if (row === 0 && col === 7) s.castling.bK = false;
  };
  clearRookRight(move.from.row, move.from.col);
  clearRookRight(move.to.row, move.to.col);

  // en passant : nouvelle cible ou remise à zéro
  if (move.double) {
    s.enPassant = { row: (move.from.row + move.to.row) / 2, col: move.from.col };
  } else {
    s.enPassant = null;
  }

  // horloge des 50 coups
  if (type === 'P' || captured) s.halfmoveClock = 0;
  else s.halfmoveClock += 1;

  if (color === 'b') s.fullmoveNumber += 1;
  s.turn = opponent(color);
  s.lastMove = { from: move.from, to: move.to, piece, captured: captured || null, promotion: move.promotion || null };
  s.history.push(s.lastMove);
  return s;
}

// Coups légaux d'une case (filtre les coups qui laissent son propre roi en échec)
function getLegalMoves(state, row, col) {
  const piece = state.board[row][col];
  if (!piece || colorOf(piece) !== state.turn) return [];
  const color = colorOf(piece);
  const pseudo = pseudoMoves(state, row, col);
  const legal = [];
  for (const m of pseudo) {
    const next = applyMove(state, m);
    if (!isInCheck(next, color)) legal.push(m);
  }
  return legal;
}

// Tous les coups légaux d'une couleur
function getAllLegalMoves(state, color) {
  const all = [];
  for (let r = 0; r < 8; r++)
    for (let c = 0; c < 8; c++) {
      const p = state.board[r][c];
      if (p && colorOf(p) === color) {
        all.push(...getLegalMoves(state, r, c));
      }
    }
  return all;
}

function hasInsufficientMaterial(state) {
  const pieces = [];
  for (let r = 0; r < 8; r++)
    for (let c = 0; c < 8; c++) {
      const p = state.board[r][c];
      if (p && typeOf(p) !== 'K') pieces.push(p);
    }
  if (pieces.length === 0) return true;
  if (pieces.length === 1 && (typeOf(pieces[0]) === 'N' || typeOf(pieces[0]) === 'B')) return true;
  if (pieces.length === 2 && pieces.every((p) => typeOf(p) === 'B')) {
    // deux fous de couleurs de cases différentes -> pas nul automatiquement; on simplifie: considère nul
    return true;
  }
  return false;
}

// Statut de la partie APRÈS un coup (state.turn = joueur qui doit jouer maintenant)
function getGameStatus(state) {
  const color = state.turn;
  const moves = getAllLegalMoves(state, color);
  const inCheck = isInCheck(state, color);
  if (moves.length === 0) {
    if (inCheck) return { status: 'checkmate', winner: opponent(color) };
    return { status: 'stalemate' };
  }
  if (state.halfmoveClock >= 100) return { status: 'draw', reason: '50 coups' };
  if (hasInsufficientMaterial(state)) return { status: 'draw', reason: 'matériel insuffisant' };
  return { status: 'ongoing', inCheck };
}

function moveMatches(m, from, to, promotion) {
  return (
    m.from.row === from.row && m.from.col === from.col &&
    m.to.row === to.row && m.to.col === to.col &&
    (!m.promotion || m.promotion === (promotion || 'Q'))
  );
}

// Tente de jouer un coup depuis des coordonnées brutes ; renvoie {state, status} ou null si illégal
function tryMove(state, from, to, promotion) {
  const legal = getLegalMoves(state, from.row, from.col);
  const match = legal.find((m) => moveMatches(m, from, to, promotion));
  if (!match) return null;
  const next = applyMove(state, match);
  const status = getGameStatus(next);
  return { state: next, status, move: next.lastMove };
}

module.exports = {
  initialState,
  cloneState,
  squareToAlg,
  algToSquare,
  isOnBoard,
  colorOf,
  typeOf,
  opponent,
  isInCheck,
  isSquareAttacked,
  getLegalMoves,
  getAllLegalMoves,
  getGameStatus,
  applyMove,
  tryMove,
  findKing,
};