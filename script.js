// ── Config ───────────────────────────────────────────────────────────────────
const PL = {
  brbStart: 'PLKE8KDGAf7uk',
  brbEnd: 'PLQadk1R5eem0',
  bumps: 'PLSlQX90nmhUE',
  voiceComm: 'PLAYB_Hd6OWbc',
  longComm: 'PLNWlrH3lY3Pw',
};

const COMBINATIONS = [
  [PL.bumps],
  [PL.bumps, PL.voiceComm],
  [PL.brbStart, PL.voiceComm, PL.longComm, PL.brbEnd],
];

// Playlists shared across combinations — single global position
const SHARED_PLAYLISTS = new Set([PL.bumps]);

// Weight pool: combo1 x2, combo2 x1, combo3 x1 per 4-cycle block
const COMBO_WEIGHT_POOL = [0, 0, 1, 2];

const SLOTS = [
  {
    label: 'Slot 1 — Midnight (11:00 PM – 6:59 AM)',
    ranges: [
      { startH: 23, startM: 0, endH: 23, endM: 59 },
      { startH: 0, startM: 0, endH: 6, endM: 59 },
    ],
    playlistA: 'PLDratAzGBEuc',
    songsA: 3,
  },
  {
    label: 'Slot 2 — Morning (7:00 AM – 10:59 AM)',
    ranges: [{ startH: 7, startM: 0, endH: 10, endM: 59 }],
    playlistA: 'PLCsjyYN_-0T4',
    songsA: 3,
  },
  {
    label: 'Slot 3 — Lunch (11:00 AM – 12:59 PM)',
    ranges: [{ startH: 11, startM: 0, endH: 12, endM: 59 }],
    playlistA: 'PLeNspIIt7ozk',
    songsA: 3,
  },
  {
    label: 'Slot 4 — Afternoon (1:00 PM – 3:59 PM)',
    ranges: [{ startH: 13, startM: 0, endH: 15, endM: 59 }],
    playlistA: 'PLDFQj1u0PoYg',
    songsA: 3,
  },
  {
    label: 'Slot 5 — Evening (4:00 PM – 7:59 PM)',
    ranges: [{ startH: 16, startM: 0, endH: 19, endM: 59 }],
    playlistA: 'PLRp2kh8fEeQk',
    songsA: 3,
  },
  {
    label: 'Slot 6 — Night (8:00 PM – 10:59 PM)',
    ranges: [{ startH: 20, startM: 0, endH: 22, endM: 59 }],
    playlistA: 'PLQ-w4IseBY80',
    songsA: 3,
  },
];

// ── Utilities ─────────────────────────────────────────────────────────────────
function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
function pad(n) {
  return String(n).padStart(2, '0');
}
function currentMinutes() {
  const n = new Date();
  return n.getHours() * 60 + n.getMinutes();
}
function resolveSlot() {
  const m = currentMinutes();
  return (
    SLOTS.find((s) =>
      s.ranges.some(
        (r) => m >= r.startH * 60 + r.startM && m <= r.endH * 60 + r.endM,
      ),
    ) || null
  );
}
function slotKey(slot) {
  return slot ? slot.label : null;
}

// ── Storage ───────────────────────────────────────────────────────────────────
const CACHE_TTL = 3 * 60 * 60 * 1000;
const STATE_KEY = 'pls_playback_state';

function savePosition(key, videos, index) {
  try {
    localStorage.setItem(
      `pls_pos_${key}`,
      JSON.stringify({ videos, index, savedAt: Date.now() }),
    );
  } catch (e) {}
}
function loadPositionTTL(key, rawLength) {
  try {
    const d = JSON.parse(localStorage.getItem(`pls_pos_${key}`) || 'null');
    if (
      !d ||
      Date.now() - d.savedAt > CACHE_TTL ||
      d.videos.length !== rawLength
    ) {
      localStorage.removeItem(`pls_pos_${key}`);
      return null;
    }
    return d;
  } catch (e) {
    return null;
  }
}
function loadPositionPermanent(key, rawLength) {
  try {
    const d = JSON.parse(localStorage.getItem(`pls_pos_${key}`) || 'null');
    if (!d || d.videos.length !== rawLength) {
      localStorage.removeItem(`pls_pos_${key}`);
      return null;
    }
    return d;
  } catch (e) {
    return null;
  }
}
function saveState() {
  try {
    localStorage.setItem(
      STATE_KEY,
      JSON.stringify({
        mode,
        songCountA,
        comboIndex: COMBINATIONS.indexOf(currentCombo),
        comboStep,
        slotKey: currentSlotKey,
      }),
    );
  } catch (e) {}
}
function loadState() {
  try {
    return JSON.parse(localStorage.getItem(STATE_KEY) || 'null');
  } catch (e) {
    return null;
  }
}

