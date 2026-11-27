/**
 * 课程资料导航页面脚本。
 * 首页与详情页共用：按 body[data-page] 分派，所有外部文本都用 textContent 写入。
 */
import {
  accessMarker,
  canonicalUrlKey,
  courseExamYears,
  courseHref,
  courseResources,
  courseSummary,
  codeFromSearch,
  DEFAULT_PAGE_SIZE,
  filterCourses,
  formatAcademicYear,
  groupResourcesByType,
  isStale,
  LINK_STATUS_SYMBOL,
  linkHealth,
  normalizeName,
  normalizeResourceType,
  paginate,
  parseFilters,
  pickQuickCourses,
  resourceAcademicYears,
  RESOURCE_TYPE_IDS,
  resourceFacts,
  resourceLinkPlan,
  resourceMarkers,
  resourceNotes,
  resourceYears,
  safeExternalUrl,
  schemaFromCatalog,
  serializeFilters,
  STATUS_FILTER_IDS,
  STATUS_IDS,
} from './search.mjs';
import { classifyHealth, HEALTH_EVIDENCE_LABELS } from './health-evidence.mjs';

const HEALTH_NOW = Date.now();
const STORAGE_KEY_INDEX_STATUS = 'ustc-course-nav.index.status';
const DEFAULT_INDEX_STATUS = 'with';
const PERSISTED_INDEX_STATUSES = ['all', 'with', 'without'];
const STORAGE_KEY_COURSE_ONLY_SOLUTION = 'ustc-course-nav.course.only-solution';
const STORAGE_KEY_COURSE_ONLY_OPEN = 'ustc-course-nav.course.only-open';
const STORAGE_KEY_COURSE_VISITS = 'ustc-course-nav.course.visits';
const MAX_STORED_VISITS = 200;

const state = { schema: null };

function readIndexStatus() {
  try {
    const stored = localStorage.getItem(STORAGE_KEY_INDEX_STATUS);
    return PERSISTED_INDEX_STATUSES.includes(stored) ? stored : DEFAULT_INDEX_STATUS;
  } catch {
    return DEFAULT_INDEX_STATUS;
  }
}

function saveIndexStatus(status) {
  if (!PERSISTED_INDEX_STATUSES.includes(status)) return;
  try {
    localStorage.setItem(STORAGE_KEY_INDEX_STATUS, status);
  } catch {
    // 存储不可用时仅在当前页生效。
  }
}

function resourceHasSolution(resource) {
  return (
    resource?.coverage?.has_solutions === true ||
    (resource?.locations ?? []).some((location) => location?.role === 'solution')
  );
}

function readBoolPref(key, fallback) {
  try {
    const stored = localStorage.getItem(key);
    if (stored === 'true') return true;
    if (stored === 'false') return false;
    return fallback;
  } catch {
    return fallback;
  }
}

function saveBoolPref(key, value) {
  try {
    localStorage.setItem(key, value ? 'true' : 'false');
  } catch {
    // 存储不可用时仅在当前页生效。
  }
}

function readCourseVisits() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY_COURSE_VISITS);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    const visits = {};
    for (const [code, count] of Object.entries(parsed)) {
      if (typeof code === 'string' && code && Number.isSafeInteger(count) && count > 0) {
        visits[code] = count;
      }
    }
    return visits;
  } catch {
    return {};
  }
}

function recordCourseVisit(code) {
  if (typeof code !== 'string' || !code) return;
  try {
    const navType = performance.getEntriesByType?.('navigation')?.[0]?.type;
    if (navType === 'reload' || navType === 'back_forward') return;
  } catch {
    // 不支持 Navigation Timing 时按正常访问计数。
  }
  try {
    const visits = readCourseVisits();
    visits[code] = (visits[code] ?? 0) + 1;
    const entries = Object.entries(visits)
      .sort((a, b) => b[1] - a[1])
      .slice(0, MAX_STORED_VISITS);
    localStorage.setItem(STORAGE_KEY_COURSE_VISITS, JSON.stringify(Object.fromEntries(entries)));
  } catch {
    // 存储不可用时静默跳过。
  }
}

