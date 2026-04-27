// ==UserScript==
// @name         Kleinanzeigen Plus
// @namespace    https://local.kleinanzeigen.enhanced
// @version      1.0.7
// @description  Floating settings button with default sort automation.
// @match        https://www.kleinanzeigen.de/*
// @homepageURL  https://github.com/jxnxtxan/kleinanzeigen-plus
// @supportURL   https://github.com/jxnxtxan/kleinanzeigen-plus/issues
// @updateURL    https://raw.githubusercontent.com/jxnxtxan/kleinanzeigen-plus/main/kleinazeigen-plus.js
// @downloadURL  https://raw.githubusercontent.com/jxnxtxan/kleinanzeigen-plus/main/kleinazeigen-plus.js
// @run-at       document-idle
// @grant        none
// ==/UserScript==

(function () {
  "use strict";

  const STORAGE_KEY = "kaEnhancedSettings";
  const DEFAULT_SETTINGS = {
    autoSortEnabled: true,
    preferredSort: "Niedrigster Preis",
  };
  const VALID_SORTS = ["Neueste", "Niedrigster Preis", "Höchster Preis"];
  const SORT_URL_SLUG = {
    Neueste: null,
    "Niedrigster Preis": "preis",
    "Höchster Preis": "preisabsteigend",
  };
  const SORT_ALIASES = {
    Neueste: ["neueste", "neu zuerst", "neu"],
    "Niedrigster Preis": [
      "niedrigster preis",
      "preis aufsteigend",
      "preis: aufsteigend",
      "niedrigster",
    ],
    "Höchster Preis": [
      "höchster preis",
      "hoechster preis",
      "preis absteigend",
      "preis: absteigend",
      "höchster",
      "hoechster",
    ],
  };

  let isApplyingSort = false;
  let applyRetryTimer = null;

  function loadSettings() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return { ...DEFAULT_SETTINGS };
      const parsed = JSON.parse(raw);
      const preferredSort = VALID_SORTS.includes(parsed.preferredSort)
        ? parsed.preferredSort
        : DEFAULT_SETTINGS.preferredSort;
      return {
        autoSortEnabled: parsed.autoSortEnabled !== false,
        preferredSort,
      };
    } catch {
      return { ...DEFAULT_SETTINGS };
    }
  }

  function saveSettings(next) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  }

  function normalizeText(value) {
    return String(value || "")
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/\s+/g, " ")
      .trim();
  }

  function optionMatchesSort(optionText, sortName) {
    const text = normalizeText(optionText);
    if (!text) return false;
    const aliases = SORT_ALIASES[sortName] || [sortName];
    return aliases.some((alias) => {
      const normalizedAlias = normalizeText(alias);
      return text === normalizedAlias || text.includes(normalizedAlias);
    });
  }

  function buildSortedPath(pathname, sortName) {
    if (!pathname.startsWith("/s-")) return null;
    if (pathname.startsWith("/s-anzeige/")) return null;

    const slug = SORT_URL_SLUG[sortName];
    const hasLeadingSortSegment = /^\/s-sortierung:[^/]+\/.+/.test(pathname);
    const hasInnerSortSegment = /\/sortierung:[^/]+\//.test(pathname);

    // "Neueste" is the default; remove explicit sort segment if present.
    if (!slug) {
      let nextPath = pathname;
      if (hasLeadingSortSegment) {
        nextPath = nextPath.replace(/^\/s-sortierung:[^/]+\//, "/s-");
      }
      if (hasInnerSortSegment) {
        nextPath = nextPath.replace(/\/sortierung:[^/]+\//g, "/");
      }
      return nextPath;
    }

    if (hasLeadingSortSegment) {
      const nextPath = pathname.replace(/^\/s-sortierung:[^/]+/, `/s-sortierung:${slug}`);
      return nextPath;
    }

    if (hasInnerSortSegment) {
      const nextPath = pathname.replace(/\/sortierung:[^/]+\//g, `/sortierung:${slug}/`);
      return nextPath;
    }

    // Insert sort segment after /s- to match Kleinanzeigen route style.
    return pathname.replace(/^\/s-/, `/s-sortierung:${slug}/`);
  }

  function applySortByUrl(sortName) {
    const nextPath = buildSortedPath(window.location.pathname, sortName);
    if (!nextPath || nextPath === window.location.pathname) return false;
    const nextUrl = `${window.location.origin}${nextPath}${window.location.search}${window.location.hash}`;
    window.location.assign(nextUrl);
    return true;
  }

  function getSortRoot() {
    const label = Array.from(document.querySelectorAll("label")).find((el) =>
      el.textContent?.includes("Sortieren nach")
    );
    if (label) {
      const forId = label.getAttribute("for");
      if (forId) {
        const input = document.getElementById(forId);
        if (input) return input.closest("div") || input;
      }
      const siblingSelect = label.parentElement?.querySelector("select");
      if (siblingSelect) return siblingSelect.closest("div") || siblingSelect;
    }

    const combobox = document.querySelector('[role="combobox"][aria-label*="Sortieren"]');
    if (combobox) return combobox;

    const sortSelect = Array.from(document.querySelectorAll("select")).find((el) =>
      /sort/i.test(el.name || "") || /sort/i.test(el.id || "")
    );
    return sortSelect || null;
  }

  function clickOptionByName(sortName) {
    const optionCandidates = Array.from(
      document.querySelectorAll('[role="option"], li, button, a, div')
    );
    const target = optionCandidates.find((el) => {
      const text = el.textContent?.trim();
      if (!text) return false;
      if (!optionMatchesSort(text, sortName)) return false;
      const role = el.getAttribute("role");
      return role === "option" || role === "menuitem" || role === "button" || role === "link" || el.tagName === "LI";
    });

    if (!target) return false;
    target.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    target.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
    target.click();
    return true;
  }

  function applySortByLabel(sortName) {
    const sortRoot = getSortRoot();
    if (!sortRoot) return false;

    if (sortRoot.tagName === "SELECT") {
      const select = sortRoot;
      const option = Array.from(select.options).find((opt) =>
        optionMatchesSort(opt.text, sortName)
      );
      if (!option) return false;
      if (select.value !== option.value) {
        select.value = option.value;
        select.dispatchEvent(new Event("input", { bubbles: true }));
        select.dispatchEvent(new Event("change", { bubbles: true }));
      }
      return true;
    }

    sortRoot.click();
    return clickOptionByName(sortName);
  }

  function applyPreferredSort() {
    const settings = loadSettings();
    if (!settings.autoSortEnabled || isApplyingSort) return;
    isApplyingSort = true;

    // URL-based sort is more stable on Kleinanzeigen search pages.
    const appliedViaUrl = applySortByUrl(settings.preferredSort);
    const applyDone = appliedViaUrl || applySortByLabel(settings.preferredSort);
    isApplyingSort = false;

    if (!applyDone) {
      clearTimeout(applyRetryTimer);
      applyRetryTimer = window.setTimeout(applyPreferredSort, 1000);
    }
  }

  function findHeaderAnchor() {
    const meinsButton = Array.from(document.querySelectorAll("button")).find((el) =>
      (el.textContent || "").trim() === "Meins"
    );
    if (meinsButton?.parentElement) return meinsButton.parentElement;

    const meinsByAria = document.querySelector('button[aria-label*="Meins"], button[title*="Meins"]');
    if (meinsByAria?.parentElement) return meinsByAria.parentElement;

    return null;
  }

  function createPanel() {
    if (document.getElementById("ka-enhanced-root")) return;
    const settings = loadSettings();

    const root = document.createElement("div");
    root.id = "ka-enhanced-root";
    root.innerHTML = `
      <style>
        #ka-enhanced-root {
          position: relative;
          display: inline-flex;
          align-items: center;
          margin-left: 4px;
          z-index: 2000;
          font-family: Arial, sans-serif;
          color: #222;
        }
        #ka-enhanced-open-btn {
          min-width: 72px;
          height: 64px;
          padding: 6px 10px 4px;
          border: none;
          border-radius: 8px;
          background: transparent;
          color: #1d4b00;
          font-size: 14px;
          font-weight: 600;
          line-height: 1.1;
          cursor: pointer;
          display: inline-flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          gap: 3px;
          transition: background-color 0.15s ease, color 0.15s ease;
        }
        #ka-enhanced-open-btn:hover {
          background: rgba(0, 0, 0, 0.08);
        }
        #ka-enhanced-open-btn:focus-visible {
          outline: none;
          background: rgba(0, 0, 0, 0.12);
          box-shadow: 0 0 0 2px rgba(17, 17, 17, 0.35);
        }
        #ka-enhanced-open-btn .ka-tools-icon {
          width: 18px;
          height: 18px;
          border: 2px solid currentColor;
          border-radius: 50%;
          position: relative;
          box-sizing: border-box;
        }
        #ka-enhanced-open-btn .ka-tools-icon::before,
        #ka-enhanced-open-btn .ka-tools-icon::after {
          content: "";
          position: absolute;
          left: 50%;
          top: 50%;
          background: currentColor;
          transform: translate(-50%, -50%);
        }
        #ka-enhanced-open-btn .ka-tools-icon::before {
          width: 2px;
          height: 12px;
        }
        #ka-enhanced-open-btn .ka-tools-icon::after {
          width: 12px;
          height: 2px;
        }
        #ka-enhanced-open-btn .ka-tools-label {
          font-size: 13px;
          font-weight: 600;
          color: #1d4b00;
        }
        #ka-enhanced-panel {
          display: none;
          position: absolute;
          top: calc(100% + 8px);
          right: 0;
          min-width: 300px;
          background: #fff;
          border: 1px solid #ddd;
          border-radius: 12px;
          padding: 12px;
          box-shadow: 0 8px 26px rgba(0,0,0,0.2);
        }
        #ka-enhanced-panel.open {
          display: block;
        }
        #ka-enhanced-panel h4 {
          margin: 0 0 10px;
          font-size: 14px;
        }
        .ka-row {
          margin: 8px 0;
          font-size: 13px;
        }
        .ka-row label {
          display: flex;
          gap: 8px;
          align-items: center;
        }
        #ka-sort-select {
          width: 100%;
          padding: 6px 8px;
          border-radius: 8px;
          border: 1px solid #ccc;
        }
        #ka-apply-now {
          margin-top: 8px;
          width: 100%;
          display: flex;
          justify-content: center;
          align-items: center;
          border: none;
          border-radius: 8px;
          padding: 8px;
          background: #1d4b00;
          color: #fff;
          cursor: pointer;
          font-weight: 600;
          text-align: center;
        }
      </style>
      <button id="ka-enhanced-open-btn" type="button" title="Kleinanzeigen Einstellungen">
        <span class="ka-tools-icon" aria-hidden="true"></span>
        <span class="ka-tools-label">Tools</span>
      </button>
      <div id="ka-enhanced-panel">
        <h4>Kleinanzeigen Tools</h4>
        <div class="ka-row">
          <label>
            <input id="ka-sort-enabled" type="checkbox" ${settings.autoSortEnabled ? "checked" : ""}>
            Standard-Sortierung automatisch setzen
          </label>
        </div>
        <div class="ka-row">
          <label for="ka-sort-select">Gewünschte Sortierung</label>
          <select id="ka-sort-select">
            ${VALID_SORTS.map(
              (name) =>
                `<option value="${name}" ${
                  settings.preferredSort === name ? "selected" : ""
                }>${name}</option>`
            ).join("")}
          </select>
        </div>
        <button id="ka-apply-now" type="button">Jetzt anwenden</button>
      </div>
    `;

    const headerAnchor = findHeaderAnchor();
    if (headerAnchor) {
      headerAnchor.insertAdjacentElement("afterend", root);
    } else {
      // Fallback if header structure changes.
      document.body.appendChild(root);
    }

    const openBtn = root.querySelector("#ka-enhanced-open-btn");
    const panel = root.querySelector("#ka-enhanced-panel");
    const enabledInput = root.querySelector("#ka-sort-enabled");
    const selectInput = root.querySelector("#ka-sort-select");
    const applyNowBtn = root.querySelector("#ka-apply-now");

    openBtn.addEventListener("click", () => panel.classList.toggle("open"));
    document.addEventListener("click", (event) => {
      if (!root.contains(event.target)) panel.classList.remove("open");
    });
    enabledInput.addEventListener("change", () => {
      const next = loadSettings();
      next.autoSortEnabled = enabledInput.checked;
      saveSettings(next);
      if (next.autoSortEnabled) applyPreferredSort();
    });
    selectInput.addEventListener("change", () => {
      const next = loadSettings();
      next.preferredSort = selectInput.value;
      saveSettings(next);
      if (next.autoSortEnabled) applyPreferredSort();
    });
    applyNowBtn.addEventListener("click", applyPreferredSort);
  }

  function setupObservers() {
    const observer = new MutationObserver(() => {
      if (!document.getElementById("ka-enhanced-root")) {
        createPanel();
      }
      if (!loadSettings().autoSortEnabled) return;
      clearTimeout(applyRetryTimer);
      applyRetryTimer = window.setTimeout(applyPreferredSort, 300);
    });
    observer.observe(document.body, { childList: true, subtree: true });
  }

  createPanel();
  setupObservers();
  applyPreferredSort();
})();
