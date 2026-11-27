/**
 * 课程资料导航的搜索与筛选纯函数。
 *
 * 该模块不访问 DOM、不发网络请求，浏览器页面与 Node 测试共用。
 * 课程类别与 tag 的归属来自 data/course-metadata.json（经 catalog.json 下发），
 * 这里只处理检索顺序、筛选维度、年份与健康状态展示，不重新判断课程分类。
 */

/** 与 data 契约一致的固定顺序（展示与校验用）。 */
export const KIND_IDS = ['common', 'general', 'professional'];
/** 正式资料分类（五类），顺序即详情页分区顺序。 */
export const RESOURCE_TYPE_IDS = ['exams', 'homework', 'study', 'books', 'projects'];
/**
 * 旧分类到五类正式分类的映射：旧分享链接和尚未迁移的资料仍落到对应新类别。
 * 只有这四个旧分类合并到 study；exams/homework/books/projects 的 id 不变。
 */
export const LEGACY_RESOURCE_TYPE_IDS = Object.freeze({
  lectures: 'study',
  notes: 'study',
  open_book: 'study',
  guides: 'study',
});
export const ACCESS_IDS = ['public', 'login', 'campus', 'paid', 'unknown'];
export const EXAM_KIND_IDS = ['midterm', 'final', 'quiz', 'mixed', 'unknown'];
export const EXAM_FORM_IDS = ['original', 'recollection', 'practice', 'unknown'];
export const STATUS_IDS = ['with', 'without'];
/** 收录状态是两项独立复选框：all 两项都选，none 两项都不选，其余为单选一种状态。 */
export const STATUS_FILTER_IDS = ['all', ...STATUS_IDS, 'none'];

/**
 * 资料位置类型与 data 契约一致：目录、具体文件页、普通页面。
 * 旧数据可能没有该字段，此时按已知 URL 形态保守判断，绝不把目录当成文件。
 */
export const PAGE_KIND_IDS = ['directory', 'file', 'page'];
export const PAGE_KIND_LABELS = Object.freeze({
  directory: '资料目录',
  file: '文件页面',
  page: '原始页面',
});

/** 把任意输入归一为五类之一；未知分类返回 null。旧分类映射到新分类。 */
export function normalizeResourceType(value) {
  if (typeof value !== 'string' || !value) return null;
  if (RESOURCE_TYPE_IDS.includes(value)) return value;
  return LEGACY_RESOURCE_TYPE_IDS[value] ?? null;
}

export const DEFAULT_FILTERS = Object.freeze({
  q: '',
  kind: 'all',
  tags: [],
  type: 'all',
  year: 'all',
  status: 'all',
});

/** 从 catalog.json 得到可接受的筛选值集合；旧分类 id 归一到五类正式分类。 */
export function schemaFromCatalog(catalog) {
  const types = new Set();
  for (const item of asList(catalog?.resource_types)) {
    const id = normalizeResourceType(item?.id);
    if (id) types.add(id);
  }
  return {
    kinds: asList(catalog?.kinds).map((item) => item?.id).filter(Boolean),
    types: types.size > 0 ? RESOURCE_TYPE_IDS.filter((id) => types.has(id)) : RESOURCE_TYPE_IDS,
    tags: asList(catalog?.tags).map((item) => item?.id).filter(Boolean),
    statuses: STATUS_IDS,
  };
}

const DEFAULT_SCHEMA = {
  kinds: KIND_IDS,
  types: RESOURCE_TYPE_IDS,
  tags: [],
  statuses: STATUS_IDS,
};

/**
 * 名称归一化：NFKC + 折叠空白 + 去首尾空白，保留大小写与 A/B/H 等级后缀。
 * 仅用于展示与比较，绝不改动存储的课程名称。
 */
export function normalizeName(value) {
  if (typeof value !== 'string') return '';
  return value.normalize('NFKC').replace(/\s+/gu, ' ').trim();
}

/** 检索用归一化：在 normalizeName 的基础上按大小写不敏感比较。 */
export function normalizeSearchText(value) {
  return normalizeName(value).toLowerCase();
}

function asList(value) {
  return Array.isArray(value) ? value : [];
}

function validYear(value) {
  const year = Number(value);
  return Number.isInteger(year) && year >= 1900 && year <= 2100 ? year : null;
}