function el(tagName, className, text) {
  const node = document.createElement(tagName);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function setText(node, text) {
  if (node && node.textContent !== text) node.textContent = text;
}

async function loadCatalog() {
  const response = await fetch('data/catalog.json', {
    cache: 'no-cache',
    headers: { accept: 'application/json' },
  });
  if (!response.ok) {
    throw new Error(`课程目录请求失败：HTTP ${response.status}`);
  }
  const data = await response.json();
  if (!data || !Array.isArray(data.courses) || !Array.isArray(data.resource_types)) {
    throw new Error('课程目录数据结构有误。');
  }
  return data;
}

function labelMap(items) {
  const map = new Map();
  for (const item of Array.isArray(items) ? items : []) {
    if (item && typeof item.id === 'string') map.set(item.id, item.label ?? item.id);
  }
  return map;
}

/** 资料分类名称：旧分类 id 归一到五类正式分类，避免同一类别出现两套名称。 */
function resourceTypeLabelMap(items) {
  const map = new Map();
  for (const item of Array.isArray(items) ? items : []) {
    const id = normalizeResourceType(item?.id);
    if (id && !map.has(id)) map.set(id, item.label ?? id);
  }
  return map;
}

/** 资料分类下拉与名称共用五类正式分类；旧 catalog 也不会出现旧分类选项。 */
function resourceTypeItems(items) {
  const labels = resourceTypeLabelMap(items);
  return RESOURCE_TYPE_IDS.filter((id) => labels.has(id)).map((id) => ({
    id,
    label: labels.get(id),
  }));
}

function formatDate(value) {
  if (!value) return '';
  const time = Date.parse(value);
  if (Number.isNaN(time)) return String(value);
  return new Date(time).toISOString().slice(0, 10);
}

function showLoadError(message) {
  const errorBox = document.getElementById('load-error');
  if (!errorBox) return;
  errorBox.textContent = message;
  errorBox.hidden = false;
  const status = document.getElementById('result-status');
  if (status) status.textContent = '加载失败';
}

/**
 * 分别渲染仓库与网站统计；有统计日期但缺少昨日记录时明确提示。
 */
function renderSiteStats(stats) {
  const container = document.getElementById('site-stats');
  if (!container) return;
  const keys = ['repo_views_yesterday', 'repo_views_14d', 'site_views_yesterday', 'site_total_views', 'collected_at'];
  const selfHosted = document.querySelector('[data-self-hosted-stats]') !== null;

  for (const key of keys) {
    if (selfHosted && (key === 'site_views_yesterday' || key === 'site_total_views')) continue;
    const item = container.querySelector(`[data-stat-item="${key}"]`);
    const valueNode = container.querySelector(`[data-stat-value="${key}"]`);
    if (!item || !valueNode) continue;
    const raw = stats?.[key];
    const date = key === 'repo_views_yesterday' ? stats?.repo_views_date_utc
      : key === 'site_views_yesterday' ? stats?.site_views_date_utc : null;
    const dateNode = item.querySelector('[data-stat-date]');
    if (dateNode) dateNode.textContent = date ? ` · ${date}` : '';
    if (key === 'collected_at' && raw) valueNode.dateTime = raw;
    const text = key === 'collected_at' ? stats?.collected_at_beijing
      : Number.isSafeInteger(raw) && raw >= 0 ? raw.toLocaleString('zh-CN')
        : date ? '暂无数据' : null;
    valueNode.textContent = text ?? '';
    item.hidden = !text;
  }
  container.hidden = !container.querySelector('[data-stat-item]:not([hidden])');
}

/* ============================== 首页 ============================== */

function initIndex(catalog) {
  const form = document.getElementById('filters');
  const qInput = document.getElementById('q');
  const typeSelect = document.getElementById('type');
  const yearGroup = document.getElementById('year-group');
  const yearSelect = document.getElementById('year');
  const tagToggleGroup = document.getElementById('tag-toggle-group');
  const tagToggle = document.getElementById('tag-toggle');
  const tagDrawer = document.getElementById('tag-drawer');
  const tagOptions = document.getElementById('tag-options');
  const tagCount = document.getElementById('tag-count');
  const courseList = document.getElementById('course-list');
  const pagination = document.getElementById('pagination');
  const prevPage = document.getElementById('prev-page');
  const nextPage = document.getElementById('next-page');
  const pageStatus = document.getElementById('page-status');
  const resultStatus = document.getElementById('result-status');
  const noResults = document.getElementById('no-results');
  const noResultsText = document.getElementById('no-results-text');
  const showWithoutBtn = document.getElementById('show-without-courses');
  const clearSearchButton = document.getElementById('clear-search');
  const searchWrap = qInput?.closest('.search-input-wrap') ?? null;
  const pageHero = document.querySelector('.page-hero');
  const searchSection = document.querySelector('main search');
  const heroPulse = document.getElementById('hero-pulse');
  const heroPulseText = document.getElementById('hero-pulse-text');
  const heroBrowseAll = document.getElementById('hero-browse-all');
  const heroQuickLinks = document.getElementById('hero-quick-links');
  const resultsSection = document.querySelector('.results');
  const siteFooter = document.querySelector('.site-footer');
  const resultsHeading = document.getElementById('results-heading');

  const schema = state.schema;
  const kindLabels = labelMap(catalog.kinds);
  const typeLabels = resourceTypeLabelMap(catalog.resource_types);
  const tagLabels = labelMap(catalog.tags);

  function resolveIndexFilters(params) {
    const filters = parseFilters(params, schema);
    const hasExplicitStatus = STATUS_FILTER_IDS.includes(params.get('status'));
    if (!hasExplicitStatus) {
      filters.status = readIndexStatus();
    }
    return { filters, hasExplicitStatus };
  }

  populateSelect(typeSelect, '全部类型', resourceTypeItems(catalog.resource_types));
  buildTagOptions();

  let page = 1;
  const initialParams = new URLSearchParams(location.search);
  const { filters: initial, hasExplicitStatus: hasInitialExplicitStatus } =
    resolveIndexFilters(initialParams);
  let currentFilters = initial;
  applyControls(initial);
  updateYearOptions();
  yearSelect.value = initial.year;
  if (initialParams.has('access')) {
    const savedStatus = readIndexStatus();
    const url = new URL(location.href);
    url.search = serializeFilters(initial, undefined, {
      defaultStatus:
        !hasInitialExplicitStatus && savedStatus === DEFAULT_INDEX_STATUS
          ? DEFAULT_INDEX_STATUS
          : '',
    }).toString();
    history.replaceState(null, '', url);
  }
  const hasInitialUrlFilters =
    hasInitialExplicitStatus || serializeFilters({ ...initial, status: 'all' }).toString() !== '';
  const isInitiallyDetailed = document.body.dataset.mode === 'detailed';
  document.body.dataset.hero = !hasInitialUrlFilters && !isInitiallyDetailed ? 'centered' : 'expanded';

  if (heroPulse && heroPulseText) {
    const courseTotal = catalog.counts?.courses ?? catalog.courses.length;
    const withTotal = catalog.counts?.with_resources
      ?? catalog.courses.filter((c) => courseResources(c).length > 0).length;
    const resTotal = catalog.counts?.resources
      ?? catalog.courses.reduce((sum, c) => sum + courseResources(c).length, 0);
    heroPulseText.textContent = `涵盖 ${courseTotal.toLocaleString('zh-CN')} 门本科课 · ${withTotal.toLocaleString('zh-CN')} 门已收资料 · 共 ${resTotal.toLocaleString('zh-CN')} 条`;
    heroPulse.hidden = false;
  }

  function renderHeroQuickLinks() {
    if (!heroQuickLinks) return;
    const quickCourses = pickQuickCourses(catalog.courses, readCourseVisits(), 6);
    if (quickCourses.length > 0) {
      const quickFrag = document.createDocumentFragment();
      quickFrag.append(el('span', 'hero-quick-label', '课程直达：'));
      for (const course of quickCourses) {
        const chip = el('a', 'hero-quick-chip');
        chip.href = courseHref(course.code);
        chip.append(
          el('span', 'hero-quick-code', course.code),
          el('span', null, course.name),
        );
        quickFrag.append(chip);
      }
      heroQuickLinks.replaceChildren(quickFrag);
      heroQuickLinks.hidden = false;
    } else {
      heroQuickLinks.replaceChildren();
      heroQuickLinks.hidden = true;
    }
  }

  renderHeroQuickLinks();

  document.addEventListener('keydown', (event) => {
    if (event.key !== '/' || event.metaKey || event.ctrlKey || event.altKey) return;
    const active = document.activeElement;
    if (active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA' || active.tagName === 'SELECT' || active.isContentEditable)) {
      return;
    }
    if (document.querySelector('dialog[open]')) return;
    event.preventDefault();
    expandHero();
    qInput.focus();
  });

  render(initial, { sync: false });

  let debounceTimer = 0;

  function expandHero({ animate = true } = {}) {
    if (document.body.dataset.hero !== 'centered') return;
    const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    const heroBefore = pageHero?.getBoundingClientRect().top ?? 0;
    const searchBefore = searchSection?.getBoundingClientRect().top ?? 0;

    document.body.dataset.hero = 'expanded';

    if (!animate || reduceMotion) return;
    const timing = { duration: 360, easing: 'cubic-bezier(0.22, 1, 0.36, 1)' };
    if (pageHero?.animate) {
      const dy = heroBefore - pageHero.getBoundingClientRect().top;
      if (Math.abs(dy) > 1) {
        pageHero.animate(
          [{ transform: `translateY(${dy}px)` }, { transform: 'translateY(0)' }],
          timing,
        );
      }
    }
    if (searchSection?.animate) {
      const dy = searchBefore - searchSection.getBoundingClientRect().top;
      if (Math.abs(dy) > 1) {
        searchSection.animate(
          [{ transform: `translateY(${dy}px)` }, { transform: 'translateY(0)' }],
          timing,
        );
      }
    }
    for (const node of [resultsSection, siteFooter]) {
      if (node?.animate) {
        node.animate(
          [
            { opacity: 0, transform: 'translateY(14px)' },
            { opacity: 1, transform: 'translateY(0)' },
          ],
          { duration: 320, easing: 'cubic-bezier(0.22, 1, 0.36, 1)', fill: 'backwards' },
        );
      }
    }
  }

  qInput.addEventListener('focus', () => expandHero());
  if (searchWrap) {
    searchWrap.addEventListener('pointerdown', () => expandHero());
    searchWrap.addEventListener('click', () => expandHero());
  }
  if (heroBrowseAll) {
    heroBrowseAll.addEventListener('click', () => {
      expandHero();
      if (resultsHeading) resultsHeading.focus();
    });
  }
  window.addEventListener('ustc-mode-change', (event) => {
    if (event.detail?.mode === 'detailed') expandHero();
  });

  if (tagToggle) {
    tagToggle.addEventListener('click', () => {
      const isOpen = tagDrawer?.dataset.open === 'true';
      setTagDrawerOpen(!isOpen);
    });
  }

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    expandHero();
    window.clearTimeout(debounceTimer);
    page = 1;
    const filters = readFilters();
    render(filters, { sync: true, push: true });
    if (resultsHeading) resultsHeading.focus();
  });

  form.addEventListener('reset', () => {
    window.clearTimeout(debounceTimer);
    window.setTimeout(() => {
      yearSelect.value = 'all';
      setTagDrawerOpen(false);
      updateTagCount();
      updateYearOptions();
      saveIndexStatus(DEFAULT_INDEX_STATUS);
      page = 1;
      const filters = readFilters();
      render(filters, { sync: true });
    }, 0);
    qInput.focus();
  });

  form.addEventListener('change', (event) => {
    if (event.target === yearSelect && typeSelect.value !== 'exams') return;
    window.clearTimeout(debounceTimer);
    if (event.target === typeSelect) yearSelect.value = 'all';
    updateYearOptions();
    updateTagCount();
    page = 1;
    const filters = readFilters();
    if (event.target?.name === 'status') {
      saveIndexStatus(filters.status);
    }
    render(filters, { sync: true });
  });

  qInput.addEventListener('input', () => {
    expandHero();
    syncSearchWrapState();
    window.clearTimeout(debounceTimer);
    debounceTimer = window.setTimeout(() => {
      page = 1;
      const filters = readFilters();
      render(filters, { sync: true });
    }, 250);
  });

  if (clearSearchButton) {
    clearSearchButton.addEventListener('click', () => {
      form.reset();
    });
  }

  if (showWithoutBtn) {
    showWithoutBtn.addEventListener('click', () => {
      const withoutInput = form.querySelector('input[name="status"][value="without"]');
      if (withoutInput) withoutInput.checked = true;
      page = 1;
      const filters = readFilters();
      saveIndexStatus(filters.status);
      render(filters, { sync: true });
      if (resultsHeading) resultsHeading.focus();
    });
  }

  window.addEventListener('popstate', () => {
    page = 1;
    const { filters, hasExplicitStatus } = resolveIndexFilters(new URLSearchParams(location.search));
    if (hasExplicitStatus || serializeFilters({ ...filters, status: 'all' }).toString() !== '') {
      expandHero({ animate: false });
    }
    applyControls(filters);
    updateYearOptions();
    yearSelect.value = filters.year;
    render(filters, { sync: false });
  });

  window.addEventListener('pageshow', (event) => {
    if (event.persisted) renderHeroQuickLinks();
  });

  window.addEventListener('storage', (event) => {
    if (event.key === null || event.key === STORAGE_KEY_COURSE_VISITS) {
      renderHeroQuickLinks();
    }
    if (event.key === null || event.key === STORAGE_KEY_INDEX_STATUS) {
      const params = new URLSearchParams(location.search);
      if (!STATUS_FILTER_IDS.includes(params.get('status'))) {
        const nextFilters = { ...(currentFilters ?? initial), status: readIndexStatus() };
        page = 1;
        applyControls(nextFilters);
        yearSelect.value = nextFilters.year;
        render(nextFilters, { sync: false });
      }
    }
  });

  if (prevPage) prevPage.addEventListener('click', () => changePage(-1));
  if (nextPage) nextPage.addEventListener('click', () => changePage(1));

  function changePage(delta) {
    page += delta;
    render(currentFilters ?? initial, { sync: false });
    if (resultsHeading) resultsHeading.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  function populateSelect(select, allLabel, items) {
    const all = el('option', null, allLabel);
    all.value = 'all';
    select.replaceChildren(all);
    for (const item of Array.isArray(items) ? items : []) {
      const option = el('option', null, item.label ?? item.id);
      option.value = item.id;
      select.append(option);
    }
  }

  function setTagDrawerOpen(open) {
    if (!tagDrawer || !tagToggle) return;
    const next = Boolean(open);
    tagDrawer.dataset.open = next ? 'true' : 'false';
    tagDrawer.inert = !next;
    tagToggle.setAttribute('aria-expanded', String(next));
  }

  function buildTagOptions() {
    const tags = Array.isArray(catalog.tags) ? catalog.tags : [];
    if (tags.length === 0) {
      if (tagToggleGroup) tagToggleGroup.hidden = true;
      if (tagDrawer) tagDrawer.hidden = true;
      return;
    }
    if (tagToggleGroup) tagToggleGroup.hidden = false;
    if (tagDrawer) tagDrawer.hidden = false;
    const fragment = document.createDocumentFragment();
    for (const tag of tags) {
      const label = el('label', 'tag-option');
      const input = el('input');
      input.type = 'checkbox';
      input.name = 'tag';
      input.value = tag.id;
      input.id = `tag-${tag.id}`;
      label.htmlFor = input.id;
      const textSpan = el('span', 'tag-option-label', tag.label ?? tag.id);
      label.append(input, textSpan);
      fragment.append(label);
    }
    tagOptions.replaceChildren(fragment);
    setTagDrawerOpen(false);
    updateTagCount();
  }

  /** 学科折叠标题上的已选数量；未选择时不显示。 */
  function updateTagCount() {
    if (!tagCount) return;
    const count = form.querySelectorAll('input[name="tag"]:checked').length;
    tagCount.textContent = count > 0 ? `已选 ${count} 项` : '';
    tagCount.hidden = count === 0;
  }

  function updateYearOptions() {
    if (typeSelect.value !== 'exams') {
      yearGroup.hidden = true;
      yearSelect.disabled = true;
      return;
    }
    yearGroup.hidden = false;
    yearSelect.disabled = false;
    const previous = yearSelect.value;
    const info = allYears(catalog.courses);
    const fragment = document.createDocumentFragment();
    const all = el('option', null, '全部年份');
    all.value = 'all';
    fragment.append(all);
    for (const year of info.years) {
      const option = el('option', null, `${year} 年`);
      option.value = String(year);
      fragment.append(option);
    }
    if (info.unknown) {
      const option = el('option', null, '年份待确认');
      option.value = 'unknown';
      fragment.append(option);
    }
    yearSelect.replaceChildren(fragment);
    yearSelect.value = [...yearSelect.options].some((option) => option.value === previous)
      ? previous
      : 'all';
  }

  function readFilters() {
    const data = new FormData(form);
    const params = new URLSearchParams();
    const query = qInput.value;
    if (query) params.set('q', query);
    const kind = data.get('kind');
    if (typeof kind === 'string') params.set('kind', kind);
    const type = data.get('type');
    if (typeof type === 'string') params.set('type', type);
    if (type === 'exams' && yearSelect.value !== 'all') params.set('year', yearSelect.value);
    const statuses = data
      .getAll('status')
      .filter((value) => typeof value === 'string' && STATUS_IDS.includes(value));
    if (statuses.length === 1) params.set('status', statuses[0]);
    if (statuses.length === 0) params.set('status', 'none');
    for (const tag of data.getAll('tag')) {
      if (typeof tag === 'string' && tag) params.append('tag', tag);
    }
    return parseFilters(params, schema);
  }

  function applyControls(filters) {
    qInput.value = filters.q;
    const kindInput = form.querySelector(`input[name="kind"][value="${filters.kind}"]`);
    if (kindInput) kindInput.checked = true;
    typeSelect.value = filters.type;
    for (const input of form.querySelectorAll('input[name="status"]')) {
      input.checked = filters.status === 'all' || filters.status === input.value;
    }
    for (const input of form.querySelectorAll('input[name="tag"]')) {
      input.checked = filters.tags.includes(input.value);
    }
    updateTagCount();
    if (filters.tags.length > 0) setTagDrawerOpen(true);
  }

  function syncSearchWrapState(active = false) {
    if (!searchWrap) return;
    if (active || qInput.value.length > 0) searchWrap.dataset.hasValue = 'true';
    else delete searchWrap.dataset.hasValue;
  }

  function render(filters, { sync = true, push = false } = {}) {
    currentFilters = filters;
    const results = filterCourses(catalog.courses, filters);
    const paged = paginate(results, page, DEFAULT_PAGE_SIZE);
    page = paged.page;
    const fragment = document.createDocumentFragment();
    for (const course of paged.items) {
      fragment.append(renderCourseItem(course, { kindLabels, tagLabels, typeLabels }));
    }
    courseList.replaceChildren(fragment);

    if (pagination) {
      pagination.hidden = paged.total === 0 || paged.totalPages <= 1;
      prevPage.disabled = paged.page <= 1;
      nextPage.disabled = paged.page >= paged.totalPages;
      setText(pageStatus, `第 ${paged.page} / ${paged.totalPages} 页，共 ${paged.total} 门`);
    }

    const total = catalog.courses.length;
    const allWithTotal = catalog.courses.filter((course) => courseResources(course).length > 0).length;
    const withCount = results.filter((course) => courseResources(course).length > 0).length;
    const hiddenWithoutMatches =
      filters.status === 'with'
        ? filterCourses(catalog.courses, { ...filters, status: 'without' }).length
        : 0;
    const hasOtherFilters = Boolean(
      filters.q || filters.kind !== 'all' || filters.tags.length > 0 || filters.type !== 'all',
    );
    const active = hasOtherFilters || filters.status !== readIndexStatus();
    syncSearchWrapState(active);

    let statusText;
    if (filters.status === 'none') {
      statusText = '未显示课程';
    } else if (results.length === 0) {
      if (total === 0) statusText = '课程目录为空';
      else if (hiddenWithoutMatches > 0) statusText = '没有符合条件的已收录课程';
      else statusText = '没有符合条件的课程';
    } else if (!hasOtherFilters && filters.status === 'with') {
      statusText = `已显示 ${results.length} 门已收录课程，另有 ${total - withCount} 门暂未收录`;
    } else if (filters.status === 'with') {
      statusText = hiddenWithoutMatches > 0
        ? `找到 ${results.length} 门已收录课程（另有 ${hiddenWithoutMatches} 门匹配课程暂未收录）`
        : `找到 ${results.length} 门已收录课程`;
    } else if (filters.status === 'without') {
      statusText = `找到 ${results.length} 门暂未收录课程`;
    } else if (hasOtherFilters) {
      statusText = `找到 ${results.length} 门课程，其中 ${withCount} 门已收资料`;
    } else {
      statusText = `共 ${total} 门课程，${allWithTotal} 门已收资料，${total - allWithTotal} 门暂未收录`;
    }
    setText(resultStatus, statusText);

    const empty = results.length === 0;
    noResults.hidden = !empty;
    if (showWithoutBtn) {
      showWithoutBtn.hidden = !(empty && hiddenWithoutMatches > 0);
    }
    if (empty) {
      if (filters.status === 'none') {
        setText(
          noResultsText,
          '请至少勾选「已收录」或「暂未收录」中的一项。',
        );
      } else if (hiddenWithoutMatches > 0) {
        setText(
          noResultsText,
          `有匹配课程尚未收录资料（共 ${hiddenWithoutMatches} 门），当前筛选仅显示已收录课程。`,
        );
      } else if (hasOtherFilters || filters.status !== 'all') {
        setText(
          noResultsText,
          `没有找到符合条件的课程（${describeFilters(filters, { kindLabels, tagLabels, typeLabels })}），试试放宽条件。`,
        );
      } else {
        setText(noResultsText, '课程目录暂时为空，请稍后刷新重试。');
      }
    }

    if (sync) {
      const savedStatus = readIndexStatus();
      const params = serializeFilters(filters, undefined, {
        defaultStatus: savedStatus === DEFAULT_INDEX_STATUS ? DEFAULT_INDEX_STATUS : '',
      });
      const url = new URL(location.href);
      url.search = params.toString();
      if (push) history.pushState(null, '', url);
      else history.replaceState(null, '', url);
    }
  }
}

