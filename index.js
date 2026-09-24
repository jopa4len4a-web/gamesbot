// index.js — бот + сервер

require('dotenv').config();
const http = require('http');
const fs = require('fs');
const path = require('path');
const TelegramBot = require('node-telegram-bot-api');
const { generatePlayer, catastrophes, randomItem } = require('./game');

const BOT_TOKEN = process.env.BOT_TOKEN || "ТВОЙ_ТОКЕН_СЮДА";
const PORT = process.env.PORT || 3000;
const WEBAPP_URL = "https://hdbrvzhtbhshtr.bothost.tech/";

const bot = new TelegramBot(BOT_TOKEN, { polling: true });
const games = {};

// ===== HTTP-сервер =====
const server = http.createServer((req, res) => {
  let url = (req.url || '/').split('?')[0].replace(/^\/+/, '') || 'index.html';
  const publicDir = path.join(__dirname, 'public');
  const filePath = path.join(publicDir, path.normalize(url));
  const resolvedPath = path.resolve(filePath);
  const resolvedPublic = path.resolve(publicDir);

  if (!resolvedPath.startsWith(resolvedPublic + path.sep) && resolvedPath !== resolvedPublic) {
    res.writeHead(403); res.end('Доступ запрещён'); return;
  }

  const extname = path.extname(resolvedPath);
  const mimeTypes = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' };
  const contentType = mimeTypes[extname] || 'text/plain';

  fs.readFile(resolvedPath, (err, content) => {
    if (err) { res.writeHead(404); res.end('Не найдено'); return; }
    res.writeHead(200, { 'Content-Type': contentType });
    res.end(content, 'utf-8');
  });
});

server.listen(PORT, '0.0.0.0', () => console.log(`✅ Сервер на порту ${PORT}`));

// ===== Утилиты =====
async function isAdmin(chatId, userId) {
  try {
    const member = await bot.getChatMember(chatId, userId);
    return ['creator', 'administrator'].includes(member.status);
  } catch (e) { return false; }
}

function playerList(game) {
  if (!game.players.length) return '_пока никого_';
  return game.players.map((p, i) =>
    `${i + 1}. ${p.alive ? '🟢' : '🔴'} *${p.username}*`
  ).join('\n');
}

function lobbyKeyboard(chatId) {
  return {
    inline_keyboard: [
      [{ text: '✋ Вступить в игру', callback_data: `join_${chatId}` }],
      [{ text: '🚪 Выйти', callback_data: `leave_${chatId}` }],
      [{ text: '🎮 Открыть WebApp', web_app: { url: `${WEBAPP_URL}?chatId=${chatId}` } }]
    ]
  };
}

// ===== /start =====
bot.onText(/\/start/, (msg) => {
  bot.sendMessage(msg.chat.id,
    `🏚️ *БУНКЕР*\n\n` +
    `_Игра на выживание для компании_\n\n` +
    `📍 *Команды:*\n` +
    `/newgame — создать лобби\n` +
    `/join — вступить\n` +
    `/leave — выйти\n` +
    `/startgame — начать игру\n` +
    `/callall — позвать всех админом\n` +
    `/forcestart — принудительный старт (админ)\n` +
    `/status — статус игры\n` +
    `/endgame — закончить игру`,
    { parse_mode: 'Markdown' }
  );
});

// ===== /newgame =====
bot.onText(/\/newgame/, async (msg) => {
  const chatId = msg.chat.id;

  if (games[chatId]) {
    bot.sendMessage(chatId, '⚠️ Игра уже создана. Жми /join или /startgame.');
    return;
  }

  const admin = await isAdmin(chatId, msg.from.id);

  games[chatId] = {
    players: [],
    catastrophe: randomItem(catastrophes),
    round: 0,
    state: 'lobby',
    hostId: msg.from.id,
    hostIsAdmin: admin
  };

  bot.sendMessage(chatId,
    `🎬 *ЛОББИ СОЗДАНО*\n\n` +
    `☢️ Катастрофа: *${games[chatId].catastrophe}*\n\n` +
    `👥 Игроков: *0*\n\n` +
    `_Нажми кнопку ниже или напиши_ /join`,
    { parse_mode: 'Markdown', reply_markup: lobbyKeyboard(chatId) }
  );
});

