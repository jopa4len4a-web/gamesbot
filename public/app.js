// app.js — WebApp с реальными данными

const tg = window.Telegram.WebApp;
tg.ready();
tg.expand();
if (tg.setHeaderColor) tg.setHeaderColor('#0a0a0a');
if (tg.setBackgroundColor) tg.setBackgroundColor('#0a0a0a');

const urlParams = new URLSearchParams(window.location.search);
const chatId = urlParams.get('chatId');
const userId = tg.initDataUnsafe?.user?.id;

let state = null;
let pollingInterval = null;

// ===== API =====
async function fetchState() {
  if (!chatId || !userId) {
    console.log('Нет chatId или userId');
    return null;
  }
  try {
    const res = await fetch(`/api/state?chatId=${chatId}&userId=${userId}`);
    if (!res.ok) return null;
    return await res.json();
  } catch (e) {
    console.error('Ошибка загрузки:', e);
    return null;
  }
}

async function revealCard(field) {
  try {
    await fetch('/api/reveal', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chatId, userId, field })
    });
    if (tg.HapticFeedback) tg.HapticFeedback.impactOccurred('medium');
  } catch (e) {}
}

async function sendVote(targetId) {
  try {
    const res = await fetch('/api/vote', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chatId, userId, targetId })
    });
    const data = await res.json();
    if (data.ok) {
      if (tg.HapticFeedback) tg.HapticFeedback.notificationOccurred('success');
      // Обновим состояние
      await refresh();
    }
  } catch (e) {
    console.error('Ошибка голосования:', e);
  }
}

// ===== Рендер =====
function renderAll() {
  if (!state) {
    document.getElementById('catastropheText').textContent = 'Игра не найдена';
    document.getElementById('playerCards').innerHTML =
      '<p class="hint">Открой игру через бота</p>';
    return;
  }

  // Катастрофа
  document.getElementById('catastropheText').textContent = state.catastrophe;
  document.getElementById('roundInfo').textContent = state.round;

  // Карточки игрока
  renderCards(state.me);

  // Игроки
  renderPlayers(state.players);

  // Голосование
  renderVoteButtons(state.players, userId, state.me);
}

function renderCards(player) {
  const container = document.getElementById('playerCards');
  container.innerHTML = '';

  if (!player) {
    container.innerHTML = '<p class="hint">Тебя нет в игре</p>';
    return;
  }

  const fields = [
    { key: 'profession', label: 'ПРОФЕССИЯ', icon: '🔧' },
    { key: 'health', label: 'ЗДОРОВЬЕ', icon: '❤️' },
    { key: 'hobby', label: 'ХОББИ', icon: '🎯' },
    { key: 'luggage', label: 'БАГАЖ', icon: '🎒' },
    { key: 'fact', label: 'ФАКТ', icon: '📌' }
  ];

  fields.forEach(f => {
    const revealed = player.revealed.includes(f.key);
    const card = document.createElement('div');
    card.className = `card ${revealed ? 'revealed' : 'hidden'}`;
    card.innerHTML = `
      <div class="card-label">${f.icon} ${f.label}</div>
      <div class="card-value">${revealed ? player[f.key] : '████████'}</div>
    `;
    card.onclick = async () => {
      if (!revealed) {
        await revealCard(f.key);
        await refresh();
      }
    };
    container.appendChild(card);
  });
}

function renderPlayers(players) {
  const container = document.getElementById('playersList');
  container.innerHTML = '';
  players.forEach(p => {
    const tag = document.createElement('div');
    tag.className = `player-tag ${p.alive ? '' : 'dead'}`;
    tag.textContent = p.username + (p.votes ? ` (${p.votes})` : '');
    container.appendChild(tag);
  });
}

function renderVoteButtons(players, myId, me) {
  const container = document.getElementById('voteButtons');
  container.innerHTML = '';

  if (!me || !me.alive) {
    container.innerHTML = '<p class="hint">Ты не участвуешь в голосовании</p>';
    return;
  }

  const targets = players.filter(p => p.alive && p.userId !== myId);

  if (!targets.length) {
    container.innerHTML = '<p class="hint">Нет доступных игроков</p>';
    return;
  }

  targets.forEach(p => {
    const btn = document.createElement('button');
    const hasVoted = me.votedFor !== null && me.votedFor !== undefined;
    const votedThis = me.votedFor === p.userId;

    btn.className = `vote-btn ${votedThis ? 'voted' : ''}`;
    btn.textContent = votedThis
      ? `✅ Голос отдан (${p.username})`
      : (hasVoted
        ? `✅ Ты уже проголосовал`
        : `⚔️ Голосовать против ${p.username}`);
    btn.disabled = hasVoted;
    btn.onclick = () => sendVote(p.userId);
    container.appendChild(btn);
  });
}

// ===== Обновление =====
async function refresh() {
  state = await fetchState();
  renderAll();
}

// ===== Поллинг =====
function startPolling() {
  if (pollingInterval) clearInterval(pollingInterval);
  pollingInterval = setInterval(refresh, 3000);
}

// ===== Запуск =====
(async () => {
  await refresh();
  startPolling();
})();
