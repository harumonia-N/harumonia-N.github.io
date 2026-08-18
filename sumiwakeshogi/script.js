// すみわけ将棋の状態と、盤面を扱うための定数です。
const SIZE = 9;
const PLAYERS = ["sente", "gote"];
const PLAYER_NAME = { sente: "先手", gote: "後手" };
const PIECES = ["R", "B", "G", "S", "N", "L", "P"];
const PIECE_NAME = { R: "飛車", B: "角", G: "金", S: "銀", N: "桂馬", L: "香車", P: "歩兵" };
const INITIAL_HAND = { R: 1, B: 1, G: 1, S: 1, N: 1, L: 1, P: 2 };

let game;

// 新しい対局データを作る。盤面の各要素は { owner, type } または null。
const createGame = () => ({
  board: Array.from({ length: SIZE }, () => Array(SIZE).fill(null)),
  hands: Object.fromEntries(PLAYERS.map(player => [player, { ...INITIAL_HAND }])),
  penalties: { sente: 0, gote: 0 },
  turn: "sente",
  selected: "R",
  phase: "normal",
  finished: false,
  message: "駒を選んで、盤上の空きマスをクリックしてください。",
});

const opponentOf = player => player === "sente" ? "gote" : "sente";
const inside = (row, col) => row >= 0 && row < SIZE && col >= 0 && col < SIZE;
const forward = player => player === "sente" ? -1 : 1;
const allHandsEmpty = () => PLAYERS.every(player => PIECES.every(type => game.hands[player][type] === 0));

// 駒が一手で届く升を返す。盤外に出る手はここで除外する。
function stepTargets(row, col, type, owner) {
  const f = forward(owner);
  const offsets = {
    // 行方向は「前」を正として持ち、先手・後手ごとに f を掛ける。
    G: [[1, -1], [1, 0], [1, 1], [0, -1], [0, 1], [-1, 0]],
    S: [[1, -1], [1, 0], [1, 1], [-1, -1], [-1, 1]],
    N: [[2, -1], [2, 1]],
    P: [[1, 0]],
  };
  if (!offsets[type]) return [];
  return offsets[type]
    .map(([dr, dc]) => [row + dr * (type === "G" || type === "S" || type === "N" || type === "P" ? f : 1), col + dc])
    .filter(([r, c]) => inside(r, c));
}

// 飛車・角・香の利きは、最初にぶつかった駒のマスまでで止まる。
function slidingTargets(row, col, type, owner, board = game.board) {
  let directions = [];
  if (type === "R") directions = [[-1, 0], [1, 0], [0, -1], [0, 1]];
  if (type === "B") directions = [[-1, -1], [-1, 1], [1, -1], [1, 1]];
  if (type === "L") directions = [[forward(owner), 0]];
  const targets = [];
  directions.forEach(([dr, dc]) => {
    let r = row + dr;
    let c = col + dc;
    while (inside(r, c)) {
      targets.push([r, c]);
      if (board[r][c]) break;
      r += dr;
      c += dc;
    }
  });
  return targets;
}

function attacksFrom(row, col, piece, board = game.board) {
  return ["R", "B", "L"].includes(piece.type)
    ? slidingTargets(row, col, piece.type, piece.owner, board)
    : stepTargets(row, col, piece.type, piece.owner);
}

// 候補升が盤上の既存のどの駒からも利かれているか調べる。
function squareIsAttacked(row, col, board = game.board) {
  return board.some((line, r) => line.some((piece, c) => piece && attacksFrom(r, c, piece, board).some(([tr, tc]) => tr === row && tc === col)));
}

function isDeadEnd(row, type, player) {
  if (player === "sente") return (type === "P" || type === "L") ? row === 0 : type === "N" && row <= 1;
  return (type === "P" || type === "L") ? row === 8 : type === "N" && row >= 7;
}

function isNifu(col, player) {
  return game.board.some(line => line[col]?.owner === player && line[col]?.type === "P");
}

// ドロップ後、その駒が既存の駒へ利いてしまうか。候補升そのものは空なので除く。
function placedPieceAttacksAny(row, col, type, player) {
  const virtualBoard = game.board.map(line => [...line]);
  virtualBoard[row][col] = { owner: player, type };
  return attacksFrom(row, col, virtualBoard[row][col], virtualBoard)
    .some(([r, c]) => r !== row || c !== col ? Boolean(game.board[r][c]) : false);
}

// 配置不可の理由を一つだけ返す。null は合法手。
function invalidReason(row, col, type, player, sudden = game.phase === "sudden") {
  if (!inside(row, col)) return "盤外です";
  if (game.board[row][col]) return "すでに駒が置かれています";
  if (!sudden && game.hands[player][type] <= 0) return "その駒は残っていません";
  if (type === "P" && isNifu(col, player)) return "二歩です";
  if (isDeadEnd(row, type, player)) return "行き所のない駒です";
  if (squareIsAttacked(row, col)) return "そのマスは他の駒の利きです";
  if (placedPieceAttacksAny(row, col, type, player)) return "置く駒の利きに他の駒があります";
  return null;
}

function legalMoves(player, sudden = game.phase === "sudden") {
  const types = sudden ? ["P"] : PIECES.filter(type => game.hands[player][type] > 0);
  const moves = [];
  for (const type of types) {
    for (let row = 0; row < SIZE; row++) {
      for (let col = 0; col < SIZE; col++) {
        if (!invalidReason(row, col, type, player, sudden)) moves.push({ row, col, type });
      }
    }
  }
  return moves;
}

