const STORAGE_PLAYERS = "inpostor_players";
const STORAGE_CONFIG = "inpostor_config";
const REVEAL_MS_NEEDED = 500;
const REVEAL_DONE_MS = 5000;
const TICK_MS = 50;

const panelEls = {
  home: () => document.getElementById("panel-home"),
  config: () => document.getElementById("panel-config"),
  pass: () => document.getElementById("panel-pass"),
  done: () => document.getElementById("panel-done"),
};

function loadPlayers() {
  try {
    const raw = localStorage.getItem(STORAGE_PLAYERS);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed)
      ? parsed.filter((n) => typeof n === "string" && n.trim().length > 0)
      : [];
  } catch {
    return [];
  }
}

function savePlayers(names) {
  localStorage.setItem(STORAGE_PLAYERS, JSON.stringify(names));
}

function normalizeName(value) {
  return value.replace(/\s+/g, " ").trim();
}

function escapeAttr(s) {
  return s.replace(/&/g, "&amp;").replace(/"/g, "&quot;");
}

function getDtbFromPage() {
  const d = typeof window !== "undefined" ? window.INPOSTOR_DTB : null;
  if (d && Array.isArray(d.categories) && Array.isArray(d.words)) return d;
  console.error("INPOSTOR_DTB lipsește sau are structură invalidă.");
  return { categories: [], words: [] };
}

function defaultConfig(allCategoryIds) {
  return {
    selectedCategoryIds: [...allCategoryIds],
    inpostorCount: 1,
    inpostorsGetHint: true,
    inpostorsSeeOthers: true,
    allowFullInpostorRound: false,
    allowFullNonInpostorRound: false,
  };
}

function loadGameConfig(allCategoryIds) {
  const raw = localStorage.getItem(STORAGE_CONFIG);
  if (!raw) return defaultConfig(allCategoryIds);
  try {
    const c = JSON.parse(raw);
    const base = defaultConfig(allCategoryIds);
    const valid = new Set(allCategoryIds);
    let ids = Array.isArray(c.selectedCategoryIds)
      ? c.selectedCategoryIds.filter((id) => valid.has(id))
      : base.selectedCategoryIds;
    if (ids.length === 0) ids = [...allCategoryIds];

    const countRaw = c.inpostorCount ?? c.imposterCount;
    const hintRaw = c.inpostorsGetHint ?? c.impostersGetHint;
    const seeRaw = c.inpostorsSeeOthers ?? c.impostersSeeOthers;
    const fullIRaw = c.allowFullInpostorRound ?? c.allowFullImposterRound;
    const fullCRaw = c.allowFullNonInpostorRound ?? c.allowFullNonImposterRound;

    return {
      selectedCategoryIds: ids,
      inpostorCount: clampInt(countRaw, 1, 16, base.inpostorCount),
      inpostorsGetHint: typeof hintRaw === "boolean" ? hintRaw : base.inpostorsGetHint,
      inpostorsSeeOthers: typeof seeRaw === "boolean" ? seeRaw : base.inpostorsSeeOthers,
      allowFullInpostorRound: typeof fullIRaw === "boolean" ? fullIRaw : base.allowFullInpostorRound,
      allowFullNonInpostorRound: typeof fullCRaw === "boolean" ? fullCRaw : base.allowFullNonInpostorRound,
    };
  } catch {
    return defaultConfig(allCategoryIds);
  }
}

function clampInt(v, min, max, fallback) {
  const n = Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.round(n)));
}

function saveGameConfig(config) {
  localStorage.setItem(STORAGE_CONFIG, JSON.stringify(config));
}

function showPanel(name) {
  const keys = ["home", "config", "pass", "done"];
  keys.forEach((key) => {
    const el = panelEls[key]();
    if (!el) return;
    const on = key === name;
    el.classList.toggle("panel--active", on);
    el.hidden = !on;
  });
}

