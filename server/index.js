const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const os = require('os');
const ChessLogic = require('../shared/chess-logic');
const ReversiLogic = require('../shared/reversi-logic');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*' }
});

app.use(express.static(path.join(__dirname, '..', 'public')));
app.use('/shared', express.static(path.join(__dirname, '..', 'shared')));

// ==================== 游戏逻辑 ====================

// 房间状态
const rooms = new Map();

// 五子棋棋盘大小
const BOARD_SIZE = 15;

function createRoom(roomId, gameType, hostName) {
  return {
    id: roomId,
    gameType, // 'gomoku' | 'chess' (预留)
    players: [],   // { id, name, color }
    spectators: [], // { id, name }
    board: null,
    currentTurn: null, // 当前回合玩家id
    currentTurnIdx: 0, // 当前回合玩家索引（selfPlay时两个玩家id相同，需按索引追踪）
    status: 'waiting', // waiting | playing | finished
    winner: null,
    lastMove: null,
    inCheck: false,
    selfPlay: false,
    description: '',
    emptySince: null,
    moveHistory: [],
    surrender: null,
    createdAt: Date.now()
  };
}

function createGomokuBoard() {
  return Array.from({ length: BOARD_SIZE }, () => Array(BOARD_SIZE).fill(0));
  // 0=空, 1=黑, 2=白
}

function createBoardForType(gameType) {
  if (gameType === 'chess') return ChessLogic.createBoard();
  if (gameType === 'reversi') return ReversiLogic.createBoard();
  return createGomokuBoard();
}

// 五子棋胜负判断
function checkGomokuWin(board, row, col, player) {
  const directions = [[0,1],[1,0],[1,1],[1,-1]];
  for (const [dr, dc] of directions) {
    let count = 1;
    // 正方向
    for (let i = 1; i < 5; i++) {
      const r = row + dr * i, c = col + dc * i;
      if (r >= 0 && r < BOARD_SIZE && c >= 0 && c < BOARD_SIZE && board[r][c] === player) {
        count++;
      } else break;
    }
    // 反方向
    for (let i = 1; i < 5; i++) {
      const r = row - dr * i, c = col - dc * i;
      if (r >= 0 && r < BOARD_SIZE && c >= 0 && c < BOARD_SIZE && board[r][c] === player) {
        count++;
      } else break;
    }
    if (count >= 5) return true;
  }
  return false;
}

// 判断棋盘是否满
function isBoardFull(board) {
  return board.every(row => row.every(cell => cell !== 0));
}

function getRoomList() {
  const list = [];
  for (const [id, room] of rooms) {
    list.push({
      id,
      gameType: room.gameType,
      playerCount: room.players.length,
      spectatorCount: room.spectators.length,
      status: room.status,
      playerNames: room.players.map(p => p.name),
      description: room.description
    });
  }
  return list;
}

function broadcastRoomList() {
  io.emit('room-list', getRoomList());
}

function getRoomState(room, playerId) {
  const player = room.players.find(p => p.id === playerId);
  const isSpectator = room.spectators.some(s => s.id === playerId);
  // 计算当前玩家的合法走法
  let validMoves = [];
  if (room.status === 'playing' && room.gameType === 'chess') {
    const turnPlayer = room.players.find(p => p.id === room.currentTurn);
    if (turnPlayer) {
      const color = turnPlayer.color === 1 ? 'red' : 'black';
      validMoves = [];
      for (let r = 0; r < ChessLogic.ROWS; r++) {
        for (let c = 0; c < ChessLogic.COLS; c++) {
          const piece = room.board[r][c];
          if (piece && ChessLogic.getPieceColor(piece) === color) {
            const moves = ChessLogic.getValidMoves(room.board, r, c, color);
            if (moves.length > 0) validMoves.push({ from: [r, c], to: moves });
          }
        }
      }
    }
  }
  // selfPlay模式下，myColor根据当前回合索引动态切换
  let myColor = player ? player.color : null;
  if (room.selfPlay && player && room.players.length === 2) {
    myColor = room.players[room.currentTurnIdx].color;
  }
  return {
    roomId: room.id,
    gameType: room.gameType,
    players: room.players.map(p => ({ id: p.id, name: p.name, color: p.color })),
    spectators: room.spectators.map(s => ({ id: s.id, name: s.name })),
    board: room.board,
    currentTurn: room.currentTurn,
    status: room.status,
    winner: room.winner,
    lastMove: room.lastMove,
    inCheck: room.inCheck,
    validMoves: validMoves,
    selfPlay: room.selfPlay,
    description: room.description,
    surrender: room.surrender,
    canStart: room.status === 'waiting' && (room.players.length === 2 || (room.selfPlay && room.players.length >= 1)),
    myRole: player ? 'player' : (isSpectator ? 'spectator' : 'unknown'),
    myColor: myColor
  };
}

