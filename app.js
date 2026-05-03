const contentRoot = document.getElementById("scriptureContent");
const tocRoot = document.getElementById("tocList");
const searchInput = document.getElementById("searchInput");
const searchCount = document.getElementById("searchCount");
const progressBar = document.getElementById("progressBar");
const increaseText = document.getElementById("increaseText");
const decreaseText = document.getElementById("decreaseText");
const focusMode = document.getElementById("focusMode");
const tocToggle = document.getElementById("tocToggle");
const bookMode = document.getElementById("bookMode");
const canvas = document.getElementById("sand-canvas");
const languageSelect = document.getElementById("languageSelect");
const languageSelectPanel = document.getElementById("languageSelectPanel");
const heroTitle = document.getElementById("hero-title");
const heroKicker = document.querySelector(".kicker");
const heroLines = document.querySelectorAll(".hero-line");
const brandLink = document.querySelector(".brand-mark");
const brandTitle = document.querySelector(".brand-mark span:last-child");
const scripturePanel = document.querySelector(".scripture-panel");
const bookReader = document.getElementById("bookReader");
const bookSpread = document.getElementById("bookSpread");
const bookPageLeft = document.getElementById("bookPageLeft");
const bookPageRight = document.getElementById("bookPageRight");
const bookPrev = document.getElementById("bookPrev");
const bookNext = document.getElementById("bookNext");
const bookPageIndicator = document.getElementById("bookPageIndicator");
const bookProgress = document.getElementById("bookProgress");
const bookReturn = document.getElementById("bookReturn");

let readerScale = 1;
let searchableBlocks = [];
let translations = [];
let bookModeActive = false;
let bookPages = [];
let bookPageIndex = 0;
let bookHeadingPages = new Map();
let bookResizeTimer = 0;
let touchStartX = 0;
const requestedLanguage = new URLSearchParams(window.location.search).get("lang");
let activeLanguage = requestedLanguage || localStorage.getItem("ocb-language") || "ko";

const escapeHtml = (value) =>
  value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");

const slugify = (text, index) =>
  `${text
    .trim()
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase()}-${index}`;

function inlineMarkdown(text) {
  return escapeHtml(text).replace(/\*\*(.*?)\*\*/g, "<strong>$1</strong>");
}