function allYears(courses) {
  const years = new Set();
  let unknown = false;
  for (const course of courses) {
    const info = courseExamYears(course);
    if (info.unknown) unknown = true;
    for (const year of info.years) years.add(year);
  }
  return { years: [...years].sort((a, b) => b - a), unknown };
}

function describeFilters(filters, labels) {
  const parts = [];
  if (filters.q) parts.push(`关键词「${filters.q}」`);
  if (filters.kind !== 'all') parts.push(`类别「${labels.kindLabels.get(filters.kind) ?? filters.kind}」`);
  if (filters.tags.length > 0) {
    parts.push(`学科「${filters.tags.map((tag) => labels.tagLabels.get(tag) ?? tag).join('、')}」`);
  }
  if (filters.type !== 'all') {
    const typeLabel = labels.typeLabels.get(filters.type) ?? filters.type;
    parts.push(
      filters.year === 'all'
        ? `资料类型「${typeLabel}」`
        : `资料类型「${typeLabel}」、年份「${filters.year === 'unknown' ? '待确认' : `${filters.year} 年`}」`,
    );
  }
  if (filters.status === 'with') parts.push('仅已收录');
  if (filters.status === 'without') parts.push('仅暂未收录');
  if (filters.status === 'none') parts.push('未勾选资料情况');
  return parts.join('、');
}

