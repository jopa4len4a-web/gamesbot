// index.js — Бункер для Telegram-чата

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
const games = {}; // chatId -> game

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

function escapeMd(t) { return String(t).replace(/[*_`\[\]()]/g, '\\$&'); }

function playerList(game) {
  if (!game.players.length) return '_пока никого_';
  return game.players.map((p, i) =>
    `${i + 1}. ${p.alive ? '🟢' : '🔴'} ${escapeMd(p.username)}`
  ).join('\n');
}

function webappUrl(chatId) {
  return `${WEBAPP_URL}?chatId=${chatId}`;
}

// ===== Deep-link для вступления (ведёт в личку с ботом) =====
function joinDeepLink(chatId) {
  // Формат: https://t.me/имя_бота?start=join_CHATID
  return `https://t.me/igratestadrbot?start=join_${chatId}`;
}

// ===== Клавиатура лобби в ГРУППЕ =====
function lobbyKeyboard(chatId) {
  return {
    inline_keyboard: [
      [{ text: '✋ Вступить в игру', callback_data: `join_${chatId}` }],
      [{ text: '👥 Список игроков', callback_data: `list_${chatId}` }],
      [{ text: '🚀 Старт', callback_data: `start_${chatId}` }]
    ]
  };
}

// ===== /start в ЛИЧКЕ =====
bot.onText(/\/start(.*)/, async (msg, match) => {
  const chatId = msg.chat.id;
  const payload = (match[1] || '').trim(); // например "join_-100123456"

  // Если это личка
  if (msg.chat.type === 'private') {
    if (payload.startsWith('join_')) {
      const groupId = payload.replace('join_', '');
      const game = games[groupId];

      if (!game || game.state !== 'lobby') {
        bot.sendMessage(chatId, '❌ Лобби уже закрыто или не найдено.');
        return;
      }

      // Добавляем игрока, если ещё не в игре
      if (!game.players.find(p => p.userId === msg.from.id)) {
        const player = generatePlayer(msg.from.id, msg.from.username || msg.from.first_name);
        game.players.push(player);
      }

      // Отправляем в группу уведомление
      try {
        bot.sendMessage(groupId,
          `✅ *${escapeMd(msg.from.first_name)}* присоединился к игре! (${game.players.length})`,
          { parse_mode: 'Markdown' }
        );
      } catch (e) {}

      // В личке показываем статус ожидания
      bot.sendMessage(chatId,
        `🎯 *Ты в игре!*\n\n` +
        `☢️ Катастрофа: _${game.catastrophe}_\n\n` +
        `👥 Игроков: *${game.players.length}*\n\n` +
        `⏳ Ждём старта. Как только хост запустит игру — я пришлю тебе твою карточку выжившего.\n\n` +
        `_Можешь свернуть чат и ждать._`,
        { parse_mode: 'Markdown' }
      );
      return;
    }

    // Обычный /start в личке — показываем демо
    bot.sendMessage(chatId,
      `🏚️ *БУНКЕР*\n\n` +
      `_Игра на выживание для компании_\n\n` +
      `🎮 Хочешь попробовать? Открой демо-карточку.`,
      {
        parse_mode: 'Markdown',
        reply_markup: {
          inline_keyboard: [
            [{ text: '🎮 Открыть демо', web_app: { url: `${WEBAPP_URL}?demo=1` } }]
          ]
        }
      }
    );
    return;
  }

  // /start в группе
  bot.sendMessage(chatId,
    `🏚️ *БУНКЕР*\n\n` +
    `_Игра на выживание для компании_\n\n` +
    `📍 *Команды:*\n` +
    `/newgame — создать лобби\n` +
    `/join — вступить\n` +
    `/startgame — начать (от 3 игроков)\n` +
    `/forcestart — принудительный старт (админ)\n` +
    `/status — статус\n` +
    `/endgame — закончить`,
    { parse_mode: 'Markdown' }
  );
});

// ===== /newgame — создание лобби =====
bot.onText(/\/newgame/, async (msg) => {
  const chatId = msg.chat.id;

  if (games[chatId]) {
    bot.sendMessage(chatId, '⚠️ Игра уже создана. /startgame или /endgame');
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
    `🎬 *ЛОББИ ОТКРЫТО!*\n\n` +
    `☢️ Катастрофа: *${games[chatId].catastrophe}*\n\n` +
    `👥 Игроков: *0*\n\n` +
    `👇 Жми *«Вступить в игру»* — я открою личку с ботом, где ты будешь ждать старта.`,
    {
      parse_mode: 'Markdown',
      reply_markup: {
        inline_keyboard: [
          [{ text: '✋ Вступить в игру', url: `https://t.me/${(await bot.getMe()).username}?start=join_${chatId}` }],
          [{ text: '👥 Список игроков', callback_data: `list_${chatId}` }],
          [{ text: '🚀 Старт', callback_data: `start_${chatId}` }]
        ]
      }
    }
  );
});

// ===== /join — быстрый вступ через команду в группе =====
bot.onText(/\/join/, async (msg) => {
  const chatId = msg.chat.id;
  const game = games[chatId];

  if (!game || game.state !== 'lobby') {
    bot.sendMessage(chatId, '❌ Нет активного лобби. /newgame');
    return;
  }
  if (game.players.find(p => p.userId === msg.from.id)) {
    bot.sendMessage(chatId, '⚠️ Ты уже в игре.');
    return;
  }

  const player = generatePlayer(msg.from.id, msg.from.username || msg.from.first_name);
  game.players.push(player);

  bot.sendMessage(chatId,
    `✅ *${escapeMd(player.username)}* в игре! (${game.players.length})`,
    { parse_mode: 'Markdown' }
  );
});

// ===== Callback: список игроков =====
bot.on('callback_query', async (query) => {
  const data = query.data;
  const chatId = query.message.chat.id;
  const game = games[chatId];

  if (!game) {
    bot.answerCallbackQuery(query.id, { text: '❌ Нет игры', show_alert: true });
    return;
  }

  if (data.startsWith('list_')) {
    bot.answerCallbackQuery(query.id);
    bot.sendMessage(chatId,
      `👥 *Игроки в лобби (${game.players.length}):*\n\n${playerList(game)}`,
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

// ===== Запуск игры: рассылка WebApp всем игрокам в личку =====
async function launchGame(chatId) {
  const game = games[chatId];
  if (!game) return;

  game.state = 'playing';
  game.round = 1;

  // Сообщение в группу
  bot.sendMessage(chatId,
    `🎬 *ИГРА НАЧАЛАСЬ!*\n\n` +
    `☢️ Катастрофа: _${game.catastrophe}_\n\n` +
    `👥 *Игроки:*\n${playerList(game)}\n\n` +
    `📍 Раунд *1*. Обсуждайте в чате!\n\n` +
    `📱 *Каждому игроку я отправил в личку его карточку.*`,
    { parse_mode: 'Markdown' }
  );

  // Рассылка WebApp в личку каждому
  for (const player of game.players) {
    try {
      await bot.sendMessage(player.userId,
        `🎮 *ТВОЯ КАРТОЧКА ВЫЖИВШЕГО*\n\n` +
        `☢️ Катастрофа: _${game.catastrophe}_\n\n` +
        `📍 Раунд *1*\n\n` +
        `👇 Открой, чтобы увидеть свои характеристики:`,
        {
          parse_mode: 'Markdown',
          reply_markup: {
            inline_keyboard: [[
              { text: '🃏 Открыть карточку', web_app: { url: webappUrl(chatId) } }
            ]]
          }
        }
      );
    } catch (e) {
      // Игрок не запускал бота — не можем написать
      bot.sendMessage(chatId,
        `⚠️ Не могу написать в личку одному из игроков (не запускал бота).`,
      ).catch(() => {});
    }
  }
}

// ===== /startgame =====
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

// ===== /forcestart =====
bot.onText(/\/forcestart/, async (msg) => {
  const chatId = msg.chat.id;
  const admin = await isAdmin(chatId, msg.from.id);
  if (!admin) { bot.sendMessage(chatId, '❌ Только админ.'); return; }
  const game = games[chatId];
  if (!game) { bot.sendMessage(chatId, '❌ Нет игры.'); return; }
  if (!game.players.length) { bot.sendMessage(chatId, '❌ Никого нет.'); return; }
  await launchGame(chatId);
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
    bot.sendMessage(chatId, '❌ Только админ или создатель.');
    return;
  }

  delete games[chatId];
  bot.sendMessage(chatId, '🛑 Игра завершена. /newgame');
});

// ===== Обработка ошибок =====
process.on('unhandledRejection', (err) => {
  console.error('⚠️ Unhandled:', err.message);
});

console.log('🤖 Бот запущен...');
