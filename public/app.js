// app.js — WebApp (финальная версия)

const tg = window.Telegram.WebApp;
tg.ready();
tg.expand();
if (tg.setHeaderColor) tg.setHeaderColor('#0a0a0a');
if (tg.setBackgroundColor) tg.setBackgroundColor('#0a0a0a');

const urlParams = new URLSearchParams(window.location.search);
const chatId = urlParams.get('chatId');
const userIdFromUrl = parseInt(urlParams.get('userId'), 10);
const userIdFromTg = tg.initDataUnsafe?.user?.id;
const userId = userIdFromTg || userIdFromUrl || null;

let state = null;
let pollingInterval = null;
let lastError = null;

// ===== API =====
async function fetchState() {
  if (!chatId) {
    lastError = 'chatId не передан в URL';
    return null;
  }
  if (!userId) {
    lastError = 'userId не определён';
    return null;
  }
  try {
    const res = await fetch(`/api/state?chatId=${chatId}&userId=${userId}`);
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      lastError = err.error || `HTTP ${res.status}`;
      return null;
    }
    lastError = null;
    return await res.json();
  } catch (e) {
    lastError = 'Ошибка сети';
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
      await refresh();
    }
  } catch (e) {}
}

// ===== Рендер =====
function renderAll() {
  const catEl = document.getElementById('catastropheText');
  const roundEl = document.getElementById('roundInfo');
  const cardsEl = document.getElementById('playerCards');
  const playersEl = document.getElementById('playersList');
  const voteEl = document.getElementById('voteButtons');

  if (!state) {
    catEl.textContent = 'Игра не найдена';
    roundEl.textContent = '—';
    cardsEl.innerHTML = `
      <p class="hint" style="color:#e63946">
        ⚠️ ${lastError || 'Не удалось загрузить игру'}<br><br>
        chatId: <b>${chatId || '—'}</b><br>
        userId: <b>${userId || '—'}</b><br><br>
        Открой игру через кнопку <b>«🃏 Открыть карточку»</b> в ЛС с ботом.
      </p>
    `;
    playersEl.innerHTML = '';
    voteEl.innerHTML = '<p class="hint">Нет данных</p>';
    return;
  }

  catEl.textContent = state.catastrophe;
  roundEl.textContent = state.round;

  if (state.state === 'lobby') {
    cardsEl.innerHTML = '<p class="hint">⏳ Игра ещё не началась. Жди старта в чате.</p>';
    playersEl.innerHTML = '';
    voteEl.innerHTML = '';
    return;
  }

  renderCards(state.me);
  renderPlayers(state.players);
  renderVoteButtons(state.players, userId, state.me);
}

function renderCards(player) {
  const container = document.getElementById('playerCards');
  container.innerHTML = '';

  if (!player) {
    container.innerHTML = `
      <p class="hint" style="color:#e63946">
        ⚠️ Тебя нет в списке игроков.<br><br>
        Твой userId: <b>${userId}</b><br>
        Игроки в игре: <b>${(state.debug?.playerIds || []).map(p => p.userId).join(', ') || '—'}</b>
      </p>
    `;
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
    const revealed = (player.revealed || []).includes(f.key);
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
      : (hasVoted ? `✅ Ты уже проголосовал` : `⚔️ Голосовать против ${p.username}`);
    btn.disabled = hasVoted;
    btn.onclick = () => sendVote(p.userId);
    container.appendChild(btn);
  });
}

async function refresh() {
  state = await fetchState();
  renderAll();
}

function startPolling() {
  if (pollingInterval) clearInterval(pollingInterval);
  pollingInterval = setInterval(refresh, 3000);
}

(async () => {
  await refresh();
  startPolling();
})();
