// ==UserScript==
// @name         Kleinanzeigen Plus
// @namespace    https://local.kleinanzeigen.enhanced
// @version      1.2.21
// @description  Sortierung, Notizen & PDF auf Anzeigen, Bild-Lupe in Suchergebnissen, Tools-Panel.
// @match        https://www.kleinanzeigen.de/*
// @homepageURL  https://github.com/jxnxtxan/kleinanzeigen-plus
// @supportURL   https://github.com/jxnxtxan/kleinanzeigen-plus/issues
// @updateURL    https://raw.githubusercontent.com/jxnxtxan/kleinanzeigen-plus/main/kleinazeigen-plus.js
// @downloadURL  https://raw.githubusercontent.com/jxnxtxan/kleinanzeigen-plus/main/kleinazeigen-plus.js
// @run-at       document-idle
// @grant        none
// @require      https://cdnjs.cloudflare.com/ajax/libs/html2pdf.js/0.10.2/html2pdf.bundle.min.js
// @require      https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js
// @connect      cdnjs.cloudflare.com
// ==/UserScript==

(function () {
  "use strict";

  const STORAGE_KEY = "kaEnhancedSettings";
  const NOTES_STORAGE_KEY = "kaPlusNotesV1";
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

  const PDF_PAGE_WIDTH_PX = 794;
  const PDF_IMAGE_MAX = 20;
  const PDF_IMAGE_MAX_HEIGHT_CSS = 520;
  const PDF_IMAGE_JPEG_QUALITY = 0.82;
  const KA_PLUS_JSPDF_CDN_PRIMARY = "https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js";
  const KA_PLUS_JSPDF_CDN_FALLBACK = "https://unpkg.com/jspdf@2.5.1/dist/jspdf.umd.min.js";

  let isApplyingSort = false;
  let applyRetryTimer = null;
  let kaPlusRefreshTimer = null;

  function isDetailPage() {
    return window.location.pathname.startsWith("/s-anzeige/");
  }

  function isSearchPage() {
    const p = window.location.pathname;
    return p.startsWith("/s-") && !p.startsWith("/s-anzeige/");
  }

  function parseAdIdFromLocation() {
    const seg = window.location.pathname.split("/").filter(Boolean).pop() || "";
    const m = seg.match(/^(\d{6,})/);
    return m ? m[1] : null;
  }

  function loadNotesMap() {
    try {
      const raw = localStorage.getItem(NOTES_STORAGE_KEY);
      if (!raw) return {};
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === "object" ? parsed : {};
    } catch {
      return {};
    }
  }

  function saveNotesMap(map) {
    localStorage.setItem(NOTES_STORAGE_KEY, JSON.stringify(map));
  }

  function loadNoteForAd(adId) {
    if (!adId) return "";
    const map = loadNotesMap();
    return typeof map[adId] === "string" ? map[adId] : "";
  }

  function persistNoteForAd(adId, text) {
    if (!adId) return;
    const map = loadNotesMap();
    if (text) map[adId] = text;
    else delete map[adId];
    saveNotesMap(map);
  }

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

  function findContactColumnRoot() {
    const merk = Array.from(document.querySelectorAll("button, a")).find((el) => {
      const t = (el.textContent || "").trim();
      return t.includes("Zur Merkliste") || t.includes("Merkliste hinzufügen");
    });
    if (!merk) return null;
    let n = merk;
    for (let i = 0; i < 14 && n; i++) {
      const t = n.textContent || "";
      if (t.includes("Nachricht schreiben") && t.includes("Zur Merkliste")) return n;
      n = n.parentElement;
    }
    return merk.parentElement;
  }

  function escapeHtml(s) {
    return String(s || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function textOr(sel, fallback = "") {
    const el = document.querySelector(sel);
    const t = el?.innerText?.trim();
    return t || fallback;
  }

  function getAdTitleText() {
    return (
      textOr("#viewad-title") ||
      textOr('[itemprop="name"]') ||
      textOr("main h1") ||
      textOr("h1")
    );
  }

  function getAdPriceText() {
    return (
      textOr("#viewad-price") ||
      textOr('[itemprop="price"]') ||
      textOr("#viewad-main h2") ||
      ""
    );
  }

  function getDescriptionText() {
    const box =
      document.querySelector("#viewad-description-text") ||
      document.querySelector("#viewad-description") ||
      document.querySelector('[data-component="Description"]');
    return box?.innerText?.trim() || "";
  }

  function getDetailRows() {
    const rows = [];
    const list = document.querySelector("#viewad-details, [id*='viewad-details'], ul[class*='details']");
    if (list) {
      list.querySelectorAll("li").forEach((li) => {
        const t = li.innerText?.replace(/\s+/g, " ").trim();
        if (t && t.length < 400) rows.push(t);
      });
    }
    return rows;
  }

  function getCategoryText() {
    const nav = document.querySelector('nav[aria-label="Breadcrumb"], nav[aria-label*="readcrumb"]');
    if (!nav) return "";
    const parts = Array.from(nav.querySelectorAll("a"))
      .map((a) => a.textContent?.trim())
      .filter(Boolean);
    return parts[parts.length - 1] || "";
  }

  function getPostedDateText() {
    const main = document.querySelector("#viewad-main, main, article");
    if (!main) return "";
    const timeEl = main.querySelector("time[datetime]");
    return timeEl?.textContent?.trim() || timeEl?.getAttribute("datetime") || "";
  }

  function getLocationText() {
    const main = document.querySelector("#viewad-main, main, article");
    if (!main) return "";
    const loc =
      textOr("#viewad-locality") ||
      textOr('[data-testid="location"]') ||
      Array.from(main.querySelectorAll("span, div")).find((el) => /\d{5}\s/.test(el.textContent || ""))
        ?.textContent?.trim() ||
      "";
    return loc;
  }

  function parseSellerInfo() {
    const box =
      document.querySelector("#viewad-contact, [data-testid='seller-card'], [class*='seller']") ||
      document.body;
    const lines = (box.innerText || "")
      .split("\n")
      .map((line) => line.replace(/\s+/g, " ").trim())
      .filter(Boolean);
    const type =
      lines.find((line) => /privater nutzer|gewerblicher nutzer|gewerblicher anbieter/i.test(line)) || "";
    const activeLine = lines.find((line) => /aktiv seit/i.test(line)) || "";
    const activeSince = activeLine.replace(/^.*aktiv seit\s*/i, "").trim();
    const profileLink = Array.from(box.querySelectorAll("a[href]")).find((a) =>
      /\/s-bestandsliste\.html|\/pro\//i.test(a.getAttribute("href") || "")
    );
    const profileHref = profileLink?.getAttribute("href") || "";
    const userIdMatch =
      profileHref.match(/[?&](?:userId|userid|u)=(\d+)/i) ||
      profileHref.match(/\/(?:u|user)\/(\d+)/i) ||
      null;
    const userId = userIdMatch ? userIdMatch[1] : "";
    const name =
      (profileLink?.textContent || "").trim() ||
      lines.find((line) => !/^(lb|top zufriedenheit|sehr freundlich|zuverlässig|folgen|anzeige melden)$/i.test(line)) ||
      "";

    return { name, userId, type, activeSince };
  }

  function bestUrlFromSrcset(srcset) {
    if (!srcset) return "";
    let bestUrl = "";
    let bestW = 0;
    srcset.split(",").forEach((part) => {
      const bits = part.trim().split(/\s+/);
      const url = bits[0];
      const desc = bits[1] || "";
      const m = desc.match(/^(\d+)w$/i);
      const w = m ? parseInt(m[1], 10) : 0;
      if (url && w >= bestW) {
        bestW = w;
        bestUrl = url;
      }
    });
    return bestUrl;
  }

  /**
   * Kleinanzeigen prod-ads images: größere Darstellung über rule-Parameter.
   * $_920.AUTO liefert 404 – ungültig. $_59 ist die übliche „große“ Stufe in Suche/Anzeige;
   * $_59.JPG ist oft größer als $_59.AUTO (per curl auf Live-URLs verifiziert).
   */
  const KLEINANZEIGEN_BEST_RULE = "$_59.JPG";
  const KLEINANZEIGEN_FALLBACK_RULE = "$_59.AUTO";

  function upgradeKleinanzeigenImageUrl(url) {
    if (!url || typeof url !== "string") return url;
    if (!/\/\/img\.kleinanzeigen\.de\//i.test(url) && !/\/\/imgs\.classifiedscdn\.kleinanzeigen\.de\//i.test(url)) {
      return url;
    }
    const R = KLEINANZEIGEN_BEST_RULE;
    let out = url;
    out = out.replace(/([?&])rule=\$_\d+\.(AUTO|JPG|JPEG|WEBP)/gi, (_, sep) => `${sep}rule=${R}`);
    out = out.replace(/([?&])rule=_\d+\.(AUTO|JPG|JPEG|WEBP)/gi, (_, sep) => `${sep}rule=${R}`);
    if (!/rule=/i.test(out)) out = out.replace(/\$_\d+\.(AUTO|JPG|JPEG|WEBP)/gi, R);
    return out;
  }

  /** Zweite Stufe falls JPG-Regel einmal nicht liefert. */
  function kleinTo59AutoUrl(url) {
    if (!url || typeof url !== "string") return url;
    if (!/\/\/img\.kleinanzeigen\.de\//i.test(url) && !/\/\/imgs\.classifiedscdn\.kleinanzeigen\.de\//i.test(url)) {
      return url;
    }
    const R = KLEINANZEIGEN_FALLBACK_RULE;
    let out = url;
    out = out.replace(/([?&])rule=\$_\d+\.(AUTO|JPG|JPEG|WEBP)/gi, (_, sep) => `${sep}rule=${R}`);
    out = out.replace(/([?&])rule=_\d+\.(AUTO|JPG|JPEG|WEBP)/gi, (_, sep) => `${sep}rule=${R}`);
    if (!/rule=/i.test(out)) out = out.replace(/\$_\d+\.(AUTO|JPG|JPEG|WEBP)/gi, R);
    return out;
  }

  function imageUrlRuleScore(url) {
    const m = url.match(/\$_?(\d+)\.(AUTO|JPG|WEBP|JPEG)/i);
    if (!m) return 0;
    let s = parseInt(m[1], 10);
    if (String(m[2]).toUpperCase() === "JPG" || String(m[2]).toUpperCase() === "JPEG") s += 0.1;
    return s;
  }

  /** Numerischer Vergleich: höher = mehr erwartete Pixelqualität (JPG vor AUTO bei gleicher Stufe). */
  function kleinProdAdsUrlQuality(url) {
    try {
      const u = String(url || "");
      if (!/\/\/img\.kleinanzeigen\.de\/api\/v1\/prod-ads\/images\//i.test(u)) return 0;
      const m = u.match(/\$_?(\d+)\.(AUTO|JPG|JPEG|WEBP)/i);
      if (!m) return 100;
      const n = parseInt(m[1], 10);
      const typ = String(m[2]).toUpperCase();
      let q = n * 100;
      if (typ === "JPG" || typ === "JPEG") q += 50;
      else if (typ === "WEBP") q += 25;
      return q;
    } catch {
      return 0;
    }
  }

  function collectUrlsFromParsedListingDoc(doc) {
    const urls = [];
    if (!doc || !doc.querySelectorAll) return urls;
    const sel =
      "#viewad-images img, #viewad-images picture source, [id*='viewad-image'] img, [data-testid*='gallery'] img, [data-testid*='Gallery'] img";
    doc.querySelectorAll(sel).forEach((el) => {
      const tag = el.tagName && el.tagName.toUpperCase();
      if (tag === "SOURCE") {
        const s = el.getAttribute("srcset") || "";
        const b = bestUrlFromSrcset(s);
        if (b) urls.push(b);
      } else {
        const ss = el.getAttribute("srcset") || "";
        if (ss) {
          const b = bestUrlFromSrcset(ss);
          if (b) urls.push(b);
        }
        const src = el.getAttribute("src");
        if (src) urls.push(src);
      }
    });
    return urls;
  }

  function scrapeKleinanzeigenImageUrlsFromHtmlString(html) {
    const out = [];
    if (!html) return out;
    const re = /https:\/\/img\.kleinanzeigen\.de\/[^"'\\s<>)]+/gi;
    let m;
    while ((m = re.exec(html)) !== null) {
      let u = m[0].replace(/&amp;/g, "&").replace(/\\u002F/gi, "/");
      if (/placeholder|sprite|logo|favicon/i.test(u)) continue;
      out.push(u);
    }
    return out;
  }

  async function fetchListingImageCandidates(listingHref, signal) {
    const r = await fetch(listingHref, {
      credentials: "include",
      redirect: "follow",
      signal,
      headers: { Accept: "text/html,application/xhtml+xml" },
    });
    if (!r.ok) return [];
    const html = await r.text();
    let doc;
    try {
      doc = new DOMParser().parseFromString(html, "text/html");
    } catch {
      return scrapeKleinanzeigenImageUrlsFromHtmlString(html);
    }
    const fromDom = collectUrlsFromParsedListingDoc(doc);
    if (fromDom.length) return fromDom;
    return scrapeKleinanzeigenImageUrlsFromHtmlString(html);
  }

  function extractLikelyImageIdFromUrl(url) {
    if (!url) return "";
    try {
      const abs = new URL(url, location.href);
      const path = abs.pathname;
      const uuid = path.match(/\/prod-ads\/images\/[a-z0-9]{2}\/([a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})\b/i);
      if (uuid) return uuid[1];
      const loose = path.match(/\/(?:prod-ads\/)?images\/[a-z0-9]{2}\/([a-f0-9-]{8,})\b/i);
      if (loose) return loose[1];
      return "";
    } catch {
      return "";
    }
  }

  function pickBestGalleryUrlForThumb(candidates, thumbUrl) {
    const arr = [...new Set(candidates)].filter(Boolean);
    if (!arr.length) return "";
    const thumbKey = extractLikelyImageIdFromUrl(thumbUrl);
    if (thumbKey) {
      const hit = arr.find((u) => u.includes(thumbKey));
      if (hit) return upgradeKleinanzeigenImageUrl(hit);
    }
    const upgraded = arr.map((u) => upgradeKleinanzeigenImageUrl(u));
    upgraded.sort((a, b) => imageUrlRuleScore(b) - imageUrlRuleScore(a));
    return upgraded[0] || "";
  }

  async function resolveHighResListingImage(listingHref, thumbUrl, signal) {
    const cands = await fetchListingImageCandidates(listingHref, signal);
    const best = pickBestGalleryUrlForThumb(cands, thumbUrl);
    return best || "";
  }

  function bestImageUrlFromEl(el) {
    if (!el) return "";
    if (el.tagName === "SOURCE") {
      const u = bestUrlFromSrcset(el.getAttribute("srcset") || "");
      if (u) return u;
    }
    if (el.tagName === "IMG") {
      const fromSet = bestUrlFromSrcset(el.getAttribute("srcset") || "");
      if (fromSet) return fromSet;
      return el.currentSrc || el.getAttribute("src") || "";
    }
    return "";
  }

  function collectGalleryImageUrls() {
    const root =
      document.querySelector("#viewad-images, [id*='viewad-images'], [data-testid*='gallery']") ||
      document.querySelector("#viewad-main") ||
      document.body;
    const urls = [];
    const seen = new Set();
    root.querySelectorAll("img, picture source").forEach((el) => {
      const u = bestImageUrlFromEl(el);
      if (!u || u.startsWith("data:") || u.includes("sprite") || u.includes("placeholder")) return;
      if (seen.has(u)) return;
      seen.add(u);
      urls.push(u);
    });
    return urls.slice(0, 48);
  }

  function buildPdfInnerHtml(data) {
    const rowsHtml = data.detailRows
      .map((r) => `<tr><td colspan="2" style="padding:4px 0;border-bottom:1px solid #eee;">${escapeHtml(r)}</td></tr>`)
      .join("");
    const imgs = data.imageUrls.slice(0, PDF_IMAGE_MAX);
    const imgBlocks = imgs
      .map(
        (url, i) => `
      <div style="margin:12px 0;page-break-inside:avoid;">
        <div style="font-size:11px;color:#666;margin-bottom:4px;">${i + 1} / ${imgs.length}</div>
        <img crossorigin="anonymous" src="${escapeHtml(url)}" style="max-width:100%;max-height:${PDF_IMAGE_MAX_HEIGHT_CSS}px;height:auto;display:block;border:1px solid #ddd;border-radius:4px;" alt="" />
      </div>`
      )
      .join("");
    const exportLine = new Date().toLocaleString("de-DE");
    return `
      <div style="font-family:Arial,Helvetica,sans-serif;font-size:13px;color:#111;line-height:1.45;">
        <h1 style="font-size:20px;margin:0 0 8px;">${escapeHtml(data.title)}</h1>
        <p style="margin:4px 0;"><strong>Anzeigen-ID</strong> ${escapeHtml(data.adId)}</p>
        <p style="margin:4px 0;"><strong>Preis</strong> ${escapeHtml(data.price)}</p>
        <p style="margin:4px 0;"><strong>Ort</strong> ${escapeHtml(data.location)}</p>
        <p style="margin:4px 0;"><strong>Eingestellt</strong> ${escapeHtml(data.postedDate)}</p>
        <p style="margin:4px 0;"><strong>Kategorie</strong> ${escapeHtml(data.category)}</p>
        <p style="margin:4px 0;word-break:break-all;"><strong>URL</strong> ${escapeHtml(data.url)}</p>
        <h2 style="font-size:15px;margin:16px 0 6px;">Verkäufer</h2>
        <p style="margin:4px 0;"><strong>Name</strong> ${escapeHtml(data.sellerName)}</p>
        <p style="margin:4px 0;"><strong>Nutzer-ID</strong> ${escapeHtml(data.sellerUserId)}</p>
        <p style="margin:4px 0;"><strong>Typ</strong> ${escapeHtml(data.sellerType)}</p>
        <p style="margin:4px 0;"><strong>Aktiv seit</strong> ${escapeHtml(data.sellerActiveSince)}</p>
        <h2 style="font-size:15px;margin:16px 0 6px;">Details</h2>
        <table style="width:100%;border-collapse:collapse;">${rowsHtml || `<tr><td>${escapeHtml("(Keine strukturierten Merkmale gefunden)")}</td></tr>`}</table>
        <h2 style="font-size:15px;margin:16px 0 6px;">Beschreibung</h2>
        <p style="margin:4px 0;white-space:pre-wrap;">${escapeHtml(data.description)}</p>
        <h2 style="font-size:15px;margin:16px 0 6px;">Bilder (${imgs.length})</h2>
        ${imgBlocks || `<p>${escapeHtml("(Keine Bilder erkannt)")}</p>`}
        <hr style="margin:20px 0;border:none;border-top:1px solid #ccc;" />
        <p style="font-size:10px;color:#555;">Exportiert am: ${escapeHtml(exportLine)}</p>
        <p style="font-size:10px;color:#555;">Quelle: kleinanzeigen.de • PDF erstellt mit: Kleinanzeigen Plus</p>
        <p style="font-size:10px;color:#555;">Hinweis: Dieses PDF wurde automatisch von Kleinanzeigen Plus erstellt und dient ausschließlich der persönlichen Dokumentation. Kleinanzeigen Plus ist nicht verantwortlich für den Inhalt der Anzeige. Alle Rechte am Inhalt (Texte, Bilder) verbleiben beim jeweiligen Ersteller bzw. Rechteinhaber. Eine Weiterverbreitung oder kommerzielle Nutzung ist ohne ausdrückliche Genehmigung nicht gestattet.</p>
      </div>
    `;
  }

  function logPdfRuntime(stage, extra = {}) {
    const snapshot = {
      stage,
      hasHtml2Pdf: typeof globalThis.html2pdf,
      hasJspdfNamespace: typeof globalThis.jspdf,
      hasJspdfCtor: typeof globalThis.jspdf?.jsPDF,
      hasGlobalJsPdfCtor: typeof globalThis.jsPDF,
      ...extra,
    };
    console.log("[Kleinanzeigen Plus][PDF Debug]", snapshot);
  }

  function loadScriptOnce(src) {
    return new Promise((resolve, reject) => {
      const existing = Array.from(document.querySelectorAll("script[src]")).find((s) => s.src === src);
      if (existing?.dataset.kaPlusLoaded === "1") {
        resolve();
        return;
      }
      const script = existing || document.createElement("script");
      script.src = src;
      script.async = true;
      script.crossOrigin = "anonymous";
      const done = () => {
        script.dataset.kaPlusLoaded = "1";
        resolve();
      };
      const fail = (ev) => reject(new Error(`Script load failed: ${src} (${ev?.type || "error"})`));
      script.addEventListener("load", done, { once: true });
      script.addEventListener("error", fail, { once: true });
      if (!existing) document.head.appendChild(script);
    });
  }

  async function ensureJsPdfAvailable() {
    const before = globalThis.jspdf?.jsPDF || globalThis.jsPDF;
    if (typeof before === "function") return before;
    logPdfRuntime("jspdf-missing-before-runtime-load");

    try {
      await loadScriptOnce(KA_PLUS_JSPDF_CDN_PRIMARY);
    } catch (errPrimary) {
      console.warn("[Kleinanzeigen Plus][PDF Debug] Primary jsPDF CDN load failed:", errPrimary);
      await loadScriptOnce(KA_PLUS_JSPDF_CDN_FALLBACK);
    }

    const after = globalThis.jspdf?.jsPDF || globalThis.jsPDF;
    if (typeof after !== "function") {
      logPdfRuntime("jspdf-still-missing-after-runtime-load");
      throw new Error("jsPDF fallback unavailable");
    }
    logPdfRuntime("jspdf-ready-after-runtime-load");
    return after;
  }

  function blobToDataUrl(blob) {
    return new Promise((resolve, reject) => {
      const fr = new FileReader();
      fr.onload = () => resolve(String(fr.result || ""));
      fr.onerror = () => reject(new Error("Failed to convert blob to data URL"));
      fr.readAsDataURL(blob);
    });
  }

  async function fetchImageAsDataUrl(url) {
    const candidates = [...new Set([upgradeKleinanzeigenImageUrl(url), kleinTo59AutoUrl(url), url].filter(Boolean))];
    for (const candidate of candidates) {
      try {
        const res = await fetch(candidate, {
          method: "GET",
          mode: "cors",
          credentials: "omit",
          cache: "force-cache",
        });
        if (!res.ok) continue;
        const blob = await res.blob();
        if (!blob || !blob.size) continue;
        const dataUrl = await blobToDataUrl(blob);
        if (dataUrl.startsWith("data:image/")) {
          return { dataUrl, sourceUrl: candidate };
        }
      } catch {
        // Try next URL variant.
      }
    }
    return null;
  }

  async function exportPdfWithJsPdfFallback(data, filename) {
    const Ctor = await ensureJsPdfAvailable();
    const doc = new Ctor({ unit: "mm", format: "a4", orientation: "portrait" });
    const pageW = doc.internal.pageSize.getWidth();
    const pageH = doc.internal.pageSize.getHeight();
    const margin = 14;
    const contentW = pageW - margin * 2;
    let y = margin;

    const ensureRoom = (needed = 6) => {
      if (y + needed <= pageH - margin) return;
      doc.addPage();
      y = margin;
    };
    const writeLine = (text, size = 10.6, bold = false, gap = 5.1, color = [22, 25, 33]) => {
      ensureRoom(gap + 1);
      doc.setTextColor(color[0], color[1], color[2]);
      doc.setFont("helvetica", bold ? "bold" : "normal");
      doc.setFontSize(size);
      doc.text(String(text || ""), margin, y);
      y += gap;
    };
    const writeWrapped = (text, size = 10.6, bold = false, gap = 4.9, color = [22, 25, 33]) => {
      doc.setTextColor(color[0], color[1], color[2]);
      doc.setFont("helvetica", bold ? "bold" : "normal");
      doc.setFontSize(size);
      const lines = doc.splitTextToSize(String(text || ""), contentW);
      lines.forEach((line) => {
        ensureRoom(gap + 1);
        doc.text(String(line), margin, y);
        y += gap;
      });
    };
    const section = (label) => {
      y += 5.2;
      ensureRoom(13);
      doc.setDrawColor(233, 237, 244);
      doc.setLineWidth(0.35);
      doc.line(margin, y - 6.2, pageW - margin, y - 6.2);
      writeLine(label, 13.6, true, 6.4, [26, 31, 43]);
    };
    const writeKeyValue = (label, value) => {
      doc.setFont("helvetica", "normal");
      doc.setFontSize(11);
      doc.setTextColor(98, 107, 121);
      ensureRoom(5.4);
      doc.text(String(label || "-"), margin, y);
      doc.setFont("helvetica", "bold");
      doc.setTextColor(25, 29, 37);
      doc.text(String(value || "-"), margin + 42, y);
      y += 5.4;
    };

    writeLine(data.title || "Anzeige", 19.5, true, 8.6, [18, 22, 30]);
    writeKeyValue("Anzeigen-ID", data.adId);
    writeKeyValue("Preis", data.price);
    writeKeyValue("Ort", data.location);
    writeKeyValue("Eingestellt", data.postedDate);
    writeKeyValue("Kategorie", data.category);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(11);
    doc.setTextColor(98, 107, 121);
    ensureRoom(5.4);
    doc.text("URL", margin, y);
    const urlLines = doc.splitTextToSize(String(data.url || "-"), contentW - 58);
    urlLines.forEach((line, idx) => {
      ensureRoom(5.1);
      doc.setFont("helvetica", idx === 0 ? "bold" : "normal");
      doc.setTextColor(25, 109, 210);
      doc.text(String(line), margin + 42, y);
      y += 5.1;
    });

    section("Verkäufer");
    writeKeyValue("Name", data.sellerName);
    writeKeyValue("Nutzer-ID", data.sellerUserId);
    writeKeyValue("Typ", data.sellerType);
    writeKeyValue("Aktiv seit", data.sellerActiveSince);

    section("Details");
    const details = Array.isArray(data.detailRows) ? data.detailRows : [];
    if (!details.length) writeLine("(Keine strukturierten Merkmale gefunden)", 10.2, false, 4.8, [98, 107, 121]);
    details.forEach((row) => {
      const m = String(row || "").match(/^([^:]+?)\s+(.+)$/);
      if (m) {
        writeKeyValue(m[1], m[2]);
      } else {
        writeWrapped(row, 10.6, false, 4.8);
      }
    });

    section("Beschreibung");
    writeWrapped(data.description || "(Keine Beschreibung)", 11.2, false, 5.35, [28, 33, 44]);

    const images = Array.isArray(data.imageUrls) ? data.imageUrls : [];
    if (!images.length) writeLine("(Keine Bilder erkannt)", 10.2, false, 4.8, [98, 107, 121]);
    let embeddedCount = 0;
    const total = Math.min(images.length, PDF_IMAGE_MAX);
    const perPage = 6;
    const gridGap = 3.8;
    const cellW = (contentW - gridGap) / 2;
    const cellH = 59;
    for (let idx = 0; idx < total; idx += perPage) {
      doc.addPage();
      y = margin;
      doc.setFont("helvetica", "bold");
      doc.setFontSize(13.6);
      doc.setTextColor(26, 31, 43);
      doc.text(`Bilder (${images.length})`, margin, y + 2);
      const chunk = images.slice(idx, idx + perPage);
      for (let j = 0; j < chunk.length; j += 1) {
        const absoluteIndex = idx + j;
        const url = chunk[j];
        const row = Math.floor(j / 2);
        const col = j % 2;
        const x = margin + col * (cellW + gridGap);
        const top = margin + 8 + row * (cellH + 10);
        doc.setFont("helvetica", "bold");
        doc.setFontSize(11.2);
        doc.setTextColor(44, 51, 66);
        doc.text(`${absoluteIndex + 1} / ${images.length}`, x, top + 3.2);

        const imageTop = top + 6;
        const loaded = await fetchImageAsDataUrl(url);
        if (!loaded) {
          doc.setFont("helvetica", "normal");
          doc.setFontSize(8.2);
          doc.setTextColor(112, 120, 134);
          const missing = doc.splitTextToSize(String(url || ""), cellW - 4);
          missing.slice(0, 4).forEach((line, lineIdx) => {
            doc.text(String(line), x + 2, imageTop + 6 + lineIdx * 3.8);
          });
          continue;
        }
        try {
          const props = doc.getImageProperties(loaded.dataUrl);
          const naturalW = props.width || 1;
          const naturalH = props.height || 1;
          const ratio = Math.min(cellW / naturalW, cellH / naturalH);
          const drawW = naturalW * ratio;
          const drawH = naturalH * ratio;
          const drawX = x + (cellW - drawW) / 2;
          const drawY = imageTop + (cellH - drawH) / 2;
          const format = loaded.dataUrl.startsWith("data:image/png") ? "PNG" : "JPEG";
          doc.addImage(loaded.dataUrl, format, drawX, drawY, drawW, drawH, undefined, "FAST");
          embeddedCount += 1;
        } catch {
          doc.setFont("helvetica", "normal");
          doc.setFontSize(8.2);
          doc.setTextColor(112, 120, 134);
          doc.text("Bild konnte nicht eingebettet werden.", x + 2, imageTop + 6);
        }
      }
      const pages = Math.ceil(total / perPage) || 1;
      doc.setFont("helvetica", "normal");
      doc.setFontSize(9);
      doc.setTextColor(122, 130, 143);
      doc.text(`${Math.floor(idx / perPage) + 1} / ${pages}`, pageW / 2, pageH - 8, { align: "center" });
    }
    logPdfRuntime("jspdf-images-embedded", {
      requested: total,
      embeddedCount,
    });

    doc.setPage(1);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8.8);
    doc.setTextColor(112, 120, 134);
    doc.text(`Exportiert am: ${new Date().toLocaleString("de-DE")}`, margin, pageH - 19);
    doc.text("Quelle: kleinanzeigen.de • PDF erstellt mit: Kleinanzeigen Plus", margin, pageH - 14.2);
    const hint =
      "Hinweis: Dieses PDF wurde automatisch von Kleinanzeigen Plus erstellt und dient ausschließlich der persönlichen Dokumentation. Kleinanzeigen Plus ist nicht verantwortlich für den Inhalt der Anzeige. Alle Rechte am Inhalt (Texte, Bilder) verbleiben beim jeweiligen Ersteller bzw. Rechteinhaber. Eine Weiterverbreitung oder kommerzielle Nutzung ist ohne ausdrückliche Genehmigung nicht gestattet.";
    const hintLines = doc.splitTextToSize(hint, contentW);
    hintLines.slice(0, 2).forEach((line, idx) => doc.text(String(line), margin, pageH - 9.6 + idx * 4));

    const out = doc.output("blob");
    if (!out || out.size < 800) {
      throw new Error(`jsPDF generated suspiciously small blob: ${out ? out.size : 0}`);
    }
    const url = URL.createObjectURL(out);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1500);
  }

  function runPdfExport(adId) {
    logPdfRuntime("runPdfExport-start");
    const title = getAdTitleText() || "Anzeige";
    const seller = parseSellerInfo();
    const data = {
      adId: adId || parseAdIdFromLocation() || "",
      title,
      price: getAdPriceText(),
      location: getLocationText(),
      postedDate: getPostedDateText(),
      category: getCategoryText(),
      url: window.location.href,
      sellerName: seller.name,
      sellerUserId: seller.userId,
      sellerType: seller.type,
      sellerActiveSince: seller.activeSince,
      detailRows: getDetailRows(),
      description: getDescriptionText(),
      imageUrls: collectGalleryImageUrls(),
    };
    const filename = `Kleinanzeigen_${data.adId || "export"}.pdf`;
    Promise.resolve()
      .then(() => {
        logPdfRuntime("before-jspdf-export", {
          titleLen: String(data.title || "").length,
          descLen: String(data.description || "").length,
          detailCount: Array.isArray(data.detailRows) ? data.detailRows.length : -1,
          imageCount: Array.isArray(data.imageUrls) ? data.imageUrls.length : -1,
        });
        return exportPdfWithJsPdfFallback(data, filename);
      })
      .catch((err) => {
        console.error("[Kleinanzeigen Plus] PDF export failed:", err);
        window.alert("PDF konnte nicht erzeugt werden.");
      });
  }

  function injectAdNotesAndPdf() {
    if (!isDetailPage()) {
      const stale = document.getElementById("ka-plus-ad-tools");
      if (stale) stale.remove();
      return;
    }
    const adId = parseAdIdFromLocation();
    if (!adId) return;
    const existing = document.getElementById("ka-plus-ad-tools");
    if (existing) {
      if (existing.dataset.kaPlusAdId === adId) return;
      existing.remove();
    }

    const anchor = findContactColumnRoot();
    const insertParent = anchor?.parentElement || document.querySelector("#viewad-main") || document.body;

    const root = document.createElement("div");
    root.id = "ka-plus-ad-tools";
    root.dataset.kaPlusInjected = "1";
    root.dataset.kaPlusAdId = adId;
    const saved = loadNoteForAd(adId);

    root.innerHTML = `
      <style>
        #ka-plus-ad-tools {
          font-family: Arial, Helvetica, sans-serif;
          color: #111;
          margin: 16px 0;
          padding: 12px;
          border: 1px solid #ddd;
          border-radius: 10px;
          background: #fff;
          box-sizing: border-box;
        }
        #ka-plus-ad-tools .ka-plus-notes-title {
          font-weight: 700;
          font-size: 13px;
          letter-spacing: 0.04em;
          margin: 0 0 8px;
        }
        #ka-plus-ad-tools textarea.ka-plus-notes-input {
          width: 100%;
          min-height: 110px;
          box-sizing: border-box;
          border: 1px solid #ffb900;
          border-radius: 6px;
          padding: 8px;
          font-size: 13px;
          resize: vertical;
        }
        #ka-plus-ad-tools .ka-plus-notes-actions {
          display: flex;
          gap: 8px;
          margin-top: 8px;
        }
        #ka-plus-ad-tools .ka-plus-btn-save {
          flex: 1;
          border: none;
          border-radius: 999px;
          padding: 8px 12px;
          background: #ffc107;
          color: #111;
          font-weight: 600;
          cursor: pointer;
          display: flex;
          align-items: center;
          justify-content: center;
          text-align: center;
        }
        #ka-plus-ad-tools .ka-plus-btn-del {
          flex: 1;
          border: none;
          border-radius: 999px;
          padding: 8px 12px;
          background: #8b1538;
          color: #fff;
          font-weight: 600;
          cursor: pointer;
          display: flex;
          align-items: center;
          justify-content: center;
          text-align: center;
        }
        #ka-plus-ad-tools .ka-plus-btn-pdf {
          margin-top: 10px;
          width: 100%;
          border: none;
          border-radius: 999px;
          padding: 10px 12px;
          min-height: 40px;
          background: #ffc107;
          color: #111;
          font-weight: 700;
          cursor: pointer;
          display: flex;
          align-items: center;
          justify-content: center;
          text-align: center;
          line-height: 1.2;
        }
        #ka-plus-ad-tools .ka-plus-notes-footer {
          margin-top: 8px;
          font-size: 11px;
          color: #888;
          text-align: center;
        }
      </style>
      <p class="ka-plus-notes-title">MEINE NOTIZEN</p>
      <textarea class="ka-plus-notes-input" id="ka-plus-notes-ta" aria-label="Eigene Notiz zur Anzeige"></textarea>
      <div class="ka-plus-notes-actions">
        <button type="button" class="ka-plus-btn-save" id="ka-plus-notes-save">Speichern</button>
        <button type="button" class="ka-plus-btn-del" id="ka-plus-notes-del">Löschen</button>
      </div>
      <button type="button" class="ka-plus-btn-pdf" id="ka-plus-pdf-btn">Als PDF speichern</button>
      <p class="ka-plus-notes-footer">© Kleinanzeigen Plus</p>
    `;

    if (anchor) anchor.insertAdjacentElement("afterend", root);
    else insertParent.appendChild(root);

    const ta = root.querySelector("#ka-plus-notes-ta");
    ta.value = saved;

    root.querySelector("#ka-plus-notes-save").addEventListener("click", () => {
      persistNoteForAd(adId, ta.value.trim());
    });
    root.querySelector("#ka-plus-notes-del").addEventListener("click", () => {
      ta.value = "";
      persistNoteForAd(adId, "");
    });
    root.querySelector("#ka-plus-pdf-btn").addEventListener("click", () => runPdfExport(adId));
  }

  function abortKaPlusLightboxFetch(lb) {
    if (!lb || !lb._kaPlusLightboxAbort) return;
    try {
      lb._kaPlusLightboxAbort.abort();
    } catch {
      /* ignore */
    }
    lb._kaPlusLightboxAbort = null;
  }

  function closeKaPlusLightbox() {
    const lb = document.getElementById("ka-plus-lightbox");
    if (!lb) return;
    abortKaPlusLightboxFetch(lb);
    lb.classList.remove("ka-open");
  }

  function ensureLightbox() {
    let lb = document.getElementById("ka-plus-lightbox");
    if (lb) {
      const inner = lb.querySelector("#ka-plus-lightbox-inner");
      const needsRebuild =
        !inner?.querySelector("#ka-plus-lightbox-figure-wrap") ||
        !inner?.querySelector("#ka-plus-lightbox-img-frame") ||
        inner.firstElementChild?.id === "ka-plus-lightbox-toolbar";
      if (needsRebuild) {
        lb.remove();
        lb = null;
      }
    }
    if (lb) return lb;
    lb = document.createElement("div");
    lb.id = "ka-plus-lightbox";
    lb.innerHTML = `
      <style>
        #ka-plus-lightbox {
          display: none;
          position: fixed;
          inset: 0;
          z-index: 2147483000;
          background: rgba(0,0,0,0.78);
          align-items: stretch;
          justify-content: flex-start;
          padding: 4px 4px 8px;
          box-sizing: border-box;
          flex-direction: column;
          min-height: 100vh;
          min-height: 100dvh;
        }
        #ka-plus-lightbox.ka-open { display: flex; }
        #ka-plus-lightbox-inner {
          flex: 1 1 auto;
          min-height: 0;
          width: 100%;
          max-width: 100%;
          display: flex;
          flex-direction: column;
          align-items: stretch;
          justify-content: flex-start;
          box-sizing: border-box;
        }
        #ka-plus-lightbox-toolbar {
          flex: 0 0 auto;
          width: 100%;
          max-width: 100%;
          display: flex;
          justify-content: center;
          padding-top: 12px;
          padding-bottom: 4px;
          box-sizing: border-box;
        }
        #ka-plus-lightbox-link {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          padding: 10px 24px;
          border-radius: 9999px;
          background: #ffc107;
          color: #111;
          font-weight: 700;
          font-size: 14px;
          font-family: Arial, Helvetica, sans-serif;
          text-decoration: none;
          box-shadow: 0 2px 12px rgba(0,0,0,0.35);
          border: none;
          box-sizing: border-box;
          line-height: 1.2;
        }
        #ka-plus-lightbox-link:hover { filter: brightness(1.06); }
        #ka-plus-lightbox-figure-wrap {
          flex: 1 1 auto;
          min-height: 0;
          width: 100%;
          max-width: 100%;
          display: flex;
          align-items: center;
          justify-content: center;
          box-sizing: border-box;
          padding: 2px;
        }
        #ka-plus-lightbox-img-frame {
          position: relative;
          display: inline-block;
          line-height: 0;
          vertical-align: middle;
          max-width: calc(100vw - 44px);
          max-height: min(calc(100dvh - 98px), calc(100vh - 98px));
        }
        #ka-plus-lightbox-img {
          display: block;
          max-width: calc(100vw - 44px);
          max-height: min(calc(100dvh - 98px), calc(100vh - 98px));
          width: auto;
          height: auto;
          object-fit: contain;
          border-radius: 14px;
          box-shadow: 0 12px 48px rgba(0,0,0,0.55);
        }
        #ka-plus-lightbox-close {
          position: absolute;
          top: 6px;
          right: 6px;
          width: 44px;
          height: 44px;
          min-width: 44px;
          min-height: 44px;
          padding: 0;
          margin: 0;
          border: none;
          border-radius: 50%;
          box-sizing: border-box;
          background: #fff;
          color: #1d4b00;
          cursor: pointer;
          box-shadow: 0 3px 14px rgba(0,0,0,0.35);
          transform: none;
          display: flex;
          align-items: center;
          justify-content: center;
          z-index: 2;
        }
        #ka-plus-lightbox-close svg {
          display: block;
          flex-shrink: 0;
        }
        #ka-plus-lightbox-close:focus-visible {
          outline: 2px solid #ffc107;
          outline-offset: 2px;
        }
      </style>
      <div id="ka-plus-lightbox-inner">
        <div id="ka-plus-lightbox-figure-wrap">
          <div id="ka-plus-lightbox-img-frame">
            <img id="ka-plus-lightbox-img" alt="Vergrößertes Anzeigenbild" />
            <button type="button" id="ka-plus-lightbox-close" aria-label="Schließen">
              <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                <path d="M6 6l12 12M18 6L6 18" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"/>
              </svg>
            </button>
          </div>
        </div>
        <div id="ka-plus-lightbox-toolbar">
          <a id="ka-plus-lightbox-link" href="#" target="_blank" rel="noopener">Zur Anzeige</a>
        </div>
      </div>
    `;
    document.body.appendChild(lb);
    lb.querySelector("#ka-plus-lightbox-close").addEventListener("click", (e) => {
      e.stopPropagation();
      closeKaPlusLightbox();
    });
    lb.querySelector("#ka-plus-lightbox-link").addEventListener("click", (e) => e.stopPropagation());
    lb.addEventListener("click", (e) => {
      if (e.target === lb) closeKaPlusLightbox();
    });
    return lb;
  }

  function openLightbox(imageUrl, listingHref) {
    const lb = ensureLightbox();
    abortKaPlusLightboxFetch(lb);

    const img = lb.querySelector("#ka-plus-lightbox-img");
    const link = lb.querySelector("#ka-plus-lightbox-link");
    const thumb = imageUrl || "";
    const bestJpg = upgradeKleinanzeigenImageUrl(thumb);
    const bestAuto = kleinTo59AutoUrl(thumb);
    const tryUrls = [...new Set([bestJpg, bestAuto, thumb].filter(Boolean))];

    let tryIdx = 0;
    img.onload = null;
    img.onerror = function kaLbImgFallback() {
      tryIdx += 1;
      if (tryIdx < tryUrls.length) {
        img.src = tryUrls[tryIdx];
        return;
      }
      img.onerror = null;
    };
    img.src = tryUrls[0] || thumb;

    link.href = listingHref || "#";
    const toolbar = lb.querySelector("#ka-plus-lightbox-toolbar");
    if (toolbar) toolbar.style.display = listingHref ? "flex" : "none";
    link.style.display = listingHref ? "inline-flex" : "none";
    lb.classList.add("ka-open");

    if (!listingHref) return;

    const ac = new AbortController();
    lb._kaPlusLightboxAbort = ac;
    const fallbackSrc = tryUrls[0] || thumb;

    resolveHighResListingImage(listingHref, thumb, ac.signal)
      .then((hi) => {
        if (ac.signal.aborted || !hi) return;
        if (!lb.classList.contains("ka-open")) return;

        const candidate = upgradeKleinanzeigenImageUrl(hi);
        const cur = img.currentSrc || img.src || "";
        try {
          if (candidate && new URL(candidate).href === new URL(cur, location.href).href) return;
        } catch {
          if (candidate === cur) return;
        }

        const qCand = kleinProdAdsUrlQuality(candidate);
        const qCur = kleinProdAdsUrlQuality(cur);
        if (qCand <= qCur) return;

        const fb = [...new Set([kleinTo59AutoUrl(hi), fallbackSrc])].filter((u) => u && u !== candidate);
        let fi = -1;

        img.onerror = function kaLbHiFallback() {
          fi += 1;
          if (fi < fb.length) img.src = fb[fi];
          else img.onerror = null;
        };
        img.src = candidate;
      })
      .catch(() => {});
  }

  function findListingCardRoot(anchorLink) {
    const article = anchorLink.closest("article");
    if (article) return article;
    const li = anchorLink.closest("li");
    if (li && li.querySelector("img")) return li;
    let n = anchorLink.parentElement;
    for (let i = 0; i < 10 && n && n !== document.body; i++) {
      if (n.querySelector && n.querySelector("img")) {
        const imgs = n.querySelectorAll("img");
        if (imgs.length === 1 || anchorLink.href) return n;
      }
      n = n.parentElement;
    }
    return anchorLink.parentElement !== document.body ? anchorLink.parentElement : null;
  }

  function firstListingImage(card) {
    const img = card.querySelector("img");
    return img || null;
  }

  function enhanceSearchCards() {
    if (!isSearchPage()) return;
    let cards = Array.from(document.querySelectorAll("article")).filter(
      (a) => a.querySelector('a[href*="/s-anzeige/"]') && a.querySelector("img")
    );
    if (!cards.length) {
      cards = Array.from(document.querySelectorAll('a[href*="/s-anzeige/"]'))
        .map((link) => findListingCardRoot(link))
        .filter((c, i, arr) => c && c.querySelector?.("img") && arr.indexOf(c) === i);
    }
    cards.forEach((card) => {
      if (card.dataset.kaPlusLupe === "1") return;
      const link = card.querySelector('a[href*="/s-anzeige/"]');
      const img = firstListingImage(card);
      if (!link || !img || !card.contains(img)) return;

      card.dataset.kaPlusLupe = "1";
      const href = link.getAttribute("href") || "";
      let wrap = img.parentElement;
      if (!wrap) return;
      if (window.getComputedStyle(wrap).position === "static") wrap.style.position = "relative";

      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "ka-plus-lupe-btn";
      btn.title = "Bild vergrößern";
      btn.setAttribute("aria-label", "Bild vergrößern");
      btn.innerHTML = `
        <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true" style="display:block;">
          <circle cx="10" cy="10" r="6.5" fill="none" stroke="#fff" stroke-width="2"/>
          <line x1="15" y1="15" x2="21" y2="21" stroke="#fff" stroke-width="2.5" stroke-linecap="round"/>
        </svg>
      `;
      Object.assign(btn.style, {
        position: "absolute",
        left: "8px",
        top: "8px",
        transform: "none",
        width: "40px",
        height: "40px",
        minWidth: "40px",
        minHeight: "40px",
        aspectRatio: "1 / 1",
        boxSizing: "border-box",
        borderRadius: "50%",
        border: "none",
        background: "#ffc107",
        cursor: "pointer",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        boxShadow: "0 2px 8px rgba(0,0,0,0.25)",
        zIndex: "5",
        padding: "0",
        lineHeight: "0",
      });

      const listingUrl = new URL(href, window.location.origin).href;
      const onLupeClick = (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
        const url =
          bestUrlFromSrcset(img.getAttribute("srcset") || "") || img.currentSrc || img.getAttribute("src") || "";
        if (url) openLightbox(url, listingUrl);
      };
      btn.addEventListener("click", onLupeClick, true);

      wrap.appendChild(btn);
    });
  }

  function scheduleKaPlusRefresh() {
    clearTimeout(kaPlusRefreshTimer);
    kaPlusRefreshTimer = window.setTimeout(() => {
      injectAdNotesAndPdf();
      enhanceSearchCards();
    }, 120);
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
      scheduleKaPlusRefresh();
      if (!loadSettings().autoSortEnabled) return;
      clearTimeout(applyRetryTimer);
      applyRetryTimer = window.setTimeout(applyPreferredSort, 300);
    });
    observer.observe(document.body, { childList: true, subtree: true });
  }

  window.addEventListener("popstate", scheduleKaPlusRefresh);

  createPanel();
  setupObservers();
  applyPreferredSort();
  scheduleKaPlusRefresh();
})();