/**
 * 解析 URLSearchParams 中的筛选条件；未知维度、未知枚举值一律忽略。
 * `tag` 可重复出现；`status=with/without` 保留旧分享链接语义，`status=none` 表示两项都未勾选。
 * 旧分享链接里的 lectures/notes/open_book/guides 映射到 study，再按新分类校验。
 * year 只在 type === "exams" 时生效；旧 access 参数不再参与筛选。
 */
export function parseFilters(searchParams, schema = DEFAULT_SCHEMA) {
  const params =
    searchParams instanceof URLSearchParams
      ? searchParams
      : new URLSearchParams(searchParams ?? '');
  const kinds = new Set(schema.kinds ?? DEFAULT_SCHEMA.kinds);
  const types = new Set(schema.types ?? DEFAULT_SCHEMA.types);
  const knownTags = Array.isArray(schema.tags) ? new Set(schema.tags) : null;

  const kind = params.get('kind');
  const normalizedType = normalizeResourceType(params.get('type'));
  const status = params.get('status');
  const yearRaw = params.get('year');

  const tags = [];
  for (const tag of params.getAll('tag')) {
    const value = tag.trim();
    if (!value) continue;
    if (knownTags && !knownTags.has(value)) continue;
    if (!tags.includes(value)) tags.push(value);
  }
  tags.sort();

  const resolvedType = normalizedType && types.has(normalizedType) ? normalizedType : 'all';
  let year = 'all';
  if (resolvedType === 'exams') {
    if (yearRaw === 'unknown') {
      year = 'unknown';
    } else if (yearRaw !== null && validYear(yearRaw) !== null) {
      year = String(validYear(yearRaw));
    }
  }

  return {
    q: normalizeName(params.get('q') ?? '').slice(0, 120),
    kind: kind && kinds.has(kind) ? kind : 'all',
    tags,
    type: resolvedType,
    year,
    status: STATUS_FILTER_IDS.includes(status) ? status : 'all',
  };
}

/** 把筛选条件写回 URLSearchParams；只写非默认值，顺序稳定，旧 access 参数会被清除。 */
export function serializeFilters(filters, base = new URLSearchParams(), options = {}) {
  const params = base instanceof URLSearchParams ? base : new URLSearchParams(base ?? '');
  for (const key of ['q', 'kind', 'tag', 'type', 'year', 'access', 'status']) {
    params.delete(key);
  }
  const state = { ...DEFAULT_FILTERS, ...(filters ?? {}) };
  const q = normalizeName(state.q ?? '');
  if (q) params.set('q', q);
  if (state.kind && state.kind !== 'all') params.set('kind', state.kind);
  for (const tag of [...new Set(asList(state.tags))].sort()) {
    if (tag) params.append('tag', tag);
  }
  const type = normalizeResourceType(state.type);
  if (type) {
    params.set('type', type);
    if (type === 'exams' && state.year && state.year !== 'all') {
      params.set('year', state.year);
    }
  }
  const status = STATUS_FILTER_IDS.includes(state.status) ? state.status : 'all';
  const defaultStatus = options?.defaultStatus === undefined ? 'all' : options.defaultStatus;
  if (defaultStatus === '' || defaultStatus === null || status !== defaultStatus) {
    params.set('status', status);
  }
  return params;
}

/** 课程详情页链接：代码经 URLSearchParams 编码，PHYS1008B+ 的加号保持原义。 */
export function courseHref(code) {
  const params = new URLSearchParams({ code: String(code) });
  return `course.html?${params.toString()}`;
}

/** 从 query string 读取课程代码（URLSearchParams 已把 + 解成空格的问题由编码端避免）。 */
export function codeFromSearch(search) {
  const params = new URLSearchParams(search ?? '');
  return params.get('code') ?? '';
}

export function courseResources(course) {
  return asList(course?.resources);
}

export function resourceLocations(resource) {
  return asList(resource?.locations);
}

/** 已确认年份：去重、降序。学年区间不会被拆成两年。 */
export function resourceYears(resource) {
  const years = [];
  for (const raw of asList(resource?.coverage?.years)) {
    const year = validYear(raw);
    if (year !== null && !years.includes(year)) years.push(year);
  }
  return years.sort((a, b) => b - a);
}

const ACADEMIC_YEAR_PATTERN = /^(20\d{2})-(20\d{2})$/u;

