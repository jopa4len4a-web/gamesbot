// app.js — WebApp с авто-определением пользователя

const tg = window.Telegram.WebApp;
tg.ready();
tg.expand();
if (tg.setHeaderColor) tg.setHeaderColor('#0a0a0a');
if (tg.setBackgroundColor) tg.setBackgroundColor('#0a0a0a');

const urlParams = new URLSearchParams(window.location.search);
const chatId = urlParams.get('chatId');
const userIdFromUrl = parseInt(urlParams.get('userId'), 10);
const userIdFromTg = tg.initDataUnsafe?.user?.id;
let userId = userIdFromTg || userIdFromUrl;

let state = null;
let pollingInterval = null;

// ===== Автоопределение userId через /api/whoami =====
async function resolveUserId() {
  if (userId) return userId;
  try {
    const res = await fetch('/api/whoami', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ initData: tg.initData, chatId })
    });
    const data = await res.json();
    if (data.user?.id) {
      userId = data.user.id;
      console.log('userId определён через /api/whoami:', userId);
      return userId;
    }
  } catch (e) {
    console.error('Не удалось определить userId:', e);
  }
  return null;
}

// ===== API =====
async function fetchState() {
  if (!chatId) return null;
  if (!userId) await resolveUserId();
  if (!userId) return null;
  try {
    const res = await fetch(`/api/state?chatId=${chatId}&userId=${userId}`);
    if (!res.ok) {
      const err = await res.json();
      console.error('API error:', err);
      return null;
    }
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
    document.getElementById('playerCards').innerHTML = `
      <div class="card hidden">
        <div class="card-label">ОШИБКА</div>
        <div class="card-value">Не удалось загрузить игру</div>
      </div>
      <p class="hint">
        userId: <b>${userId || '—'}</b><br>
        chatId: <b>${chatId || '—'}</b><br><br>
        Открой WebApp <b>из ЛС с ботом</b>.
      </p>
    `;
    return;
  }

  document.getElementById('catastropheText').textContent = state.catastrophe;
  document.getElementById('roundInfo').textContent = state.round;

  renderCards(state.me, state.debug);
  renderPlayers(state.players);
  renderVoteButtons(state.players, userId, state.me);
}

function renderCards(player, debug) {
  const container = document.getElementById('playerCards');
  container.innerHTML = '';

  if (!player) {
    // Показываем подробную отладку
    const playersList = (debug?.playerIds || []).map(p =>
      `• ${p.username} (id: ${p.userId})`
    ).join('<br>') || '—';

    container.innerHTML = `
      <div class="card revealed" style="border-color:#e63946">
        <div class="card-label" style="color:#e63946">ОШИБКА</div>
        <div class="card-value">Тебя нет в списке игроков</div>
      </div>
      <div class="card hidden">
        <div class="card-label">ТВОЙ ID</div>
        <div class="card-value">${userId || '—'}</div>
      </div>
      <div class="card hidden">
        <div class="card-label">CHAT ID</div>
        <div class="card-value">${chatId || '—'}</div>
      </div>
      <div class="card hidden">
        <div class="card-label">ИГРОКИ В ИГРЕ</div>
        <div class="card-value" style="font-size:12px;line-height:1.6">${playersList}</div>
      </div>
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

// ===== Обновление =====
async function refresh() {
  state = await fetchState();
  renderAll();
}

function startPolling() {
  if (pollingInterval) clearInterval(pollingInterval);
  pollingInterval = setInterval(refresh, 3000);
}

(async () => {
  await resolveUserId();
  await refresh();
  startPolling();
})();