function broadcastRoomState(room) {
  const allSocketIds = [
    ...room.players.map(p => p.id),
    ...room.spectators.map(s => s.id)
  ];
  for (const sid of allSocketIds) {
    const socket = io.sockets.sockets.get(sid);
    if (socket) {
      socket.emit('room-state', getRoomState(room, sid));
    }
  }
}

// ==================== Socket.IO 事件处理 ====================

io.on('connection', (socket) => {
  let playerName = '玩家' + Math.floor(Math.random() * 1000);
  let currentRoom = null;

  socket.emit('welcome', { socketId: socket.id });

  // 设置昵称
  socket.on('set-name', (name) => {
    playerName = (name || '').trim().slice(0, 20) || '玩家';
  });

  // 获取房间列表
  socket.on('get-rooms', () => {
    socket.emit('room-list', getRoomList());
  });

  // 创建房间
  socket.on('create-room', ({ gameType, description }) => {
    if (currentRoom) {
      socket.emit('error-msg', '你已经在房间中了');
      return;
    }
    const roomId = 'room_' + Date.now() + '_' + Math.floor(Math.random() * 1000);
    const room = createRoom(roomId, gameType || 'gomoku', playerName);
    room.description = (description || '').toString().trim().slice(0, 100);
    room.players.push({ id: socket.id, name: playerName, color: 1 }); // 黑棋先行
    room.currentTurn = socket.id;
    rooms.set(roomId, room);
    currentRoom = roomId;
    socket.join(roomId);
    socket.emit('room-created', { roomId });
    io.to(roomId).emit('chat-message', { name: '系统', text: `${playerName} 创建了房间`, time: Date.now(), system: true });
    broadcastRoomState(room);
    broadcastRoomList();
  });

  // 加入房间（角色选择）
  socket.on('join-room', ({ roomId, role }) => {
    const room = rooms.get(roomId);
    if (!room) { socket.emit('error-msg', '房间不存在'); return; }
    if (currentRoom) { socket.emit('error-msg', '你已经在房间中了'); return; }

    if (role === 'player') {
      if (room.players.length >= 2) {
        socket.emit('error-msg', '参与者已满，请选择观战');
        return;
      }
      room.players.push({ id: socket.id, name: playerName, color: room.players.length + 1 });
      room.emptySince = null; // 清除销毁标记
      currentRoom = roomId;
      socket.join(roomId);
      io.to(roomId).emit('chat-message', { name: '系统', text: `${playerName} 加入为参与者`, time: Date.now(), system: true });
    } else {
      room.spectators.push({ id: socket.id, name: playerName });
      room.emptySince = null; // 清除销毁标记
      currentRoom = roomId;
      socket.join(roomId);
      io.to(roomId).emit('chat-message', { name: '系统', text: `${playerName} 进入观战`, time: Date.now(), system: true });
    }
    broadcastRoomState(room);
    broadcastRoomList();
  });

  // 开始游戏
  socket.on('start-game', () => {
    const room = rooms.get(currentRoom);
    if (!room || room.status !== 'waiting') return;
    if (!room.players.find(p => p.id === socket.id)) return;
    if (room.players.length < 2 && !room.selfPlay) return;

    // selfPlay: 创建虚拟玩家
    if (room.selfPlay && room.players.length === 1) {
      room.players.push({ id: room.players[0].id, name: room.players[0].name, color: 2, isVirtual: true });
    }

    room.board = createBoardForType(room.gameType);
    room.status = 'playing';
    room.currentTurnIdx = 0;
    room.currentTurn = room.players[0].id;
    room.lastMove = null;
    room.moveHistory = [];
    room.inCheck = false;
    io.to(room.id).emit('chat-message', { name: '系统', text: '游戏开始！', time: Date.now(), system: true });
    broadcastRoomState(room);
    broadcastRoomList();
  });

  // 切换自对弈
  socket.on('toggle-self-play', () => {
    const room = rooms.get(currentRoom);
    if (!room || room.status !== 'waiting') return;
    if (!room.players.find(p => p.id === socket.id)) return;
    if (room.players.length > 1) return;
    room.selfPlay = !room.selfPlay;
    broadcastRoomState(room);
  });

  // 落子（五子棋）/ 走子（象棋）
  socket.on('make-move', ({ row, col, fromRow, fromCol }) => {
    const room = rooms.get(currentRoom);
    if (!room || room.status !== 'playing') return;
    if (room.currentTurn !== socket.id) {
      socket.emit('error-msg', '还没轮到你');
      return;
    }

    const player = room.players.find(p => p.id === socket.id);
    if (!player) return;

    if (room.gameType === 'chess') {
      // 象棋走子（selfPlay时根据当前回合索引决定颜色）
      let color;
      if (room.selfPlay && room.players.length === 2) {
        color = room.currentTurnIdx === 0 ? 'red' : 'black';
      } else {
        color = player.color === 1 ? 'red' : 'black';
      }
      if (!ChessLogic.isValidMove(room.board, fromRow, fromCol, row, col, color)) {
        socket.emit('error-msg', '非法走法');
        return;
      }
      if (ChessLogic.wouldBeInCheck(room.board, fromRow, fromCol, row, col, color)) {
        socket.emit('error-msg', '不能送将');
        return;
      }
      // 执行走子
      const movedPiece = room.board[fromRow][fromCol];
      const capturedPiece = room.board[row][col];
      room.board[row][col] = movedPiece;
      room.board[fromRow][fromCol] = null;
      room.lastMove = { from: [fromRow, fromCol], to: [row, col] };
      room.moveHistory.push({ type: 'chess', piece: movedPiece, fromRow, fromCol, toRow: row, toCol: col, captured: capturedPiece });

      // 检查是否将杀
      const oppColor = color === 'red' ? 'black' : 'red';
      if (ChessLogic.isCheckmate(room.board, oppColor)) {
        room.status = 'finished';
        room.winner = socket.id;
      } else if (!ChessLogic.hasAnyValidMove(room.board, oppColor)) {
        // 困毙也算输
        room.status = 'finished';
        room.winner = socket.id;
      } else {
        room.inCheck = ChessLogic.isInCheck(room.board, oppColor);
        // 切换回合（selfPlay时两个玩家id相同，必须按索引切换）
        room.currentTurnIdx = (room.currentTurnIdx + 1) % room.players.length;
        room.currentTurn = room.players[room.currentTurnIdx].id;
      }
    } else if (room.gameType === 'reversi') {
      // 黑白棋落子
      if (row < 0 || row >= ReversiLogic.SIZE || col < 0 || col >= ReversiLogic.SIZE) return;
      // selfPlay时根据当前回合索引决定颜色
      let pieceColor = player.color;
      if (room.selfPlay && room.players.length === 2) {
        pieceColor = room.players[room.currentTurnIdx].color;
      }
      const flips = ReversiLogic.getFlipped(room.board, row, col, pieceColor);
      if (flips.length === 0) {
        socket.emit('error-msg', '非法落子');
        return;
      }
      // 执行落子并翻转
      room.board[row][col] = pieceColor;
      for (const [fr, fc] of flips) {
        room.board[fr][fc] = pieceColor;
      }
      room.lastMove = { from: null, to: [row, col] };
      room.moveHistory.push({ type: 'reversi', row, col, color: pieceColor, flips: flips.map(f => [f[0], f[1]]) });

      // 检查终局
      if (ReversiLogic.isGameOver(room.board)) {
        room.status = 'finished';
        const winnerColor = ReversiLogic.getWinner(room.board);
        if (winnerColor === 0) {
          room.winner = null; // 平局
        } else {
          // 找到对应颜色的玩家
          const winnerPlayer = room.players.find(p => p.color === winnerColor);
          room.winner = winnerPlayer ? winnerPlayer.id : null;
        }
      } else {
        // 切换回合
        room.currentTurnIdx = (room.currentTurnIdx + 1) % room.players.length;
        room.currentTurn = room.players[room.currentTurnIdx].id;
        // 检查对方是否有合法走法，无则跳过
        const nextColor = room.players[room.currentTurnIdx].color;
        if (ReversiLogic.getValidMoves(room.board, nextColor).length === 0) {
          // 对方无合法走法，跳过回合
          room.currentTurnIdx = (room.currentTurnIdx + 1) % room.players.length;
          room.currentTurn = room.players[room.currentTurnIdx].id;
          io.to(room.id).emit('chat-message', { name: '系统', text: '对方无合法走法，跳过回合', time: Date.now(), system: true });
        }
      }
    } else {
      // 五子棋落子
      if (row < 0 || row >= BOARD_SIZE || col < 0 || col >= BOARD_SIZE) return;
      if (room.board[row][col] !== 0) {
        socket.emit('error-msg', '该位置已有棋子');
        return;
      }
      // selfPlay时根据当前回合索引决定颜色
      let pieceColor = player.color;
      if (room.selfPlay && room.players.length === 2) {
        pieceColor = room.players[room.currentTurnIdx].color;
      }
      room.board[row][col] = pieceColor;
      room.moveHistory.push({ type: 'gomoku', row, col, color: pieceColor });
      if (checkGomokuWin(room.board, row, col, pieceColor)) {
        room.status = 'finished';
        room.winner = socket.id;
      } else if (isBoardFull(room.board)) {
        room.status = 'finished';
        room.winner = null;
      } else {
        // 切换回合（selfPlay时两个玩家id相同，必须按索引切换）
        room.currentTurnIdx = (room.currentTurnIdx + 1) % room.players.length;
        room.currentTurn = room.players[room.currentTurnIdx].id;
      }
    }

    broadcastRoomState(room);
    broadcastRoomList();
  });

  // 重新开始
  socket.on('restart-game', () => {
    const room = rooms.get(currentRoom);
    if (!room || room.status !== 'finished') return;
    // 只有玩家可以重新开始
    if (!room.players.find(p => p.id === socket.id)) return;

    // selfPlay模式下保留虚拟玩家
    if (!room.selfPlay) {
      room.players = room.players.filter(p => !p.isVirtual);
    }
    room.board = createBoardForType(room.gameType);
    room.status = 'playing';
    room.winner = null;
    room.lastMove = null;
    room.moveHistory = [];
    room.surrender = null;
    room.inCheck = false;
    room.currentTurnIdx = 0;
    room.currentTurn = room.players[0].id;
    broadcastRoomState(room);
    broadcastRoomList();
  });

  // 投降
  socket.on('surrender', () => {
    const room = rooms.get(currentRoom);
    if (!room || room.status !== 'playing') return;
    const player = room.players.find(p => p.id === socket.id);
    if (!player) return;
    room.status = 'finished';
    const opponent = room.players.find(p => p.id !== socket.id);
    room.winner = opponent ? opponent.id : null;
    room.surrender = socket.id;
    io.to(room.id).emit('chat-message', { name: '系统', text: `${player.name} 投降了，输一半！`, time: Date.now(), system: true });
    broadcastRoomState(room);
    broadcastRoomList();
  });

  // 请求悔棋
  socket.on('request-undo', () => {
    const room = rooms.get(currentRoom);
    if (!room || room.status !== 'playing') return;
    if (room.moveHistory.length === 0) { socket.emit('error-msg', '没有可以悔的棋'); return; }
    const player = room.players.find(p => p.id === socket.id);
    if (!player) return;
    const opponent = room.players.find(p => p.id !== socket.id);
    if (!opponent || opponent.isVirtual) {
      // 自对弈模式直接悔棋
      const lastMove = room.moveHistory.pop();
      if (lastMove.type === 'gomoku') {
        room.board[lastMove.row][lastMove.col] = 0;
      } else if (lastMove.type === 'reversi') {
        room.board[lastMove.row][lastMove.col] = 0;
        for (const [fr, fc] of lastMove.flips) { room.board[fr][fc] = lastMove.color === 1 ? 2 : 1; }
      } else if (lastMove.type === 'chess') {
        room.board[lastMove.fromRow][lastMove.fromCol] = lastMove.piece;
        room.board[lastMove.toRow][lastMove.toCol] = lastMove.captured;
      }
      room.currentTurnIdx = (room.currentTurnIdx - 1 + room.players.length) % room.players.length;
      room.currentTurn = room.players[room.currentTurnIdx].id;
      room.lastMove = null;
      io.to(room.id).emit('chat-message', { name: '系统', text: '悔棋成功', time: Date.now(), system: true });
      broadcastRoomState(room);
      return;
    }
    room.undoRequesterId = socket.id;
    const requesterSocket = io.sockets.sockets.get(socket.id);
    const opponentSocket = io.sockets.sockets.get(opponent.id);
    if (opponentSocket) opponentSocket.emit('undo-request', { requesterName: player.name });
    if (requesterSocket) requesterSocket.emit('undo-wait', { targetName: opponent.name });
  });

  // 悔棋回应
  socket.on('undo-response', ({ accept }) => {
    const room = rooms.get(currentRoom);
    if (!room || !room.undoRequesterId) return;
    const requesterId = room.undoRequesterId;
    const responder = room.players.find(p => p.id === socket.id);
    const requester = room.players.find(p => p.id === requesterId);
    if (!responder || !requester) return;
    if (accept) {
      const lastMove = room.moveHistory.pop();
      if (lastMove.type === 'gomoku') {
        room.board[lastMove.row][lastMove.col] = 0;
      } else if (lastMove.type === 'reversi') {
        room.board[lastMove.row][lastMove.col] = 0;
        for (const [fr, fc] of lastMove.flips) { room.board[fr][fc] = lastMove.color === 1 ? 2 : 1; }
      } else if (lastMove.type === 'chess') {
        room.board[lastMove.fromRow][lastMove.fromCol] = lastMove.piece;
        room.board[lastMove.toRow][lastMove.toCol] = lastMove.captured;
      }
      room.currentTurnIdx = (room.currentTurnIdx - 1 + room.players.length) % room.players.length;
      room.currentTurn = room.players[room.currentTurnIdx].id;
      room.lastMove = null;
      io.to(room.id).emit('chat-message', { name: '系统', text: `${responder.name} 同意悔棋`, time: Date.now(), system: true });
      io.to(room.id).emit('undo-result', { accepted: true });
    } else {
      io.to(room.id).emit('chat-message', { name: '系统', text: `${responder.name} 拒绝了悔棋请求`, time: Date.now(), system: true });
      io.to(room.id).emit('undo-result', { accepted: false });
    }
    room.undoRequesterId = null;
    broadcastRoomState(room);
  });

  // 编辑房间简介
  socket.on('edit-description', (desc) => {
    const room = rooms.get(currentRoom);
    if (!room) return;
    if (!room.players.find(p => p.id === socket.id)) return;
    room.description = (desc || '').toString().trim().slice(0, 100);
    broadcastRoomState(room);
    broadcastRoomList();
  });

  // 房间聊天
  socket.on('chat-message', (msg) => {
    if (!currentRoom) return;
    const room = rooms.get(currentRoom);
    if (!room) return;
    const text = (msg || '').toString().trim().slice(0, 200);
    if (!text) return;
    io.to(currentRoom).emit('chat-message', {
      name: playerName,
      text: text,
      time: Date.now()
    });
  });

  // 离开房间
  socket.on('leave-room', () => {
    handleLeaveRoom(socket);
  });

  // 断开连接
  socket.on('disconnect', () => {
    handleLeaveRoom(socket);
  });

  function handleLeaveRoom(sock) {
    if (!currentRoom) return;
    const room = rooms.get(currentRoom);
    if (!room) {
      currentRoom = null;
      return;
    }

    // 从玩家中移除（selfPlay时移除同一socket的所有玩家）
    const playerIndex = room.players.findIndex(p => p.id === sock.id);
    const wasPlayer = playerIndex !== -1;
    if (wasPlayer) {
      room.players = room.players.filter(p => p.id !== sock.id);
      room.selfPlay = false;
    }

    // 从观战者中移除
    const specIndex = room.spectators.findIndex(s => s.id === sock.id);
    if (specIndex !== -1) {
      room.spectators.splice(specIndex, 1);
    }

    sock.leave(currentRoom);

    // 如果房间空了，标记销毁时间
    if (room.players.length === 0 && room.spectators.length === 0) {
      room.emptySince = Date.now();
    } else if (wasPlayer && room.status === 'playing') {
      // 玩家离开，对局结束，对方获胜
      room.status = 'finished';
      room.winner = room.players.length > 0 ? room.players[0].id : null;
      broadcastRoomState(room);
    } else {
      broadcastRoomState(room);
    }

    currentRoom = null;
    broadcastRoomList();
  }
});

// ==================== 启动服务器 ====================

const PORT = 3000;
server.listen(PORT, '0.0.0.0', () => {
  console.log(`\n🎮 棋类对战服务器已启动！`);
  console.log(`📍 本机访问: http://localhost:${PORT}`);

  // 获取局域网IP
  const interfaces = os.networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]) {
      if (iface.family === 'IPv4' && !iface.internal) {
        console.log(`🌐 局域网访问: http://${iface.address}:${PORT}`);
      }
    }
  }
  console.log('');
});

// ==================== 空房间定时销毁 ====================

const ROOM_EMPTY_TIMEOUT = 10 * 60 * 1000; // 10分钟

setInterval(() => {
  const now = Date.now();
  for (const [id, room] of rooms) {
    if (room.emptySince && (now - room.emptySince) >= ROOM_EMPTY_TIMEOUT) {
      rooms.delete(id);
      console.log(`🗑 空房间 ${id} 已自动销毁`);
      broadcastRoomList();
    }
  }
}, 60 * 1000); // 每分钟检查一次