/** 校验 ASCII `YYYY-YYYY` 学年区间并要求结束年为开始年 + 1；非法输入返回 null。 */
export function normalizeAcademicYear(value) {
  if (typeof value !== 'string') return null;
  const match = ACADEMIC_YEAR_PATTERN.exec(value.trim());
  if (!match) return null;
  const start = Number(match[1]);
  const end = Number(match[2]);
  return end === start + 1 ? `${start}-${end}` : null;
}

/** 展示用：ASCII `2025-2026` → `2025—2026 学年`；非法输入返回空串。 */
export function formatAcademicYear(value) {
  const normalized = normalizeAcademicYear(value);
  return normalized ? `${normalized.replace('-', '—')} 学年` : '';
}

/** 已登记学年：去重、按开始年降序；只用于展示，不折算成公历年。 */
export function resourceAcademicYears(resource) {
  const years = [];
  for (const raw of asList(resource?.coverage?.academic_years)) {
    const value = normalizeAcademicYear(raw);
    if (value && !years.includes(value)) years.push(value);
  }
  return years.sort((a, b) => (a < b ? 1 : a > b ? -1 : 0));
}

/**
 * 年份展示文本：有公历年先写公历年；只有学年时只写学年；都没有时为「年份待确认」。
 * 任何情况下都不把学年折算成公历年。
 */
export function resourceYearText(resource) {
  const years = resourceYears(resource);
  if (years.length > 0) return years.map((year) => `${year} 年`).join('、');
  const academicYears = resourceAcademicYears(resource);
  if (academicYears.length > 0) return academicYears.map((value) => formatAcademicYear(value)).join('、');
  return '年份待确认';
}

/** 课程的试题年份概览。unknown 表示有试题但年份尚未确认。 */
export function courseExamYears(course) {
  const years = new Set();
  let unknown = false;
  for (const resource of courseResources(course)) {
    if (normalizeResourceType(resource?.type) !== 'exams') continue;
    const list = resourceYears(resource);
    if (list.length === 0) unknown = true;
    for (const year of list) years.add(year);
  }
  return { years: [...years].sort((a, b) => b - a), unknown };
}

/** 全部课程可选的试题年份，供筛选下拉框使用。 */
export function allExamYears(courses) {
  const years = new Set();
  let unknown = false;
  for (const course of asList(courses)) {
    const info = courseExamYears(course);
    if (info.unknown) unknown = true;
    for (const year of info.years) years.add(year);
  }
  return { years: [...years].sort((a, b) => b - a), unknown };
}

export function resourceMatchesYear(resource, year) {
  if (!year || year === 'all') return true;
  const years = resourceYears(resource);
  if (year === 'unknown') return years.length === 0;
  const wanted = validYear(year);
  if (wanted === null) return true;
  return years.includes(wanted);
}

/**
 * 资料类型 / 试题年份必须在同一条资料上同时满足，
 * 避免将「2025 试题 + 其他年份笔记」误判为「2025 资料」。
 * 访问要求字段仍保留在资料数据中，但不再参与首页筛选。
 */
export function courseMatchesResourceFilters(course, type, year = 'all') {
  const typeFilter = normalizeResourceType(type);
  if (!typeFilter) return true;
  const yearFilter = typeFilter === 'exams' ? year : 'all';
  return courseResources(course).some(
    (resource) =>
      normalizeResourceType(resource?.type) === typeFilter && resourceMatchesYear(resource, yearFilter),
  );
}

export function courseMatchesTags(course, tags) {
  const selected = asList(tags);
  if (selected.length === 0) return true;
  const own = new Set(asList(course?.tags));
  return selected.some((tag) => own.has(tag));
}

/** 搜索匹配等级：1 精确代码、2 精确名称、3 前缀、4 包含；无匹配返回 null。 */
export function matchQuery(course, query) {
  const q = normalizeSearchText(query);
  if (!q) return 0;
  const code = normalizeSearchText(course?.code);
  const name = normalizeSearchText(course?.name);
  if (code === q) return 1;
  if (name === q) return 2;
  if (code.startsWith(q) || name.startsWith(q)) return 3;
  if (code.includes(q) || name.includes(q)) return 4;
  return null;
}

export function compareCourseCodes(a, b) {
  const left = String(a?.code ?? '');
  const right = String(b?.code ?? '');
  if (left === right) return 0;
  return left < right ? -1 : 1;
}