function renderCourseItem(course, labels) {
  const summary = courseSummary(course, labels.typeLabels);
  const hasRes = summary.total > 0;
  const item = el('li', `course-item ${hasRes ? 'has-resources' : 'no-resources'}`);

  const top = el('div', 'course-top');
  const link = el('a', 'course-link');
  link.href = courseHref(course.code);
  link.append(
    el('span', 'course-code', course.code),
    el('span', 'course-name', course.name),
  );
  const status = el('span', `badge ${hasRes ? 'with' : 'without'}`);
  status.textContent = hasRes ? '已收录' : '暂未收录';
  top.append(link, status);
  item.append(top);

  const kindText = labels.kindLabels.get(course.kind);
  const tagNames = (course.tags ?? []).map((tag) => labels.tagLabels.get(tag) ?? tag).filter(Boolean);
  if (course.kind || tagNames.length > 0) {
    const submeta = el('div', 'course-submeta');
    if (course.kind) {
      const kindBadge = el('span', 'badge kind', kindText ?? course.kind);
      kindBadge.dataset.kind = course.kind;
      submeta.append(kindBadge);
    }
    if (tagNames.length > 0) {
      submeta.append(el('span', 'meta-taxonomy', tagNames.join(' / ')));
    }
    item.append(submeta);
  }

  const hasYears = summary.examYears.length > 0 || summary.hasUnknownExamYear;
  if (hasRes || hasYears) {
    const inventory = el('div', 'course-inventory');
    if (hasRes) {
      const typesRow = el('div', 'inventory-types');
      typesRow.append(el('span', 'inventory-total', `资料 ${summary.total} 条`));
      for (const entry of summary.types) {
        const chip = el('span', 'inventory-type');
        chip.append(
          document.createTextNode(`${entry.label} `),
          el('strong', null, String(entry.count)),
        );
        typesRow.append(chip);
      }
      inventory.append(typesRow);
    }
    if (hasYears) {
      const yearsRow = el('div', 'course-years-row');
      yearsRow.append(el('span', 'years-prefix', '试题年份'));
      const yearItems = summary.examYears.map((year) => `${year}`);
      if (summary.hasUnknownExamYear) yearItems.push('待确认');
      yearsRow.append(el('span', 'years-list', yearItems.join(' · ')));
      inventory.append(yearsRow);
    }
    item.append(inventory);
  }

  return item;
}