function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function pickRandom(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

function wordEntryName(w) {
  if (!w) return "";
  if (typeof w.name === "string" && w.name.trim()) return w.name.trim();
  if (typeof w.word === "string" && w.word.trim()) return w.word.trim();
  return "";
}

function wordEntryHint(w) {
  if (!w || typeof w.hint !== "string") return "";
  return w.hint.trim();
}

function getWordPool(dtb, selectedCategoryIds) {
  const sel = new Set(selectedCategoryIds);
  return dtb.words.filter(
    (w) =>
      wordEntryName(w) &&
      Array.isArray(w.categories) &&
      w.categories.some((id) => sel.has(id))
  );
}

function resolveInpostorCount(n, cfg) {
  const minK = cfg.allowFullNonInpostorRound ? 0 : 1;
  const maxK = cfg.allowFullInpostorRound ? n : n - 1;
  if (n < 1) return 0;
  if (minK > maxK) return clampInt(cfg.inpostorCount, 0, n, 0);
  return clampInt(cfg.inpostorCount, minK, maxK, minK);
}

function pickInpostorIndices(n, k) {
  const idx = shuffle([...Array(n).keys()]);
  return new Set(idx.slice(0, k));
}

function buildAssignments(players, inpostorSet, secretWord, wordEntry, cfg) {
  const inpostorNames = players.filter((_, i) => inpostorSet.has(i));
  const hintText = wordEntryHint(wordEntry);

  return players.map((name, i) => {
    const isInpostor = inpostorSet.has(i);
    const others = inpostorNames.filter((x) => x !== name);

    if (!isInpostor) {
      return {
        name,
        roleLine: "Ești cartof.",
        wordLead: secretWord ? "Cuvântul este:" : null,
        mainLine: secretWord || "—",
        extraLine: null,
      };
    }

    let mainLine = "Nu cunoști cuvântul cartofilor.";
    if (!secretWord) {
      mainLine = "Toți sunteți inpostori în această rundă.";
    }

    const parts = [];
    if (cfg.inpostorsSeeOthers && others.length > 0) {
      parts.push(`Alți inpostori: ${others.join(", ")}.`);
    }
    if (secretWord && cfg.inpostorsGetHint && hintText) {
      parts.push(`Indiciu: ${hintText}.`);
    }

    return {
      name,
      roleLine: "Ești inpostor.",
      wordLead: null,
      mainLine,
      extraLine: parts.length > 0 ? parts.join(" ") : null,
    };
  });
}

function renderPlayers(players) {
  const list = document.getElementById("player-list");
  const empty = document.getElementById("players-empty");
  list.innerHTML = "";

  players.forEach((name, index) => {
    const li = document.createElement("li");
    li.className = "player-item";
    li.innerHTML = `
      <span class="player-item__name"></span>
      <button type="button" class="player-item__remove" data-index="${index}" aria-label="Elimină ${escapeAttr(name)}">Șterge</button>
    `;
    li.querySelector(".player-item__name").textContent = name;
    list.appendChild(li);
  });

  empty.style.display = players.length === 0 ? "block" : "none";
}

function syncStartButton(btn, playersLength) {
  const ok = playersLength >= 3;
  btn.disabled = !ok;
  btn.classList.toggle("cta-btn--disabled", !ok);
}

function renderCategoryCheckboxes(dtb, config) {
  const container = document.getElementById("category-list");
  container.innerHTML = "";
  const selected = new Set(config.selectedCategoryIds);

  dtb.categories
    .slice()
    .sort((a, b) => a.id - b.id)
    .forEach((cat) => {
      const id = `cat-${cat.id}`;
      const label = document.createElement("label");
      label.className = "category-chip";
      label.htmlFor = id;
      const input = document.createElement("input");
      input.type = "checkbox";
      input.className = "sr-only";
      input.id = id;
      input.dataset.categoryId = String(cat.id);
      input.checked = selected.has(cat.id);
      const span = document.createElement("span");
      span.className = "category-chip__text";
      span.textContent = cat.name;
      label.appendChild(input);
      label.appendChild(span);
      container.appendChild(label);
    });
}

function readConfigFromForm(dtb, prev) {
  const allIds = dtb.categories.map((c) => c.id);
  const checked = [];
  document.querySelectorAll("#category-list input[type=checkbox]").forEach((el) => {
    if (el.checked) checked.push(Number(el.dataset.categoryId));
  });
  const selectedCategoryIds = checked.length > 0 ? checked : [...allIds];

  return {
    selectedCategoryIds,
    inpostorCount: clampInt(document.getElementById("inpostor-count").value, 1, 16, prev.inpostorCount),
    inpostorsGetHint: document.getElementById("cfg-hint").checked,
    inpostorsSeeOthers: document.getElementById("cfg-see-others").checked,
    allowFullInpostorRound: document.getElementById("cfg-full-inpostor").checked,
    allowFullNonInpostorRound: document.getElementById("cfg-full-cartof").checked,
  };
}

function applyConfigToForm(config) {
  document.getElementById("inpostor-count").value = String(config.inpostorCount);
  document.getElementById("cfg-hint").checked = config.inpostorsGetHint;
  document.getElementById("cfg-see-others").checked = config.inpostorsSeeOthers;
  document.getElementById("cfg-full-inpostor").checked = config.allowFullInpostorRound;
  document.getElementById("cfg-full-cartof").checked = config.allowFullNonInpostorRound;
}

function init() {
  try {
    localStorage.removeItem("inpostor_dtb");
  } catch {
    /* ignore */
  }

  const dtb = getDtbFromPage();
  const allCategoryIds = dtb.categories.map((c) => c.id);
  let gameConfig = loadGameConfig(allCategoryIds);
  saveGameConfig(gameConfig);

  let players = loadPlayers();
  const btnStart = document.getElementById("btn-start");

  renderPlayers(players);
  syncStartButton(btnStart, players.length);

  renderCategoryCheckboxes(dtb, gameConfig);
  applyConfigToForm(gameConfig);

  let roundState = null;
  let passTick = null;
  let passPressing = false;
  let passPointerId = null;
  let passGlobalUp = null;
  let doneHoldAccum = 0;
  let doneHoldTick = null;
  let doneHoldPressing = false;

  function persistConfigFromForm() {
    gameConfig = readConfigFromForm(dtb, gameConfig);
    saveGameConfig(gameConfig);
  }

  function clearPassTick() {
    if (passTick != null) {
      clearInterval(passTick);
      passTick = null;
    }
  }

  function stopPassPress() {
    passPressing = false;
    const wrap = document.getElementById("pass-card-wrap");
    const card = document.getElementById("pass-card");
    if (wrap) wrap.classList.remove("is-pressing");
    clearPassTick();
    if (passGlobalUp) {
      document.removeEventListener("pointerup", passGlobalUp, true);
      document.removeEventListener("pointercancel", passGlobalUp, true);
      passGlobalUp = null;
    }
    const pid = passPointerId;
    passPointerId = null;
    if (pid != null && card) {
      try {
        if (card.hasPointerCapture(pid)) {
          card.releasePointerCapture(pid);
        }
      } catch {
        /* ignore */
      }
    }
  }

  function updatePassNextButton() {
    const btn = document.getElementById("btn-pass-next");
    const ok = roundState && roundState.revealMs >= REVEAL_MS_NEEDED;
    btn.disabled = !ok;
  }

  function bindPassCard() {
    const card = document.getElementById("pass-card");

    card.addEventListener("pointerdown", (e) => {
      if (e.button !== 0) return;
      if (!document.getElementById("panel-pass").classList.contains("panel--active")) return;
      e.preventDefault();
      stopPassPress();
      passPointerId = e.pointerId;
      try {
        card.setPointerCapture(passPointerId);
      } catch {
        passPointerId = null;
        return;
      }
      passPressing = true;
      document.getElementById("pass-card-wrap").classList.add("is-pressing");
      clearPassTick();
      passTick = setInterval(() => {
        if (!passPressing || !roundState) return;
        roundState.revealMs += TICK_MS;
        if (roundState.revealMs >= REVEAL_MS_NEEDED) {
          updatePassNextButton();
          clearPassTick();
        }
      }, TICK_MS);

      passGlobalUp = (ev) => {
        if (ev.pointerId !== passPointerId) return;
        stopPassPress();
      };
      document.addEventListener("pointerup", passGlobalUp, true);
      document.addEventListener("pointercancel", passGlobalUp, true);
    });
  }

  function resetDoneHoldUi() {
    doneHoldPressing = false;
    if (doneHoldTick != null) {
      clearInterval(doneHoldTick);
      doneHoldTick = null;
    }
    const fill = document.getElementById("btn-done-reveal-fill");
    const btn = document.getElementById("btn-done-reveal");
    if (fill) fill.style.width = "0%";
    if (btn) btn.classList.remove("is-holding");
    doneHoldAccum = 0;
  }

  function bindDoneRevealHold() {
    const btn = document.getElementById("btn-done-reveal");
    const fill = document.getElementById("btn-done-reveal-fill");

    btn.addEventListener("pointerdown", (e) => {
      if (e.button !== 0) return;
      const panel = document.getElementById("panel-done");
      if (!panel.classList.contains("panel--active")) return;
      if (!document.getElementById("done-reveal").hidden) return;
      e.preventDefault();
      btn.setPointerCapture(e.pointerId);
      doneHoldPressing = true;
      btn.classList.add("is-holding");
      if (doneHoldTick != null) clearInterval(doneHoldTick);
      doneHoldTick = setInterval(() => {
        if (!doneHoldPressing) return;
        doneHoldAccum += TICK_MS;
        const pct = Math.min(100, (doneHoldAccum / REVEAL_DONE_MS) * 100);
        fill.style.width = `${pct}%`;
        if (doneHoldAccum >= REVEAL_DONE_MS) {
          document.getElementById("done-reveal").hidden = false;
          doneHoldAccum = 0;
          fill.style.width = "0%";
          doneHoldPressing = false;
          btn.classList.remove("is-holding");
          clearInterval(doneHoldTick);
          doneHoldTick = null;
        }
      }, TICK_MS);
    });

    const endHold = (e) => {
      if (btn.hasPointerCapture(e.pointerId)) {
        btn.releasePointerCapture(e.pointerId);
      }
      doneHoldPressing = false;
      btn.classList.remove("is-holding");
      if (doneHoldTick != null) {
        clearInterval(doneHoldTick);
        doneHoldTick = null;
      }
      const reveal = document.getElementById("done-reveal");
      if (reveal.hidden && doneHoldAccum < REVEAL_DONE_MS) {
        fill.style.width = "0%";
        doneHoldAccum = 0;
      }
    };

    btn.addEventListener("pointerup", endHold);
    btn.addEventListener("pointercancel", endHold);
  }

  function showPassSlide(index) {
    const a = roundState.assignments[index];
    document.getElementById("pass-name").textContent = a.name;
    document.getElementById("pass-line-role").textContent = a.roleLine;
    const wordLead = document.getElementById("pass-word-lead");
    if (a.wordLead) {
      wordLead.hidden = false;
      wordLead.textContent = a.wordLead;
    } else {
      wordLead.hidden = true;
      wordLead.textContent = "";
    }
    document.getElementById("pass-line-main").textContent = a.mainLine;
    const extra = document.getElementById("pass-line-extra");
    if (a.extraLine) {
      extra.hidden = false;
      extra.textContent = a.extraLine;
    } else {
      extra.hidden = true;
      extra.textContent = "";
    }
    const total = roundState.assignments.length;
    document.getElementById("pass-progress").textContent = `Jucător ${index + 1} din ${total}`;

    const nextBtn = document.getElementById("btn-pass-next");
    nextBtn.textContent = index >= total - 1 ? "Începe jocul" : "Următorul jucător";

    roundState.passIndex = index;
    roundState.revealMs = 0;
    stopPassPress();
    updatePassNextButton();
  }

  function startRoundFlow() {
    persistConfigFromForm();
    gameConfig = readConfigFromForm(dtb, gameConfig);
    saveGameConfig(gameConfig);

    if (players.length < 3) return;

    const selected = gameConfig.selectedCategoryIds;
    if (selected.length === 0) {
      alert("Bifează cel puțin o categorie în configurare.");
      return;
    }

    const pool = getWordPool(dtb, selected);
    const n = players.length;
    const k = resolveInpostorCount(n, gameConfig);
    const inpostorSet = pickInpostorIndices(n, k);

    const hasCartof = k < n;
    if (hasCartof && pool.length === 0) {
      alert("Nu există cuvinte pentru categoriile alese. Bifează alte categorii.");
      return;
    }

    const wordEntry = hasCartof ? pickRandom(pool) : null;
    const secretWord = wordEntry ? wordEntryName(wordEntry) : null;

    const assignments = buildAssignments(players, inpostorSet, secretWord, wordEntry, gameConfig);

    roundState = {
      assignments,
      passIndex: 0,
      revealMs: 0,
      starter: pickRandom(players),
      secretWord,
      inpostorNames: players.filter((_, i) => inpostorSet.has(i)),
    };

    showPanel("pass");
    showPassSlide(0);
  }

  function finishPassToDone() {
    const { starter, secretWord, inpostorNames } = roundState;

    document.getElementById("done-starter-name").textContent = starter;
    document.getElementById("done-secret-word").textContent = secretWord
      ? secretWord
      : "— (nu există cuvânt comun în această rundă)";
    document.getElementById("done-inpostor-list").textContent =
      inpostorNames.length === 0 ? "Niciunul — toți jucătorii sunt cartofi." : inpostorNames.join(", ");

    document.getElementById("done-reveal").hidden = true;
    resetDoneHoldUi();

    showPanel("done");
    roundState = null;
    stopPassPress();
  }

  document.getElementById("category-list").addEventListener("change", (e) => {
    const t = e.target;
    if (t.type !== "checkbox" || !t.dataset.categoryId) return;
    const checked = document.querySelectorAll("#category-list input[type=checkbox]:checked");
    if (checked.length === 0) {
      t.checked = true;
      return;
    }
    persistConfigFromForm();
  });

  ["inpostor-count", "cfg-hint", "cfg-see-others", "cfg-full-inpostor", "cfg-full-cartof"].forEach((id) => {
    document.getElementById(id).addEventListener("change", persistConfigFromForm);
  });
  document.getElementById("inpostor-count").addEventListener("input", persistConfigFromForm);

  const form = document.getElementById("add-form");
  const input = document.getElementById("player-name");

  form.addEventListener("submit", (e) => {
    e.preventDefault();
    const name = normalizeName(input.value);
    if (!name) return;
    if (players.includes(name)) {
      input.select();
      return;
    }
    players.push(name);
    savePlayers(players);
    renderPlayers(players);
    syncStartButton(btnStart, players.length);
    input.value = "";
    input.focus();
  });

  document.getElementById("player-list").addEventListener("click", (e) => {
    const btn = e.target.closest(".player-item__remove");
    if (!btn) return;
    const index = Number(btn.dataset.index);
    if (Number.isNaN(index)) return;
    players.splice(index, 1);
    savePlayers(players);
    renderPlayers(players);
    syncStartButton(btnStart, players.length);
  });

  function goHome() {
    persistConfigFromForm();
    stopPassPress();
    roundState = null;
    resetDoneHoldUi();
    document.getElementById("done-reveal").hidden = true;
    showPanel("home");
  }

  document.getElementById("btn-open-config").addEventListener("click", () => {
    gameConfig = loadGameConfig(allCategoryIds);
    renderCategoryCheckboxes(dtb, gameConfig);
    applyConfigToForm(gameConfig);
    showPanel("config");
  });

  document.getElementById("btn-config-play").addEventListener("click", goHome);
  document.getElementById("btn-config-back").addEventListener("click", goHome);

  document.getElementById("btn-start").addEventListener("click", () => {
    if (players.length < 3) return;
    startRoundFlow();
  });

  const modalAbandon = document.getElementById("modal-abandon");

  function openAbandonModal() {
    modalAbandon.hidden = false;
    document.getElementById("modal-abandon-cancel").focus();
  }

  function closeAbandonModal() {
    modalAbandon.hidden = true;
  }

  document.getElementById("btn-pass-abort").addEventListener("click", openAbandonModal);

  document.getElementById("modal-abandon-cancel").addEventListener("click", closeAbandonModal);
  document.getElementById("modal-abandon-backdrop").addEventListener("click", closeAbandonModal);
  document.getElementById("modal-abandon-ok").addEventListener("click", () => {
    closeAbandonModal();
    goHome();
  });

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !modalAbandon.hidden) {
      e.preventDefault();
      closeAbandonModal();
    }
  });

  document.getElementById("btn-pass-next").addEventListener("click", () => {
    if (!roundState || roundState.revealMs < REVEAL_MS_NEEDED) return;
    const next = roundState.passIndex + 1;
    if (next >= roundState.assignments.length) {
      finishPassToDone();
    } else {
      showPassSlide(next);
    }
  });

  document.getElementById("btn-done-home").addEventListener("click", goHome);

  document.getElementById("btn-done-hide-reveal").addEventListener("click", () => {
    document.getElementById("done-reveal").hidden = true;
    resetDoneHoldUi();
  });

  bindPassCard();
  bindDoneRevealHold();
  showPanel("home");
}

init();
