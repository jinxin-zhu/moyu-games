// ==================== 客户端主逻辑 ====================

(function() {
  const socket = io();

  // DOM 元素
  const $ = (sel) => document.querySelector(sel);
  const lobbyPage = $('#lobby-page');
  const gamePage = $('#game-page');
  const nicknameDisplay = $('#nickname-display');
  const roomListEl = $('#room-list');
  const canvas = $('#game-canvas');
  const ctx = canvas.getContext('2d');
  const toastEl = $('#toast');
  const turnIndicator = $('#turn-indicator');
  const gameResult = $('#game-result');
  const restartBtn = $('#restart-btn');
  const startGameBtn = $('#start-game-btn');
  const selfPlayLabel = $('#self-play-label');
  const selfPlayCheck = $('#self-play-check');
  const surrenderBtn = $('#surrender-btn');
  const undoBtn = $('#undo-btn');

  // 状态
  let mySocketId = null;
  let myName = '玩家' + Math.floor(Math.random() * 1000);
  let currentRoomId = null;
  let roomState = null;
  let toastTimer = null;

  // 五子棋常量
  const GOMOKU_SIZE = 15;
  const GOMOKU_CANVAS = 600;
  const GOMOKU_PADDING = 20;
  const GOMOKU_CELL = (GOMOKU_CANVAS - GOMOKU_PADDING * 2) / (GOMOKU_SIZE - 1);

  // 象棋常量
  const CHESS_COLS = 9;
  const CHESS_ROWS = 10;
  const CHESS_CELL = 60;
  const CHESS_PADDING = 30;
  const CHESS_CANVAS_W = CHESS_PADDING * 2 + (CHESS_COLS - 1) * CHESS_CELL; // 540
  const CHESS_CANVAS_H = CHESS_PADDING * 2 + (CHESS_ROWS - 1) * CHESS_CELL; // 600

  // 象棋交互状态
  let selectedPiece = null; // {row, col}
  let currentValidMoves = []; // [[r,c], ...]

  // 黑白棋常量
  const REVERSI_SIZE = 8;
  const REVERSI_CANVAS = 520;
  const REVERSI_PADDING = 20;
  const REVERSI_CELL = (REVERSI_CANVAS - REVERSI_PADDING * 2) / REVERSI_SIZE;

  // 初始化
  nicknameDisplay.textContent = myName;

  // ==================== Socket 事件 ====================

  socket.on('welcome', ({ socketId }) => {
    mySocketId = socketId;
  });

  socket.on('room-list', (rooms) => {
    renderRoomList(rooms);
  });

  socket.on('room-created', ({ roomId }) => {
    currentRoomId = roomId;
    showPage('game');
  });

  socket.on('room-state', (state) => {
    roomState = state;
    currentRoomId = state.roomId;
    // 切换游戏类型时重置canvas尺寸
    if (state.gameType === 'chess') {
      canvas.width = CHESS_CANVAS_W;
      canvas.height = CHESS_CANVAS_H;
    } else if (state.gameType === 'reversi') {
      canvas.width = REVERSI_CANVAS;
      canvas.height = REVERSI_CANVAS;
    } else {
      canvas.width = GOMOKU_CANVAS;
      canvas.height = GOMOKU_CANVAS;
    }
    // 如果不再是自己的回合，清除选择
    if (state.status === 'playing' && state.currentTurn !== mySocketId) {
      selectedPiece = null;
      currentValidMoves = [];
    }
    renderGamePage(state);
  });

  socket.on('error-msg', (msg) => {
    showToast(msg);
  });

  // 聊天消息
  socket.on('chat-message', ({ name, text, time, system }) => {
    if (system) {
      addSystemMessage(text);
    } else {
      addChatMessage(name, text, time);
    }
  });

  // 悔棋请求（对方视角）
  socket.on('undo-request', ({ requesterName }) => {
    $('#undo-request-text').textContent = `${requesterName} 请求悔棋，是否同意？`;
    $('#undo-request-modal').style.display = 'flex';
  });

  // 等待悔棋回应（请求方视角）
  socket.on('undo-wait', ({ targetName }) => {
    $('#undo-wait-text').textContent = `已向 ${targetName} 发送悔棋请求，等待回应...`;
    $('#undo-wait-modal').style.display = 'flex';
  });

  // 悔棋结果
  socket.on('undo-result', ({ accepted }) => {
    $('#undo-wait-modal').style.display = 'none';
    if (!accepted) showToast('对方拒绝了悔棋请求');
  });

  // ==================== 页面切换 ====================

  function showPage(page) {
    lobbyPage.classList.remove('active');
    gamePage.classList.remove('active');
    if (page === 'lobby') {
      lobbyPage.classList.add('active');
      gameResult.style.display = 'none';
      restartBtn.style.display = 'none';
      selectedPiece = null;
      currentValidMoves = [];
    } else {
      gamePage.classList.add('active');
    }
  }

  // ==================== 大厅渲染 ====================

  function renderRoomList(rooms) {
    if (rooms.length === 0) {
      roomListEl.innerHTML = '<div class="empty-tip">暂无房间，创建一个吧！</div>';
      return;
    }
    roomListEl.innerHTML = rooms.map(room => {
      const gameName = { gomoku: '五子棋', chess: '象棋', reversi: '黑白棋' }[room.gameType] || room.gameType;
      const statusText = { waiting: '等待中', playing: '对局中', finished: '已结束' }[room.status];
      const descHtml = room.description ? `<div class="room-card-desc">“${room.description}”</div>` : '';
      return `
        <div class="room-card" data-room-id="${room.id}">
          <div class="room-card-info">
            <h4>${gameName} - ${room.playerNames.join(' vs ') || '空房间'}</h4>
            <p>房间ID: ${room.id} | 参与者: ${room.playerCount}/2 | 观战: ${room.spectatorCount}</p>
            ${descHtml}
          </div>
          <div style="display:flex;align-items:center;gap:10px">
            <span class="room-status ${room.status}">${statusText}</span>
            <button class="btn btn-small btn-primary join-btn" data-room-id="${room.id}">加入</button>
          </div>
        </div>
      `;
    }).join('');

    roomListEl.querySelectorAll('.join-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const role = document.querySelector('input[name="role"]:checked').value;
        socket.emit('join-room', { roomId: btn.dataset.roomId, role });
      });
    });
  }

  // ==================== 游戏页面渲染 ====================

  function renderGamePage(state) {
    if (!currentRoomId) currentRoomId = state.roomId;
    showPage('game');

    // 房间信息
    $('#room-id-display').textContent = state.roomId;
    $('#game-type-display').textContent = { gomoku: '五子棋', chess: '象棋', reversi: '黑白棋' }[state.gameType] || state.gameType;
    const statusMap = { waiting: '等待玩家加入', playing: '对局中', finished: '已结束' };
    $('#game-status-display').textContent = statusMap[state.status] || state.status;

    // 房间简介
    const descDisplay = $('#room-desc-display');
    descDisplay.textContent = state.description || '暂无简介';
    // 只有参与者可以编辑简介
    const descEditBtn = $('#desc-edit-btn');
    descEditBtn.style.display = state.myRole === 'player' ? 'inline-block' : 'none';

    // 玩家列表
    const playersList = $('#players-list');
    if (state.gameType === 'chess') {
      playersList.innerHTML = state.players.map(p => {
        const colorClass = p.color === 1 ? 'red-piece' : 'black-piece';
        const colorName = p.color === 1 ? '红方' : '黑方';
        const isTurn = state.currentTurn === p.id && state.status === 'playing';
        const isMe = p.id === mySocketId;
        return `
          <div class="player-item">
            <span class="color-dot ${colorClass}"></span>
            <span>${p.name} (${colorName})${isMe ? ' [我]' : ''}</span>
            ${isTurn ? '<span class="turn-badge">思考中</span>' : ''}
          </div>
        `;
      }).join('');
    } else {
      // 五子棋和黑白棋都用黑/白
      playersList.innerHTML = state.players.map(p => {
        const colorClass = p.color === 1 ? 'black' : 'white';
        const colorName = p.color === 1 ? '黑棋' : '白棋';
        const isTurn = state.currentTurn === p.id && state.status === 'playing';
        const isMe = p.id === mySocketId;
        // 黑白棋显示当前子数
        let pieceInfo = '';
        if (state.gameType === 'reversi' && state.board) {
          const counts = ReversiLogic.countPieces(state.board);
          const myCount = p.color === 1 ? counts.black : counts.white;
          pieceInfo = ` [${myCount}子]`;
        }
        return `
          <div class="player-item">
            <span class="color-dot ${colorClass}"></span>
            <span>${p.name} (${colorName}${pieceInfo})${isMe ? ' [我]' : ''}</span>
            ${isTurn ? '<span class="turn-badge">思考中</span>' : ''}
          </div>
        `;
      }).join('');
    }

    // 观战列表
    $('#spectator-count').textContent = state.spectators.length;
    $('#spectators-list').innerHTML = state.spectators.map(s => {
      const isMe = s.id === mySocketId;
      return `<div class="spectator-item">👁 ${s.name}${isMe ? ' (我)' : ''}</div>`;
    }).join('');

    // 回合提示
    if (state.status === 'playing') {
      const currentPlayer = state.players.find(p => p.id === state.currentTurn);
      if (currentPlayer) {
        const isMe = currentPlayer.id === mySocketId;
        let text = isMe ? '轮到你了' : `${currentPlayer.name} 思考中...`;
        if (isMe && state.gameType === 'chess' && state.inCheck) {
          text = '⚠️ 你被将军了！请应将';
        }
        turnIndicator.textContent = text;
      }
    } else if (state.status === 'waiting') {
      if (state.selfPlay) {
        turnIndicator.textContent = '自对弈模式 - 点击「开始游戏」';
      } else if (state.players.length < 2) {
        turnIndicator.textContent = '等待对手加入...';
      } else {
        turnIndicator.textContent = '等待参与者开始游戏...';
      }
    } else {
      turnIndicator.textContent = '';
    }

    // 开始游戏按钮
    if (state.status === 'waiting' && state.myRole === 'player' && state.canStart) {
      startGameBtn.style.display = 'block';
    } else {
      startGameBtn.style.display = 'none';
    }

    // 投降和悔棋按钮
    if (state.status === 'playing' && state.myRole === 'player') {
      surrenderBtn.style.display = 'block';
      undoBtn.style.display = 'block';
    } else {
      surrenderBtn.style.display = 'none';
      undoBtn.style.display = 'none';
    }

    // 自对弈开关（仅等待中且只有1个参与者时显示）
    if (state.status === 'waiting' && state.myRole === 'player' && state.players.length === 1) {
      selfPlayLabel.style.display = 'flex';
      selfPlayCheck.checked = state.selfPlay;
    } else {
      selfPlayLabel.style.display = 'none';
    }

    // 自对弈模式下的回合提示
    if (state.selfPlay && state.status === 'playing' && state.myRole === 'player') {
      const currentColor = state.players.find(p => p.id === state.currentTurn);
      if (state.gameType === 'chess') {
        const colorText = currentColor && currentColor.color === 1 ? '红方' : '黑方';
        turnIndicator.textContent = `${colorText} 走棋`;
      } else {
        const colorText = currentColor && currentColor.color === 1 ? '黑棋' : '白棋';
        turnIndicator.textContent = `轮到 ${colorText}`;
      }
    }

    // 结果
    if (state.status === 'finished') {
      restartBtn.style.display = state.myRole === 'player' ? 'block' : 'none';
      gameResult.style.display = 'block';
      if (state.winner) {
        const winnerPlayer = state.players.find(p => p.id === state.winner);
        const isMeWinner = state.winner === mySocketId;
        if (state.myRole === 'spectator') {
          gameResult.innerHTML = `🏆 ${winnerPlayer ? winnerPlayer.name : '未知'} 获胜！<div class="result-sub">对局结束</div>`;
        } else if (isMeWinner) {
          gameResult.innerHTML = `🏆 你赢了！<div class="result-sub">恭喜获胜</div>`;
        } else {
          gameResult.innerHTML = `😔 你输了<div class="result-sub">${winnerPlayer ? winnerPlayer.name : '对手'} 获胜</div>`;
        }
      } else {
        const subText = state.gameType === 'reversi' ? '棋盘已满' : '棋盘已满';
        gameResult.innerHTML = `🤝 平局<div class="result-sub">${subText}</div>`;
      }
      // 黑白棋显示最终子数
      if (state.gameType === 'reversi' && state.board) {
        const counts = ReversiLogic.countPieces(state.board);
        gameResult.innerHTML += `<div class="result-sub" style="margin-top:8px">⚫ ${counts.black} : ${counts.white} ⚪</div>`;
      }
    } else {
      gameResult.style.display = 'none';
      restartBtn.style.display = 'none';
    }

    // 绘制棋盘
    drawBoard(state);
  }

  // ==================== 棋盘绘制调度 ====================

  function drawBoard(state) {
    if (state.gameType === 'chess') {
      drawChessBoard(state);
    } else if (state.gameType === 'reversi') {
      drawReversiBoard(state);
    } else {
      drawGomokuBoard(state);
    }
  }

  // ==================== 五子棋绘制 ====================

  function drawGomokuBoard(state) {
    const board = state.board;
    const S = GOMOKU_SIZE, P = GOMOKU_PADDING, C = GOMOKU_CELL, W = GOMOKU_CANVAS;

    ctx.fillStyle = '#d4a060';
    ctx.fillRect(0, 0, W, W);
    ctx.strokeStyle = '#333';
    ctx.lineWidth = 1;
    for (let i = 0; i < S; i++) {
      const pos = P + i * C;
      ctx.beginPath(); ctx.moveTo(P, pos); ctx.lineTo(W - P, pos); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(pos, P); ctx.lineTo(pos, W - P); ctx.stroke();
    }
    // 星位
    ctx.fillStyle = '#333';
    for (const r of [3, 7, 11]) {
      for (const c of [3, 7, 11]) {
        ctx.beginPath();
        ctx.arc(P + c * C, P + r * C, 4, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    // 棋子
    if (board) {
      for (let r = 0; r < S; r++) {
        for (let c = 0; c < S; c++) {
          if (board[r][c] !== 0) drawGomokuPiece(r, c, board[r][c]);
        }
      }
    }
  }

  function drawGomokuPiece(row, col, color) {
    const x = GOMOKU_PADDING + col * GOMOKU_CELL;
    const y = GOMOKU_PADDING + row * GOMOKU_CELL;
    const radius = GOMOKU_CELL * 0.42;
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    if (color === 1) {
      const g = ctx.createRadialGradient(x - 3, y - 3, 2, x, y, radius);
      g.addColorStop(0, '#555'); g.addColorStop(1, '#111');
      ctx.fillStyle = g;
    } else {
      const g = ctx.createRadialGradient(x - 3, y - 3, 2, x, y, radius);
      g.addColorStop(0, '#fff'); g.addColorStop(1, '#ccc');
      ctx.fillStyle = g;
    }
    ctx.fill();
    ctx.strokeStyle = color === 1 ? '#000' : '#999';
    ctx.lineWidth = 1;
    ctx.stroke();
  }

  // ==================== 象棋绘制 ====================

  function drawChessBoard(state) {
    const W = CHESS_CANVAS_W, H = CHESS_CANVAS_H, P = CHESS_PADDING, C = CHESS_CELL;
    const boardW = (CHESS_COLS - 1) * C;
    const boardH = (CHESS_ROWS - 1) * C;

    // 背景
    ctx.fillStyle = '#e8c87a';
    ctx.fillRect(0, 0, W, H);

    ctx.strokeStyle = '#333';
    ctx.lineWidth = 1;

    // 横线
    for (let r = 0; r < CHESS_ROWS; r++) {
      const y = P + r * C;
      ctx.beginPath(); ctx.moveTo(P, y); ctx.lineTo(P + boardW, y); ctx.stroke();
    }
    // 竖线（注意上下半部分分开画，中间河界断开）
    for (let c = 0; c < CHESS_COLS; c++) {
      if (c === 0 || c === CHESS_COLS - 1) {
        // 边线贯通
        ctx.beginPath(); ctx.moveTo(P + c * C, P); ctx.lineTo(P + c * C, P + boardH); ctx.stroke();
      } else {
        // 上半部分
        ctx.beginPath(); ctx.moveTo(P + c * C, P); ctx.lineTo(P + c * C, P + 4 * C); ctx.stroke();
        // 下半部分
        ctx.beginPath(); ctx.moveTo(P + c * C, P + 5 * C); ctx.lineTo(P + c * C, P + boardH); ctx.stroke();
      }
    }

    // 九宫格斜线
    // 上方 (0,3)-(2,5)
    ctx.beginPath(); ctx.moveTo(P + 3 * C, P); ctx.lineTo(P + 5 * C, P + 2 * C); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(P + 5 * C, P); ctx.lineTo(P + 3 * C, P + 2 * C); ctx.stroke();
    // 下方 (7,3)-(9,5)
    ctx.beginPath(); ctx.moveTo(P + 3 * C, P + 7 * C); ctx.lineTo(P + 5 * C, P + 9 * C); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(P + 5 * C, P + 7 * C); ctx.lineTo(P + 3 * C, P + 9 * C); ctx.stroke();

    // 星位标记
    const chessStars = [[2, 1], [2, 7], [3, 0], [3, 2], [3, 4], [3, 6], [3, 8], [6, 0], [6, 2], [6, 4], [6, 6], [6, 8], [7, 1], [7, 7]];
    for (const [r, c] of chessStars) {
      drawChessStar(P + c * C, P + r * C, c);
    }

    // 楚河汉界
    ctx.fillStyle = '#333';
    ctx.font = 'bold 22px "KaiTi", "STKaiti", "SimSun", serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const riverY = P + 4.5 * C;
    ctx.fillText('楚 河', P + 2 * C, riverY);
    ctx.fillText('汉 界', P + 6 * C, riverY);

    // 绘制棋子
    if (state.board) {
      for (let r = 0; r < CHESS_ROWS; r++) {
        for (let c = 0; c < CHESS_COLS; c++) {
          if (state.board[r][c]) {
            drawChessPiece(r, c, state.board[r][c]);
          }
        }
      }
    }

    // 上一步移动高亮
    if (state.lastMove) {
      const { from, to } = state.lastMove;
      drawChessHighlight(from[0], from[1], 'rgba(255, 200, 0, 0.4)');
      drawChessHighlight(to[0], to[1], 'rgba(255, 200, 0, 0.5)');
    }

    // 选中棋子高亮
    if (selectedPiece) {
      drawChessHighlight(selectedPiece.row, selectedPiece.col, 'rgba(0, 255, 100, 0.4)');
      // 绘制可走位置标记
      for (const [r, c] of currentValidMoves) {
        const x = P + c * C;
        const y = P + r * C;
        const targetPiece = state.board && state.board[r][c];
        if (targetPiece) {
          // 可吃子位置：红色圆环
          ctx.beginPath();
          ctx.arc(x, y, C * 0.42, 0, Math.PI * 2);
          ctx.strokeStyle = 'rgba(255, 50, 50, 0.7)';
          ctx.lineWidth = 3;
          ctx.stroke();
        } else {
          // 可移动位置：绿色小圆点
          ctx.beginPath();
          ctx.arc(x, y, 8, 0, Math.PI * 2);
          ctx.fillStyle = 'rgba(0, 200, 100, 0.6)';
          ctx.fill();
        }
      }
    }
  }

  function drawChessStar(x, y, col) {
    const size = 5;
    const gap = 3;
    ctx.strokeStyle = '#333';
    ctx.lineWidth = 1;
    // 画四个角的小标记
    const dirs = [];
    if (col > 0) dirs.push([-1, -1], [-1, 1]);
    if (col < 8) dirs.push([1, -1], [1, 1]);
    for (const [dx, dy] of dirs) {
      const sx = x + dx * gap, sy = y + dy * gap;
      ctx.beginPath();
      ctx.moveTo(sx, sy);
      ctx.lineTo(sx + dx * size, sy);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(sx, sy);
      ctx.lineTo(sx, sy + dy * size);
      ctx.stroke();
    }
  }

  function drawChessPiece(row, col, piece) {
    const x = CHESS_PADDING + col * CHESS_CELL;
    const y = CHESS_PADDING + row * CHESS_CELL;
    const radius = CHESS_CELL * 0.42;
    const isRed = piece.startsWith('r_');
    const type = piece.split('_')[1];
    const name = ChessLogic.PIECE_NAMES[piece] || '?';

    // 棋子底色
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    const gradient = ctx.createRadialGradient(x - 4, y - 4, 3, x, y, radius);
    gradient.addColorStop(0, '#fff8e8');
    gradient.addColorStop(1, '#d4b876');
    ctx.fillStyle = gradient;
    ctx.fill();
    ctx.strokeStyle = '#8b6914';
    ctx.lineWidth = 1.5;
    ctx.stroke();

    // 内圈
    ctx.beginPath();
    ctx.arc(x, y, radius - 4, 0, Math.PI * 2);
    ctx.strokeStyle = isRed ? '#c00' : '#222';
    ctx.lineWidth = 1.5;
    ctx.stroke();

    // 文字
    ctx.fillStyle = isRed ? '#c00' : '#222';
    ctx.font = `bold ${radius * 1.1}px "KaiTi", "STKaiti", "SimSun", serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(name, x, y + 1);
  }

  function drawChessHighlight(row, col, color) {
    const x = CHESS_PADDING + col * CHESS_CELL;
    const y = CHESS_PADDING + row * CHESS_CELL;
    ctx.fillStyle = color;
    ctx.fillRect(x - CHESS_CELL / 2, y - CHESS_CELL / 2, CHESS_CELL, CHESS_CELL);
  }

  // ==================== 黑白棋绘制 ====================

  function drawReversiBoard(state) {
    const S = REVERSI_SIZE, P = REVERSI_PADDING, C = REVERSI_CELL, W = REVERSI_CANVAS;

    // 绿色棋盘
    ctx.fillStyle = '#2d8b46';
    ctx.fillRect(0, 0, W, W);

    // 网格线
    ctx.strokeStyle = '#1a6b30';
    ctx.lineWidth = 1;
    for (let i = 0; i <= S; i++) {
      const pos = P + i * C;
      ctx.beginPath(); ctx.moveTo(P, pos); ctx.lineTo(P + S * C, pos); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(pos, P); ctx.lineTo(pos, P + S * C); ctx.stroke();
    }

    // 星位（4个角的小标记）
    ctx.fillStyle = '#1a6b30';
    for (const r of [2, 5]) {
      for (const c of [2, 5]) {
        ctx.beginPath();
        ctx.arc(P + c * C + C / 2, P + r * C + C / 2, 4, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    // 棋子
    if (state.board) {
      for (let r = 0; r < S; r++) {
        for (let c = 0; c < S; c++) {
          if (state.board[r][c] !== 0) {
            drawReversiPiece(r, c, state.board[r][c]);
          }
        }
      }
    }

    // 上一步移动高亮
    if (state.lastMove && state.lastMove.to) {
      const [tr, tc] = state.lastMove.to;
      const x = P + tc * C;
      const y = P + tr * C;
      ctx.strokeStyle = 'rgba(255, 255, 0, 0.7)';
      ctx.lineWidth = 2;
      ctx.strokeRect(x + 2, y + 2, C - 4, C - 4);
    }

    // 合法位置提示（仅当轮到自己时）
    if (state.myRole === 'player' && state.currentTurn === mySocketId && state.board) {
      const myColor = state.myColor === 1 ? ReversiLogic.BLACK : ReversiLogic.WHITE;
      const validMoves = ReversiLogic.getValidMoves(state.board, myColor);
      for (const [r, c] of validMoves) {
        const x = P + c * C + C / 2;
        const y = P + r * C + C / 2;
        ctx.beginPath();
        ctx.arc(x, y, 6, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(255, 255, 255, 0.35)';
        ctx.fill();
      }
    }
  }

  function drawReversiPiece(row, col, color) {
    const x = REVERSI_PADDING + col * REVERSI_CELL + REVERSI_CELL / 2;
    const y = REVERSI_PADDING + row * REVERSI_CELL + REVERSI_CELL / 2;
    const radius = REVERSI_CELL * 0.42;

    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    if (color === ReversiLogic.BLACK) {
      const g = ctx.createRadialGradient(x - 3, y - 3, 2, x, y, radius);
      g.addColorStop(0, '#555');
      g.addColorStop(1, '#111');
      ctx.fillStyle = g;
    } else {
      const g = ctx.createRadialGradient(x - 3, y - 3, 2, x, y, radius);
      g.addColorStop(0, '#fff');
      g.addColorStop(1, '#ccc');
      ctx.fillStyle = g;
    }
    ctx.fill();
    ctx.strokeStyle = color === ReversiLogic.BLACK ? '#000' : '#999';
    ctx.lineWidth = 1;
    ctx.stroke();
  }

  function handleReversiClick(mx, my) {
    if (roomState.currentTurn !== mySocketId) return;
    const col = Math.floor((mx - REVERSI_PADDING) / REVERSI_CELL);
    const row = Math.floor((my - REVERSI_PADDING) / REVERSI_CELL);
    if (row >= 0 && row < REVERSI_SIZE && col >= 0 && col < REVERSI_SIZE) {
      socket.emit('make-move', { row, col });
    }
  }

  function handleReversiHover(mx, my) {
    if (roomState.currentTurn !== mySocketId) {
      canvas.style.cursor = 'default';
      return;
    }
    const col = Math.floor((mx - REVERSI_PADDING) / REVERSI_CELL);
    const row = Math.floor((my - REVERSI_PADDING) / REVERSI_CELL);
    if (row >= 0 && row < REVERSI_SIZE && col >= 0 && col < REVERSI_SIZE) {
      const myColor = roomState.myColor === 1 ? ReversiLogic.BLACK : ReversiLogic.WHITE;
      if (ReversiLogic.isValidMove(roomState.board, row, col, myColor)) {
        canvas.style.cursor = 'pointer';
        drawReversiBoard(roomState);
        // 绘制半透明预览
        const x = REVERSI_PADDING + col * REVERSI_CELL + REVERSI_CELL / 2;
        const y = REVERSI_PADDING + row * REVERSI_CELL + REVERSI_CELL / 2;
        const radius = REVERSI_CELL * 0.42;
        ctx.beginPath();
        ctx.arc(x, y, radius, 0, Math.PI * 2);
        ctx.fillStyle = myColor === ReversiLogic.BLACK ? 'rgba(0,0,0,0.3)' : 'rgba(255,255,255,0.3)';
        ctx.fill();
        return;
      }
    }
    canvas.style.cursor = 'default';
    drawReversiBoard(roomState);
  }

  // ==================== 点击事件处理 ====================

  canvas.addEventListener('click', (e) => {
    if (!roomState || roomState.status !== 'playing') return;
    if (roomState.myRole !== 'player') return;

    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    const mx = (e.clientX - rect.left) * scaleX;
    const my = (e.clientY - rect.top) * scaleY;

    if (roomState.gameType === 'chess') {
      handleChessClick(mx, my);
    } else if (roomState.gameType === 'reversi') {
      handleReversiClick(mx, my);
    } else {
      handleGomokuClick(mx, my);
    }
  });

  function handleGomokuClick(mx, my) {
    if (roomState.currentTurn !== mySocketId) return;
    const col = Math.round((mx - GOMOKU_PADDING) / GOMOKU_CELL);
    const row = Math.round((my - GOMOKU_PADDING) / GOMOKU_CELL);
    if (row >= 0 && row < GOMOKU_SIZE && col >= 0 && col < GOMOKU_SIZE) {
      socket.emit('make-move', { row, col });
    }
  }

  function handleChessClick(mx, my) {
    const col = Math.round((mx - CHESS_PADDING) / CHESS_CELL);
    const row = Math.round((my - CHESS_PADDING) / CHESS_CELL);
    if (row < 0 || row >= CHESS_ROWS || col < 0 || col >= CHESS_COLS) return;

    const myColor = roomState.myColor === 1 ? 'red' : 'black';
    const isMyTurn = roomState.currentTurn === mySocketId;

    if (!isMyTurn) return;

    const piece = roomState.board[row][col];
    const pieceColor = piece ? ChessLogic.getPieceColor(piece) : null;

    // 已选中棋子的情况下，点击合法目标位置 → 走子
    if (selectedPiece) {
      const isValidTarget = currentValidMoves.some(([r, c]) => r === row && c === col);
      if (isValidTarget) {
        socket.emit('make-move', { row, col, fromRow: selectedPiece.row, fromCol: selectedPiece.col });
        selectedPiece = null;
        currentValidMoves = [];
        return;
      }
      // 点击自己的其他棋子 → 换选
      if (pieceColor === myColor) {
        selectedPiece = { row, col };
        currentValidMoves = ChessLogic.getValidMoves(roomState.board, row, col, myColor);
        drawChessBoard(roomState);
        return;
      }
      // 点击其他位置 → 取消选择
      selectedPiece = null;
      currentValidMoves = [];
      drawChessBoard(roomState);
      return;
    }

    // 未选中棋子时，点击自己的棋子 → 选中
    if (pieceColor === myColor) {
      selectedPiece = { row, col };
      currentValidMoves = ChessLogic.getValidMoves(roomState.board, row, col, myColor);
      drawChessBoard(roomState);
    }
  }

  // ==================== 鼠标悬停 ====================

  canvas.addEventListener('mousemove', (e) => {
    if (!roomState) return;
    if (roomState.status !== 'playing' || roomState.myRole !== 'player') {
      canvas.style.cursor = 'default';
      return;
    }

    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    const mx = (e.clientX - rect.left) * scaleX;
    const my = (e.clientY - rect.top) * scaleY;

    if (roomState.gameType === 'gomoku') {
      handleGomokuHover(mx, my);
    } else if (roomState.gameType === 'reversi') {
      handleReversiHover(mx, my);
    } else {
      handleChessHover(mx, my);
    }
  });

  function handleGomokuHover(mx, my) {
    if (roomState.currentTurn !== mySocketId) {
      canvas.style.cursor = 'default';
      return;
    }
    const col = Math.round((mx - GOMOKU_PADDING) / GOMOKU_CELL);
    const row = Math.round((my - GOMOKU_PADDING) / GOMOKU_CELL);
    if (row >= 0 && row < GOMOKU_SIZE && col >= 0 && col < GOMOKU_SIZE && roomState.board && roomState.board[row][col] === 0) {
      canvas.style.cursor = 'pointer';
      drawGomokuBoard(roomState);
      const x = GOMOKU_PADDING + col * GOMOKU_CELL;
      const y = GOMOKU_PADDING + row * GOMOKU_CELL;
      ctx.beginPath();
      ctx.arc(x, y, GOMOKU_CELL * 0.42, 0, Math.PI * 2);
      ctx.fillStyle = roomState.myColor === 1 ? 'rgba(0,0,0,0.3)' : 'rgba(255,255,255,0.3)';
      ctx.fill();
    } else {
      canvas.style.cursor = 'default';
      drawGomokuBoard(roomState);
    }
  }

  function handleChessHover(mx, my) {
    if (roomState.currentTurn !== mySocketId) {
      canvas.style.cursor = 'default';
      return;
    }
    const col = Math.round((mx - CHESS_PADDING) / CHESS_CELL);
    const row = Math.round((my - CHESS_PADDING) / CHESS_CELL);
    if (row >= 0 && row < CHESS_ROWS && col >= 0 && col < CHESS_COLS) {
      const myColor = roomState.myColor === 1 ? 'red' : 'black';
      const piece = roomState.board[row][col];
      if (piece && ChessLogic.getPieceColor(piece) === myColor) {
        canvas.style.cursor = 'pointer';
        return;
      }
      // 在合法目标位置上也显示pointer
      if (selectedPiece && currentValidMoves.some(([r, c]) => r === row && c === col)) {
        canvas.style.cursor = 'pointer';
        return;
      }
    }
    canvas.style.cursor = 'default';
  }

  canvas.addEventListener('mouseleave', () => {
    if (roomState) drawBoard(roomState);
  });

  // ==================== 按钮事件 ====================

  // 暂存的游戏类型
  let pendingGameType = null;

  $('#create-room-btn').addEventListener('click', () => {
    pendingGameType = $('#game-type-select').value;
    $('#desc-modal-input').value = '';
    $('#desc-modal').style.display = 'flex';
    $('#desc-modal-input').focus();
  });

  $('#desc-modal-skip').addEventListener('click', () => {
    $('#desc-modal').style.display = 'none';
    socket.emit('create-room', { gameType: pendingGameType, description: '' });
  });

  $('#desc-modal-confirm').addEventListener('click', () => {
    const desc = $('#desc-modal-input').value.trim();
    $('#desc-modal').style.display = 'none';
    socket.emit('create-room', { gameType: pendingGameType, description: desc });
  });

  $('#desc-modal-input').addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      $('#desc-modal-confirm').click();
    }
  });

  $('#join-room-btn').addEventListener('click', () => {
    const roomId = $('#room-id-input').value.trim();
    if (!roomId) { showToast('请输入房间ID'); return; }
    const role = document.querySelector('input[name="role"]:checked').value;
    socket.emit('join-room', { roomId, role });
  });

  // 开始游戏
  startGameBtn.addEventListener('click', () => {
    socket.emit('start-game');
  });

  // 自对弈开关
  selfPlayCheck.addEventListener('change', () => {
    socket.emit('toggle-self-play');
  });

  $('#leave-room-btn').addEventListener('click', () => {
    socket.emit('leave-room');
    currentRoomId = null;
    roomState = null;
    selectedPiece = null;
    currentValidMoves = [];
    selfPlayCheck.checked = false;
    showPage('lobby');
    socket.emit('get-rooms');
  });

  restartBtn.addEventListener('click', () => {
    socket.emit('restart-game');
  });

  $('#refresh-rooms-btn').addEventListener('click', () => {
    socket.emit('get-rooms');
  });

  // 改名
  $('#change-name-btn').addEventListener('click', () => {
    $('#name-input').value = myName;
    $('#name-modal').style.display = 'flex';
    $('#name-input').focus();
  });

  $('#name-cancel-btn').addEventListener('click', () => {
    $('#name-modal').style.display = 'none';
  });

  $('#name-confirm-btn').addEventListener('click', () => {
    const newName = $('#name-input').value.trim();
    if (newName) {
      myName = newName;
      nicknameDisplay.textContent = myName;
      socket.emit('set-name', myName);
      showToast('昵称已更新');
    }
    $('#name-modal').style.display = 'none';
  });

  $('#name-input').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') $('#name-confirm-btn').click();
  });

  // ==================== 聊天功能 ====================

  function addChatMessage(name, text, time) {
    const chatEl = $('#chat-messages');
    if (!chatEl) return;
    const timeStr = new Date(time).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
    const isMe = name === myName;
    const div = document.createElement('div');
    div.className = 'chat-msg';
    div.innerHTML = `<span class="chat-name" style="${isMe ? 'color:var(--accent)' : ''}">${escapeHtml(name)}</span><span class="chat-text">${escapeHtml(text)}</span><span class="chat-time">${timeStr}</span>`;
    chatEl.appendChild(div);
    chatEl.scrollTop = chatEl.scrollHeight;
  }

  function addSystemMessage(text) {
    const chatEl = $('#chat-messages');
    if (!chatEl) return;
    const div = document.createElement('div');
    div.className = 'chat-msg system';
    div.textContent = text;
    chatEl.appendChild(div);
    chatEl.scrollTop = chatEl.scrollHeight;
  }

  function sendChat() {
    const input = $('#chat-input');
    const text = input.value.trim();
    if (!text) return;
    socket.emit('chat-message', text);
    input.value = '';
    input.focus();
  }

  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  // 编辑简介
  $('#desc-edit-btn').addEventListener('click', () => {
    $('#room-desc-input').value = roomState ? roomState.description || '' : '';
    $('#room-desc-display').style.display = 'none';
    $('#desc-edit-btn').style.display = 'none';
    $('#room-desc-edit').style.display = 'flex';
    $('#room-desc-input').focus();
  });

  $('#desc-cancel-btn').addEventListener('click', () => {
    $('#room-desc-edit').style.display = 'none';
    $('#room-desc-display').style.display = 'block';
    if (roomState && roomState.myRole === 'player') $('#desc-edit-btn').style.display = 'inline-block';
  });

  $('#desc-save-btn').addEventListener('click', () => {
    const desc = $('#room-desc-input').value.trim();
    socket.emit('edit-description', desc);
    $('#room-desc-edit').style.display = 'none';
    $('#room-desc-display').style.display = 'block';
    if (roomState && roomState.myRole === 'player') $('#desc-edit-btn').style.display = 'inline-block';
  });

  // 聊天按钮事件
  $('#chat-send-btn').addEventListener('click', sendChat);
  $('#chat-input').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') sendChat();
  });

  // 投降
  surrenderBtn.addEventListener('click', () => {
    $('#surrender-modal').style.display = 'flex';
  });
  $('#surrender-cancel-btn').addEventListener('click', () => {
    $('#surrender-modal').style.display = 'none';
  });
  $('#surrender-confirm-btn').addEventListener('click', () => {
    $('#surrender-modal').style.display = 'none';
    socket.emit('surrender');
  });

  // 悔棋
  undoBtn.addEventListener('click', () => {
    socket.emit('request-undo');
  });
  $('#undo-req-accept-btn').addEventListener('click', () => {
    $('#undo-request-modal').style.display = 'none';
    socket.emit('undo-response', { accept: true });
  });
  $('#undo-req-reject-btn').addEventListener('click', () => {
    $('#undo-request-modal').style.display = 'none';
    socket.emit('undo-response', { accept: false });
  });
  $('#undo-wait-cancel-btn').addEventListener('click', () => {
    $('#undo-wait-modal').style.display = 'none';
  });

  // 快捷语句：展开/折叠
  const quickChatToggle = $('#quick-chat-toggle');
  const quickChatList = $('#quick-chat-list');
  const quickChatArrow = quickChatToggle.querySelector('.quick-chat-arrow');
  quickChatToggle.addEventListener('click', () => {
    quickChatList.classList.toggle('collapsed');
    quickChatArrow.textContent = quickChatList.classList.contains('collapsed') ? '▼' : '▲';
  });

  // 快捷语句：点击发送
  quickChatList.querySelectorAll('.quick-chat-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const text = btn.dataset.text;
      if (text) {
        socket.emit('chat-message', text);
      }
    });
  });

  // ==================== 工具函数 ====================

  function showToast(msg) {
    toastEl.textContent = msg;
    toastEl.classList.add('show');
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      toastEl.classList.remove('show');
    }, 2500);
  }

})();