// ── Video ID cache ────────────────────────────────────────────────────────────
// All video IDs are fetched once and stored here, keyed by playlist ID.
// Nothing ever calls player.loadPlaylist() after init.
const videoCache = {}; // playlistId → [videoId, ...]
const indexCache = {}; // playlistId → current index

function getVideos(plId) {
  return videoCache[plId] || [];
}
function getIndex(plId) {
  return indexCache[plId] || 0;
}
function setIndex(plId, i) {
  indexCache[plId] = i;
}

function advanceIndex(plId) {
  const vids = videoCache[plId];
  if (!vids || vids.length === 0) return;
  const next = (indexCache[plId] || 0) + 1;
  if (next >= vids.length) {
    videoCache[plId] = shuffle(vids);
    indexCache[plId] = 0;
    console.log(`"${plId}" wrapped and re-shuffled.`);
  } else {
    indexCache[plId] = next;
  }
}

// ── Playlist ID fetching ──────────────────────────────────────────────────────
// Uses an iframe-based approach: loads the playlist, reads IDs, then restores.
// All fetches happen BEFORE playback starts so loadVideoById is the only
// play call made during actual playback.

let fetchQueue = Promise.resolve(); // serialize all fetches

function fetchPlaylistIds(plId) {
  fetchQueue = fetchQueue.then(() => _doFetch(plId));
  return fetchQueue;
}

async function _doFetch(plId, attempt = 1) {
  if (videoCache[plId]) return; // already fetched
  return new Promise((resolve, reject) => {
    const t0 = Date.now();
    player.mute();
    player.loadPlaylist({ list: plId, listType: 'playlist', index: 0 });
    const check = () => {
      const list = player.getPlaylist();
      if (list && list.length > 0) {
        player.stopVideo();
        resolve(list);
      } else if (Date.now() - t0 > 20000) {
        // increased to 20s
        reject(new Error(`Timeout fetching ${plId}`));
      } else {
        setTimeout(check, 250);
      }
    };
    setTimeout(check, 800); // slightly longer initial wait
  })
    .then((raw) => {
      const saved = loadPositionPermanent(plId, raw.length);
      if (saved) {
        videoCache[plId] = saved.videos;
        indexCache[plId] = saved.index;
      } else {
        videoCache[plId] = shuffle(raw);
        indexCache[plId] = 0;
      }
      console.log(
        `Fetched "${plId}": ${videoCache[plId].length} videos, idx ${indexCache[plId]}`,
      );
    })
    .catch(async (e) => {
      if (attempt < 3) {
        console.warn(`Retrying "${plId}" (attempt ${attempt + 1})...`);
        await new Promise((r) => setTimeout(r, 2000)); // wait 2s before retry
        return _doFetch(plId, attempt + 1);
      }
      console.error(`Failed to fetch "${plId}" after ${attempt} attempts:`, e);
    });
}

// ── Combo pool ────────────────────────────────────────────────────────────────
let comboPool = [];
let firstPool = true;

function nextCombo() {
  if (comboPool.length === 0) {
    if (firstPool) {
      firstPool = false;
      do {
        comboPool = shuffle([...COMBO_WEIGHT_POOL]);
      } while (comboPool[comboPool.length - 1] === 2);
    } else {
      comboPool = shuffle([...COMBO_WEIGHT_POOL]);
    }
    console.log('New combo pool:', [...comboPool]);
  }
  return comboPool.pop();
}

// ── State ─────────────────────────────────────────────────────────────────────
let player,
  apiReady = false,
  started = false;