// ===== /join =====
async function joinGame(chatId, user) {
  const game = games[chatId];
  if (!game || game.state !== 'lobby') return '❌ Нет активного лобби.';
  if (game.players.find(p => p.userId === user.id)) return '⚠️ Ты уже в игре.';

  const player = generatePlayer(user.id, user.username || user.first_name);
  game.players.push(player);

  return `✅ *${player.username}* в игре! (${game.players.length})`;
}

bot.onText(/\/join/, async (msg) => {
  const result = await joinGame(msg.chat.id, msg.from);
  bot.sendMessage(msg.chat.id, result, { parse_mode: 'Markdown' });
});

// ===== /leave =====
async function leaveGame(chatId, userId) {
  const game = games[chatId];
  if (!game) return '❌ Нет игры.';
  const idx = game.players.findIndex(p => p.userId === userId);
  if (idx === -1) return '⚠️ Тебя нет в игре.';
  const name = game.players[idx].username;
  game.players.splice(idx, 1);
  return `🚪 *${name}* покинул игру.`;
}

bot.onText(/\/leave/, async (msg) => {
  const result = await leaveGame(msg.chat.id, msg.from.id);
  bot.sendMessage(msg.chat.id, result, { parse_mode: 'Markdown' });
});

// ===== /callall — позвать всех =====
bot.onText(/\/callall/, async (msg) => {
  const chatId = msg.chat.id;
  const game = games[chatId];

  if (!game) { bot.sendMessage(chatId, '❌ Сначала /newgame'); return; }

  const admin = await isAdmin(chatId, msg.from.id);
  if (!admin && msg.from.id !== game.hostId) {
    bot.sendMessage(chatId, '❌ Только админ или создатель может звать всех.');
    return;
  }

  bot.sendMessage(chatId,
    `📢 *ВНИМАНИЕ!*\n\n` +
    `@${msg.from.username || 'Хост'} зовёт всех в *БУНКЕР*!\n\n` +
    `☢️ Катастрофа: _${game.catastrophe}_\n\n` +
    `👇 Жми кнопку, чтобы вступить!`,
    { parse_mode: 'Markdown', reply_markup: lobbyKeyboard(chatId) }
  );
});

// ===== /startgame =====
async function startGame(chatId, userId, force = false) {
  const game = games[chatId];
  if (!game) return { ok: false, msg: '❌ Нет игры. /newgame' };
  if (game.state !== 'lobby') return { ok: false, msg: '⚠️ Игра уже идёт.' };

  const admin = await isAdmin(chatId, userId);
  const isHost = userId === game.hostId;

  if (!admin && !isHost) return { ok: false, msg: '❌ Только админ или создатель может начать.' };

  const minPlayers = admin ? 1 : 3;
  if (game.players.length < minPlayers) {
    return { ok: false, msg: `❌ Нужно минимум ${minPlayers} игроков. Сейчас: ${game.players.length}` };
  }

  game.state = 'playing';
  game.round = 1;

  return {
    ok: true,
    msg: `🎬 *ИГРА НАЧАЛАСЬ!*\n\n` +
      `☢️ Катастрофа: _${game.catastrophe}_\n\n` +
      `👥 *Игроки:*\n${playerList(game)}\n\n` +
      `📍 Раунд *1*. Обсуждайте и голосуйте!\n\n` +
      `Открой WebApp, чтобы увидеть свои карты.`
  };
}

bot.onText(/\/startgame/, async (msg) => {
  const res = await startGame(msg.chat.id, msg.from.id, false);
  bot.sendMessage(msg.chat.id, res.msg, {
    parse_mode: 'Markdown',
    reply_markup: res.ok ? { inline_keyboard: [[
      { text: '🎮 Открыть WebApp', web_app: { url: `${WEBAPP_URL}?chatId=${msg.chat.id}` } }
    ]] } : undefined
  });
});