function renderPlayerPanel(player) {
  const panel = document.getElementById(`${player}-panel`);
  const isCurrent = !game.finished && game.turn === player;
  const dots = "●".repeat(game.penalties[player]) + "○".repeat(3 - game.penalties[player]);
  panel.innerHTML = `
    <h2>${PLAYER_NAME[player]}</h2>
    <p class="sub">${player === "sente" ? "盤面の上へ進む" : "盤面の下へ進む"}</p>
    <div class="penalty"><span>ペナルティ</span><span class="penalty-dots" aria-label="${game.penalties[player]}回">${dots}</span></div>
    <div class="piece-list" aria-label="${PLAYER_NAME[player]}の持ち駒">
      ${PIECES.map(type => {
        const count = game.hands[player][type];
        const selected = isCurrent && game.selected === type && game.phase === "normal";
        return `<button class="piece-choice ${selected ? "selected" : ""}" type="button" data-player="${player}" data-piece="${type}" ${game.finished || !isCurrent || game.phase === "sudden" ? "disabled" : ""}>
          <span class="mini-piece ${player}">${PIECE_NAME[type]}</span><span>${PIECE_NAME[type]}</span><span class="piece-count">×${count}</span>
        </button>`;
      }).join("")}
    </div>`;
  panel.querySelectorAll(".piece-choice").forEach(button => button.addEventListener("click", () => {
    game.selected = button.dataset.piece;
    game.message = `${PIECE_NAME[game.selected]}を選択しました。`;
    render();
  }));
}

function renderBoard() {
  const board = document.getElementById("board");
  const legal = game.finished ? legalMoves(game.turn) : [];
  const legalKeys = new Set(legal.map(move => `${move.row},${move.col}`));
  board.innerHTML = "";
  game.board.forEach((line, row) => line.forEach((piece, col) => {
    const cell = document.createElement("button");
    cell.type = "button";
    cell.className = `square ${game.finished && legalKeys.has(`${row},${col}`) ? "legal" : ""}`;
    cell.disabled = game.finished;
    cell.setAttribute("role", "gridcell");
    cell.setAttribute("aria-label", `${9 - row}段${col + 1}筋${piece ? PLAYER_NAME[piece.owner] + PIECE_NAME[piece.type] : "空きマス"}`);
    if (piece) cell.innerHTML = `<span class="piece ${piece.owner}">${PIECE_NAME[piece.type]}</span>`;
    cell.addEventListener("click", () => tryPlace(row, col));
    board.append(cell);
  }));
}

function render() {
  renderPlayerPanel("sente");
  renderPlayerPanel("gote");
  document.getElementById("phase-label").textContent = game.phase === "sudden" ? "サドンデス" : "通常戦";
  document.getElementById("turn-label").textContent = game.finished ? "対局終了" : `${PLAYER_NAME[game.turn]}の番`;
  document.getElementById("selected-label").textContent = game.phase === "sudden" ? "選択中：歩兵（無限）" : `選択中：${PIECE_NAME[game.selected]}`;
  document.getElementById("message").textContent = game.message;
  renderBoard();
}

function finish(message, alertMessage) {
  game.finished = true;
  game.message = message;
  render();
  window.setTimeout(() => alert(alertMessage), 30);
}

function addPenalty(player, reason) {
  game.penalties[player]++;
  if (game.penalties[player] >= 3) {
    finish(`${reason}。ペナルティが3回になりました。`, `${PLAYER_NAME[opponentOf(player)]}の勝ち！`);
  } else {
    game.message = `${reason}。ペナルティ ${game.penalties[player]} / 3`;
    render();
  }
}

// 通常戦の手番開始時、置ける手がないときの勝敗・引き分けを確定する。
function checkTurnAvailability() {
  if (game.phase === "sudden") {
    if (legalMoves(game.turn, true).length === 0) {
      finish(`${PLAYER_NAME[game.turn]}は合法な歩を置けません。`, `${PLAYER_NAME[opponentOf(game.turn)]}の勝ち！`);
    }
    return;
  }
  if (allHandsEmpty()) {
    const currentMoves = legalMoves(game.turn, true);
    const otherMoves = legalMoves(opponentOf(game.turn), true);
    if (currentMoves.length || otherMoves.length) {
      game.phase = "sudden";
      game.message = "歩兵は無限です。反則した方が負けになります。";
      render();
      window.setTimeout(() => alert("すごい！！！\nどちらも最後まで駒を置き切ったね！\n\nサドンデス開始！"), 30);
      return;
    }
    finish("両者とも置ける手がありません。", "すごい！！！\nどちらも健闘したね");
    return;
  }
  if (legalMoves(game.turn).length === 0) {
    const other = opponentOf(game.turn);
    game.message = `${PLAYER_NAME[game.turn]}は置けません。`;
    if (legalMoves(other).length === 0) {
      finish("両者とも置ける手がありません。", "すごい！！！\nどちらも健闘したね");
    } else {
      game.turn = other;
      finish(`${PLAYER_NAME[opponentOf(other)]}は合法手がありません。`, `${PLAYER_NAME[other]}の勝ち！`);
    }
  }
}

function tryPlace(row, col) {
  if (game.finished) return;
  const player = game.turn;
  const type = game.phase === "sudden" ? "P" : game.selected;
  const reason = invalidReason(row, col, type, player);
  if (reason) {
    if (game.phase === "sudden") finish(`${reason}。サドンデスの反則です。`, `${PLAYER_NAME[opponentOf(player)]}の勝ち！`);
    else addPenalty(player, reason);
    return;
  }
  game.board[row][col] = { owner: player, type };
  if (game.phase === "normal") game.hands[player][type]--;
  game.turn = opponentOf(player);
  game.message = `${PLAYER_NAME[player]}が${PIECE_NAME[type]}を置きました。`;
  render();
  checkTurnAvailability();
}

document.getElementById("reset-button").addEventListener("click", () => {
  game = createGame();
  render();
});

game = createGame();
render();