function compareByCodeThenName(a, b) {
  return compareCourseCodes(a, b) || String(a?.name ?? '').localeCompare(String(b?.name ?? ''), 'zh-CN');
}

/**
 * 筛选课程：各维度 AND；tag 维度内 OR；选择资料类型时只保留匹配的课程。
 * status=none（两项收录状态都未勾选）返回空结果，由页面提示恢复方式。
 * 有查询词时按匹配等级、再按代码排序；无查询词时按代码排序。
 */
export function filterCourses(courses, filters = {}) {
  const state = { ...DEFAULT_FILTERS, ...(filters ?? {}) };
  if (state.status === 'none') return [];
  const query = normalizeName(state.q ?? '');
  const ranked = [];

  for (const course of asList(courses)) {
    if (!course || typeof course.code !== 'string') continue;
    const hasResources = courseResources(course).length > 0;
    if (state.status === 'with' && !hasResources) continue;
    if (state.status === 'without' && hasResources) continue;
    if (state.kind !== 'all' && course.kind !== state.kind) continue;
    if (!courseMatchesTags(course, state.tags)) continue;
    if (!courseMatchesResourceFilters(course, state.type, state.year)) continue;

    const rank = matchQuery(course, query);
    if (rank === null) continue;
    ranked.push({ course, rank });
  }

  ranked.sort((a, b) => a.rank - b.rank || compareByCodeThenName(a.course, b.course));
  return ranked.map((item) => item.course);
}

/** 首页每页课程数，简洁与详细模式共用。 */
export const DEFAULT_PAGE_SIZE = 50;

/**
 * 结果分页：页码从 1 开始，越界时收敛到有效页；空结果仍算第 1 页。
 * 只做切片，不改变 filterCourses 给出的顺序。
 */
export function paginate(items, page = 1, pageSize = DEFAULT_PAGE_SIZE) {
  const list = asList(items);
  const size = Number.isInteger(pageSize) && pageSize > 0 ? pageSize : DEFAULT_PAGE_SIZE;
  const totalPages = Math.max(1, Math.ceil(list.length / size));
  const requested = Number.isInteger(page) ? page : 1;
  const current = Math.min(Math.max(requested, 1), totalPages);
  const start = (current - 1) * size;
  return {
    page: current,
    pageSize: size,
    totalPages,
    total: list.length,
    items: list.slice(start, start + size),
  };
}

function maxYear(resource) {
  const years = resourceYears(resource);
  return years.length > 0 ? years[0] : Number.NEGATIVE_INFINITY;
}

function resourceTypeOf(resource) {
  return normalizeResourceType(resource?.type);
}

const TYPE_ORDER = new Map(RESOURCE_TYPE_IDS.map((id, index) => [id, index]));

/**
 * 详情展示顺序：五类资料固定顺序；试题内按已确认年份新到旧，年份不明最后。
 * 同年不同卷、不同解析版本不会被合并；旧分类按新分类参与排序。
 */
export function sortResources(resources) {
  return asList(resources)
    .map((resource, index) => ({ resource, type: resourceTypeOf(resource), index }))
    .sort((a, b) => {
      const typeA = TYPE_ORDER.get(a.type) ?? RESOURCE_TYPE_IDS.length;
      const typeB = TYPE_ORDER.get(b.type) ?? RESOURCE_TYPE_IDS.length;
      if (typeA !== typeB) return typeA - typeB;
      if (a.type === 'exams' && b.type === 'exams') {
        const yearA = maxYear(a.resource);
        const yearB = maxYear(b.resource);
        if (yearA !== yearB) return yearB - yearA;
      }
      const titleA = normalizeName(a.resource?.title);
      const titleB = normalizeName(b.resource?.title);
      const titleOrder = titleA.localeCompare(titleB, 'zh-CN');
      if (titleOrder !== 0) return titleOrder;
      const idOrder = String(a.resource?.id ?? '').localeCompare(String(b.resource?.id ?? ''));
      return idOrder !== 0 ? idOrder : a.index - b.index;
    })
    .map((entry) => entry.resource);
}

/**
 * 按五类资料分组（保持固定顺序，空组也返回，由页面决定是否展示）。
 * 显示名称由 catalog.json 注入，模块内不保存第二套 label。
 */