function renderMarkdown(markdown) {
  const lines = markdown.replace(/\r\n/g, "\n").split("\n");
  const html = [];
  const toc = [];
  let listOpen = false;
  let headingIndex = 0;

  const closeList = () => {
    if (listOpen) {
      html.push("</ol>");
      listOpen = false;
    }
  };

  lines.forEach((rawLine) => {
    const line = rawLine.trim().replace(/^＃+/, (match) => "#".repeat(match.length));

    if (!line) {
      closeList();
      return;
    }

    const heading = line.match(/^(#{1,3})\s*(.+)$/);
    if (heading) {
      closeList();
      const level = heading[1].length;
      const text = heading[2].trim();
      const id = slugify(text, headingIndex++);
      html.push(`<h${level} id="${id}">${inlineMarkdown(text)}</h${level}>`);
      if (level === 2 || level === 3) {
        toc.push({ id, text, level });
      }
      return;
    }

    const numbered = line.match(/^\d+[\.)]\s*(.+)$/);
    if (numbered) {
      if (!listOpen) {
        html.push("<ol>");
        listOpen = true;
      }
      html.push(`<li>${inlineMarkdown(numbered[1])}</li>`);
      return;
    }

    closeList();
    html.push(`<p>${inlineMarkdown(line)}</p>`);
  });

  closeList();
  contentRoot.innerHTML = html.join("\n");
  renderToc(toc);
  searchableBlocks = [...contentRoot.querySelectorAll("p, li, h2, h3")];
  searchableBlocks.forEach((node) => {
    node.dataset.rawText = node.textContent || "";
  });
  observeHeadings();
  buildBookPages({ reset: true });
}

function renderToc(toc) {
  tocRoot.innerHTML = toc
    .map((item) => {
      const className = item.level === 2 ? "book" : "chapter";
      return `<a class="toc-link ${className}" href="#${item.id}" data-target="${item.id}">${escapeHtml(
        item.text
      )}</a>`;
    })
    .join("");

  tocRoot.querySelectorAll(".toc-link").forEach((link) => {
    link.addEventListener("click", handleTocLinkClick);
  });
}

function isCompactBook() {
  return window.innerWidth <= 680;
}

function getPagesPerSpread() {
  return isCompactBook() ? 1 : 2;
}

function splitBookText(text) {
  const limit = isCompactBook() ? 260 : 470;
  const chars = [...text.trim()];
  if (chars.length <= limit) return [text.trim()];

  const chunks = [];
  let rest = text.trim();
  while ([...rest].length > limit) {
    const slice = [...rest].slice(0, limit).join("");
    const softCuts = [" ", ".", ",", ";", ":", "?", "!", "。", "，", "、", "؟", "।"];
    let cut = -1;
    softCuts.forEach((mark) => {
      cut = Math.max(cut, slice.lastIndexOf(mark));
    });
    if (cut < limit * 0.55) cut = slice.length;
    chunks.push(rest.slice(0, cut).trim());
    rest = rest.slice(cut).trim();
  }
  if (rest) chunks.push(rest);
  return chunks;
}

function bookBlockCost(block) {
  const length = [...block.text].length;
  if (block.tag === "h2") return 260 + length * 2.1;
  if (block.tag === "h3") return 135 + length * 1.6;
  return 64 + length * 1.2;
}

function makeBookBlocks() {
  return [...contentRoot.querySelectorAll("h2, h3, p, li")]
    .flatMap((node) => {
      const tagName = node.tagName.toLowerCase();
      const text = (node.dataset.rawText || node.textContent || "").trim();
      if (!text) return [];

      if (tagName === "h2" || tagName === "h3") {
        return [{ tag: tagName, text, sourceId: node.id || "" }];
      }

      return splitBookText(text).map((chunk, index) => ({
        tag: "p",
        text: chunk,
        sourceId: index === 0 ? node.id || "" : "",
        className: tagName === "li" ? "book-list-item" : "",
      }));
    });
}

function buildBookPages(options = {}) {
  if (!bookReader) return;

  const pageLimit = isCompactBook() ? 760 : 1040;
  const pages = [];
  const headingPages = new Map();
  let page = [];
  let pageCost = 0;

  makeBookBlocks().forEach((block) => {
    const cost = bookBlockCost(block);
    if (page.length && pageCost + cost > pageLimit) {
      pages.push(page);
      page = [];
      pageCost = 0;
    }
    if (block.sourceId) headingPages.set(block.sourceId, pages.length);
    page.push(block);
    pageCost += cost;
  });

  if (page.length) pages.push(page);
  bookPages = pages.length ? pages : [[{ tag: "p", text: "본문을 여는 중", className: "" }]];
  bookHeadingPages = headingPages;
  if (options.reset) {
    bookPageIndex = 0;
  }
  bookPageIndex = Math.min(bookPageIndex, Math.max(0, bookPages.length - 1));
  renderBookSpread();
}

function renderBookBlock(block) {
  const className = block.className ? ` class="${block.className}"` : "";
  return `<${block.tag}${className}>${inlineMarkdown(block.text)}</${block.tag}>`;
}

function renderBookPage(target, page, pageNumber) {
  const wrapper = target.closest(".book-page");
  wrapper.classList.toggle("is-empty", !page);

  if (!page) {
    target.innerHTML = '<div class="book-page-empty">OC</div>';
    return;
  }

  target.innerHTML = `${page.map(renderBookBlock).join("\n")}<span class="book-page-number">${pageNumber}</span>`;
}

function renderBookSpread() {
  if (!bookReader) return;

  const perSpread = getPagesPerSpread();
  const rightPage = bookPageRight.closest(".book-page");
  rightPage.hidden = perSpread === 1;

  renderBookPage(bookPageLeft, bookPages[bookPageIndex], bookPageIndex + 1);
  renderBookPage(bookPageRight, perSpread > 1 ? bookPages[bookPageIndex + 1] : null, bookPageIndex + 2);

  const endPage = Math.min(bookPages.length, bookPageIndex + perSpread);
  const label = perSpread > 1 && endPage > bookPageIndex + 1
    ? `${bookPageIndex + 1}-${endPage} / ${bookPages.length}`
    : `${bookPageIndex + 1} / ${bookPages.length}`;
  bookPageIndicator.textContent = label;
  bookProgress.style.width = `${(endPage / bookPages.length) * 100}%`;
  bookPrev.disabled = bookPageIndex <= 0;
  bookNext.disabled = endPage >= bookPages.length;
}

function turnBookPage(direction) {
  const perSpread = getPagesPerSpread();
  const nextIndex = Math.min(
    Math.max(0, bookPageIndex + direction * perSpread),
    Math.max(0, bookPages.length - 1)
  );
  if (nextIndex === bookPageIndex) return;

  bookPageIndex = nextIndex;
  bookSpread.classList.remove("turn-next", "turn-prev");
  void bookSpread.offsetWidth;
  bookSpread.classList.add(direction > 0 ? "turn-next" : "turn-prev");
  renderBookSpread();
  window.setTimeout(() => bookSpread.classList.remove("turn-next", "turn-prev"), 360);
}

function setBookMode(active) {
  bookModeActive = active;
  scripturePanel.classList.toggle("book-active", active);
  bookReader.hidden = !active;
  bookMode.setAttribute("aria-pressed", String(active));
  bookMode.textContent = active ? "스크롤" : "책장";
  if (active) {
    buildBookPages();
    bookReader.scrollIntoView({ behavior: "smooth", block: "start" });
  }
}

function handleTocLinkClick(event) {
  if (window.innerWidth <= 980) {
    setMobileToc(false);
  }
  if (!bookModeActive) return;
  const target = event.currentTarget.dataset.target;
  if (!bookHeadingPages.has(target)) return;
  event.preventDefault();
  bookPageIndex = bookHeadingPages.get(target);
  renderBookSpread();
  bookReader.scrollIntoView({ behavior: "smooth", block: "start" });
}

function setMobileToc(open) {
  document.body.classList.toggle("toc-open", open);
  tocToggle.setAttribute("aria-expanded", String(open));
}

function observeHeadings() {
  const links = new Map(
    [...document.querySelectorAll(".toc-link")].map((link) => [link.dataset.target, link])
  );
  const headings = [...contentRoot.querySelectorAll("h2, h3")];
  const observer = new IntersectionObserver(
    (entries) => {
      const visible = entries
        .filter((entry) => entry.isIntersecting)
        .sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];
      if (!visible) return;
      document.querySelectorAll(".toc-link.active").forEach((link) => {
        link.classList.remove("active");
      });
      const active = links.get(visible.target.id);
      if (active) active.classList.add("active");
    },
    { rootMargin: "-20% 0px -72% 0px", threshold: [0.05, 0.2, 0.6] }
  );
  headings.forEach((heading) => observer.observe(heading));
}

