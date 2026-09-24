// index.js — точка входа

require('dotenv').config();
const http = require('http');
const fs = require('fs');
const path = require('path');
const TelegramBot = require('node-telegram-bot-api');
const { generatePlayer, catastrophes, randomItem } = require('./game');

const BOT_TOKEN = process.env.BOT_TOKEN || "ТВОЙ_ТОКЕН_СЮДА";
const PORT = process.env.PORT || 3000;

const bot = new TelegramBot(BOT_TOKEN, { polling: true });

// ===== Хранилище активных игр =====
const games = {}; // { chatId: { players: [], catastrophe, round, state } }

// ===== HTTP-сервер для WebApp =====
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
    if (err) {
      res.writeHead(404); res.end('Файл не найден'); return;
    }
    res.writeHead(200, { 'Content-Type': contentType });
    res.end(content, 'utf-8');
  });
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`✅ Сервер запущен на порту ${PORT}`);
});

// ===== Команды бота =====

bot.onText(/\/start/, (msg) => {
  const chatId = msg.chat.id;
  const webAppUrl = `https://твой-домен.bothost.tech/`; // ЗАМЕНИ ПОСЛЕ ДЕПЛОЯ

  bot.sendMessage(chatId,
    `🎮 **Бункер** — игра на выживание.\n\n` +
    `Глобальная катастрофа. Мест в бункере меньше, чем людей.\n` +
    `Убеди остальных, что ты достоин выжить.\n\n` +
    `Команды:\n` +
    `/create — создать игру\n` +
    `/join — присоединиться\n` +
    `/startgame — начать (для создателя)\n` +
    `/status — статус игры`,
    {
      parse_mode: 'Markdown',
      reply_markup: {
        inline_keyboard: [[
          { text: '🎮 Открыть WebApp', web_app: { url: webAppUrl } }
        ]]
      }
    }
  );
});

bot.onText(/\/create/, (msg) => {
  const chatId = msg.chat.id;
  if (games[chatId]) {
    bot.sendMessage(chatId, '⚠️ Игра уже создана. Используй /join или /startgame.');
    return;
  }
  games[chatId] = {
    players: [],
    catastrophe: randomItem(catastrophes),
    round: 0,
    state: 'lobby',
    hostId: msg.from.id
  };
  bot.sendMessage(chatId, `🏗️ Игра создана!\n\nКатастрофа: **${games[chatId].catastrophe}**\n\nИгроки присоединяются командой /join. Создатель начинает игру командой /startgame.`, { parse_mode: 'Markdown' });
});

bot.onText(/\/join/, (msg) => {
  const chatId = msg.chat.id;
  const game = games[chatId];
  if (!game || game.state !== 'lobby') {
    bot.sendMessage(chatId, '❌ Нет активной игры в лобби. Создай: /create');
    return;
  }
  if (game.players.find(p => p.userId === msg.from.id)) {
    bot.sendMessage(chatId, '⚠️ Ты уже в игре.');
    return;
  }
  const player = generatePlayer(msg.from.id, msg.from.username);
  game.players.push(player);
  bot.sendMessage(chatId, `✅ **${player.username}** присоединился. (${game.players.length} игроков)`, { parse_mode: 'Markdown' });
});

bot.onText(/\/startgame/, (msg) => {
  const chatId = msg.chat.id;
  const game = games[chatId];
  if (!game) { bot.sendMessage(chatId, '❌ Нет игры. /create'); return; }
  if (msg.from.id !== game.hostId) { bot.sendMessage(chatId, '❌ Только создатель может начать.'); return; }
  if (game.players.length < 3) { bot.sendMessage(chatId, '❌ Нужно минимум 3 игрока.'); return; }

  game.state = 'playing';
  game.round = 1;

  bot.sendMessage(chatId,
    `🎬 **Игра началась!**\n\n` +
    `Раунд 1. Обсуждайте и голосуйте.\n` +
    `Открой WebApp, чтобы увидеть свои карты и голосовать.`,
    {
      parse_mode: 'Markdown',
      reply_markup: {
        inline_keyboard: [[
          { text: '🎮 Открыть WebApp', web_app: { url: `https://твой-домен.bothost.tech/?chatId=${chatId}` } }
        ]]
      }
    }
  );
});

// ===== API для WebApp =====
// Простой эндпоинт для получения состояния игры
// В реальном проекте используй WebSocket или long polling

// Обработка данных от WebApp (через sendData)
bot.on('web_app_data', (msg) => {
  const chatId = msg.chat.id;
  const data = JSON.parse(msg.web_app_data.data);
  const game = games[chatId];

  if (!game) return;

  if (data.action === 'vote') {
    const target = game.players.find(p => p.userId === data.targetId);
    if (target) {
      target.votes = (target.votes || 0) + 1;
    }

    // Проверяем, все ли проголосовали
    const totalVotes = game.players.reduce((sum, p) => sum + (p.votes || 0), 0);
    if (totalVotes >= game.players.filter(p => p.alive).length) {
      // Голосование завершено
      let maxVotes = 0;
      let eliminated = null;
      game.players.forEach(p => {
        if (p.alive && p.votes > maxVotes) { maxVotes = p.votes; eliminated = p; }
      });
      if (eliminated) {
        eliminated.alive = false;
        bot.sendMessage(chatId, `🗳️ **${eliminated.username}** изгнан из бункера!`, { parse_mode: 'Markdown' });
      }
      // Сброс голосов
      game.players.forEach(p => p.votes = 0);
      game.round++;

      const aliveCount = game.players.filter(p => p.alive).length;
      if (aliveCount <= Math.ceil(game.players.length / 2)) {
        game.state = 'finished';
        const winners = game.players.filter(p => p.alive).map(p => p.username).join(', ');
        bot.sendMessage(chatId, `🏆 **Игра окончена!**\n\nВыжившие: ${winners}\n\nСыграть ещё: /create`, { parse_mode: 'Markdown' });
      } else {
        bot.sendMessage(chatId, `📢 Раунд ${game.round}. Обсуждайте!`, { parse_mode: 'Markdown' });
      }
    }
  }
});

console.log('🤖 Бот запущен...');