/* ============================== 课程详情 ============================== */

function initCoursePage(catalog) {
  const title = document.getElementById('course-title');
  const meta = document.getElementById('course-meta');
  const status = document.getElementById('course-status');
  const toolbar = document.getElementById('course-toolbar');
  const sectionNav = document.getElementById('section-nav');
  const quickFilters = document.getElementById('course-quick-filters');
  const content = document.getElementById('course-content');
  const sections = document.getElementById('resource-sections');
  const notFound = document.getElementById('not-found');

  const code = codeFromSearch(location.search).trim();
  const course = findCourse(catalog.courses, code);

  if (!course) {
    if (notFound) notFound.hidden = false;
    if (content) content.hidden = true;
    if (toolbar) toolbar.hidden = true;
    if (sectionNav) sectionNav.hidden = true;
    if (quickFilters) quickFilters.hidden = true;
    if (title) title.textContent = '未找到该课程';
    if (meta) meta.textContent = code ? `课程代码：${code}` : '未指定课程代码';
    if (status) {
      status.textContent = '';
      status.hidden = true;
    }
    document.title = '未找到该课程 · 也西书架';
    return;
  }

  document.title = `${course.code} ${course.name} · 也西书架`;
  recordCourseVisit(course.code);
  if (title) {
    title.replaceChildren(
      el('span', 'course-title-code', course.code),
      document.createTextNode(' '),
      el('span', 'course-title-name', course.name),
    );
  }
  if (notFound) notFound.hidden = true;
  if (content) content.hidden = false;

  const labels = {
    kind: labelMap(catalog.kinds),
    tag: labelMap(catalog.tags),
    type: resourceTypeLabelMap(catalog.resource_types),
    examKind: labelMap(catalog.exam_kinds),
    examForm: labelMap(catalog.exam_forms),
    access: labelMap(catalog.access),
    links: catalog.links,
    sourceNames: new Map(
      (Array.isArray(catalog.sources) ? catalog.sources : []).map((source) => [source.id, source.name]),
    ),
  };

  if (meta) {
    meta.replaceChildren();
    let hasMeta = false;
    const kindText = labels.kind.get(course.kind);
    if (kindText) {
      const kindPill = el('span', 'meta-pill kind-pill', kindText);
      if (course.kind) kindPill.dataset.kind = course.kind;
      meta.append(kindPill);
      hasMeta = true;
    }
    const tags = (course.tags ?? []).map((tag) => labels.tag.get(tag) ?? tag).filter(Boolean);
    if (tags.length > 0) {
      if (hasMeta) meta.append(spanSep());
      tags.forEach((tag, idx) => {
        if (idx > 0) meta.append(document.createTextNode(' '));
        meta.append(el('span', 'meta-pill tag-pill', tag));
      });
    }
  }

  const resources = courseResources(course);
  const groups = groupResourcesByType(resources, labels.type).filter(
    (group) => group.resources.length > 0,
  );
  const summary = groups.length > 0 ? courseSummary(course, labels.type) : null;
  const examYearParts = [];
  if (summary) {
    const yearText = summary.examYears.map((year) => `${year} 年`).join('、');
    if (yearText) examYearParts.push(`试题年份：${yearText}`);
    if (summary.hasUnknownExamYear) {
      examYearParts.push(yearText ? '部分试题年份待确认' : '试题年份待确认');
    }
  }

  function updateCourseStatus(visibleTotal) {
    if (!status) return;
    if (!summary) {
      // 完全无资料时只展示一个空态，不再逐个类别重复「暂无」。
      status.textContent = '';
      status.hidden = true;
      return;
    }
    status.hidden = false;
    const isFiltered = filterState.onlySolution || filterState.onlyOpen;
    const lead = isFiltered
      ? `当前显示 ${visibleTotal} / 共 ${summary.total} 条资料`
      : `共 ${summary.total} 条资料`;
    status.textContent = [lead, ...examYearParts].join(' · ');
  }

  const showSectionNav = groups.length > 1;
  if (sectionNav) {
    if (showSectionNav) {
      const navFrag = document.createDocumentFragment();
      for (const group of groups) {
        const anchor = el('a', 'section-nav-link');
        anchor.href = `#section-${group.type}`;
        anchor.dataset.sectionType = group.type;
        anchor.append(
          document.createTextNode(group.label ?? group.type),
          document.createTextNode(' '),
          el('span', 'section-nav-count', String(group.resources.length)),
        );
        navFrag.append(anchor);
      }
      sectionNav.replaceChildren(navFrag);
      sectionNav.hidden = false;
    } else {
      sectionNav.replaceChildren();
      sectionNav.hidden = true;
    }
  }

  const isOpenResource = (resource) =>
    (resource?.locations ?? []).some((location) => location?.access === 'public');
  const hasSol = resources.some(resourceHasSolution);
  const hasNoSol = resources.some((resource) => !resourceHasSolution(resource));
  const hasOpen = resources.some(isOpenResource);
  const hasClosed = resources.some((resource) => !isOpenResource(resource));
  const showSolFilter = hasSol && hasNoSol;
  const showOpenFilter = hasOpen && hasClosed;
  const filterState = {
    onlySolution: showSolFilter ? readBoolPref(STORAGE_KEY_COURSE_ONLY_SOLUTION, true) : false,
    onlyOpen: showOpenFilter ? readBoolPref(STORAGE_KEY_COURSE_ONLY_OPEN, false) : false,
  };

  function syncQuickFilters() {
    if (!sections) return;
    let totalVisible = 0;
    let visibleSectionsCount = 0;
    const visibleByType = new Map();
    for (const sec of sections.querySelectorAll('.resource-type')) {
      let visibleInSec = 0;
      const items = [...sec.querySelectorAll('[data-resource-item]')];
      for (const item of items) {
        const solOk = !filterState.onlySolution || item.dataset.hasSolution === 'true';
        const openOk = !filterState.onlyOpen || item.dataset.isOpen === 'true';
        const show = solOk && openOk;
        item.hidden = !show;
        if (show) {
          visibleInSec += 1;
          totalVisible += 1;
        }
      }
      for (const divider of sec.querySelectorAll('.year-divider')) {
        const bucket = divider.dataset.yearGroup;
        const countInBucket = items.filter(
          (item) => item.dataset.yearBucket === bucket && !item.hidden,
        ).length;
        divider.hidden = countInBucket === 0;
        const dividerCount = divider.querySelector('.year-divider-count');
        if (dividerCount) dividerCount.textContent = `${countInBucket} 条`;
      }
      const typeCount = sec.querySelector('.type-count');
      if (typeCount) typeCount.textContent = `${visibleInSec} 条`;
      sec.hidden = visibleInSec === 0;
      if (visibleInSec > 0) visibleSectionsCount += 1;
      if (sec.dataset.type) visibleByType.set(sec.dataset.type, visibleInSec);
    }
    if (sectionNav && showSectionNav) {
      for (const anchor of sectionNav.querySelectorAll('.section-nav-link')) {
        const type = anchor.dataset.sectionType;
        const count = type ? (visibleByType.get(type) ?? 0) : 0;
        anchor.hidden = count === 0;
        const navCount = anchor.querySelector('.section-nav-count');
        if (navCount) navCount.textContent = String(count);
      }
      sectionNav.hidden = visibleSectionsCount === 0;
    }
    updateCourseStatus(totalVisible);
    const filterEmpty = document.getElementById('course-filter-empty');
    if (filterEmpty) {
      filterEmpty.hidden = totalVisible > 0 || groups.length === 0;
    }
  }

  let solBtn = null;
  let openBtn = null;
  if (quickFilters) {
    quickFilters.replaceChildren();
    if (showSolFilter || showOpenFilter) {
      if (showSolFilter) {
        solBtn = el('button', 'quick-filter-pill', '仅看含解答');
        solBtn.type = 'button';
        solBtn.dataset.filterKind = 'only-solution';
        solBtn.setAttribute('aria-pressed', String(filterState.onlySolution));
        solBtn.addEventListener('click', () => {
          filterState.onlySolution = !filterState.onlySolution;
          saveBoolPref(STORAGE_KEY_COURSE_ONLY_SOLUTION, filterState.onlySolution);
          solBtn.setAttribute('aria-pressed', String(filterState.onlySolution));
          syncQuickFilters();
        });
        quickFilters.append(solBtn);
      }
      if (showOpenFilter) {
        openBtn = el('button', 'quick-filter-pill', '仅看免登录');
        openBtn.type = 'button';
        openBtn.dataset.filterKind = 'only-open';
        openBtn.setAttribute('aria-pressed', String(filterState.onlyOpen));
        openBtn.addEventListener('click', () => {
          filterState.onlyOpen = !filterState.onlyOpen;
          saveBoolPref(STORAGE_KEY_COURSE_ONLY_OPEN, filterState.onlyOpen);
          openBtn.setAttribute('aria-pressed', String(filterState.onlyOpen));
          syncQuickFilters();
        });
        quickFilters.append(openBtn);
      }
      quickFilters.hidden = false;
    } else {
      quickFilters.hidden = true;
    }
  }

  if (toolbar) {
    toolbar.hidden = !(showSectionNav || showSolFilter || showOpenFilter);
  }

  window.addEventListener('storage', (event) => {
    let changed = false;
    if ((event.key === null || event.key === STORAGE_KEY_COURSE_ONLY_SOLUTION) && showSolFilter) {
      const next = readBoolPref(STORAGE_KEY_COURSE_ONLY_SOLUTION, true);
      if (next !== filterState.onlySolution) {
        filterState.onlySolution = next;
        if (solBtn) solBtn.setAttribute('aria-pressed', String(next));
        changed = true;
      }
    }
    if ((event.key === null || event.key === STORAGE_KEY_COURSE_ONLY_OPEN) && showOpenFilter) {
      const next = readBoolPref(STORAGE_KEY_COURSE_ONLY_OPEN, false);
      if (next !== filterState.onlyOpen) {
        filterState.onlyOpen = next;
        if (openBtn) openBtn.setAttribute('aria-pressed', String(next));
        changed = true;
      }
    }
    if (changed) syncQuickFilters();
  });

  if (!sections) return;
  if (groups.length === 0) {
    updateCourseStatus(0);
    sections.replaceChildren(renderEmptyState());
    return;
  }
  const fragment = document.createDocumentFragment();
  for (const group of groups) fragment.append(renderTypeSection(group, labels));
  const emptyFilter = el('section', 'empty-state');
  emptyFilter.id = 'course-filter-empty';
  emptyFilter.hidden = true;
  emptyFilter.append(el('p', null, '没有同时满足当前快捷过滤条件的资料。'));
  const resetQuick = el('button', 'secondary', '显示全部资料');
  resetQuick.type = 'button';
  resetQuick.addEventListener('click', () => {
    filterState.onlySolution = false;
    filterState.onlyOpen = false;
    if (showSolFilter) saveBoolPref(STORAGE_KEY_COURSE_ONLY_SOLUTION, false);
    if (showOpenFilter) saveBoolPref(STORAGE_KEY_COURSE_ONLY_OPEN, false);
    for (const btn of quickFilters?.querySelectorAll('button') ?? []) {
      btn.setAttribute('aria-pressed', 'false');
    }
    syncQuickFilters();
  });
  emptyFilter.append(resetQuick);
  fragment.append(emptyFilter);
  sections.replaceChildren(fragment);
  syncQuickFilters();
  const target = document.getElementById(window.location.hash.slice(1));
  if (target && sections.contains(target) && !target.hidden) target.scrollIntoView();
}