function applySearch(query) {
  const q = query.trim();
  const normalized = q.toLocaleLowerCase("ko-KR");
  let matches = 0;

  searchableBlocks.forEach((node) => {
    const raw = node.dataset.rawText || "";
    node.classList.remove("dimmed", "search-hit");

    if (!q) {
      node.innerHTML = inlineMarkdown(raw);
      return;
    }

    const index = raw.toLocaleLowerCase("ko-KR").indexOf(normalized);
    if (index === -1) {
      node.innerHTML = inlineMarkdown(raw);
      node.classList.add("dimmed");
      return;
    }

    matches += 1;
    const before = raw.slice(0, index);
    const hit = raw.slice(index, index + q.length);
    const after = raw.slice(index + q.length);
    node.innerHTML = `${inlineMarkdown(before)}<mark>${escapeHtml(hit)}</mark>${inlineMarkdown(after)}`;
    node.classList.add("search-hit");
  });

  searchCount.textContent = q ? `${matches}곳에서 발견` : "";
}

function populateLanguageSelects() {
  const options = translations
    .map((language) => `<option value="${language.code}">${escapeHtml(language.name)}</option>`)
    .join("");
  [languageSelect, languageSelectPanel].forEach((select) => {
    select.innerHTML = options;
    select.value = activeLanguage;
  });
}

