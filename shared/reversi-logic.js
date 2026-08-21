// ==================== 黑白棋逻辑（服务端和客户端共享） ====================

const ReversiLogic = {
  SIZE: 8,
  EMPTY: 0,
  BLACK: 1,
  WHITE: 2,

  // 8个方向
  DIRS: [
    [-1, -1], [-1, 0], [-1, 1],
    [0, -1],           [0, 1],
    [1, -1],  [1, 0],  [1, 1]
  ],

  // 创建初始棋盘（8x8，中心4子交叉）
  createBoard() {
    const board = Array.from({ length: this.SIZE }, () => Array(this.SIZE).fill(this.EMPTY));
    const mid = this.SIZE / 2;
    board[mid - 1][mid - 1] = this.WHITE; // (3,3)
    board[mid - 1][mid] = this.BLACK;      // (3,4)
    board[mid][mid - 1] = this.BLACK;      // (4,3)
    board[mid][mid] = this.WHITE;          // (4,4)
    return board;
  },

  // 获取某方向上被翻转的棋子坐标
  _getFlipsInDir(board, row, col, dr, dc, player) {
    const opp = player === this.BLACK ? this.WHITE : this.BLACK;
    const flips = [];
    let r = row + dr, c = col + dc;
    while (r >= 0 && r < this.SIZE && c >= 0 && c < this.SIZE && board[r][c] === opp) {
      flips.push([r, c]);
      r += dr;
      c += dc;
    }
    // 必须以己方棋子结尾
    if (flips.length > 0 && r >= 0 && r < this.SIZE && c >= 0 && c < this.SIZE && board[r][c] === player) {
      return flips;
    }
    return [];
  },

  // 返回落子后需翻转的所有坐标，空数组=非法落子
  getFlipped(board, row, col, player) {
    if (row < 0 || row >= this.SIZE || col < 0 || col >= this.SIZE) return [];
    if (board[row][col] !== this.EMPTY) return [];

    const allFlips = [];
    for (const [dr, dc] of this.DIRS) {
      const flips = this._getFlipsInDir(board, row, col, dr, dc, player);
      allFlips.push(...flips);
    }
    return allFlips;
  },

  // 检查某位置是否为合法落子
  isValidMove(board, row, col, player) {
    return this.getFlipped(board, row, col, player).length > 0;
  },

  // 执行落子：返回新棋盘（不修改原棋盘）
  applyMove(board, row, col, player) {
    const flips = this.getFlipped(board, row, col, player);
    if (flips.length === 0) return null;

    const newBoard = board.map(r => [...r]);
    newBoard[row][col] = player;
    for (const [fr, fc] of flips) {
      newBoard[fr][fc] = player;
    }
    return newBoard;
  },

  // 获取某玩家所有合法落子位置
  getValidMoves(board, player) {
    const moves = [];
    for (let r = 0; r < this.SIZE; r++) {
      for (let c = 0; c < this.SIZE; c++) {
        if (this.isValidMove(board, r, c, player)) {
          moves.push([r, c]);
        }
      }
    }
    return moves;
  },

  // 检查游戏是否结束（双方都无合法走法）
  isGameOver(board) {
    return this.getValidMoves(board, this.BLACK).length === 0 &&
           this.getValidMoves(board, this.WHITE).length === 0;
  },

  // 统计棋子数
  countPieces(board) {
    let black = 0, white = 0;
    for (let r = 0; r < this.SIZE; r++) {
      for (let c = 0; c < this.SIZE; c++) {
        if (board[r][c] === this.BLACK) black++;
        else if (board[r][c] === this.WHITE) white++;
      }
    }
    return { black, white };
  },

  // 获取胜者：1=黑胜 2=白胜 0=平局 null=未结束
  getWinner(board) {
    if (!this.isGameOver(board)) return null;
    const { black, white } = this.countPieces(board);
    if (black > white) return this.BLACK;
    if (white > black) return this.WHITE;
    return 0;
  }
};

// 兼容浏览器和Node.js
if (typeof module !== 'undefined' && module.exports) {
  module.exports = ReversiLogic;
}