function findCourse(courses, code) {
  if (!code) return null;
  const exact = courses.find((course) => course.code === code);
  if (exact) return exact;
  const normalized = normalizeName(code).toLowerCase();
  return courses.find((course) => normalizeName(course.code).toLowerCase() === normalized) ?? null;
}

function spanSep() {
  const sep = el('span', 'sep', '·');
  sep.setAttribute('aria-hidden', 'true');
  return sep;
}

function renderTypeSection(group, labels) {
  const section = el('section', 'resource-type');
  section.id = `section-${group.type}`;
  section.dataset.type = group.type;
  const heading = el('h2', 'resource-type-heading');
  heading.append(document.createTextNode(group.label ?? group.type));
  const count = el('span', 'type-count', `${group.resources.length} 条`);
  heading.append(document.createTextNode(' '), count);
  section.append(heading);

  const list = el('ul', 'resource-list');
  list.setAttribute('role', 'list');
  const yearBucketOf = (resource) => {
    const years = resourceYears(resource);
    return years.length > 0 ? String(years[0]) : 'unknown';
  };
  const useYearDividers =
    group.type === 'exams' && new Set(group.resources.map(yearBucketOf)).size >= 2;
  const bucketCounts = new Map();
  if (useYearDividers) {
    for (const resource of group.resources) {
      const bucket = yearBucketOf(resource);
      bucketCounts.set(bucket, (bucketCounts.get(bucket) ?? 0) + 1);
    }
  }
  let currentBucket = null;
  for (const resource of group.resources) {
    const bucket = yearBucketOf(resource);
    if (useYearDividers && bucket !== currentBucket) {
      currentBucket = bucket;
      const divider = el('li', 'year-divider');
      divider.setAttribute('role', 'presentation');
      divider.dataset.yearGroup = bucket;
      divider.append(
        el('span', 'year-divider-label', bucket === 'unknown' ? '年份待确认' : bucket),
        el('span', 'year-divider-count', `${bucketCounts.get(bucket)} 条`),
      );
      list.append(divider);
    }
    const item = renderResource(resource, labels);
    item.dataset.yearBucket = bucket;
    list.append(item);
  }
  section.append(list);
  return section;
}

