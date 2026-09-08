(() => {
  const DIFFICULTIES = {
    easy:   { size: 6, colors: 3 },
    medium: { size: 8, colors: 4 },
    hard:   { size: 10, colors: 5 },
  };

  const LEVEL_UP_SCORE = 300; // score needed per level, raises color count (difficulty)

  const PALETTE = [
    '#ff6b35', // orange
    '#3fd6ff', // cyan
    '#7dff6b', // green
    '#ffd23f', // yellow
    '#ff3f8e', // pink
    '#b06bff', // purple
  ];

  const boardEl = document.getElementById('board');
  const scoreEl = document.getElementById('score');
  const bestEl = document.getElementById('best');
  const levelEl = document.getElementById('level');
  const movesEl = document.getElementById('moves');
  const messageEl = document.getElementById('message');
  const previewEl = document.getElementById('preview');
  const newGameBtn = document.getElementById('newGame');
  const diffBtns = document.querySelectorAll('.diff-btn');

  let difficulty = 'medium';
  let size, baseColors, colorCount, cells, groupSizes, movesMade, score, level, busy;

  function loadBest() {
    return Number(localStorage.getItem('doomscroll_best') || 0);
  }
  function saveBest(value) {
    localStorage.setItem('doomscroll_best', String(value));
  }

  function setDifficulty(name) {
    difficulty = name;
    diffBtns.forEach(b => b.classList.toggle('active', b.dataset.diff === name));
  }

  function startGame() {
    const cfg = DIFFICULTIES[difficulty];
    size = cfg.size;
    baseColors = cfg.colors;
    colorCount = baseColors;
    movesMade = 0;
    score = 0;
    level = 1;
    busy = false;
    buildBoard();
    updateStats();
    messageEl.textContent = '';
    previewEl.textContent = 'Hover a bomb group to preview its chain and score.';
  }

  function buildBoard() {
    cells = Array.from({ length: size * size }, () => Math.floor(Math.random() * colorCount));
    groupSizes = computeGroupSizes();
    guaranteeMove();
    render();
  }

  // If the board ever has no group of 2+, force one so play can always continue.
  function guaranteeMove() {
    if (groupSizes.some(s => s >= 2)) return;
    for (let i = 0; i < cells.length; i++) {
      const n = neighbors(i);
      if (n.length) {
        cells[n[0]] = cells[i];
        groupSizes = computeGroupSizes();
        return;
      }
    }
  }

  function neighbors(i) {
    const row = Math.floor(i / size);
    const col = i % size;
    const result = [];
    if (row > 0) result.push(i - size);
    if (row < size - 1) result.push(i + size);
    if (col > 0) result.push(i - 1);
    if (col < size - 1) result.push(i + 1);
    return result;
  }

  // Flood-fill same-colored bombs connected to the start cell.
  function findChain(start) {
    if (cells[start] === null) return [];
    const color = cells[start];
    const seen = new Set([start]);
    const queue = [start];
    while (queue.length) {
      const current = queue.shift();
      for (const n of neighbors(current)) {
        if (cells[n] === color && !seen.has(n)) {
          seen.add(n);
          queue.push(n);
        }
      }
    }
    return [...seen];
  }

  // Scan the whole board once so every cell knows its group size, letting us
  // mark unclickable single bombs and preview chains cheaply on hover.
  function computeGroupSizes() {
    const sizes = new Array(cells.length).fill(0);
    const visited = new Array(cells.length).fill(false);
    for (let i = 0; i < cells.length; i++) {
      if (cells[i] === null || visited[i]) continue;
      const group = findChain(i);
      group.forEach(idx => {
        visited[idx] = true;
        sizes[idx] = group.length;
      });
    }
    return sizes;
  }

  function render() {
    boardEl.style.gridTemplateColumns = `repeat(${size}, 1fr)`;
    boardEl.innerHTML = '';
    cells.forEach((color, i) => {
      const cell = document.createElement('div');
      const hasBomb = color !== null;
      const poppable = hasBomb && groupSizes[i] >= 2;
      cell.className = 'cell' + (hasBomb ? ' bomb' : '') + (poppable ? ' poppable' : '') + (hasBomb && !poppable ? ' isolated' : '');
      cell.dataset.index = i;
      if (hasBomb) {
        cell.style.color = PALETTE[color];
        cell.style.background = `${PALETTE[color]}33`;
        cell.textContent = '💣';
      }
      if (poppable) {
        cell.addEventListener('click', () => onCellClick(i));
        cell.addEventListener('mouseenter', () => showPreview(i));
        cell.addEventListener('mouseleave', clearPreview);
      }
      boardEl.appendChild(cell);
    });
  }

  function showPreview(i) {
    const chain = findChain(i);
    chain.forEach(idx => boardEl.children[idx].classList.add('highlight'));
    const potential = chain.length * chain.length * level;
    previewEl.textContent = `Chain of ${chain.length} bombs → +${potential} pts`;
  }

  function clearPreview() {
    Array.from(boardEl.children).forEach(el => el.classList.remove('highlight'));
    previewEl.textContent = 'Hover a bomb group to preview its chain and score.';
  }

  function onCellClick(i) {
    if (busy || cells[i] === null || groupSizes[i] < 2) return;
    const chain = findChain(i);
    busy = true;
    movesMade++;
    updateStats();
    explodeChain(chain);
  }

  function explodeChain(chain) {
    const cellEls = boardEl.children;
    const colorOfChain = PALETTE[cells[chain[0]]];
    chain.forEach((idx, order) => {
      setTimeout(() => {
        const el = cellEls[idx];
        el.classList.add('exploding');
        spawnParticles(el, colorOfChain);
        cells[idx] = null;
      }, order * 60);
    });

    const totalDelay = chain.length * 60 + 500;
    setTimeout(() => {
      applyGravity();
      refillTop();
      groupSizes = computeGroupSizes();
      guaranteeMove();
      score += chain.length * chain.length * level;
      updateLevel();
      render();
      clearPreview();
      updateStats();
      busy = false;
    }, totalDelay);
  }

  // Bombs fall to fill empty space below them within their column.
  function applyGravity() {
    for (let col = 0; col < size; col++) {
      const values = [];
      for (let row = 0; row < size; row++) {
        const v = cells[row * size + col];
        if (v !== null) values.push(v);
      }
      const padded = Array(size - values.length).fill(null).concat(values);
      for (let row = 0; row < size; row++) {
        cells[row * size + col] = padded[row];
      }
    }
  }

  // New bombs drop in from the top to refill the empty space gravity left behind.
  function refillTop() {
    for (let i = 0; i < cells.length; i++) {
      if (cells[i] === null) cells[i] = Math.floor(Math.random() * colorCount);
    }
  }

  function spawnParticles(el, color) {
    for (let p = 0; p < 6; p++) {
      const particle = document.createElement('span');
      particle.className = 'particle';
      const angle = (Math.PI * 2 * p) / 6;
      const dist = 26 + Math.random() * 14;
      particle.style.setProperty('--dx', `${Math.cos(angle) * dist}px`);
      particle.style.setProperty('--dy', `${Math.sin(angle) * dist}px`);
      particle.style.background = color;
      el.appendChild(particle);
      setTimeout(() => particle.remove(), 650);
    }
  }

  // Difficulty ramps up with score: more colors makes matches harder to find.
  function updateLevel() {
    const newLevel = 1 + Math.floor(score / LEVEL_UP_SCORE);
    if (newLevel === level) return;
    level = newLevel;
    colorCount = Math.min(PALETTE.length, baseColors + level - 1);
    messageEl.textContent = `Level ${level}! Bombs are getting trickier...`;
    setTimeout(() => { messageEl.textContent = ''; }, 1500);
  }

  function updateStats() {
    if (score > loadBest()) saveBest(score);
    scoreEl.textContent = score;
    bestEl.textContent = Math.max(loadBest(), score);
    levelEl.textContent = level;
    movesEl.textContent = movesMade;
  }

  diffBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      setDifficulty(btn.dataset.diff);
      startGame();
    });
  });
  newGameBtn.addEventListener('click', startGame);

  setDifficulty(difficulty);
  startGame();
})();