export function groupResourcesByType(resources, typeLabels = {}) {
  const groups = new Map(RESOURCE_TYPE_IDS.map((type) => [type, []]));
  for (const resource of sortResources(resources)) {
    const type = resourceTypeOf(resource);
    if (type) groups.get(type).push(resource);
  }
  return RESOURCE_TYPE_IDS.map((type) => ({
    type,
    label: typeLabels?.get?.(type) ?? typeLabels?.[type] ?? type,
    resources: groups.get(type),
  }));
}

/* ------------------------------ 资料入口与展示 ------------------------------ */

/** 可识别的文件扩展名；只有末段命中且更早层级没有文件扩展名时才视为具体文件。 */
const FILE_EXTENSIONS = new Set([
  'pdf', 'zip', 'rar', '7z', 'tar', 'gz', 'tgz', 'bz2', 'xz', 'doc', 'docx', 'ppt', 'pptx',
  'xls', 'xlsx', 'csv', 'txt', 'md', 'markdown', 'tex', 'djvu', 'epub', 'mobi', 'ps', 'ipynb',
  'png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp', 'mp3', 'wav', 'mp4', 'mov', 'avi',
  'c', 'cc', 'cpp', 'h', 'hpp', 'java', 'py', 'm', 'mm', 's', 'asm', 'v', 'vhd', 'sv',
  'js', 'ts', 'json', 'xml', 'yaml', 'yml', 'bib', 'cls', 'sty', 'odt', 'ods', 'odp',
]);

function hasFileExtension(segment) {
  const index = segment.lastIndexOf('.');
  if (index <= 0 || index === segment.length - 1) return false;
  return FILE_EXTENSIONS.has(segment.slice(index + 1).toLowerCase());
}

function decodedSegments(pathname) {
  let decoded = pathname;
  try {
    decoded = decodeURI(pathname);
  } catch {
    // 非法百分号编码时保留原路径比较。
  }
  return decoded.split('/').filter(Boolean);
}

/**
 * 按已知 URL 形态保守判断入口类型：GitHub tree 是目录、blob 是文件页；
 * 末段带文件扩展名视为文件页，但路径更早层级也以文件扩展名结尾时（如 `.pdf/...`）
 * 说明末段只是目录内的文件，入口仍按目录处理。其余一律普通页面。
 */
export function classifyUrlKind(value) {
  const safe = safeExternalUrl(value);
  if (!safe) return 'page';
  const parsed = new URL(safe);
  const pathname = parsed.pathname;
  const segments = decodedSegments(pathname);
  if (parsed.host.toLowerCase() === 'github.com' && segments.length >= 3) {
    if (segments[2] === 'tree') return 'directory';
    if (segments[2] === 'blob') return 'file';
  }
  const fileSegments = segments.filter(hasFileExtension);
  if (fileSegments.length === 0) {
    return 'page';
  }
  if (!hasFileExtension(segments[segments.length - 1])) return 'directory';
  return fileSegments.length > 1 ? 'directory' : 'file';
}

/** 只有确实指向具体文件的 URL 才算直接文件；目录页和普通页面都不算。 */
export function isDirectFileUrl(value) {
  return classifyUrlKind(value) === 'file';
}

/** 位置入口类型：数据提供 page_kind 时以其为准，否则按 URL 形态判断。 */
export function locationPageKind(location) {
  const supplied = location?.page_kind;
  if (PAGE_KIND_IDS.includes(supplied)) return supplied;
  return classifyUrlKind(location?.page_url);
}

/** 等价 URL 的展示键：忽略片段、末尾斜杠、主机大小写与百分号编码差异。 */
export function canonicalUrlKey(value) {
  const safe = safeExternalUrl(value);
  if (!safe) return null;
  const parsed = new URL(safe);
  let pathname = parsed.pathname;
  try {
    pathname = decodeURI(pathname);
  } catch {
    // 保留原路径。
  }
  pathname = pathname.replace(/\/+$/u, '') || '/';
  return `${parsed.protocol}//${parsed.host.toLowerCase()}${pathname}${parsed.search}`;
}

