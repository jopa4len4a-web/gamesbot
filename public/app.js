// app.js — логика WebApp

const tg = window.Telegram.WebApp;
tg.ready();
tg.expand();
if (tg.setHeaderColor) tg.setHeaderColor('#0a0a0a');
if (tg.setBackgroundColor) tg.setBackgroundColor('#0a0a0a');

const urlParams = new URLSearchParams(window.location.search);
const chatId = urlParams.get('chatId') || '0';

// ===== Демо-персонаж (пока без API) =====
const demoPlayer = {
  userId: 123,
  username: 'Ты',
  alive: true,
  profession: 'Хирург',
  health: 'Идеально здоров',
  hobby: 'Радиолюбительство',
  luggage: 'Аптечка',
  fact: 'Служил в армии 5 лет',
  revealed: []
};

const demoPlayers = [
  { userId: 123, username: 'Ты', alive: true },
  { userId: 1, username: 'Алекс', alive: true },
  { userId: 2, username: 'Мария', alive: true },
  { userId: 3, username: 'Дмитрий', alive: true },
  { userId: 4, username: 'Ольга', alive: true }
];

// ===== Рендер карточек =====
function renderCards(player) {
  const container = document.getElementById('playerCards');
  container.innerHTML = '';

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
    card.onclick = () => {
      if (!revealed) {
        player.revealed.push(f.key);
        if (tg.HapticFeedback) tg.HapticFeedback.impactOccurred('medium');
        renderCards(player);
      }
    };
    container.appendChild(card);
  });
}

// ===== Рендер игроков =====
function renderPlayers(players) {
  const container = document.getElementById('playersList');
  container.innerHTML = '';
  players.forEach(p => {
    const tag = document.createElement('div');
    tag.className = `player-tag ${p.alive ? '' : 'dead'}`;
    tag.textContent = p.username;
    container.appendChild(tag);
  });
}

// ===== Рендер голосования =====
function renderVoteButtons(players, myId) {
  const container = document.getElementById('voteButtons');
  container.innerHTML = '';
  const targets = players.filter(p => p.alive && p.userId !== myId);

  if (!targets.length) {
    container.innerHTML = '<p class="hint">Нет доступных игроков для голосования</p>';
    return;
  }

  targets.forEach(p => {
    const btn = document.createElement('button');
    btn.className = 'vote-btn';
    btn.textContent = `⚔️ Голосовать против ${p.username}`;
    btn.onclick = () => {
      tg.sendData(JSON.stringify({ action: 'vote', targetId: p.userId, chatId }));
      if (tg.HapticFeedback) tg.HapticFeedback.notificationOccurred('success');
      btn.classList.add('voted');
      btn.textContent = `✅ Голос отдан (${p.username})`;
    };
    container.appendChild(btn);
  });
}

// ===== Инициализация =====
document.getElementById('catastropheText').textContent =
  '☢️ Ядерная война. Радиация снаружи смертельна.';
document.getElementById('roundInfo').textContent = '1';

renderCards(demoPlayer);
renderPlayers(demoPlayers);
renderVoteButtons(demoPlayers, demoPlayer.userId);
