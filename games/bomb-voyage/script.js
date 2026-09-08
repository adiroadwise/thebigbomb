(() => {
  const canvas = document.getElementById('game');
  const ctx = canvas.getContext('2d');
  const W = canvas.width;
  const H = canvas.height;

  const streakEl = document.getElementById('streak');
  const bestStreakEl = document.getElementById('bestStreak');
  const attemptsEl = document.getElementById('attempts');
  const difficultyLabelEl = document.getElementById('difficultyLabel');
  const overlayEl = document.getElementById('overlayMessage');
  const restartBtn = document.getElementById('restart');

  // Physics tuning — kept aggressive on purpose, this game is meant to be hard.
  const GRAVITY = 470;          // px/s^2
  const FLAP_VY = -102.5;       // instantaneous upward velocity set on every click (halved)
  const NUDGE_VX = 37.5;        // horizontal velocity kick from an off-center click (halved)
  const DEADZONE = 26;          // px around the stork's x that counts as "center click"
  const MAX_VX = 230;
  const MAX_VY = 430;
  const WIND_STRENGTH = 55;     // px/s^2, ambient side-to-side pressure
  const SAFE_LANDING_SPEED = 190; // combined speed (px/s) allowed for a gentle touchdown
  const GROUND_Y = H - 70;
  const BASE_PAD_WIDTH = 100;
  const MIN_PAD_WIDTH = 46;
  const CRADLE_RATIO = 0.45;    // cradle width as a fraction of the pad width
  const MIN_CRADLE_WIDTH = 24;
  const STORK_W = 46, STORK_H = 40;
  const BOMB_R = 13;
  const BOMB_DROP = STORK_H / 2 + 8 + BOMB_R; // distance from stork center to bomb center
  const COMBO_WINDOW = 350;     // ms between clicks to keep building the combo
  const COMBO_STEP = 0.5;       // multiplier gained per extra quick click
  const COMBO_MAX = 2.0;        // multiplier cap (reached on triple-click)

  // Each level completed (successful landing) unlocks one more hazard type.
  const SPRAYER_SPEED = 90;     // px/s
  const BARN_ROOF_DROP = 130;   // px above the ground the barn roof underside sits
  const BARN_GAP_WIDTH = 70;    // px width of the open side you must fly in through

  let x, y, vx, vy, windSeed, time, flapTimer;
  let padX, padWidth, cradleX, cradleWidth;
  let clouds, hazards, sprayer, barn;
  let streak = 0, attempts = 0;
  let state = 'playing'; // 'playing' | 'landed' | 'crashed'
  let stateTimer = 0;
  let crashAnchorY = 0;
  let lastClickTime = -Infinity, comboCount = 0;
  let comboFlashText = '', comboFlashTimer = 0;

  function currentLevel() { return streak + 1; }

  function loadBestStreak() {
    return Number(localStorage.getItem('bombvoyage_best_streak') || 0);
  }
  function saveBestStreak(value) {
    localStorage.setItem('bombvoyage_best_streak', String(value));
  }

  function rand(min, max) { return min + Math.random() * (max - min); }
  function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

  function resetClouds() {
    clouds = Array.from({ length: 5 }, () => ({
      x: rand(0, W),
      y: rand(40, 220),
      r: rand(24, 46),
      speed: rand(6, 16),
    }));
  }

  function newPad() {
    padWidth = Math.max(MIN_PAD_WIDTH, BASE_PAD_WIDTH - streak * 6);
    padX = rand(30, W - padWidth - 30);
    cradleWidth = Math.max(MIN_CRADLE_WIDTH, padWidth * CRADLE_RATIO);
    cradleX = padX + padWidth / 2 - cradleWidth / 2;
  }

  // One extra hazard type unlocks per level: tree, then building, then the
  // crop sprayer, then the barn that has to be entered from the side.
  // Kept clear of both the pad and the bird's spawn column so every round
  // opens with a safe stretch of sky before any hazard comes into play.
  const SPAWN_X = W / 2;
  const SPAWN_CLEARANCE = 90;

  function makeGroundHazard(type) {
    const width = type === 'tree' ? rand(28, 36) : rand(70, 110);
    const height = type === 'tree' ? rand(110, 160) : rand(150, 220);
    let hx = rand(20, W - 20 - width);
    for (let tries = 0; tries < 20; tries++) {
      hx = rand(20, W - 20 - width);
      const clearsPad = hx + width < padX - 30 || hx > padX + padWidth + 30;
      const clearsSpawn = hx + width < SPAWN_X - SPAWN_CLEARANCE || hx > SPAWN_X + SPAWN_CLEARANCE;
      if (clearsPad && clearsSpawn) break;
    }
    return { type, x: hx, width, height, topY: GROUND_Y - height };
  }

  function makeSprayer() {
    const dir = Math.random() < 0.5 ? 1 : -1;
    return {
      x: dir === 1 ? -60 : W + 60,
      y: rand(160, 340),
      width: 56,
      height: 22,
      dir,
      speed: SPRAYER_SPEED + streak * 4,
    };
  }

  function makeBarn() {
    const openSide = Math.random() < 0.5 ? 'left' : 'right';
    const barnWidth = padWidth + 90;
    const barnX = clamp(padX + padWidth / 2 - barnWidth / 2, 10, W - 10 - barnWidth);
    return { openSide, barnX, barnWidth, roofY: GROUND_Y - BARN_ROOF_DROP, gapWidth: BARN_GAP_WIDTH };
  }

  function setupHazards() {
    const level = currentLevel();
    hazards = [];
    if (level >= 2) hazards.push(makeGroundHazard('tree'));
    if (level >= 3) hazards.push(makeGroundHazard('building'));
    sprayer = level >= 4 ? makeSprayer() : null;
    barn = level >= 5 ? makeBarn() : null;
  }

  function startRound() {
    x = W / 2 + rand(-40, 40);
    y = 90;
    vx = rand(-20, 20);
    vy = 0;
    windSeed = Math.random() * 100;
    time = 0;
    flapTimer = 0;
    lastClickTime = -Infinity;
    comboCount = 0;
    comboFlashTimer = 0;
    newPad();
    setupHazards();
    state = 'playing';
    stateTimer = 0;
    overlayEl.classList.remove('show');
    updateStats();
  }

  function startGame() {
    streak = 0;
    attempts = 0;
    resetClouds();
    startRound();
  }

  function updateStats() {
    streakEl.textContent = streak;
    bestStreakEl.textContent = Math.max(loadBestStreak(), streak);
    attemptsEl.textContent = attempts;
    difficultyLabelEl.textContent = `Level ${currentLevel()}`;
  }

  function showOverlay(text) {
    overlayEl.textContent = text;
    overlayEl.classList.add('show');
  }

  function handleInput(clickX) {
    if (state !== 'playing') return;
    const now = performance.now();
    comboCount = (now - lastClickTime <= COMBO_WINDOW) ? comboCount + 1 : 1;
    lastClickTime = now;
    const multiplier = Math.min(COMBO_MAX, 1 + COMBO_STEP * (comboCount - 1));

    vy = FLAP_VY * multiplier;
    flapTimer = 0.18;
    if (clickX < x - DEADZONE) vx -= NUDGE_VX * multiplier;
    else if (clickX > x + DEADZONE) vx += NUDGE_VX * multiplier;

    if (multiplier > 1) {
      comboFlashText = `×${multiplier.toFixed(1)}`;
      comboFlashTimer = 0.6;
    }
  }

  // Pointer events unify mouse and touch and fire without the ~300ms click
  // delay some mobile browsers add — important for the click-combo timing.
  canvas.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    const rect = canvas.getBoundingClientRect();
    const scaleX = W / rect.width;
    handleInput((e.clientX - rect.left) * scaleX);
  });

  restartBtn.addEventListener('click', startGame);

  function update(dt) {
    time += dt;
    if (flapTimer > 0) flapTimer = Math.max(0, flapTimer - dt);
    if (comboFlashTimer > 0) comboFlashTimer = Math.max(0, comboFlashTimer - dt);

    if (sprayer) {
      sprayer.x += sprayer.dir * sprayer.speed * dt;
      if (sprayer.dir === 1 && sprayer.x - sprayer.width > W) sprayer.x = -sprayer.width;
      if (sprayer.dir === -1 && sprayer.x + sprayer.width < 0) sprayer.x = W + sprayer.width;
    }

    if (state === 'playing') {
      const wind = Math.sin(time * 0.6 + windSeed) * WIND_STRENGTH;
      vy += GRAVITY * dt;
      vx += wind * dt;
      vx *= Math.pow(0.06, dt); // strong horizontal damping so nudges fade fast
      vx = clamp(vx, -MAX_VX, MAX_VX);
      vy = clamp(vy, -9999, MAX_VY);

      x += vx * dt;
      y += vy * dt;

      if (x < STORK_W / 2) { x = STORK_W / 2; vx = 0; }
      if (x > W - STORK_W / 2) { x = W - STORK_W / 2; vx = 0; }
      if (y < STORK_H) { y = STORK_H; if (vy < 0) vy = 0; }

      if (checkHazardCollision() || checkSprayerCollision() || checkBarnCollision()) {
        crash();
        return;
      }

      const bombBottom = y + BOMB_DROP + BOMB_R;
      if (bombBottom >= GROUND_Y) {
        resolveLanding();
      }
    } else {
      stateTimer += dt;
      if (stateTimer > 1.3) startRound();
    }

    clouds.forEach(c => {
      c.x += c.speed * dt;
      if (c.x - c.r > W) c.x = -c.r;
    });
  }

  function storkBounds() {
    return { x1: x - STORK_W / 2, x2: x + STORK_W / 2, y1: y - STORK_H / 2, y2: y + STORK_H / 2 };
  }

  function checkHazardCollision() {
    const s = storkBounds();
    return hazards.some(h => s.x2 > h.x && s.x1 < h.x + h.width && s.y2 > h.topY);
  }

  function checkSprayerCollision() {
    if (!sprayer) return false;
    const s = storkBounds();
    const px1 = sprayer.x - sprayer.width / 2, px2 = sprayer.x + sprayer.width / 2;
    const py1 = sprayer.y - sprayer.height / 2, py2 = sprayer.y + sprayer.height / 2;
    return s.x2 > px1 && s.x1 < px2 && s.y2 > py1 && s.y1 < py2;
  }

  // The roof only blocks the closed part of the barn — the open side has no
  // roof at all, so flying in low through the gap is the only safe route.
  function checkBarnCollision() {
    if (!barn) return false;
    const s = storkBounds();
    const gapStart = barn.openSide === 'left' ? barn.barnX : barn.barnX + barn.barnWidth - barn.gapWidth;
    const gapEnd = gapStart + barn.gapWidth;
    const inGap = s.x1 >= gapStart && s.x2 <= gapEnd;
    const overlapsFootprint = s.x2 > barn.barnX && s.x1 < barn.barnX + barn.barnWidth;
    return overlapsFootprint && !inGap && s.y1 < barn.roofY;
  }

  function crash() {
    streak = 0;
    state = 'crashed';
    stateTimer = 0;
    crashAnchorY = y;
    showOverlay('BOOM! 💥');
    updateStats();
  }

  function resolveLanding() {
    attempts++;
    const bombX = x + bombSway();
    const inCradle = bombX >= cradleX && bombX <= cradleX + cradleWidth;
    const speed = Math.hypot(vx, vy);
    const gentle = speed <= SAFE_LANDING_SPEED;

    // Snap so the bomb's bottom edge rests exactly at ground level, in the cradle.
    y = GROUND_Y - BOMB_DROP - BOMB_R;

    if (inCradle && gentle) {
      streak++;
      if (streak > loadBestStreak()) saveBestStreak(streak);
      state = 'landed';
      stateTimer = 0;
      showOverlay('Gentle landing! 🎉');
      updateStats();
    } else {
      crash();
    }
  }

  // --- Drawing ---

  function draw() {
    drawSky();
    drawClouds();
    drawField();
    drawBarn();
    drawPad();
    drawHazards();
    drawSprayer();
    if (state === 'crashed') {
      drawExplosion();
    } else {
      drawBomb();
      drawStork();
      drawComboFlash();
    }
    drawWindIndicator();
  }

  function drawSky() {
    const g = ctx.createLinearGradient(0, 0, 0, GROUND_Y);
    g.addColorStop(0, '#7ec8ff');
    g.addColorStop(1, '#cdeeff');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, GROUND_Y);
  }

  function drawClouds() {
    ctx.fillStyle = 'rgba(255,255,255,0.85)';
    clouds.forEach(c => {
      ctx.beginPath();
      ctx.ellipse(c.x, c.y, c.r, c.r * 0.6, 0, 0, Math.PI * 2);
      ctx.ellipse(c.x + c.r * 0.6, c.y + 6, c.r * 0.7, c.r * 0.45, 0, 0, Math.PI * 2);
      ctx.ellipse(c.x - c.r * 0.6, c.y + 8, c.r * 0.6, c.r * 0.4, 0, 0, Math.PI * 2);
      ctx.fill();
    });
  }

  function drawField() {
    const g = ctx.createLinearGradient(0, GROUND_Y, 0, H);
    g.addColorStop(0, '#5fd35f');
    g.addColorStop(1, '#2f9e44');
    ctx.fillStyle = g;
    ctx.fillRect(0, GROUND_Y, W, H - GROUND_Y);
  }

  // The barn wall + roof only cover the closed side; the open side is bare sky
  // down to the ground, which is the only safe way in to the cradle.
  function drawBarn() {
    if (!barn) return;
    const wallX = barn.openSide === 'left' ? barn.barnX + barn.gapWidth : barn.barnX;
    const wallWidth = barn.barnWidth - barn.gapWidth;
    ctx.fillStyle = '#b5651d';
    ctx.fillRect(wallX, barn.roofY, wallWidth, GROUND_Y - barn.roofY);
    ctx.fillStyle = '#8b2e2e';
    ctx.beginPath();
    ctx.moveTo(wallX - 12, barn.roofY);
    ctx.lineTo(wallX + wallWidth / 2, barn.roofY - 40);
    ctx.lineTo(wallX + wallWidth + 12, barn.roofY);
    ctx.closePath();
    ctx.fill();
  }

  function drawHazards() {
    hazards.forEach(h => (h.type === 'tree' ? drawTree(h) : drawBuilding(h)));
  }

  function drawTree(h) {
    const cx = h.x + h.width / 2;
    const trunkH = h.height * 0.35;
    ctx.fillStyle = '#8a5a34';
    ctx.fillRect(cx - h.width * 0.12, GROUND_Y - trunkH, h.width * 0.24, trunkH);
    ctx.fillStyle = '#2f9e44';
    const canopyY = GROUND_Y - trunkH;
    ctx.beginPath(); ctx.arc(cx, canopyY - h.width * 0.3, h.width * 0.55, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.arc(cx - h.width * 0.3, canopyY - h.width * 0.1, h.width * 0.4, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.arc(cx + h.width * 0.3, canopyY - h.width * 0.15, h.width * 0.4, 0, Math.PI * 2); ctx.fill();
  }

  function drawBuilding(h) {
    ctx.fillStyle = '#6b7280';
    ctx.fillRect(h.x, h.topY, h.width, h.height);
    ctx.fillStyle = '#ffd23f';
    const cols = Math.max(2, Math.floor(h.width / 18));
    const rows = Math.max(3, Math.floor(h.height / 22));
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        ctx.fillRect(h.x + 8 + c * 18, h.topY + 10 + r * 22, 8, 10);
      }
    }
  }

  function drawSprayer() {
    if (!sprayer) return;
    ctx.save();
    ctx.translate(sprayer.x, sprayer.y);
    ctx.scale(sprayer.dir, 1);
    // mist trail
    ctx.fillStyle = 'rgba(255,255,255,0.5)';
    for (let i = 1; i <= 4; i++) {
      ctx.beginPath();
      ctx.arc(-sprayer.width / 2 - i * 10, i * 2, 4, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.fillStyle = '#ffd23f';
    ctx.beginPath();
    ctx.ellipse(0, 0, sprayer.width / 2, sprayer.height / 2, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#e03131';
    ctx.fillRect(-6, -sprayer.height, 26, 5);
    ctx.beginPath();
    ctx.moveTo(sprayer.width / 2 - 4, 0);
    ctx.lineTo(sprayer.width / 2 + 10, -8);
    ctx.lineTo(sprayer.width / 2 + 10, 8);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  function drawPad() {
    const py = GROUND_Y;
    ctx.fillStyle = '#8a5a34';
    ctx.fillRect(padX, py - 6, padWidth, 12);
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(padX + 8, py);
    ctx.lineTo(padX + padWidth - 8, py);
    ctx.stroke();
    drawCradle();
  }

  // The cradle is the only spot that will actually catch the bomb — everywhere
  // else on (or off) the pad still counts as a miss.
  function drawCradle() {
    const ccx = cradleX + cradleWidth / 2;
    const cy = GROUND_Y - 2;
    const half = cradleWidth / 2;

    ctx.fillStyle = '#c98a4b';
    ctx.beginPath();
    ctx.moveTo(ccx - half, cy - 10);
    ctx.quadraticCurveTo(ccx - half - 2, cy + 8, ccx, cy + 12);
    ctx.quadraticCurveTo(ccx + half + 2, cy + 8, ccx + half, cy - 10);
    ctx.quadraticCurveTo(ccx, cy - 2, ccx - half, cy - 10);
    ctx.fill();

    ctx.strokeStyle = 'rgba(90,55,20,0.6)';
    ctx.lineWidth = 1.5;
    for (let i = -1; i <= 1; i++) {
      ctx.beginPath();
      ctx.moveTo(ccx + i * half * 0.6, cy - 8);
      ctx.lineTo(ccx + i * half * 0.4, cy + 9);
      ctx.stroke();
    }
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.ellipse(ccx, cy - 9, half, 4, 0, 0, Math.PI * 2);
    ctx.stroke();
  }

  function drawComboFlash() {
    if (comboFlashTimer <= 0) return;
    const alpha = comboFlashTimer / 0.6;
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.font = 'bold 20px "Segoe UI", sans-serif';
    ctx.fillStyle = '#ffd23f';
    ctx.strokeStyle = '#1b1035';
    ctx.lineWidth = 3;
    ctx.textAlign = 'center';
    const ty = y - STORK_H / 2 - 16 - (1 - alpha) * 14;
    ctx.strokeText(comboFlashText, x, ty);
    ctx.fillText(comboFlashText, x, ty);
    ctx.restore();
  }

  function drawWindIndicator() {
    const wind = Math.sin(time * 0.6 + windSeed) * WIND_STRENGTH;
    const arrowLen = clamp(wind, -30, 30);
    ctx.save();
    ctx.translate(W / 2, 24);
    ctx.strokeStyle = 'rgba(27,16,53,0.55)';
    ctx.fillStyle = 'rgba(27,16,53,0.55)';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(-arrowLen, 0);
    ctx.lineTo(arrowLen, 0);
    ctx.stroke();
    ctx.beginPath();
    const dir = Math.sign(arrowLen) || 1;
    ctx.moveTo(arrowLen, 0);
    ctx.lineTo(arrowLen - dir * 7, -5);
    ctx.lineTo(arrowLen - dir * 7, 5);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  function bombSway() {
    return clamp(-vx * 0.05, -12, 12);
  }

  function drawBomb() {
    const bx = x + bombSway();
    const by = y + STORK_H / 2 + 8 + BOMB_R;
    ctx.strokeStyle = '#8a5a34';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(x, y + STORK_H / 2 + 2);
    ctx.lineTo(bx, by - BOMB_R);
    ctx.stroke();
    paintBomb(bx, by);
  }

  function paintBomb(bx, by) {
    ctx.save();
    ctx.translate(bx, by);
    // fuse
    ctx.strokeStyle = '#d9a441';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(0, -BOMB_R);
    ctx.quadraticCurveTo(6, -BOMB_R - 8, 2, -BOMB_R - 14);
    ctx.stroke();
    ctx.fillStyle = '#ffb703';
    ctx.beginPath();
    ctx.arc(2, -BOMB_R - 15, 3, 0, Math.PI * 2);
    ctx.fill();
    // body
    ctx.fillStyle = '#2b2b33';
    ctx.beginPath();
    ctx.arc(0, 0, BOMB_R, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.18)';
    ctx.beginPath();
    ctx.arc(-4, -4, BOMB_R * 0.4, 0, Math.PI * 2);
    ctx.fill();
    // cute face
    ctx.fillStyle = '#fff';
    ctx.beginPath(); ctx.arc(-4, -1, 2.6, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.arc(4, -1, 2.6, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#1b1035';
    ctx.beginPath(); ctx.arc(-4, -1, 1.3, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.arc(4, -1, 1.3, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = '#1b1035';
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.arc(0, 3, 4, 0.15 * Math.PI, 0.85 * Math.PI);
    ctx.stroke();
    ctx.restore();
  }

  function drawStork() {
    const tilt = clamp(vx * 0.002, -0.35, 0.35);
    const wingUp = flapTimer > 0.08;
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(tilt);

    // legs
    ctx.strokeStyle = '#ff8c42';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(-6, STORK_H / 2 - 4); ctx.lineTo(-8, STORK_H / 2 + 10);
    ctx.moveTo(6, STORK_H / 2 - 4); ctx.lineTo(8, STORK_H / 2 + 10);
    ctx.stroke();

    // wings
    ctx.fillStyle = '#f1f3f5';
    const wingAngle = wingUp ? -0.9 : 0.5;
    ctx.save();
    ctx.translate(-STORK_W / 2 + 6, -2);
    ctx.rotate(wingAngle);
    ctx.beginPath();
    ctx.ellipse(0, 0, 20, 9, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
    ctx.save();
    ctx.translate(STORK_W / 2 - 6, -2);
    ctx.rotate(-wingAngle);
    ctx.beginPath();
    ctx.ellipse(0, 0, 20, 9, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    // body
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.ellipse(0, 0, STORK_W / 2 - 6, STORK_H / 2, 0, 0, Math.PI * 2);
    ctx.fill();

    // neck + head
    ctx.beginPath();
    ctx.ellipse(10, -STORK_H / 2 + 2, 8, 8, 0, 0, Math.PI * 2);
    ctx.fill();

    // beak
    ctx.fillStyle = '#ff8c42';
    ctx.beginPath();
    ctx.moveTo(16, -STORK_H / 2 - 1);
    ctx.lineTo(30, -STORK_H / 2 + 3);
    ctx.lineTo(16, -STORK_H / 2 + 6);
    ctx.closePath();
    ctx.fill();

    // eye
    ctx.fillStyle = '#1b1035';
    ctx.beginPath();
    ctx.arc(13, -STORK_H / 2 - 1, 1.6, 0, Math.PI * 2);
    ctx.fill();

    ctx.restore();
  }

  function drawExplosion() {
    const p = clamp(stateTimer / 1.3, 0, 1);
    const scale = 1 + p * 0.6;
    ctx.save();
    ctx.translate(x, crashAnchorY);
    ctx.scale(scale, scale);

    // comic starburst
    const spikes = 10;
    const outerR = 46;
    const innerR = 20;
    ctx.fillStyle = `rgba(255, ${140 - p * 60 | 0}, 40, ${1 - p * 0.7})`;
    ctx.beginPath();
    for (let i = 0; i < spikes * 2; i++) {
      const r = i % 2 === 0 ? outerR : innerR;
      const a = (Math.PI / spikes) * i - Math.PI / 2;
      ctx.lineTo(Math.cos(a) * r, Math.sin(a) * r);
    }
    ctx.closePath();
    ctx.fill();

    ctx.fillStyle = `rgba(255, 210, 63, ${1 - p})`;
    ctx.beginPath();
    for (let i = 0; i < spikes * 2; i++) {
      const r = (i % 2 === 0 ? outerR : innerR) * 0.6;
      const a = (Math.PI / spikes) * i - Math.PI / 2 + 0.2;
      ctx.lineTo(Math.cos(a) * r, Math.sin(a) * r);
    }
    ctx.closePath();
    ctx.fill();

    ctx.font = 'bold 22px "Segoe UI", sans-serif';
    ctx.fillStyle = '#fff';
    ctx.strokeStyle = '#1b1035';
    ctx.lineWidth = 3;
    ctx.textAlign = 'center';
    ctx.strokeText('BOOM!', 0, -55);
    ctx.fillText('BOOM!', 0, -55);
    ctx.restore();

    // dazed stork face poking out of the soot, Looney-Tunes style
    ctx.save();
    ctx.translate(x, crashAnchorY);
    ctx.fillStyle = '#2b2b33';
    ctx.beginPath();
    ctx.ellipse(0, 6, 22, 12, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#f1f3f5';
    ctx.beginPath();
    ctx.arc(0, -8, 14, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#1b1035';
    ctx.lineWidth = 2;
    // X eyes
    [-5, 5].forEach(ex => {
      ctx.beginPath();
      ctx.moveTo(ex - 3, -11); ctx.lineTo(ex + 3, -5);
      ctx.moveTo(ex + 3, -11); ctx.lineTo(ex - 3, -5);
      ctx.stroke();
    });
    // spinning stars overhead
    ctx.fillStyle = '#ffd23f';
    for (let s = 0; s < 3; s++) {
      const a = time * 4 + (s * Math.PI * 2) / 3;
      const sx = Math.cos(a) * 22;
      const sy = -28 + Math.sin(a) * 6;
      drawStar(sx, sy, 5);
    }
    ctx.restore();
  }

  function drawStar(cx, cy, r) {
    ctx.beginPath();
    for (let i = 0; i < 10; i++) {
      const rad = i % 2 === 0 ? r : r / 2.4;
      const a = (Math.PI / 5) * i - Math.PI / 2;
      ctx.lineTo(cx + Math.cos(a) * rad, cy + Math.sin(a) * rad);
    }
    ctx.closePath();
    ctx.fill();
  }

  let lastTime = 0;
  function loop(ts) {
    if (!lastTime) lastTime = ts;
    const dt = Math.min((ts - lastTime) / 1000, 0.033);
    lastTime = ts;
    update(dt);
    draw();
    requestAnimationFrame(loop);
  }

  startGame();
  requestAnimationFrame(loop);
})();
