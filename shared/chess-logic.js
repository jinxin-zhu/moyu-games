// ==================== 象棋逻辑（服务端和客户端共享） ====================

const ChessLogic = {
  COLS: 9,
  ROWS: 10,

  // 棋子名称映射
  PIECE_NAMES: {
    'r_king': '帅', 'r_advisor': '仕', 'r_elephant': '相',
    'r_horse': '马', 'r_chariot': '车', 'r_cannon': '炮', 'r_soldier': '兵',
    'b_king': '将', 'b_advisor': '士', 'b_elephant': '象',
    'b_horse': '馬', 'b_chariot': '車', 'b_cannon': '砲', 'b_soldier': '卒'
  },

  // 获取棋子颜色: 'red' | 'black' | null
  getPieceColor(piece) {
    if (!piece) return null;
    return piece.startsWith('r_') ? 'red' : 'black';
  },

  // 获取棋子类型
  getPieceType(piece) {
    if (!piece) return null;
    return piece.split('_')[1];
  },

  // 创建初始棋盘 (10行 x 9列)
  createBoard() {
    const board = Array.from({ length: 10 }, () => Array(9).fill(null));
    // 黑方 (上方, row 0-4)
    board[0][0] = 'b_chariot'; board[0][1] = 'b_horse'; board[0][2] = 'b_elephant';
    board[0][3] = 'b_advisor';  board[0][4] = 'b_king';   board[0][5] = 'b_advisor';
    board[0][6] = 'b_elephant'; board[0][7] = 'b_horse';  board[0][8] = 'b_chariot';
    board[2][1] = 'b_cannon';   board[2][7] = 'b_cannon';
    board[3][0] = 'b_soldier';  board[3][2] = 'b_soldier'; board[3][4] = 'b_soldier';
    board[3][6] = 'b_soldier';  board[3][8] = 'b_soldier';
    // 红方 (下方, row 5-9)
    board[9][0] = 'r_chariot';  board[9][1] = 'r_horse';  board[9][2] = 'r_elephant';
    board[9][3] = 'r_advisor';  board[9][4] = 'r_king';   board[9][5] = 'r_advisor';
    board[9][6] = 'r_elephant'; board[9][7] = 'r_horse';  board[9][8] = 'r_chariot';
    board[7][1] = 'r_cannon';   board[7][7] = 'r_cannon';
    board[6][0] = 'r_soldier';  board[6][2] = 'r_soldier'; board[6][4] = 'r_soldier';
    board[6][6] = 'r_soldier';  board[6][8] = 'r_soldier';
    return board;
  },

  // 判断走子是否合法（不检查送将）
  isValidMove(board, fromRow, fromCol, toRow, toCol, color) {
    if (fromRow === toRow && fromCol === toCol) return false;
    const piece = board[fromRow][fromCol];
    if (!piece) return false;
    if (this.getPieceColor(piece) !== color) return false;
    const target = board[toRow][toCol];
    if (target && this.getPieceColor(target) === color) return false;
    if (toRow < 0 || toRow >= this.ROWS || toCol < 0 || toCol >= this.COLS) return false;

    const type = this.getPieceType(piece);
    switch (type) {
      case 'king':     return this._isValidKingMove(board, fromRow, fromCol, toRow, toCol);
      case 'advisor':  return this._isValidAdvisorMove(board, fromRow, fromCol, toRow, toCol);
      case 'elephant': return this._isValidElephantMove(board, fromRow, fromCol, toRow, toCol, color);
      case 'horse':    return this._isValidHorseMove(board, fromRow, fromCol, toRow, toCol);
      case 'chariot':  return this._isValidChariotMove(board, fromRow, fromCol, toRow, toCol);
      case 'cannon':   return this._isValidCannonMove(board, fromRow, fromCol, toRow, toCol);
      case 'soldier':  return this._isValidSoldierMove(fromRow, fromCol, toRow, toCol, color);
      default: return false;
    }
  },

  // 帅/将：九宫内一步直线
  _isValidKingMove(board, fr, fc, tr, tc) {
    const dr = tr - fr, dc = tc - fc;
    if (Math.abs(dr) + Math.abs(dc) !== 1) return false;
    if (tc < 3 || tc > 5) return false;
    if (tr < 0 || tr > 2) {
      if (tr < 7 || tr > 9) return false;
    }
    return true;
  },

  // 仕/士：九宫内一步斜线
  _isValidAdvisorMove(board, fr, fc, tr, tc) {
    if (Math.abs(tr - fr) !== 1 || Math.abs(tc - fc) !== 1) return false;
    if (tc < 3 || tc > 5) return false;
    if (tr < 0 || tr > 2) {
      if (tr < 7 || tr > 9) return false;
    }
    return true;
  },

  // 相/象：走"田"字对角，不能过河，需检查蹩脚
  _isValidElephantMove(board, fr, fc, tr, tc, color) {
    const dr = tr - fr, dc = tc - fc;
    if (Math.abs(dr) !== 2 || Math.abs(dc) !== 2) return false;
    const blockR = fr + dr / 2, blockC = fc + dc / 2;
    if (board[blockR][blockC]) return false;
    if (color === 'red' && tr < 5) return false;
    if (color === 'black' && tr > 4) return false;
    return true;
  },

  // 马：走"日"字，检查蹩脚
  _isValidHorseMove(board, fr, fc, tr, tc) {
    const dr = tr - fr, dc = tc - fc;
    const adr = Math.abs(dr), adc = Math.abs(dc);
    if (!((adr === 2 && adc === 1) || (adr === 1 && adc === 2))) return false;
    if (adr === 2) {
      if (board[fr + dr / 2][fc]) return false;
    } else {
      if (board[fr][fc + dc / 2]) return false;
    }
    return true;
  },

  // 车：直线任意距离，不能跳子
  _isValidChariotMove(board, fr, fc, tr, tc) {
    if (fr !== tr && fc !== tc) return false;
    return this._countBetween(board, fr, fc, tr, tc) === 0;
  },

  // 炮：直线移动，吃子需翻山（中间恰好一个棋子）
  _isValidCannonMove(board, fr, fc, tr, tc) {
    if (fr !== tr && fc !== tc) return false;
    const between = this._countBetween(board, fr, fc, tr, tc);
    const target = board[tr][tc];
    if (target) return between === 1;
    return between === 0;
  },

  // 兵/卒：前进一步，过河后可左右一步
  _isValidSoldierMove(fr, fc, tr, tc, color) {
    const dr = tr - fr, dc = tc - fc;
    if (Math.abs(dr) + Math.abs(dc) !== 1) return false;
    if (color === 'red') {
      if (dr > 0) return false;
      if (fr <= 4 && dc !== 0) return false;
    } else {
      if (dr < 0) return false;
      if (fr >= 5 && dc !== 0) return false;
    }
    return true;
  },

  // 统计两点之间（不含端点）的棋子数
  _countBetween(board, fr, fc, tr, tc) {
    let count = 0;
    if (fr === tr) {
      const min = Math.min(fc, tc), max = Math.max(fc, tc);
      for (let c = min + 1; c < max; c++) {
        if (board[fr][c]) count++;
      }
    } else if (fc === tc) {
      const min = Math.min(fr, tr), max = Math.max(fr, tr);
      for (let r = min + 1; r < max; r++) {
        if (board[r][fc]) count++;
      }
    }
    return count;
  },

  // 找到指定颜色的将/帅位置
  findGeneral(board, color) {
    const prefix = color === 'red' ? 'r' : 'b';
    const target = prefix + '_king';
    for (let r = 0; r < this.ROWS; r++) {
      for (let c = 0; c < this.COLS; c++) {
        if (board[r][c] === target) return [r, c];
      }
    }
    return null;
  },

  // 检查某位置是否被对方攻击
  isSquareAttacked(board, row, col, byColor) {
    const dirs4 = [[0,1],[0,-1],[1,0],[-1,0]];
    // 直线攻击（车、将面对面）
    for (const [dr, dc] of dirs4) {
      let r = row + dr, c = col + dc;
      while (r >= 0 && r < this.ROWS && c >= 0 && c < this.COLS) {
        const p = board[r][c];
        if (p) {
          if (this.getPieceColor(p) === byColor) {
            const t = this.getPieceType(p);
            if (t === 'chariot') return true;
            if (t === 'king' && this._countBetween(board, row, col, r, c) === 0) return true;
          }
          break;
        }
        r += dr; c += dc;
      }
    }
    // 炮攻击
    for (const [dr, dc] of dirs4) {
      let jumped = false;
      let r = row + dr, c = col + dc;
      while (r >= 0 && r < this.ROWS && c >= 0 && c < this.COLS) {
        const p = board[r][c];
        if (!jumped) {
          if (p) jumped = true;
        } else {
          if (p) {
            if (this.getPieceColor(p) === byColor && this.getPieceType(p) === 'cannon') return true;
            break;
          }
        }
        r += dr; c += dc;
      }
    }
    // 马攻击
    const horseOffsets = [
      [-2,-1],[-2,1],[-1,-2],[-1,2],[1,-2],[1,2],[2,-1],[2,1]
    ];
    for (const [dr, dc] of horseOffsets) {
      const r = row + dr, c = col + dc;
      if (r >= 0 && r < this.ROWS && c >= 0 && c < this.COLS) {
        const p = board[r][c];
        if (p && this.getPieceColor(p) === byColor && this.getPieceType(p) === 'horse') {
          if (this._isValidHorseMove(board, r, c, row, col)) return true;
        }
      }
    }
    // 兵/卒攻击（检查能一步走到 target 位置的敌方兵卒）
    for (const [dr, dc] of [[0,1],[0,-1],[1,0],[-1,0]]) {
      const sr = row + dr, sc = col + dc;
      if (sr >= 0 && sr < this.ROWS && sc >= 0 && sc < this.COLS) {
        const p = board[sr][sc];
        if (p && this.getPieceColor(p) === byColor && this.getPieceType(p) === 'soldier') {
          if (this._isValidSoldierMove(sr, sc, row, col, byColor)) return true;
        }
      }
    }
    return false;
  },

  // 检查某颜色是否被将军
  isInCheck(board, color) {
    const generalPos = this.findGeneral(board, color);
    if (!generalPos) return true;
    const oppColor = color === 'red' ? 'black' : 'red';
    return this.isSquareAttacked(board, generalPos[0], generalPos[1], oppColor);
  },

  // 尝试走子并检查是否送将
  wouldBeInCheck(board, fr, fc, tr, tc, color) {
    const newBoard = board.map(row => [...row]);
    newBoard[tr][tc] = newBoard[fr][fc];
    newBoard[fr][fc] = null;
    return this.isInCheck(newBoard, color);
  },

  // 获取合法走法（过滤送将）
  getValidMoves(board, row, col, color) {
    const moves = [];
    for (let r = 0; r < this.ROWS; r++) {
      for (let c = 0; c < this.COLS; c++) {
        if (this.isValidMove(board, row, col, r, c, color) &&
            !this.wouldBeInCheck(board, row, col, r, c, color)) {
          moves.push([r, c]);
        }
      }
    }
    return moves;
  },

  // 检查是否将杀（无合法走法）
  isCheckmate(board, color) {
    if (!this.isInCheck(board, color)) return false;
    for (let r = 0; r < this.ROWS; r++) {
      for (let c = 0; c < this.COLS; c++) {
        const p = board[r][c];
        if (p && this.getPieceColor(p) === color) {
          if (this.getValidMoves(board, r, c, color).length > 0) return false;
        }
      }
    }
    return true;
  },

  // 检查是否有合法走法（用于判断困毙/平局）
  hasAnyValidMove(board, color) {
    for (let r = 0; r < this.ROWS; r++) {
      for (let c = 0; c < this.COLS; c++) {
        const p = board[r][c];
        if (p && this.getPieceColor(p) === color) {
          if (this.getValidMoves(board, r, c, color).length > 0) return true;
        }
      }
    }
    return false;
  }
};

// 兼容浏览器和Node.js
if (typeof module !== 'undefined' && module.exports) {
  module.exports = ChessLogic;
}