let currentSlotKey = null,
  pendingSlotSwitch = false;
let mode = 'commercial';
let songCountA = 0,
  currentSongsA = 3;
let currentCombo = [],
  comboStep = 0;
let handlingEnd = false;

// ── UI ────────────────────────────────────────────────────────────────────────
let halfwayTimer = null;
let countdownInterval = null;

function clearHalfwayTimer() {
  if (halfwayTimer) {
    clearTimeout(halfwayTimer);
    halfwayTimer = null;
  }
}

function stopCountdown() {
  if (countdownInterval) {
    clearInterval(countdownInterval);
    countdownInterval = null;
  }
  const el = document.getElementById('countdown');
  el.classList.add('hidden');
  el.textContent = '';
}

// Playlists that should NOT show a countdown
const NO_COUNTDOWN = new Set([PL.brbStart, PL.brbEnd]);

function startCountdown() {
  stopCountdown();
  const plId = currentCombo[comboStep];
  if (NO_COUNTDOWN.has(plId)) return; // excluded playlists
  if (plId === PL.longComm) return; // long commercials use skip button instead

  // Wait briefly for the player to have an accurate duration
  setTimeout(() => {
    const dur = player.getDuration();
    if (!dur || dur <= 0) return;

    const el = document.getElementById('countdown');
    el.classList.remove('hidden');
    document
      .getElementById('player-controls-content')
      .classList.remove('hidden');

    function tick() {
      const remaining = Math.max(Math.ceil(dur - player.getCurrentTime()), 0);
      const m = Math.floor(remaining / 60);
      const s = remaining % 60;
      el.textContent = `${m}:${String(s).padStart(2, '0')}`;
      if (remaining <= 0) stopCountdown();
    }
    tick();
    countdownInterval = setInterval(tick, 1000);
  }, 1200);
}

function setSkipVisible(v) {
  const ctrl = document.getElementById('player-controls-content');
  const btn = document.getElementById('skipBtn');
  // When skip becomes visible, hide the countdown
  if (v) stopCountdown();
  ctrl.classList.toggle('hidden', !v);
  btn.classList.toggle('hidden', !v);
}

function updatePlayingUI() {
  const isComm = mode === 'commercial';
  document
    .getElementById('yt-controls-blocker')
    .classList.toggle('active', isComm);
  clearHalfwayTimer();
  stopCountdown();
  const ctrl = document.getElementById('player-controls-content');
  const btn = document.getElementById('skipBtn');
  if (isComm) {
    // Hide everything — countdown/skip will appear when PLAYING fires
    ctrl.classList.add('hidden');
    btn.classList.add('hidden');
  } else {
    // Playlist A — show skip button only
    ctrl.classList.remove('hidden');
    btn.classList.remove('hidden');
  }
}

function startHalfwayTimer() {
  clearHalfwayTimer();
  setTimeout(() => {
    const dur = player.getDuration();
    if (!dur || dur <= 0) return;
    const halfMs = (dur / 2) * 1000;
    const elapsed = player.getCurrentTime() * 1000;
    const wait = Math.max(halfMs - elapsed, 0);
    halfwayTimer = setTimeout(() => {
      if (mode === 'commercial' && currentCombo[comboStep] === PL.longComm) {
        setSkipVisible(true);
      }
    }, wait);
  }, 1000);
}

// ── Schedule panel ────────────────────────────────────────────────────────────
function buildScheduleCards() {
  const c = document.getElementById('scheduleCards');
  SLOTS.forEach((s, i) => {
    const d = document.createElement('div');
    d.className = 'scard';
    d.id = `scard-${i}`;
    d.innerHTML = `<div class="scard-header"><span class="scard-title">${s.label}</span><span class="scard-badge">● Active now</span></div>`;
    c.appendChild(d);
  });
}
function updateActiveCard() {
  const a = resolveSlot();
  SLOTS.forEach((s, i) =>
    document
      .getElementById(`scard-${i}`)
      ?.classList.toggle('is-active', s === a),
  );
}
document
  .getElementById('scheduleToggleBtn')
  .addEventListener('click', () =>
    document.getElementById('schedulePanel').classList.add('open'),
  );
