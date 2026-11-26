/**
 * 两组独立的「简洁 / 详细」显示模式 + 全站「浅色 / 深色 / 跟随系统」外观主题。
 *
 * 与页面标记和样式共用的约定：
 * - 显示模式：
 *   - 默认简洁：<body> 不带 data-mode 属性；详细模式：<body data-mode="detailed">；
 *   - 课程目录与来源页共用 ustc-course-nav.mode.catalog，所有课程详情页共用 ustc-course-nav.mode.course；
 *   - 旧键 ustc-course-nav.mode 不读取、不迁移；
 * - 外观主题：
 *   - 全站共用 ustc-course-nav.theme（light / dark / system，默认 light）；
 *   - 写入 <html data-theme="...">；
 * - 顶栏圆按钮 [data-mode-toggle] 与 [data-theme-toggle] 在脚本运行时才显示，无 JS 时保持隐藏。
 */
const STORAGE_KEY_CATALOG = 'ustc-course-nav.mode.catalog';
const STORAGE_KEY_COURSE = 'ustc-course-nav.mode.course';
const STORAGE_KEY_THEME = 'ustc-course-nav.theme';
const DETAILED = 'detailed';
const COMPACT = 'compact';
const THEMES = ['light', 'dark', 'system'];

const THEME_LABELS = {
  light: '浅色（点击切至深色）',
  dark: '深色（点击切至跟随系统）',
  system: '跟随系统（点击切至浅色）',
};

function modeStorageKey() {
  return document.body?.dataset?.page === 'course' ? STORAGE_KEY_COURSE : STORAGE_KEY_CATALOG;
}

function readMode() {
  try {
    return localStorage.getItem(modeStorageKey()) === DETAILED ? DETAILED : COMPACT;
  } catch {
    return COMPACT;
  }
}

function saveMode(mode) {
  try {
    const key = modeStorageKey();
    if (mode === DETAILED) localStorage.setItem(key, DETAILED);
    else localStorage.removeItem(key);
  } catch {
    // 存储不可用时仅在当前页生效。
  }
}

function readTheme() {
  try {
    const stored = localStorage.getItem(STORAGE_KEY_THEME);
    return THEMES.includes(stored) ? stored : 'light';
  } catch {
    return 'light';
  }
}

function saveTheme(theme) {
  try {
    if (theme === 'light') localStorage.removeItem(STORAGE_KEY_THEME);
    else localStorage.setItem(STORAGE_KEY_THEME, theme);
  } catch {
    // 存储不可用时仅在当前页生效。
  }
}

function applyMode(mode, { notify = false } = {}) {
  const detailed = mode === DETAILED;
  if (detailed) document.body.dataset.mode = DETAILED;
  else delete document.body.dataset.mode;

  const isCourse = document.body?.dataset?.page === 'course';
  const scope = isCourse ? '课程详情页' : '目录与来源页';
  const label = detailed
    ? `详细模式 · 点击切至简洁（${scope}）`
    : `简洁模式 · 点击切至详细（${scope}）`;

  for (const toggle of document.querySelectorAll('[data-mode-toggle]')) {
    toggle.hidden = false;
    toggle.dataset.modeState = detailed ? DETAILED : COMPACT;
    toggle.setAttribute('aria-pressed', String(detailed));
    toggle.setAttribute('aria-label', label);
    toggle.title = label;
  }

  if (notify) {
    window.dispatchEvent(new CustomEvent('ustc-mode-change', { detail: { mode } }));
  }
}

function applyTheme(theme) {
  const normalized = THEMES.includes(theme) ? theme : 'light';
  document.documentElement.dataset.theme = normalized;
  const label = `外观：${THEME_LABELS[normalized]}`;

  for (const toggle of document.querySelectorAll('[data-theme-toggle]')) {
    toggle.hidden = false;
    toggle.dataset.themeState = normalized;
    toggle.setAttribute('aria-label', label);
    toggle.title = label;
  }
}

function currentMode() {
  return document.body.dataset.mode === DETAILED ? DETAILED : COMPACT;
}

function currentTheme() {
  const value = document.documentElement.dataset.theme;
  return THEMES.includes(value) ? value : 'light';
}

applyMode(readMode());
applyTheme(readTheme());

for (const toggle of document.querySelectorAll('[data-mode-toggle]')) {
  toggle.addEventListener('click', () => {
    const next = currentMode() === DETAILED ? COMPACT : DETAILED;
    applyMode(next, { notify: true });
    saveMode(next);
  });
}

for (const toggle of document.querySelectorAll('[data-theme-toggle]')) {
  toggle.addEventListener('click', () => {
    const idx = THEMES.indexOf(currentTheme());
    const next = THEMES[(idx + 1) % THEMES.length];
    applyTheme(next);
    saveTheme(next);
  });
}

// 同组其他标签页切换显示模式或全站切换主题时保持一致。
window.addEventListener('storage', (event) => {
  if (event.key === null || event.key === modeStorageKey()) {
    applyMode(readMode(), { notify: true });
  }
  if (event.key === null || event.key === STORAGE_KEY_THEME) {
    applyTheme(readTheme());
  }
});