/** 同一位置的等价 URL 只保留一个，优先使用更明确的入口。 */
export function locationLinkEntries(location) {
  const entries = new Map();
  const push = (value, label, role) => {
    const url = safeExternalUrl(value);
    const key = url ? canonicalUrlKey(url) : null;
    if (!key) return;
    const entry = { url, key, label, role };
    const previous = entries.get(key);
    if (!previous || entrySpecificity(entry) < entrySpecificity(previous)) entries.set(key, entry);
  };

  if (safeExternalUrl(location?.page_url)) {
    push(location.page_url, PAGE_KIND_LABELS[locationPageKind(location)], 'page');
  }
  if (safeExternalUrl(location?.download_page)) {
    const kind = classifyUrlKind(location.download_page);
    push(location.download_page, kind === 'page' ? '前往原站' : PAGE_KIND_LABELS[kind], 'download_page');
  }
  if (safeExternalUrl(location?.download_url)) {
    const kind = classifyUrlKind(location.download_url);
    push(location.download_url, kind === 'file' ? '打开文件' : kind === 'directory' ? PAGE_KIND_LABELS.directory : '前往原站', 'download');
  }
  return [...entries.values()];
}

function entrySpecificity(entry) {
  switch (entry.label) {
    case '打开文件': return 0;
    case PAGE_KIND_LABELS.file: return 1;
    case PAGE_KIND_LABELS.page: return 2;
    case '前往原站': return 3;
    default: return 4;
  }
}

/**
 * 一条资料的链接计划：
 * - details：各位置去重后的全部入口，等价 URL 全资料只出现一次，标签取最具体的一种；
 * - compact：首个登记的原始出处，以及最直接的资料入口；相同网址只显示一次；
 * - keys：已出现的等价 URL 键，供核验依据等附加链接避免重复。
 */
export function resourceLinkPlan(resource) {
  const raw = resourceLocations(resource).map((location) => ({
    location,
    entries: locationLinkEntries(location),
  }));

  const best = new Map();
  for (const { entries } of raw) {
    for (const entry of entries) {
      const current = best.get(entry.key);
      if (!current || entrySpecificity(entry) < entrySpecificity(current)) best.set(entry.key, entry);
    }
  }
  const preferred = (entry) => (entry ? best.get(entry.key) ?? entry : null);

  const keys = new Set();
  const details = raw.map(({ location, entries }) => {
    const unique = [];
    for (const entry of entries) {
      if (keys.has(entry.key)) continue;
      keys.add(entry.key);
      unique.push(preferred(entry));
    }
    return { location, entries: unique };
  });

  let compact = null;
  for (const { location, entries } of raw) {
    for (const entry of entries) {
      if (!compact || entrySpecificity(entry) < entrySpecificity(compact.entry)) {
        compact = { location, entry };
      }
    }
  }
  if (compact) {
    for (const { location, entries } of raw) {
      const url = safeExternalUrl(location?.page_url);
      if (!url) continue;
      const key = canonicalUrlKey(url);
      if (key !== compact.entry.key) {
        compact.original = { location, entry: preferred(entries.find((entry) => entry.key === key)) };
      }
      break;
    }
  }

  return { compact, details, keys };
}

function labelOf(labels, id) {
  if (!id) return '';
  if (labels instanceof Map) return labels.get(id) ?? id;
  const value = labels?.[id];
  return typeof value === 'string' && value ? value : id;
}

/** 简洁行的年份/卷别/解答摘要；小测作业也展示已核验的试题信息。 */
export function resourceFacts(resource, labels = {}) {
  const type = normalizeResourceType(resource?.type);
  const coverage = resource?.coverage ?? {};
  const examLike = type === 'exams' || coverage.exam_kind === 'quiz';
  const facts = [];

  if (resourceYears(resource).length > 0 || resourceAcademicYears(resource).length > 0) {
    facts.push(resourceYearText(resource));
  } else if (examLike) {
    facts.push('年份待确认');
  }
  if (examLike && coverage.exam_kind) facts.push(labelOf(labels.examKind, coverage.exam_kind));
  if (coverage.has_solutions === true) facts.push('含解答');
  else if (coverage.has_solutions === false) facts.push('无解答');
  return facts;
}

/** 简洁行只使用明确的试题形式与标题标识，不从来源目录推断内容。 */
export function resourceMarkers(resource, labels = {}) {
  const form = resource?.coverage?.exam_form;
  const markers = [];
  if (form === 'recollection' || form === 'practice') markers.push(labelOf(labels.examForm, form));
  const title = resource?.title ?? '';
  if (/仅(?:有|含)?(?:参考)?答案|仅(?:有|含)?解答/u.test(title)) markers.push('仅答案');
  if (/混合课程|混收|混合题集/u.test(title)) markers.push('混合课程');
  return markers;
}