function fitHeroTitle() {
  if (!heroTitle) return;
  heroTitle.style.fontSize = "";

  const maxWidth = Math.max(
    220,
    Math.min(heroTitle.parentElement.clientWidth, window.innerWidth - 28) - 8
  );
  let currentSize = parseFloat(window.getComputedStyle(heroTitle).fontSize);
  const minimumSize = window.innerWidth < 520 ? 18 : 28;
  let attempts = 0;

  while (heroTitle.scrollWidth > maxWidth && currentSize > minimumSize && attempts < 90) {
    currentSize -= 1;
    heroTitle.style.fontSize = `${currentSize}px`;
    attempts += 1;
  }
}

function applyLanguageChrome(language) {
  const chrome = language.chrome || {};
  const title = chrome.title || "오렌지 카톨릭 성경";

  document.title = title;
  document.documentElement.dataset.language = language.code;
  heroTitle.textContent = title;
  brandTitle.textContent = title;
  brandLink.setAttribute("aria-label", chrome.homeLabel || `${title} home`);

  if (chrome.kicker && heroKicker) heroKicker.textContent = chrome.kicker;
  if (heroLines[0]) {
    heroLines[0].textContent = chrome.line2 || chrome.line1 || "";
  }

  requestAnimationFrame(fitHeroTitle);
  if (document.fonts) {
    document.fonts.ready.then(fitHeroTitle);
  }
}

function setLoading(label = "본문을 여는 중") {
  contentRoot.innerHTML = `
    <div class="loading-block">
      <span class="loading-sigil"></span>
      <p>${escapeHtml(label)}</p>
    </div>
  `;
}

function updateProgress() {
  const max = document.documentElement.scrollHeight - window.innerHeight;
  const progress = max > 0 ? (window.scrollY / max) * 100 : 0;
  progressBar.style.width = `${Math.min(100, Math.max(0, progress))}%`;
}

function setReaderScale(nextScale) {
  readerScale = Math.min(1.28, Math.max(0.9, nextScale));
  document.documentElement.style.setProperty("--reader-scale", readerScale.toFixed(2));
}

async function loadTranslations() {
  const response = await fetch("content/translations.json", { cache: "no-store" });
  if (!response.ok) {
    throw new Error(`번역 목록을 불러오지 못했습니다: ${response.status}`);
  }
  translations = await response.json();
  if (!translations.some((language) => language.code === activeLanguage)) {
    activeLanguage = "ko";
  }
  populateLanguageSelects();
}

