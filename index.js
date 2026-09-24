// index.js — Бункер (финальная версия)

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

// ==========================================
// HTTP-СЕРВЕР + API
// ==========================================
const server = http.createServer((req, res) => {
  const parsedUrl = new URL(req.url, `http://${req.headers.host}`);
  const pathname = parsedUrl.pathname;

  // ===== /api/state =====
  if (pathname === '/api/state') {
    const chatId = parsedUrl.searchParams.get('chatId');
    const userId = parseInt(parsedUrl.searchParams.get('userId'), 10);
    const game = games[chatId];

    res.setHeader('Content-Type', 'application/json');

    if (!game) {
      res.writeHead(404);
      res.end(JSON.stringify({ error: 'Игра не найдена' }));
      return;
    }

    const player = game.players.find(p => p.userId === userId);

    res.writeHead(200);
    res.end(JSON.stringify({
      catastrophe: game.catastrophe,
      round: game.round,
      state: game.state,
      players: game.players.map(p => ({
        userId: p.userId,
        username: p.username,
        alive: p.alive,
        votes: p.votes || 0,
        votedFor: p.votedFor || null
      })),
      me: player ? {
        userId: player.userId,
        username: player.username,
        alive: player.alive,
        profession: player.profession,
        health: player.health,
        hobby: player.hobby,
        luggage: player.luggage,
        fact: player.fact,
        revealed: player.revealed || [],
        votedFor: player.votedFor || null
      } : null
    }));
    return;
  }

  // ===== /api/reveal =====
  if (pathname === '/api/reveal' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      try {
        const { chatId, userId, field } = JSON.parse(body);
        const game = games[chatId];
        const player = game?.players.find(p => p.userId === userId);
        if (player) {
          if (!player.revealed) player.revealed = [];
          if (!player.revealed.includes(field)) player.revealed.push(field);
        }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true }));
      } catch (e) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Ошибка' }));
      }
    });
    return;
  }

  // ===== /api/vote =====
  if (pathname === '/api/vote' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', async () => {
      try {
        const { chatId, userId, targetId } = JSON.parse(body);
        const game = games[chatId];
        if (!game) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Нет игры' }));
          return;
        }

        const voter = game.players.find(p => p.userId === userId);
        if (!voter || !voter.alive || voter.votedFor) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Нельзя голосовать' }));
          return;
        }

        voter.votedFor = targetId;
        const target = game.players.find(p => p.userId === targetId);
        if (target) target.votes = (target.votes || 0) + 1;

        const alivePlayers = game.players.filter(p => p.alive);
        const votedCount = alivePlayers.filter(p => p.votedFor).length;

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, votedCount, total: alivePlayers.length }));

        if (votedCount >= alivePlayers.length && !game._resolving) {
          game._resolving = true;
          await resolveVote(chatId);
          game._resolving = false;
        }
      } catch (e) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Ошибка' }));
      }
    });
    return;
  }

  // ===== Статика =====
  let url = pathname.replace(/^\/+/, '') || 'index.html';
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

// ==========================================
// УТИЛИТЫ
// ==========================================
async function isAdmin(chatId, userId) {
  try {
    const member = await bot.getChatMember(chatId, userId);
    return ['creator', 'administrator'].includes(member.status);
  } catch (e) { return false; }
}