/** 访问要求短标记；公开与访问不明不额外标注。 */
export function accessMarker(access, labels = {}) {
  if (!ACCESS_IDS.includes(access) || access === 'public' || access === 'unknown') return '';
  return labelOf(labels.access, access);
}

function squashText(value) {
  return typeof value === 'string' ? value.replace(/\s+/gu, ' ').trim() : '';
}

/**
 * 合并说明文字：覆盖说明优先；与补充说明完全相同、互相包含时只保留信息更完整的一份，
 * 避免详情页出现互相矛盾或重复的旧备注。
 */
export function resourceNotes(resource) {
  const extra = squashText(resource?.notes);
  const coverage = squashText(resource?.coverage?.note);
  if (!coverage) return { coverage: '', extra };
  if (!extra || extra === coverage || coverage.includes(extra)) return { coverage, extra: '' };
  if (extra.includes(coverage)) return { coverage: extra, extra: '' };
  return { coverage, extra };
}

export const LINK_STATUS_IDS = ['reachable', 'missing', 'unknown', 'unchecked'];

export const LINK_STATUS_SYMBOL = {
  reachable: '✓',
  missing: '✕',
  unknown: '?',
  unchecked: '–',
};

export function linkHealth(links, url) {
  if (!url || !links || typeof links !== 'object') return { status: 'unchecked' };
  const entry = links[url];
  if (!entry || typeof entry !== 'object') return { status: 'unchecked' };
  const status = LINK_STATUS_IDS.includes(entry.status) ? entry.status : 'unchecked';
  return { ...entry, status };
}

/** 健康状态的中文名来自 catalog.link_statuses。 */
export function healthLabel(status, labels = {}) {
  const label = labels instanceof Map ? labels.get(status) : labels?.[status];
  return label ?? status ?? 'unchecked';
}

/** 检查结果超过 7 天即标注已过期；未检查没有日期。 */
export function isStale(checkedAt, now = Date.now(), days = 7) {
  if (!checkedAt) return false;
  const time = Date.parse(checkedAt);
  if (Number.isNaN(time)) return false;
  return now - time > days * 24 * 60 * 60 * 1000;
}

/** 仅允许 http/https 外链；其他协议不生成可点击链接。 */
export function safeExternalUrl(value) {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  try {
    const url = new URL(trimmed);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.href : null;
  } catch {
    return null;
  }
}

/** 课程资料的简要统计，用于结果列表。 */
export function courseSummary(course, typeLabels = {}) {
  const resources = courseResources(course);
  const counts = new Map();
  for (const resource of resources) {
    const type = resourceTypeOf(resource);
    if (!type) continue;
    counts.set(type, (counts.get(type) ?? 0) + 1);
  }
  const examYears = courseExamYears(course);
  return {
    total: resources.length,
    types: RESOURCE_TYPE_IDS.filter((type) => counts.has(type)).map((type) => ({
      type,
      label: typeLabels?.get?.(type) ?? typeLabels?.[type] ?? type,
      count: counts.get(type),
    })),
    examYears: examYears.years,
    hasUnknownExamYear: examYears.unknown,
  };
}

/** 为首页「课程直达」挑选课程：本地访问次数优先，其次按收录资料条数与课号排序。 */
export function pickQuickCourses(courses, visits = {}, limit = 6) {
  const size = Number.isInteger(limit) && limit >= 0 ? limit : 6;
  if (size === 0) return [];
  const visitCounts = new Map();
  if (visits && typeof visits === 'object') {
    for (const [code, raw] of Object.entries(visits)) {
      if (typeof code === 'string' && Number.isSafeInteger(raw) && raw > 0) {
        visitCounts.set(code, raw);
      }
    }
  }
  const candidates = [];
  for (const course of asList(courses)) {
    if (!course || typeof course.code !== 'string') continue;
    const visitCount = visitCounts.get(course.code) ?? 0;
    const resourceCount = courseResources(course).length;
    if (visitCount === 0 && resourceCount === 0) continue;
    candidates.push({ course, visitCount, resourceCount });
  }
  candidates.sort(
    (a, b) =>
      b.visitCount - a.visitCount ||
      b.resourceCount - a.resourceCount ||
      compareCourseCodes(a.course, b.course),
  );
  return candidates.slice(0, size).map((entry) => entry.course);
}