async function loadScripture(languageCode = activeLanguage) {
  const language = translations.find((entry) => entry.code === languageCode) || translations[0];
  if (!language) {
    throw new Error("번역 목록이 비어 있습니다.");
  }
  activeLanguage = language.code;
  localStorage.setItem("ocb-language", activeLanguage);
  const url = new URL(window.location.href);
  url.searchParams.set("lang", activeLanguage);
  window.history.replaceState(null, "", url);
  [languageSelect, languageSelectPanel].forEach((select) => {
    select.value = activeLanguage;
  });
  applyLanguageChrome(language);
  setLoading(`${language.name} 본문을 여는 중`);
  contentRoot.setAttribute("dir", language.dir || "ltr");
  document.documentElement.lang = language.code;
  document.documentElement.dir = language.dir || "ltr";
  const response = await fetch(language.file, { cache: "no-store" });
  if (!response.ok) {
    throw new Error(`본문을 불러오지 못했습니다: ${response.status}`);
  }
  const markdown = await response.text();
  renderMarkdown(markdown);
  searchInput.value = "";
  searchCount.textContent = "";
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function setupCanvas() {
  const context = canvas.getContext("2d");
  let width = 0;
  let height = 0;
  let grains = [];

  const resize = () => {
    const ratio = window.devicePixelRatio || 1;
    width = window.innerWidth;
    height = window.innerHeight;
    canvas.width = Math.floor(width * ratio);
    canvas.height = Math.floor(height * ratio);
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    grains = Array.from({ length: Math.min(150, Math.floor(width / 8)) }, () => ({
      x: Math.random() * width,
      y: Math.random() * height,
      r: Math.random() * 1.8 + 0.4,
      s: Math.random() * 0.22 + 0.04,
      a: Math.random() * 0.32 + 0.08,
    }));
  };

  const draw = () => {
    context.clearRect(0, 0, width, height);
    grains.forEach((grain) => {
      grain.x += grain.s;
      grain.y += Math.sin((grain.x + grain.y) * 0.008) * 0.12;
      if (grain.x > width + 12) grain.x = -12;
      context.beginPath();
      context.fillStyle = `rgba(242, 223, 179, ${grain.a})`;
      context.arc(grain.x, grain.y, grain.r, 0, Math.PI * 2);
      context.fill();
    });
    requestAnimationFrame(draw);
  };

  resize();
  draw();
  window.addEventListener("resize", resize);
}

searchInput.addEventListener("input", (event) => applySearch(event.target.value));
languageSelect.addEventListener("change", (event) => loadScripture(event.target.value));
languageSelectPanel.addEventListener("change", (event) => loadScripture(event.target.value));
window.addEventListener("scroll", updateProgress, { passive: true });
window.addEventListener("resize", fitHeroTitle, { passive: true });
window.addEventListener("resize", () => {
  if (window.innerWidth > 980) {
    setMobileToc(false);
  }
  if (!bookModeActive) return;
  window.clearTimeout(bookResizeTimer);
  bookResizeTimer = window.setTimeout(() => buildBookPages(), 160);
}, { passive: true });
increaseText.addEventListener("click", () => setReaderScale(readerScale + 0.06));
decreaseText.addEventListener("click", () => setReaderScale(readerScale - 0.06));
focusMode.addEventListener("click", () => {
  const focused = document.body.classList.toggle("focused");
  focusMode.setAttribute("aria-pressed", String(focused));
});
tocToggle.addEventListener("click", () => {
  setMobileToc(!document.body.classList.contains("toc-open"));
});
bookMode.addEventListener("click", () => setBookMode(!bookModeActive));
bookReturn.addEventListener("click", () => {
  setBookMode(false);
  contentRoot.scrollIntoView({ behavior: "smooth", block: "start" });
});
bookPrev.addEventListener("click", () => turnBookPage(-1));
bookNext.addEventListener("click", () => turnBookPage(1));
bookSpread.addEventListener("click", (event) => {
  if (!bookModeActive || event.target.closest("button, a, select, input")) return;
  const rect = bookSpread.getBoundingClientRect();
  turnBookPage(event.clientX < rect.left + rect.width / 2 ? -1 : 1);
});
bookSpread.addEventListener("touchstart", (event) => {
  touchStartX = event.changedTouches[0].clientX;
}, { passive: true });
bookSpread.addEventListener("touchend", (event) => {
  const delta = event.changedTouches[0].clientX - touchStartX;
  if (Math.abs(delta) > 44) turnBookPage(delta < 0 ? 1 : -1);
}, { passive: true });
document.addEventListener("keydown", (event) => {
  if (!bookModeActive) return;
  if (event.target instanceof Element && event.target.closest("input, select, textarea")) return;
  if (event.key === "ArrowLeft") {
    event.preventDefault();
    turnBookPage(-1);
  }
  if (event.key === "ArrowRight") {
    event.preventDefault();
    turnBookPage(1);
  }
});

setupCanvas();
loadTranslations()
  .then(() => loadScripture(activeLanguage))
  .catch((error) => {
    contentRoot.innerHTML = `<div class="loading-block"><p>${escapeHtml(error.message)}</p></div>`;
  });
updateProgress();