function escapeMd(t) { return String(t).replace(/[*_`\[\]()]/g, '\\$&'); }

function playerList(game) {
  if (!game.players.length) return '_пока никого_';
  return game.players.map((p, i) =>
    `${i + 1}. ${p.alive ? '🟢' : '🔴'} ${escapeMd(p.username)}`
  ).join('\n');
}

function webappUrl(chatId, userId) {
  let url = `${WEBAPP_URL}?chatId=${chatId}`;
  if (userId) url += `&userId=${userId}`;
  return url;
}

// ==========================================
// КОМАНДЫ
// ==========================================

bot.onText(/\/start(.*)/, async (msg, match) => {
  const chatId = msg.chat.id;
  const payload = (match[1] || '').trim();

  if (msg.chat.type === 'private') {
    if (payload.startsWith('join_')) {
      const groupId = payload.replace('join_', '');
      const game = games[groupId];

      if (!game || game.state !== 'lobby') {
        bot.sendMessage(chatId, '❌ Лобби закрыто или не найдено.');
        return;
      }

      if (!game.players.find(p => p.userId === msg.from.id)) {
        const player = generatePlayer(msg.from.id, msg.from.username || msg.from.first_name);
        game.players.push(player);

        try {
          bot.sendMessage(groupId,
            `✅ *${escapeMd(player.username)}* присоединился! (${game.players.length})`,
            { parse_mode: 'Markdown' }
          );
        } catch (e) {}
      }

      bot.sendMessage(chatId,
        `🎯 *Ты в игре!*\n\n` +
        `☢️ _${game.catastrophe}_\n\n` +
        `👥 Игроков: *${game.players.length}*\n\n` +
        `⏳ Ждём старта. Хост запустит игру командой в группе.`,
        { parse_mode: 'Markdown' }
      );
      return;
    }

    bot.sendMessage(chatId,
      `🏚️ *БУНКЕР*\n\n_Игра на выживание для компании_\n\n` +
      `Добавь меня в группу и напиши /newgame`,
      { parse_mode: 'Markdown' }
    );
    return;
  }

  bot.sendMessage(chatId,
    `🏚️ *БУНКЕР*\n\n` +
    `📍 *Команды:*\n` +
    `/newgame — создать лобби\n` +
    `/startgame — начать (от 3 игроков)\n` +
    `/forcestart — принудительный старт (админ)\n` +
    `/status — статус\n` +
    `/endgame — закончить`,
    { parse_mode: 'Markdown' }
  );
});

bot.onText(/\/newgame/, async (msg) => {
  const chatId = msg.chat.id;

  if (games[chatId]) {
    bot.sendMessage(chatId, '⚠️ Игра уже создана. /startgame или /endgame');
    return;
  }

  const admin = await isAdmin(chatId, msg.from.id);
  const me = await bot.getMe();

  games[chatId] = {
    players: [],
    catastrophe: randomItem(catastrophes),
    round: 0,
    state: 'lobby',
    hostId: msg.from.id,
    hostIsAdmin: admin
  };

  bot.sendMessage(chatId,
    `🎬 *ЛОББИ ОТКРЫТО!*\n\n` +
    `☢️ Катастрофа: *${games[chatId].catastrophe}*\n\n` +
    `👥 Игроков: *0*\n\n` +
    `👇 Жми *«Вступить»* — бот откроет личку, где ты будешь ждать старта.`,
    {
      parse_mode: 'Markdown',
      reply_markup: {
        inline_keyboard: [
          [{ text: '✋ Вступить в игру', url: `https://t.me/${me.username}?start=join_${chatId}` }],
          [{ text: '👥 Список игроков', callback_data: `list_${chatId}` }],
          [{ text: '🚀 Старт', callback_data: `start_${chatId}` }]
        ]
      }
    }
  );
});

bot.onText(/\/startgame/, async (msg) => {
  const chatId = msg.chat.id;
  const game = games[chatId];
  if (!game) { bot.sendMessage(chatId, '❌ Нет игры. /newgame'); return; }
  if (game.state !== 'lobby') { bot.sendMessage(chatId, '⚠️ Игра уже идёт.'); return; }

  const admin = await isAdmin(chatId, msg.from.id);
  const isHost = msg.from.id === game.hostId;
  if (!admin && !isHost) { bot.sendMessage(chatId, '❌ Только админ или создатель.'); return; }

  const minPlayers = admin ? 1 : 3;
  if (game.players.length < minPlayers) {
    bot.sendMessage(chatId, `❌ Нужно минимум ${minPlayers} игроков.`);
    return;
  }

  await launchGame(chatId);
});

bot.onText(/\/forcestart/, async (msg) => {
  const chatId = msg.chat.id;
  const admin = await isAdmin(chatId, msg.from.id);
  if (!admin) { bot.sendMessage(chatId, '❌ Только админ.'); return; }
  const game = games[chatId];
  if (!game) { bot.sendMessage(chatId, '❌ Нет игры.'); return; }
  if (!game.players.length) { bot.sendMessage(chatId, '❌ Никого нет.'); return; }
  await launchGame(chatId);
});

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

bot.onText(/\/endgame/, async (msg) => {
  const chatId = msg.chat.id;
  const game = games[chatId];
  if (!game) { bot.sendMessage(chatId, '❌ Нет игры.'); return; }

  const admin = await isAdmin(chatId, msg.from.id);
  if (!admin && msg.from.id !== game.hostId) {
    bot.sendMessage(chatId, '❌ Только админ или создатель.');
    return;
  }

  delete games[chatId];
  bot.sendMessage(chatId, '🛑 Игра завершена. /newgame');
});

// ==========================================
// ЕДИНЫЙ ОБРАБОТЧИК CALLBACK_QUERY
// ==========================================
bot.on('callback_query', async (query) => {
  const data = query.data;
  const chatId = query.message.chat.id;
  const game = games[chatId];

  // Голосование — не требует game, но нужен URL
  if (data.startsWith('vote_')) {
    if (!game) return;
    bot.answerCallbackQuery(query.id, { text: '📱 Открой WebApp в личке' });
    try {
      await bot.sendMessage(query.from.id, '🗳️ Голосуй:', {
        reply_markup: {
          inline_keyboard: [[
            { text: '🃏 Открыть WebApp', web_app: { url: webappUrl(chatId, query.from.id) } }
          ]]
        }
      });
    } catch (e) {}
    return;
  }

  if (!game) {
    bot.answerCallbackQuery(query.id, { text: '❌ Нет игры', show_alert: true });
    return;
  }

  if (data.startsWith('list_')) {
    bot.answerCallbackQuery(query.id);
    bot.sendMessage(chatId,
      `👥 *Игроки (${game.players.length}):*\n\n${playerList(game)}`,
      { parse_mode: 'Markdown' }
    );
    return;
  }

  if (data.startsWith('start_')) {
    const admin = await isAdmin(chatId, query.from.id);
    const isHost = query.from.id === game.hostId;

    if (!admin && !isHost) {
      bot.answerCallbackQuery(query.id, { text: '❌ Только админ или создатель', show_alert: true });
      return;
    }

    const minPlayers = admin ? 1 : 3;
    if (game.players.length < minPlayers) {
      bot.answerCallbackQuery(query.id, { text: `❌ Нужно минимум ${minPlayers}`, show_alert: true });
      return;
    }

    bot.answerCallbackQuery(query.id, { text: '🚀 Старт!' });
    await launchGame(chatId);
    return;
  }
});