// ===== /forcestart — принудительный старт админом =====
bot.onText(/\/forcestart/, async (msg) => {
  const chatId = msg.chat.id;
  const admin = await isAdmin(chatId, msg.from.id);
  if (!admin) { bot.sendMessage(chatId, '❌ Только админ может форсить старт.'); return; }
  const res = await startGame(chatId, msg.from.id, true);
  bot.sendMessage(chatId, res.msg, {
    parse_mode: 'Markdown',
    reply_markup: res.ok ? { inline_keyboard: [[
      { text: '🎮 Открыть WebApp', web_app: { url: `${WEBAPP_URL}?chatId=${chatId}` } }
    ]] } : undefined
  });
});

// ===== /status =====
bot.onText(/\/status/, (msg) => {
  const game = games[msg.chat.id];
  if (!game) { bot.sendMessage(msg.chat.id, '❌ Нет игры.'); return; }
  bot.sendMessage(msg.chat.id,
    `📊 *СТАТУС*\n\n` +
    `Состояние: *${game.state}*\n` +
    `Раунд: *${game.round}*\n` +
    `☢️ _${game.catastrophe}_\n\n` +
    `👥 *Игроки:*\n${playerList(game)}`,
    { parse_mode: 'Markdown' }
  );
});

// ===== /endgame =====
bot.onText(/\/endgame/, async (msg) => {
  const chatId = msg.chat.id;
  const game = games[chatId];
  if (!game) { bot.sendMessage(chatId, '❌ Нет игры.'); return; }

  const admin = await isAdmin(chatId, msg.from.id);
  if (!admin && msg.from.id !== game.hostId) {
    bot.sendMessage(chatId, '❌ Только админ или создатель может закончить.');
    return;
  }

  delete games[chatId];
  bot.sendMessage(chatId, '🛑 Игра завершена. Создать новую: /newgame');
});

// ===== Inline-кнопки =====
bot.on('callback_query', async (query) => {
  const data = query.data;
  const chatId = query.message.chat.id;

  if (data.startsWith('join_')) {
    const result = await joinGame(chatId, query.from);
    bot.answerCallbackQuery(query.id, { text: result.replace(/[*_]/g, '') });
    if (games[chatId]) {
      bot.editMessageReplyMarkup(lobbyKeyboard(chatId), {
        chat_id: chatId,
        message_id: query.message.message_id
      }).catch(() => {});
    }
  }

  if (data.startsWith('leave_')) {
    const result = await leaveGame(chatId, query.from.id);
    bot.answerCallbackQuery(query.id, { text: result.replace(/[*_]/g, '') });
  }
});

// ===== Голосование через WebApp =====
bot.on('web_app_data', (msg) => {
  const chatId = msg.chat.id;
  let data;
  try { data = JSON.parse(msg.web_app_data.data); } catch (e) { return; }
  const game = games[chatId];
  if (!game) return;

  if (data.action === 'vote') {
    const target = game.players.find(p => p.userId === data.targetId);
    if (target) target.votes = (target.votes || 0) + 1;

    const totalVotes = game.players.reduce((s, p) => s + (p.votes || 0), 0);
    const aliveCount = game.players.filter(p => p.alive).length;

    if (totalVotes >= aliveCount) {
      let maxVotes = 0, eliminated = null;
      game.players.forEach(p => {
        if (p.alive && p.votes > maxVotes) { maxVotes = p.votes; eliminated = p; }
      });
      if (eliminated) {
        eliminated.alive = false;
        bot.sendMessage(chatId, `🗳️ *${eliminated.username}* изгнан из бункера!`, { parse_mode: 'Markdown' });
      }
      game.players.forEach(p => p.votes = 0);
      game.round++;

      const alive = game.players.filter(p => p.alive).length;
      if (alive <= Math.ceil(game.players.length / 2)) {
        game.state = 'finished';
        const winners = game.players.filter(p => p.alive).map(p => p.username).join(', ');
        bot.sendMessage(chatId, `🏆 *Игра окончена!*\n\nВыжившие: ${winners}\n\n/newgame`, { parse_mode: 'Markdown' });
      } else {
        bot.sendMessage(chatId, `📢 Раунд *${game.round}*. Обсуждайте!`, { parse_mode: 'Markdown' });
      }
    }
  }
});

console.log('🤖 Бот запущен...');
