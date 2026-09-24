// app.js — логика WebApp

const tg = window.Telegram.WebApp;
tg.ready();
tg.expand();

const urlParams = new URLSearchParams(window.location.search);
const chatId = urlParams.get('chatId') || '0';

let myPlayer = null;

// ===== Рендер карточек характеристик =====
function renderCards(player) {
  const container = document.getElementById('playerCards');
  container.innerHTML = '';

  const fields = [
    { key: 'profession', label: 'ПРОФЕССИЯ' },
    { key: 'health', label: 'ЗДОРОВЬЕ' },
    { key: 'hobby', label: 'ХОББИ' },
    { key: 'luggage', label: 'БАГАЖ' },
    { key: 'fact', label: 'ФАКТ' }
  ];

  fields.forEach(f => {
    const revealed = player.revealed.includes(f.key);
    const card = document.createElement('div');
    card.className = `card ${revealed ? 'revealed' : 'hidden'}`;
    card.innerHTML = `
      <div class="card-label">${f.label}</div>
      <div class="card-value">${revealed ? player[f.key] : '█ █ █ █ █'}</div>
    `;
    card.onclick = () => {
      if (!revealed) {
        player.revealed.push(f.key);
        if (tg.HapticFeedback) tg.HapticFeedback.impactOccurred('light');
        renderCards(player);
      }
    };
    container.appendChild(card);
  });
}

// ===== Рендер списка игроков =====
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

// ===== Рендер кнопок голосования =====
function renderVoteButtons(players, myId) {
  const container = document.getElementById('voteButtons');
  container.innerHTML = '';
  players.filter(p => p.alive && p.userId !== myId).forEach(p => {
    const btn = document.createElement('button');
    btn.className = 'vote-btn';
    btn.textContent = `Голосовать против ${p.username}`;
    btn.onclick = () => {
      tg.sendData(JSON.stringify({ action: 'vote', targetId: p.userId }));
      if (tg.HapticFeedback) tg.HapticFeedback.notificationOccurred('success');
      btn.classList.add('voted');
      btn.textContent = `✅ Голос отдан (${p.username})`;
    };
    container.appendChild(btn);
  });
}

// ===== Демо-данные (заглушка до подключения API) =====
const demoPlayer = {
  userId: 123,
  username: 'Ты',
  alive: true,
  profession: 'Хирург',
  health: 'Идеально здоров',
  hobby: 'Рыбалка',
  luggage: 'Аптечка',
  fact: 'Служил в армии',
  revealed: []
};

const demoPlayers = [
  demoPlayer,
  { userId: 1, username: 'Алекс', alive: true },
  { userId: 2, username: 'Мария', alive: true },
  { userId: 3, username: 'Дмитрий', alive: true }
];

document.getElementById('catastropheText').textContent = 'Ядерная война. Радиация снаружи смертельна.';
document.getElementById('roundInfo').textContent = 'Раунд: 1';
renderCards(demoPlayer);
renderPlayers(demoPlayers);
renderVoteButtons(demoPlayers, demoPlayer.userId);