document
  .getElementById('closePanelBtn')
  .addEventListener('click', () =>
    document.getElementById('schedulePanel').classList.remove('open'),
  );

// ── CC toggle ─────────────────────────────────────────────────────────────────
let captionsOff = true;
document.getElementById('ccToggleBtn').textContent = 'CC Off';
document.getElementById('ccToggleBtn').classList.add('cc-off');
document.getElementById('ccToggleBtn').addEventListener('click', () => {
  captionsOff = !captionsOff;
  if (captionsOff) {
    player.unloadModule('captions');
    document.getElementById('ccToggleBtn').textContent = 'CC Off';
    document.getElementById('ccToggleBtn').classList.add('cc-off');
  } else {
    player.loadModule('captions');
    document.getElementById('ccToggleBtn').textContent = 'CC On';
    document.getElementById('ccToggleBtn').classList.remove('cc-off');
  }
});

function clockTick() {
  const n = new Date();
  document.getElementById('clock').textContent =
    `${pad(n.getHours())}:${pad(n.getMinutes())}:${pad(n.getSeconds())}`;
}

// ── YouTube API ───────────────────────────────────────────────────────────────
function loadYouTubeAPI() {
  const t = document.createElement('script');
  t.src = 'https://www.youtube.com/iframe_api';
  document.body.appendChild(t);
}

window.onYouTubeIframeAPIReady = function () {
  apiReady = true;
  player = new YT.Player('player', {
    height: '100%',
    width: '100%',
    playerVars: {
      autoplay: 0,
      controls: 0,
      modestbranding: 1,
      rel: 0,
      iv_load_policy: 3,
      disablekb: 1,
    },
    events: {
      onReady: onPlayerReady,
      onStateChange: onPlayerStateChange,
      onError: onPlayerError,
    },
  });
};

function onPlayerError(event) {
  if (!started || ![100, 101, 150].includes(event.data)) return;
  console.warn(`Skipping unembeddable video (error ${event.data})`);
  playNext();
}

function onPlayerReady() {
  playerIsReady = true;
  maybeShowPlayButton();
}

async function onPlayerStateChange(event) {
  if (!started) return;
  if (event.data === YT.PlayerState.PLAYING) {
    // Re-apply CC state on every new video since loadVideoById can reset it
    if (captionsOff) player.unloadModule('captions');
    if (
      mode === 'commercial' &&
      currentCombo.length > 0 &&
      comboStep < currentCombo.length
    ) {
      const plId = currentCombo[comboStep];
      if (plId === PL.longComm) {
        startHalfwayTimer();
      } else if (!NO_COUNTDOWN.has(plId)) {
        startCountdown();
      }
    }
    return;
  }
  if (event.data === YT.PlayerState.ENDED) {
    clearHalfwayTimer();
    stopCountdown();
    await playNext();
  }
}

// ── Preloader ─────────────────────────────────────────────────────────────────
const SCRAMBLE_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789@#$%&*';
let playerIsReady = false;
let scrambleDone = false;
let fetchesDone = false;
let preloadSlot = null; // slot resolved at page load, used by play button

function scrambleText(el, text, dur) {
  return new Promise((resolve) => {
    const len = text.length,
      t0 = performance.now();
    function frame(now) {
      const p = Math.min((now - t0) / dur, 1),
        n = Math.floor(p * len);
      let s = '';
      for (let i = 0; i < len; i++) {
        if (text[i] === ' ') {
          s += ' ';
          continue;
        }
        s +=
          i < n
            ? text[i]
            : SCRAMBLE_CHARS[Math.floor(Math.random() * SCRAMBLE_CHARS.length)];
      }
      el.textContent = s;
      p < 1 ? requestAnimationFrame(frame) : resolve();
    }
    requestAnimationFrame(frame);
  });
}

function maybeShowPlayButton() {
  if (!playerIsReady || !scrambleDone || !fetchesDone) return;
  document.getElementById('overlayMsg').textContent = 'READY';
  document.getElementById('overlayMsg').classList.add('visible');
  setTimeout(
    () => document.getElementById('playBtn').classList.add('ready'),
    400,
  );
}