// ==========================================
// ЗАПУСК ИГРЫ
// ==========================================
async function launchGame(chatId) {
  const game = games[chatId];
  if (!game) return;

  game.state = 'voting';
  game.round = 1;

  bot.sendMessage(chatId,
    `🎬 *ИГРА НАЧАЛАСЬ!*\n\n` +
    `☢️ Катастрофа: _${game.catastrophe}_\n\n` +
    `👥 *Игроки:*\n${playerList(game)}\n\n` +
    `📍 *Раунд 1*\n\n` +
    `📱 *Карточки отправлены каждому в личку.*`,
    { parse_mode: 'Markdown' }
  );

  for (const player of game.players) {
    try {
      await bot.sendMessage(player.userId,
        `🎮 *ТВОЯ КАРТОЧКА*\n\n` +
        `☢️ _${game.catastrophe}_\n\n` +
        `👇 Открой, изучи и раскрой характеристики:`,
        {
          parse_mode: 'Markdown',
          reply_markup: {
            inline_keyboard: [[
              { text: '🃏 Открыть карточку', web_app: { url: webappUrl(chatId, player.userId) } }
            ]]
          }
        }
      );
    } catch (e) {
      bot.sendMessage(chatId,
        `⚠️ *${escapeMd(player.username)}*, открой личку с ботом!`,
        { parse_mode: 'Markdown' }
      ).catch(() => {});
    }
  }
}

// ==========================================
// ПОДСЧЁТ ГОЛОСОВ
// ==========================================
async function resolveVote(chatId) {
  const game = games[chatId];
  if (!game) return;

  const alivePlayers = game.players.filter(p => p.alive);

  let maxVotes = 0, eliminated = null;
  alivePlayers.forEach(p => {
    if (p.votes > maxVotes) { maxVotes = p.votes; eliminated = p; }
  });

  if (eliminated && maxVotes > 0) {
    eliminated.alive = false;
    bot.sendMessage(chatId,
      `🗳️ *ГОЛОСОВАНИЕ ЗАВЕРШЕНО*\n\n` +
      `❌ *${escapeMd(eliminated.username)}* изгнан из бункера!\n` +
      `_Голосов против: ${maxVotes}_`,
      { parse_mode: 'Markdown' }
    );
  } else {
    bot.sendMessage(chatId, `🗳️ Ничья — никто не изгнан.`, { parse_mode: 'Markdown' });
  }

  game.players.forEach(p => { p.votes = 0; p.votedFor = null; });
  game.round++;

  const aliveCount = game.players.filter(p => p.alive).length;

  if (aliveCount <= Math.ceil(game.players.length / 2)) {
    game.state = 'finished';
    const winners = game.players.filter(p => p.alive).map(p => escapeMd(p.username)).join(', ');
    bot.sendMessage(chatId,
      `🏆 *ИГРА ОКОНЧЕНА!*\n\n` +
      `☢️ _${game.catastrophe}_\n\n` +
      `🎖️ *Выжившие:* ${winners}\n\n` +
      `Создать новую: /newgame`,
      { parse_mode: 'Markdown' }
    );

    for (const p of game.players) {
      try {
        await bot.sendMessage(p.userId,
          p.alive
            ? `🏆 *Ты выжил!* Поздравляю!`
            : `💀 *Тебя изгнали.* В следующий раз повезёт.`,
          { parse_mode: 'Markdown' }
        );
      } catch (e) {}
    }
  } else {
    bot.sendMessage(chatId,
      `📢 *РАУНД ${game.round}*\n\n` +
      `Обсуждайте и голосуйте снова.\n\n` +
      `👥 *Остались:*\n${playerList(game)}`,
      {
        parse_mode: 'Markdown',
        reply_markup: {
          inline_keyboard: [[
            { text: '🗳️ Голосовать', callback_data: `vote_${chatId}` }
          ]]
        }
      }
    );

    for (const p of game.players) {
      if (!p.alive) continue;
      try {
        await bot.sendMessage(p.userId,
          `📢 *Раунд ${game.round}*\n\nОбсуждайте в чате и голосуйте.`,
          {
            parse_mode: 'Markdown',
            reply_markup: {
              inline_keyboard: [[
                { text: '🗳️ Голосовать', web_app: { url: webappUrl(chatId, p.userId) } }
              ]]
            }
          }
        );
      } catch (e) {}
    }
  }
}

process.on('unhandledRejection', (err) => {
  console.error('⚠️ Unhandled:', err.message);
});

console.log('🤖 Бот запущен...');