function renderEmptyState() {
  const section = el('section', 'empty-state');
  section.append(el('h2', null, '暂未收录资料'));
  section.append(
    el(
      'p',
      null,
      '这门课目前还没有收录到公开资料，欢迎通过 GitHub 仓库推荐来源。',
    ),
  );
  return section;
}

function renderResource(resource, labels) {
  const type = normalizeResourceType(resource.type);
  const article = el('article', 'resource');

  const head = el('div', 'resource-head');
  const titleWrap = el('div', 'resource-title-wrap');
  titleWrap.append(el('h3', 'resource-title', resource.title || '未命名资料'));

  const facts = resourceFacts(resource, { examKind: labels.examKind, examForm: labels.examForm });
  const solutions = (resource.locations ?? []).filter((location) => location.role === 'solution');
  const plan = resourceLinkPlan(solutions.length ? {
    ...resource,
    locations: resource.locations.filter((location) => location.role !== 'solution'),
  } : resource);
  const markers = [...resourceMarkers(resource, { examForm: labels.examForm })];
  const access = plan.compact
    ? accessMarker(plan.compact.location?.access, { access: labels.access })
    : '';
  if (access) markers.push(access);

  if (facts.length > 0 || markers.length > 0) {
    const badgeRow = el('div', 'resource-badges mode-compact');
    for (const fact of facts) {
      const factBadge = el('span', 'badge fact-badge', fact);
      if (fact === '含解答') factBadge.dataset.fact = 'solution-yes';
      else if (fact === '无解答') factBadge.dataset.fact = 'solution-no';
      badgeRow.append(factBadge);
    }
    for (const marker of markers) {
      const markerBadge = el('span', 'badge kind', marker);
      if (access && marker === access) markerBadge.dataset.marker = 'access';
      badgeRow.append(markerBadge);
    }
    titleWrap.append(badgeRow);
  }
  const solutionLinks = [];
  const seenKeys = new Set(plan.keys);
  for (const { page_url, download_page, download_url } of solutions) {
    const url = safeExternalUrl(download_url ?? download_page ?? page_url);
    const key = canonicalUrlKey(url);
    if (!key || seenKeys.has(key)) continue;
    seenKeys.add(key);
    solutionLinks.push(url);
  }
  if (resource.exercise_source) {
    titleWrap.append(el('p', 'resource-notes exercise-references', `出处：${resource.exercise_source}`));
  }
  head.append(titleWrap);
  head.append(
    renderCompactLinks(plan, labels, {
      exerciseTitle: solutionLinks.length > 0 ? resource.title : '',
      solutionLinks,
    }),
  );
  article.append(head);

  const detail = el('div', 'mode-detail resource-detail');
  const authorParts = [];
  if (Array.isArray(resource.authors) && resource.authors.length > 0) {
    authorParts.push(`署名：${resource.authors.join('、')}`);
  }
  if (resource.verified_at) authorParts.push(`整理于 ${formatDate(resource.verified_at)}`);
  if (authorParts.length > 0) detail.append(el('p', 'resource-meta', authorParts.join(' · ')));

  const coverage = renderCoverage(resource, type, labels);
  if (coverage) detail.append(coverage);

  const notes = resourceNotes(resource);
  if (notes.coverage) detail.append(el('p', 'resource-notes', `说明：${notes.coverage}`));
  if (notes.extra) detail.append(el('p', 'resource-notes', `备注：${notes.extra}`));

  const evidence = safeExternalUrl(resource.coverage?.evidence_url);
  if (evidence) {
    const key = canonicalUrlKey(evidence);
    if (!key || !plan.keys.has(key)) {
      const p = el('p', 'resource-notes');
      p.append(document.createTextNode('参考出处：'), externalLink(evidence, '查看出处页'));
      detail.append(p);
    }
  }

  const detailSolutions = solutions
    .map((location) => {
      const url = safeExternalUrl(location.download_url ?? location.download_page ?? location.page_url);
      if (!url) return null;
      return { location, entries: [{ url, label: '配套解答' }] };
    })
    .filter(Boolean);

  if (plan.details.length === 0 && detailSolutions.length === 0) {
    detail.append(el('p', 'empty-type', '暂无可用链接'));
  } else {
    const list = el('ul', 'locations');
    list.setAttribute('role', 'list');
    plan.details.forEach((entry, index) => list.append(renderLocation(entry, labels, index)));
    for (const entry of detailSolutions) {
      list.append(renderLocation(entry, labels, 0));
    }
    detail.append(list);
  }

  article.append(detail);
  const item = el('li');
  item.dataset.resourceItem = 'true';
  item.dataset.hasSolution = String(resourceHasSolution(resource));
  item.dataset.isOpen = String((resource?.locations ?? []).some((location) => location?.access === 'public'));
  item.append(article);
  return item;
}

/** 简洁行：原始出处与最直接的资料入口。 */
function renderCompactLinks(plan, labels, { exerciseTitle = '', solutionLinks = [] } = {}) {
  const line = el('div', 'location-links compact-links mode-compact');
  if (!plan.compact && solutionLinks.length === 0) {
    line.append(el('span', 'source-note', '暂无可用链接'));
    return line;
  }
  if (plan.compact) {
    const compact = plan.compact;
    if (compact.original) {
      const { location, entry } = compact.original;
      const group = el('div', 'compact-link-group');
      group.append(
        el('span', 'source-note', `来源：${sourceNames(labels.sourceNames, location.source_id)}`),
        externalLink(entry.url, entry.label),
      );
      line.append(group);
    }
    const mainGroup = el('div', 'compact-link-group');
    if (!compact.original || compact.original.location.source_id !== compact.location.source_id) {
      const label = compact.original ? '另见' : '来源';
      mainGroup.append(
        el('span', 'source-note', `${label}：${sourceNames(labels.sourceNames, compact.location.source_id)}`),
      );
    }
    const actions = el('div', 'compact-link-actions');
    const link = externalLink(compact.entry.url, exerciseTitle ? '题目' : compact.entry.label);
    if (exerciseTitle) {
      link.setAttribute('aria-label', `${exerciseTitle}：题目（新标签页打开）`);
    }
    actions.append(link);
    for (const url of solutionLinks) {
      const solLink = externalLink(url, '配套解答');
      if (exerciseTitle) {
        solLink.setAttribute('aria-label', `${exerciseTitle}：配套解答（新标签页打开）`);
      }
      actions.append(solLink);
    }
    mainGroup.append(actions);
    line.append(mainGroup);
  } else if (solutionLinks.length > 0) {
    const actions = el('div', 'compact-link-actions');
    for (const url of solutionLinks) {
      const solLink = externalLink(url, '配套解答');
      if (exerciseTitle) {
        solLink.setAttribute('aria-label', `${exerciseTitle}：配套解答（新标签页打开）`);
      }
      actions.append(solLink);
    }
    line.append(actions);
  }
  return line;
}