// Updates the scramble text to show which playlist is currently loading
function setLoadingLabel(current, total, plId) {
  const el = document.getElementById('overlayMsg');
  el.textContent = `LOADING ${current} OF ${total}`;
  el.classList.add('visible');
}

async function runPreloader() {
  const slot = resolveSlot();
  preloadSlot = slot;
  const name = slot
    ? slot.label.match(/—\s*([^(]+)/)?.[1]?.trim() || 'Loading'
    : 'Loading';
  const scrambleEl = document.getElementById('scrambleText');

  // Run scramble animation and playlist fetching in parallel
  const animPromise = scrambleText(scrambleEl, name.toUpperCase(), 1400).then(
    () => {
      scrambleDone = true;
      maybeShowPlayButton();
    },
  );

  // Start fetching as soon as the player is ready
  const fetchPromise = waitForPlayer().then(async () => {
    if (!slot) {
      fetchesDone = true;
      maybeShowPlayButton();
      return;
    }

    const allIds = new Set();
    allIds.add(slot.playlistA);
    COMBINATIONS.forEach((combo) => combo.forEach((id) => allIds.add(id)));
    const idList = [...allIds];
    let i = 0;

    for (const plId of idList) {
      i++;
      setLoadingLabel(i, idList.length, plId);
      if (!videoCache[plId]) await fetchPlaylistIds(plId);
    }

    // Restore playlist A TTL position if available
    const slotK = slotKey(slot);
    const savedA = loadPositionTTL(
      slotK,
      videoCache[slot.playlistA]?.length || 0,
    );
    if (savedA) {
      videoCache[slot.playlistA] = savedA.videos;
      indexCache[slot.playlistA] = savedA.index;
      console.log(`Playlist A resumed from TTL cache, idx ${savedA.index}`);
    }

    fetchesDone = true;
    maybeShowPlayButton();
  });

  await Promise.all([animPromise, fetchPromise]);
}

// Waits until the YouTube player is ready before fetching
function waitForPlayer() {
  return new Promise((resolve) => {
    if (playerIsReady) {
      resolve();
      return;
    }
    const check = setInterval(() => {
      if (playerIsReady) {
        clearInterval(check);
        resolve();
      }
    }, 100);
  });
}

function playVideo(plId) {
  const vids = getVideos(plId);
  const idx = getIndex(plId);
  if (!vids.length) {
    console.error(`No videos for "${plId}"`);
    return;
  }
  console.log(`▶ "${plId}" idx ${idx + 1}/${vids.length}`);
  player.loadVideoById(vids[idx]);
  savePosition(plId, vids, idx);
}

function playCurrentComboStep() {
  const plId = currentCombo[comboStep];
  mode = 'commercial';
  updatePlayingUI();
  playVideo(plId);
  saveState();
}

function playPlaylistA() {
  mode = 'A';
  updatePlayingUI();
  const slot = resolveSlot();
  if (!slot) return;
  const plId = slot.playlistA;
  if (!videoCache[plId] || !videoCache[plId].length) {
    console.error(`Playlist A "${plId}" not in cache — re-fetching...`);
    fetchPlaylistIds(plId).then(() => playPlaylistA());
    return;
  }
  playVideo(plId);
  savePosition(slotKey(slot), getVideos(plId), getIndex(plId));
  saveState();
}

async function startCommercialBlock() {
  const comboIdx = nextCombo();
  currentCombo = COMBINATIONS[comboIdx];
  comboStep = 0;
  songCountA = 0;
  console.log(`Commercial block — combo ${comboIdx + 1}:`, currentCombo);
  playCurrentComboStep();
}

async function playNext() {
  if (!started || handlingEnd) return;
  handlingEnd = true;
  try {
    if (pendingSlotSwitch) {
      const newSlot = resolveSlot();
      if (!newSlot) {
        currentSlotKey = null;
        return;
      }
      console.log('Slot switch.');
      await loadAllPlaylistsAndStart(newSlot);
      return;
    }

    if (mode === 'commercial') {
      advanceIndex(currentCombo[comboStep]);
      comboStep++;
      saveState();
      if (comboStep >= currentCombo.length) {
        console.log('Commercial block done → Playlist A');
        playPlaylistA();
      } else {
        playCurrentComboStep();
      }
      return;
    }

    // mode === 'A'
    advanceIndex(resolveSlot().playlistA);
    songCountA++;
    console.log(`Playlist A count: ${songCountA}/${currentSongsA}`);
    saveState();

    if (songCountA >= currentSongsA) {
      console.log('Threshold reached → Commercial block');
      await startCommercialBlock();
    } else {
      playPlaylistA();
    }
  } finally {
    handlingEnd = false;
  }
}

// ── Initial load — all playlists already fetched by preloader ─────────────────
async function loadAllPlaylistsAndStart(slot) {
  currentSlotKey = slotKey(slot);
  currentSongsA = slot.songsA;
  pendingSlotSwitch = false;

  // Fetch any playlists not already in cache (e.g. on a slot switch to a new slot)
  const allIds = new Set();
  allIds.add(slot.playlistA);
  COMBINATIONS.forEach((combo) => combo.forEach((id) => allIds.add(id)));
  for (const plId of allIds) {
    if (!videoCache[plId]) {
      console.log(`Slot switch: fetching missing playlist "${plId}"...`);
      await fetchPlaylistIds(plId);
    }
  }

  // Restore playlist A TTL position if available
  const slotK = slotKey(slot);
  const savedA = loadPositionTTL(
    slotK,
    videoCache[slot.playlistA]?.length || 0,
  );
  if (savedA) {
    videoCache[slot.playlistA] = savedA.videos;
    indexCache[slot.playlistA] = savedA.index;
    console.log(`Playlist A resumed from TTL cache, idx ${savedA.index}`);
  }

  document.getElementById('overlay').classList.add('hidden');
  player.unMute();
  if (captionsOff) player.unloadModule('captions');

  // Restore saved playback state or start fresh
  const saved = loadState();
  if (saved && saved.slotKey === currentSlotKey) {
    songCountA = saved.songCountA ?? 0;
    if (saved.mode === 'A') {
      console.log(`Restoring: Playlist A, count ${songCountA}`);
      playPlaylistA();
      return;
    }
    if (saved.mode === 'commercial' && saved.comboIndex >= 0) {
      currentCombo = COMBINATIONS[saved.comboIndex];
      comboStep = saved.comboStep ?? 0;
      console.log(
        `Restoring: commercial combo ${saved.comboIndex + 1} step ${comboStep}`,
      );
      playCurrentComboStep();
      return;
    }
  }

  // No saved state — start with a commercial block
  await startCommercialBlock();
}

// ── Skip button ───────────────────────────────────────────────────────────────
document.getElementById('skipBtn').addEventListener('click', async () => {
  if (!started || handlingEnd) return;

  // Long commercial skip (halfway button)
  if (mode === 'commercial' && currentCombo[comboStep] === PL.longComm) {
    clearHalfwayTimer();
    setSkipVisible(false);
    await playNext();
    return;
  }

  // Playlist A skip
  if (mode === 'A') await playNext();
});

// ── Scheduler ─────────────────────────────────────────────────────────────────
function startScheduler() {
  setInterval(() => {
    updateActiveCard();
    if (!started) return;
    const slot = resolveSlot();
    if (!slot || slotKey(slot) !== currentSlotKey) {
      if (!pendingSlotSwitch) {
        pendingSlotSwitch = true;
        console.log('Slot change pending.');
      }
    }
  }, 30000);
}

// ── Play button ───────────────────────────────────────────────────────────────
document.getElementById('playBtn').addEventListener('click', async () => {
  if (
    started ||
    !document.getElementById('playBtn').classList.contains('ready')
  )
    return;
  const slot = preloadSlot || resolveSlot();
  if (!slot) {
    alert('No active slot right now.');
    return;
  }
  started = true;
  document.getElementById('playBtn').classList.remove('ready');
  await loadAllPlaylistsAndStart(slot);
  startScheduler();
});

// ── Init ──────────────────────────────────────────────────────────────────────
buildScheduleCards();
setInterval(clockTick, 1000);
clockTick();
updateActiveCard();
runPreloader();
loadYouTubeAPI();