/** 详细模式：只展示数据里确实存在的年份、学年和试题信息，不补造公历年。 */
function renderCoverage(resource, type, labels) {
  const coverage = resource.coverage ?? {};
  const rows = [];
  const years = resourceYears(resource);
  const academicYears = resourceAcademicYears(resource);
  if (years.length > 0) rows.push(['年份', years.map((year) => `${year} 年`).join('、')]);
  if (academicYears.length > 0) {
    rows.push(['学年', academicYears.map((value) => formatAcademicYear(value)).join('、')]);
  }
  const examLike = type === 'exams' || coverage.exam_kind === 'quiz';
  if (examLike) {
    rows.push([
      '卷别',
      coverage.exam_kind ? labels.examKind.get(coverage.exam_kind) ?? coverage.exam_kind : '待确认',
    ]);
    rows.push([
      '形式',
      coverage.exam_form ? labels.examForm.get(coverage.exam_form) ?? coverage.exam_form : '待确认',
    ]);
    rows.push([
      '解答',
      coverage.has_solutions === true
        ? '含解答'
        : coverage.has_solutions === false
          ? '无解答'
          : '待确认',
    ]);
  }
  if (rows.length === 0) return null;
  const list = el('dl', 'coverage');
  for (const [term, value] of rows) {
    const item = el('div', 'coverage-item');
    item.append(el('dt', null, term), el('dd', null, value));
    list.append(item);
  }
  return list;
}

function renderLocation({ location, entries }, labels, index) {
  const wrapper = el('li', 'location');
  const links = el('div', 'location-links');
  if (entries.length > 0) {
    for (const entry of entries) {
      const pair = el('div', 'location-entry-pair');
      pair.append(externalLink(entry.url, entry.label), renderHealth(entry, labels));
      links.append(pair);
    }
  } else {
    links.append(el('span', 'source-note', '同上方链接'));
  }
  wrapper.append(links);

  const metaParts = [`来源：${sourceNames(labels.sourceNames, location.source_id)}`];
  if (location.role === 'solution') metaParts.unshift('配套解答');
  if (index > 0) metaParts.unshift('备用入口');
  metaParts.push(`访问：${labels.access.get(location.access) ?? location.access ?? '待确认'}`);
  if (location.license_note) metaParts.push(`许可：${location.license_note}`);
  if (location.attribution) metaParts.push(`署名：${location.attribution}`);
  wrapper.append(el('p', 'location-meta', metaParts.join('；')));
  if (location.file_snapshot) {
    const { sha256, bytes, checked_at } = location.file_snapshot;
    const snapshot = el('p', 'location-meta file-snapshot');
    snapshot.append(
      `文件校验（${formatDate(checked_at)}，${bytes.toLocaleString('zh-CN')} 字节） · SHA-256：`,
      el('code', null, sha256),
    );
    wrapper.append(snapshot);
  }
  if (location.attachment_snapshots?.length) {
    const snapshots = el('div', 'location-meta file-snapshot attachment-snapshots');
    snapshots.append(el('p', null, `原帖附件（${location.attachment_snapshots.length} 个，需登录原帖获取）`));
    const list = el('ul');
    for (const { sha256, bytes, checked_at } of location.attachment_snapshots) {
      const item = el('li');
      item.append(
        `${formatDate(checked_at)}，${bytes.toLocaleString('zh-CN')} 字节 · SHA-256：`,
        el('code', null, sha256),
      );
      list.append(item);
    }
    snapshots.append(list);
    wrapper.append(snapshots);
  }
  return wrapper;
}

function sourceNames(map, id) {
  if (!id) return '未知来源';
  return map.get(id) ?? id;
}

function externalLink(url, text) {
  const isPrimary = text === '打开文件' || text === '文件页面' || text === '题目';
  const link = el('a', `link-button ${isPrimary ? 'primary-link' : 'secondary-link'}`, text);
  link.href = url;
  link.target = '_blank';
  link.rel = 'noopener noreferrer nofollow';
  const arrow = el('span', 'link-arrow', ' ↗');
  arrow.setAttribute('aria-hidden', 'true');
  link.append(arrow, el('span', 'visually-hidden', '（新标签页打开）'));
  return link;
}

const HEALTH_REASON_TEXT = {
  private_host: '非公开地址',
  dns_error: '域名无法解析',
  timeout: '连接超时',
  error_page: '原站返回错误页',
  rate_limited: '原站限制访问',
  server_error: '原站暂时异常',
};

const READER_HEALTH_LABELS = {
  unchecked: '尚未检查',
  preflight: '暂未自动检测',
  no_response: '暂时无响应',
  auth: '需登录或认证',
  missing: '页面已失效',
  responded: '站点有响应',
};

/** 自动检查仅反映最近一次网络探测结果。 */
function renderHealth(entry, labels) {
  const health = linkHealth(labels.links, entry.url);
  const evidence = classifyHealth(health);
  const status =
    evidence === 'missing'
      ? 'missing'
      : evidence === 'responded' && health.status === 'reachable'
        ? 'reachable'
        : evidence === 'unchecked'
          ? 'unchecked'
          : 'unknown';
  const node = el('span', `health health-${status}`);
  const symbol = el('span', 'health-symbol', LINK_STATUS_SYMBOL[status]);
  symbol.setAttribute('aria-hidden', 'true');
  const label =
    evidence === 'responded' && health.status === 'reachable'
      ? '访问正常'
      : evidence === 'preflight' && health.http_status
        ? '跳转目标暂未自动检测'
        : READER_HEALTH_LABELS[evidence];
  node.append(symbol, document.createTextNode(`链接状态：${label}`));

  const checkedAt = health.checked_at;
  if (checkedAt) node.append(document.createTextNode(` · ${formatDate(checkedAt)}`));
  if (health.http_status) node.append(document.createTextNode(` · HTTP ${health.http_status}`));
  const reason = HEALTH_REASON_TEXT[health.reason];
  if (reason) node.append(document.createTextNode(`（${reason}）`));
  if (isStale(checkedAt, HEALTH_NOW)) {
    node.append(document.createTextNode(' '), el('span', 'health-stale', '检查已超 7 天'));
  }
  return node;
}

/* ============================== 启动 ============================== */

async function main() {
  if (document.body.dataset.page === 'index' && document.body.dataset.mode !== 'detailed' && !location.search) {
    document.body.dataset.hero = 'centered';
  }
  const catalog = await loadCatalog();
  state.schema = schemaFromCatalog(catalog);
  renderSiteStats(catalog.stats);
  const page = document.body.dataset.page;
  if (page === 'course') {
    initCoursePage(catalog);
  } else {
    initIndex(catalog);
  }
}

main().catch((error) => {
  console.error(error);
  if (document.body.dataset.hero === 'centered') document.body.dataset.hero = 'expanded';
  showLoadError(
    '课程目录加载失败，请刷新页面重试；如仍打不开，可先查看来源与致谢。',
  );
  const noResults = document.getElementById('no-results');
  if (noResults) noResults.hidden = true;
  const content = document.getElementById('course-content');
  if (content) content.hidden = true;
});
