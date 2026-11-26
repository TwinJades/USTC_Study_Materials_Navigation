import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { ANNOUNCEMENTS } from '../site/assets/announcements.mjs';
import { buildCatalog, renderSourcesHtml } from '../scripts/build.mjs';

import {
  accessMarker,
  allExamYears,
  canonicalUrlKey,
  classifyUrlKind,
  courseExamYears,
  courseHref,
  courseSummary,
  codeFromSearch,
  DEFAULT_PAGE_SIZE,
  filterCourses,
  formatAcademicYear,
  groupResourcesByType,
  healthLabel,
  isDirectFileUrl,
  isStale,
  LEGACY_RESOURCE_TYPE_IDS,
  linkHealth,
  locationLinkEntries,
  locationPageKind,
  matchQuery,
  normalizeAcademicYear,
  normalizeName,
  normalizeResourceType,
  PAGE_KIND_IDS,
  paginate,
  parseFilters,
  RESOURCE_TYPE_IDS,
  resourceAcademicYears,
  resourceFacts,
  resourceLinkPlan,
  resourceMarkers,
  resourceMatchesYear,
  resourceNotes,
  resourceYearText,
  resourceYears,
  safeExternalUrl,
  schemaFromCatalog,
  serializeFilters,
  sortResources,
} from '../site/assets/search.mjs';

function examResource({ id, years, title = '试题', locations = [] }) {
  return {
    id,
    type: 'exams',
    title,
    authors: ['某课程组'],
    notes: '',
    coverage: {
      years,
      exam_kind: 'final',
      exam_form: 'original',
      has_solutions: null,
      evidence_url: null,
      note: '',
    },
    locations,
    verified_at: '2026-11-18',
  };
}

function location(sourceId, pageUrl, downloadUrl) {
  return {
    source_id: sourceId,
    page_url: pageUrl,
    download_page: null,
    download_url: downloadUrl,
    access: 'public',
    license_note: null,
    attribution: null,
  };
}

const threeYearsCourse = {
  code: 'MATH1001',
  name: '数学分析(A1)',
  kind: 'common',
  tags: ['math'],
  resources: [
    examResource({ id: 'exam-2014', years: [2014], title: '2014 期末', locations: [location('src-a', 'https://example.org/a/2014')] }),
    examResource({ id: 'exam-2020', years: [2020], title: '2020 期末', locations: [location('src-a', 'https://example.org/a/2020')] }),
    examResource({ id: 'exam-2025', years: [2025], title: '2025 期末', locations: [location('src-a', 'https://example.org/a/2025')] }),
  ],
};

const catalogFixture = {
  kinds: [
    { id: 'common', label: '通修课' },
    { id: 'general', label: '通识课' },
    { id: 'professional', label: '专业课' },
  ],
  resource_types: [
    { id: 'exams', label: '试题与解析' },
    { id: 'homework', label: '作业、习题与小测' },
    { id: 'study', label: '学习资料' },
    { id: 'books', label: '教材与参考书' },
    { id: 'projects', label: '大作业与考核作品' },
  ],
  access: [
    { id: 'public', label: '公开' },
    { id: 'login', label: '需登录' },
  ],
  tags: [
    { id: 'math', label: '数学' },
    { id: 'physics', label: '物理' },
  ],
};

test('2014/2020/2025 三卷各自按年份命中，不被合并成一套', () => {
  const course = structuredClone(threeYearsCourse);
  assert.deepEqual(courseExamYears(course), { years: [2025, 2020, 2014], unknown: false });
  assert.deepEqual(allExamYears([course]).years, [2025, 2020, 2014]);

  for (const year of ['2014', '2020', '2025']) {
    const filters = parseFilters(new URLSearchParams({ type: 'exams', year }), schemaFromCatalog(catalogFixture));
    const matched = filterCourses([course], filters);
    assert.equal(matched.length, 1, `年份 ${year} 应命中课程`);
    const hits = matched[0].resources.filter((resource) => resourceMatchesYear(resource, year));
    assert.equal(hits.length, 1);
    assert.deepEqual(hits[0].coverage.years, [Number(year)]);
  }

  const noMatch = filterCourses(
    [course],
    parseFilters(new URLSearchParams({ type: 'exams', year: '2019' }), schemaFromCatalog(catalogFixture)),
  );
  assert.deepEqual(noMatch, []);
});

test('同年不同卷、不同解析版本各自保留', () => {
  const course = {
    code: 'PHYS1001',
    name: '力学',
    kind: 'professional',
    tags: ['physics'],
    resources: [
      examResource({ id: 'phys-2025-final-a', years: [2025], title: '2025 期末（A 卷）' }),
      examResource({ id: 'phys-2025-final-b', years: [2025], title: '2025 期末（B 卷）' }),
      { ...examResource({ id: 'phys-2025-solutions', years: [2025], title: '2025 期末解析' }), coverage: { ...examResource({ id: 'x', years: [2025] }).coverage, has_solutions: true } },
    ],
  };

  const groups = groupResourcesByType(course.resources);
  const exams = groups.find((group) => group.type === 'exams');
  assert.equal(exams.resources.length, 3);

  const filters = parseFilters(new URLSearchParams({ type: 'exams', year: '2025' }), schemaFromCatalog(catalogFixture));
  const matched = filterCourses([course], filters);
  assert.equal(matched.length, 1);
  assert.equal(matched[0].resources.filter((resource) => resourceMatchesYear(resource, '2025')).length, 3);
  assert.equal(courseSummary(course).total, 3);
});

test('同年同标题的不同文件不按标题去重', () => {
  const course = {
    code: 'CS1001',
    name: '计算机程序设计',
    kind: 'professional',
    tags: [],
    resources: [
      examResource({ id: 'cs-2025-a', years: [2025], title: '2025 期末', locations: [location('src-a', 'https://example.org/cs/a.pdf', 'https://example.org/cs/a.pdf')] }),
      examResource({ id: 'cs-2025-b', years: [2025], title: '2025 期末', locations: [location('src-b', 'https://example.org/cs/b.pdf', 'https://example.org/cs/b.pdf')] }),
    ],
  };
  const exams = groupResourcesByType(course.resources).find((group) => group.type === 'exams');
  assert.equal(exams.resources.length, 2);
});

test('PHYS1008B+ 代码经 URLSearchParams 往返不丢加号', () => {
  const href = courseHref('PHYS1008B+');
  assert.equal(href, 'course.html?code=PHYS1008B%2B');
  const parsed = new URL(href, 'https://example.org/ustc/');
  assert.equal(parsed.searchParams.get('code'), 'PHYS1008B+');
  assert.equal(codeFromSearch(parsed.search), 'PHYS1008B+');
  assert.equal(codeFromSearch('?code=PHYS1008B%2B'), 'PHYS1008B+');
});

test('PHYS1008B+ 可按精确代码检索并排在包含匹配之前', () => {
  const courses = [
    { code: 'PHYS1008B', name: '大学物理-基础实验', kind: 'common', tags: [], resources: [] },
    { code: 'PHYS1008B+', name: '大学物理-基础实验（进阶）', kind: 'common', tags: [], resources: [] },
    { code: 'PHYS1008B2', name: '大学物理-综合实验', kind: 'common', tags: [], resources: [] },
  ];
  const result = filterCourses(courses, { q: 'phys1008b+' });
  assert.equal(result.length, 1);
  assert.equal(result[0].code, 'PHYS1008B+');

  const contains = filterCourses(courses, { q: 'PHYS1008B' });
  assert.deepEqual(contains.map((course) => course.code), ['PHYS1008B', 'PHYS1008B+', 'PHYS1008B2']);
});

test('名称 NFKC 与空白归一化，代码大小写不敏感，等级后缀不清除', () => {
  assert.equal(normalizeName('  数学分析（Ａ１）  '), '数学分析(A1)');
  assert.equal(normalizeName('数学\t分析'), '数学 分析');
  assert.equal(normalizeName(' PHYS1008B+ '), 'PHYS1008B+');

  const course = { code: 'MATH1001', name: '数学分析(A1)', kind: 'common', tags: [], resources: [] };
  assert.equal(matchQuery(course, 'math1001'), 1);
  assert.equal(matchQuery(course, '数学分析(a1)'), 2);
  assert.equal(matchQuery(course, '数学分析'), 3);
  assert.equal(matchQuery(course, '分析'), 4);
  assert.equal(matchQuery(course, '不在课程里'), null);
});

test('筛选维度：tag 内 OR、维度间 AND；未知参数忽略', () => {
  const courses = [
    { code: 'A1', name: '甲课', kind: 'common', tags: ['math'], resources: [examResource({ id: 'a1', years: [2025] })] },
    { code: 'B2', name: '乙课', kind: 'professional', tags: ['physics', 'math'], resources: [] },
    { code: 'C3', name: '丙课', kind: 'general', tags: ['physics'], resources: [] },
  ];
  const schema = schemaFromCatalog(catalogFixture);

  const bothTags = parseFilters(new URLSearchParams([['tag', 'math'], ['tag', 'physics']]), schema);
  assert.deepEqual(filterCourses(courses, bothTags).map((course) => course.code), ['A1', 'B2', 'C3']);

  const mathOnly = parseFilters(new URLSearchParams({ tag: 'math' }), schema);
  assert.deepEqual(filterCourses(courses, mathOnly).map((course) => course.code), ['A1', 'B2']);

  const mathProfessional = parseFilters(new URLSearchParams({ tag: 'math', kind: 'professional' }), schema);
  assert.deepEqual(filterCourses(courses, mathProfessional).map((course) => course.code), ['B2']);

  const withResources = parseFilters(new URLSearchParams({ status: 'with' }), schema);
  assert.deepEqual(filterCourses(courses, withResources).map((course) => course.code), ['A1']);

  const unknown = parseFilters(
    new URLSearchParams({ kind: 'bogus', type: 'bogus', access: 'bogus', status: 'bogus', year: '2025', tag: 'nope' }),
    schema,
  );
  assert.deepEqual(unknown, {
    q: '',
    kind: 'all',
    tags: [],
    type: 'all',
    year: 'all',
    status: 'all',
  });
  assert.equal(filterCourses(courses, unknown).length, 3);
});

test('资料类型与年份筛选联动，访问要求参数被忽略', () => {
  const lectures = {
    id: 'lecture-1',
    type: 'lectures',
    title: '课件合集',
    authors: [],
    notes: '',
    coverage: { years: [], exam_kind: null, exam_form: null, has_solutions: null, evidence_url: null, note: '' },
    locations: [{ ...location('src-a', 'https://example.org/lecture'), access: 'login' }],
    verified_at: '2026-11-18',
  };
  const course = { ...structuredClone(threeYearsCourse), resources: [...structuredClone(threeYearsCourse.resources), lectures] };
  const schema = schemaFromCatalog(catalogFixture);

  const legacyType = parseFilters(new URLSearchParams({ type: 'lectures' }), schema);
  assert.equal(legacyType.type, 'study', '旧分享链接的 lectures 归到学习资料');
  assert.equal(filterCourses([course], legacyType).length, 1, '旧分类资料仍按 study 命中');
  const ignoredYear = parseFilters(new URLSearchParams({ type: 'lectures', year: '2025' }), schema);
  assert.equal(filterCourses([course], ignoredYear).length, 1);
  const ignoredAccess = parseFilters(new URLSearchParams({ access: 'login' }), schema);
  assert.equal('access' in ignoredAccess, false, '访问要求不再产生筛选维度');
  assert.equal(filterCourses([course], ignoredAccess).length, 1);
  assert.equal(
    filterCourses([course], parseFilters(new URLSearchParams({ type: 'exams', year: '2019' }), schema)).length,
    0,
  );
});

test('访问要求不再参与筛选，资料上的 access 字段保持原样', () => {
  const privateExam = examResource({
    id: 'private-2025',
    years: [2025],
    title: '2025 期末（需登录）',
    locations: [{ ...location('src-a', 'https://example.org/private-2025'), access: 'login' }],
  });
  const publicNotes = {
    ...lecturesResource(),
    id: 'notes-public',
    type: 'notes',
    title: '公开笔记',
    locations: [{ ...location('src-b', 'https://example.org/notes'), access: 'public' }],
  };
  const course = {
    code: 'CS2001',
    name: '数据结构',
    kind: 'professional',
    tags: [],
    resources: [privateExam, publicNotes],
  };
  const schema = schemaFromCatalog(catalogFixture);

  const accessOnly = parseFilters(new URLSearchParams({ access: 'public' }), schema);
  assert.equal('access' in accessOnly, false);
  assert.equal(filterCourses([course], accessOnly).length, 1, '访问要求不再过滤课程');
  assert.equal(course.resources[0].locations[0].access, 'login');
  assert.equal(course.resources[1].locations[0].access, 'public');

  assert.equal(
    filterCourses([course], parseFilters(new URLSearchParams({ type: 'exams', year: '2025' }), schema)).length,
    1,
    '资料类型与年份仍须由同一条资料同时满足',
  );
});

test('收录状态两项独立勾选：默认两项、单勾、双取消与旧链接语义', () => {
  const courses = [
    { code: 'A1', name: '甲课', kind: 'common', tags: [], resources: [examResource({ id: 'a1', years: [2025] })] },
    { code: 'B2', name: '乙课', kind: 'professional', tags: [], resources: [] },
  ];
  const schema = schemaFromCatalog(catalogFixture);

  const defaults = parseFilters(new URLSearchParams(), schema);
  assert.equal(defaults.status, 'all', '两项默认都勾选');
  assert.deepEqual(filterCourses(courses, defaults).map((course) => course.code), ['A1', 'B2']);

  const withOnly = parseFilters(new URLSearchParams({ status: 'with' }), schema);
  assert.equal(withOnly.status, 'with');
  assert.deepEqual(filterCourses(courses, withOnly).map((course) => course.code), ['A1']);

  const withoutOnly = parseFilters(new URLSearchParams({ status: 'without' }), schema);
  assert.equal(withoutOnly.status, 'without');
  assert.deepEqual(filterCourses(courses, withoutOnly).map((course) => course.code), ['B2']);

  const none = parseFilters(new URLSearchParams({ status: 'none' }), schema);
  assert.equal(none.status, 'none', '两项都取消是明确的空选状态');
  assert.deepEqual(filterCourses(courses, none), []);

  assert.equal(parseFilters(new URLSearchParams({ status: 'bogus' }), schema).status, 'all');

  assert.equal(serializeFilters({ status: 'all' }).toString(), '', '默认两项都勾选不写 URL');
  assert.equal(serializeFilters({ status: 'with' }).get('status'), 'with');
  assert.equal(serializeFilters({ status: 'without' }).get('status'), 'without');
  assert.equal(serializeFilters({ status: 'none' }).get('status'), 'none');
  assert.equal(parseFilters(serializeFilters({ status: 'none' }), schema).status, 'none');
});

test('旧 access 分享参数不再参与筛选，同步 URL 时被清除', () => {
  const schema = schemaFromCatalog(catalogFixture);
  const legacy = parseFilters(new URLSearchParams({ access: 'public', status: 'with' }), schema);
  assert.deepEqual(legacy, {
    q: '',
    kind: 'all',
    tags: [],
    type: 'all',
    year: 'all',
    status: 'with',
  });

  const params = serializeFilters(legacy, new URLSearchParams('access=public&status=without'));
  assert.equal(params.get('access'), null);
  assert.equal(params.get('status'), 'with');
});

test('分页：每页 50 门，页码收敛且不改变顺序', () => {
  const items = Array.from({ length: 120 }, (_, index) => ({ code: `C${index}` }));
  assert.equal(DEFAULT_PAGE_SIZE, 50);

  const first = paginate(items, 1);
  assert.equal(first.totalPages, 3);
  assert.equal(first.page, 1);
  assert.equal(first.items.length, 50);
  assert.equal(first.items[0].code, 'C0');

  const last = paginate(items, 3);
  assert.equal(last.items.length, 20);
  assert.equal(last.items[19].code, 'C119');

  assert.equal(paginate(items, 99).page, 3, '超出末页时收敛到末页');
  assert.equal(paginate(items, 0).page, 1, '小于首页时回到首页');

  const empty = paginate([], 1);
  assert.equal(empty.totalPages, 1);
  assert.equal(empty.page, 1);
  assert.deepEqual(empty.items, []);
});

test('首页筛选结构：顶栏圆按钮、单一清除叉、学科抽屉与收录状态复选', async () => {
  const html = await readFile(new URL('../site/index.html', import.meta.url), 'utf8');
  assert.match(html, /<p class="intro mode-detail">/);
  assert.match(html, /<div class="filter-groups mode-detail">/);
  assert.match(html, /<button type="button" id="tag-toggle" class="tag-drawer-toggle" aria-expanded="false" aria-controls="tag-drawer">/);
  assert.match(html, /<div id="tag-drawer" class="tag-drawer mode-detail" data-open="false" hidden>/);
  assert.match(html, /<div id="tag-options" class="tag-options" role="group" aria-labelledby="tag-group-label"><\/div>/);
  assert.match(html, /本站整理的学科标签，支持多选/);
  assert.match(html, /name="status" value="with" checked/);
  assert.match(html, /name="status" value="without" checked/);
  assert.doesNotMatch(html, /name="access"|id="access"/);
  assert.match(html, /id="clear-search"[^>]*aria-label="清除搜索与筛选"/);
  assert.doesNotMatch(html, /id="clear-filters"|id="no-results-clear"/);
  assert.match(html, /<nav id="pagination" class="pagination" aria-label="课程结果翻页" hidden>/);
  assert.match(
    html,
    /<button type="button" class="icon-circle-btn mode-icon-btn" data-mode-toggle aria-pressed="false" aria-label="切换简洁或详细模式" hidden>[\s\S]*<button type="button" class="icon-circle-btn theme-icon-btn" data-theme-toggle aria-label="切换外观主题" hidden>/,
  );
  assert.match(
    html,
    /<dl id="site-stats" class="site-stats" aria-label="访问统计" hidden>[\s\S]*<div class="stat-pill" data-stat-item="repo_views_14d" hidden>[\s\S]*<dt>仓库浏览（近 14 天）<\/dt>[\s\S]*<dd data-stat-value="repo_views_14d"><\/dd>[\s\S]*<div class="stat-pill" data-stat-item="site_total_views" hidden>[\s\S]*<dt>网站累计浏览<\/dt>[\s\S]*<dd data-stat-value="site_total_views"><\/dd>/,
  );
});

test('年份待确认与已确认年份分开筛选', () => {
  const unknownYear = examResource({ id: 'unknown-year', years: [], title: '年份不明试题' });
  const course = {
    code: 'HIST1001',
    name: '中国近现代史纲要',
    kind: 'general',
    tags: [],
    resources: [structuredClone(threeYearsCourse.resources[2]), unknownYear],
  };
  assert.deepEqual(courseExamYears(course), { years: [2025], unknown: true });

  const unknownFilters = parseFilters(new URLSearchParams({ type: 'exams', year: 'unknown' }), schemaFromCatalog(catalogFixture));
  const hits = filterCourses([course], unknownFilters);
  assert.equal(hits.length, 1);
  assert.equal(hits[0].resources.filter((resource) => resourceMatchesYear(resource, 'unknown')).length, 1);
  assert.deepEqual(allExamYears([course]), { years: [2025], unknown: true });
});

test('URLSearchParams 往返保持筛选条件，默认值不写入', () => {
  const filters = {
    q: '数学 分析',
    kind: 'common',
    tags: ['physics', 'math'],
    type: 'exams',
    year: '2020',
    status: 'with',
  };
  const params = serializeFilters(filters);
  assert.equal(params.get('q'), '数学 分析');
  assert.deepEqual(params.getAll('tag'), ['math', 'physics']);
  assert.equal(params.get('year'), '2020');

  const parsed = parseFilters(params, schemaFromCatalog(catalogFixture));
  assert.deepEqual(parsed, { ...filters, tags: ['math', 'physics'], q: '数学 分析' });

  const defaults = serializeFilters({ q: '', kind: 'all', tags: [], type: 'all', year: '2025', status: 'all' });
  assert.equal(defaults.toString(), '', '非试题类型不应写出 year');
});

test('详情排序：五类资料固定顺序，试题年份新到旧、未知最后', () => {
  const resources = [
    examResource({ id: 'e-unknown', years: [], title: '年份待确认' }),
    examResource({ id: 'e-2014', years: [2014] }),
    examResource({ id: 'e-2025', years: [2025] }),
    { ...lecturesResource(), id: 'l-1' },
    { ...lecturesResource(), id: 'b-1', type: 'books', title: '教材' },
    { ...lecturesResource(), id: 'p-1', type: 'projects', title: '大作业' },
    { ...lecturesResource(), id: 'h-1', type: 'homework', title: '作业' },
  ];
  const sorted = sortResources(resources);
  assert.deepEqual(sorted.map((resource) => resource.id), [
    'e-2025',
    'e-2014',
    'e-unknown',
    'h-1',
    'l-1',
    'b-1',
    'p-1',
  ]);

  const groups = groupResourcesByType(resources);
  assert.deepEqual(
    groups.map((group) => group.type),
    ['exams', 'homework', 'study', 'books', 'projects'],
  );
  assert.equal(groups.find((group) => group.type === 'exams').resources[2].id, 'e-unknown');
  assert.deepEqual(
    groups.find((group) => group.type === 'study').resources.map((resource) => resource.id),
    ['l-1'],
    '旧 lectures 归到学习资料',
  );
});

function lecturesResource() {
  return {
    id: 'lecture',
    type: 'lectures',
    title: '课件',
    authors: [],
    notes: '',
    coverage: { years: [], exam_kind: null, exam_form: null, has_solutions: null, evidence_url: null, note: '' },
    locations: [],
    verified_at: '2026-11-18',
  };
}

test('链接健康与过期判断', () => {
  const links = {
    'https://example.org/ok': {
      url: 'https://example.org/ok',
      status: 'reachable',
      http_status: 200,
      reason: null,
      checked_at: '2026-11-18T01:00:00.000Z',
      final_url: 'https://example.org/ok',
    },
    'https://example.org/gone': {
      url: 'https://example.org/gone',
      status: 'missing',
      http_status: 404,
      reason: 'HTTP 404',
      checked_at: '2026-11-01T01:00:00.000Z',
      final_url: 'https://example.org/gone',
    },
  };
  const linkLabels = {
    reachable: '可访问',
    missing: '无法找到',
    unknown: '无法自动确认',
    unchecked: '未检查',
  };
  assert.equal(healthLabel(linkHealth(links, 'https://example.org/ok').status, linkLabels), '可访问');
  assert.equal(healthLabel(linkHealth(links, 'https://example.org/gone').status, linkLabels), '无法找到');
  assert.equal(healthLabel(linkHealth(links, 'https://example.org/unchecked').status, linkLabels), '未检查');
  assert.equal(linkHealth(undefined, 'https://example.org/ok').status, 'unchecked');

  const now = Date.parse('2026-11-18T12:00:00.000Z');
  assert.equal(isStale('2026-11-18T01:00:00.000Z', now), false);
  assert.equal(isStale('2026-11-01T01:00:00.000Z', now), true);
  assert.equal(isStale(null, now), false);
});

test('外部链接只接受 http/https', () => {
  assert.equal(safeExternalUrl('https://example.org/a+b.pdf'), 'https://example.org/a+b.pdf');
  assert.equal(safeExternalUrl('http://example.org/'), 'http://example.org/');
  assert.equal(safeExternalUrl('javascript:alert(1)'), null);
  assert.equal(safeExternalUrl('data:text/html,hi'), null);
  assert.equal(safeExternalUrl('//example.org/x'), null);
  assert.equal(safeExternalUrl('/relative'), null);
  assert.equal(safeExternalUrl(''), null);
  assert.equal(healthLabel('unknown', {}), 'unknown');
  assert.deepEqual(resourceYears({ coverage: { years: [2025, 2014, 2025, 'nope'] } }), [2025, 2014]);
});

function studyFixture({ id = 'study-1', type = 'study', locations = [], coverage = {}, notes = '', title = '学习资料' } = {}) {
  return {
    id,
    type,
    title,
    authors: [],
    notes,
    coverage: {
      years: [],
      academic_years: [],
      exam_kind: null,
      exam_form: null,
      has_solutions: null,
      evidence_url: null,
      note: '',
      ...coverage,
    },
    locations,
    verified_at: '2026-11-18',
  };
}

function locationFixture({
  sourceId = 'src-a',
  pageUrl = null,
  downloadPage = null,
  downloadUrl = null,
  access = 'public',
  pageKind,
} = {}) {
  const item = {
    source_id: sourceId,
    page_url: pageUrl,
    download_page: downloadPage,
    download_url: downloadUrl,
    access,
    license_note: null,
    attribution: null,
  };
  if (pageKind !== undefined) item.page_kind = pageKind;
  return item;
}

test('五类资料枚举与旧分类映射', () => {
  assert.deepEqual(RESOURCE_TYPE_IDS, ['exams', 'homework', 'study', 'books', 'projects']);
  assert.deepEqual(PAGE_KIND_IDS, ['directory', 'file', 'page']);
  assert.deepEqual(LEGACY_RESOURCE_TYPE_IDS, {
    lectures: 'study',
    notes: 'study',
    open_book: 'study',
    guides: 'study',
  });
  for (const legacy of ['lectures', 'notes', 'open_book', 'guides']) {
    assert.equal(normalizeResourceType(legacy), 'study');
  }
  for (const type of RESOURCE_TYPE_IDS) assert.equal(normalizeResourceType(type), type);
  assert.equal(normalizeResourceType('bogus'), null);
  assert.equal(normalizeResourceType(undefined), null);

  const legacySchema = schemaFromCatalog({
    resource_types: [{ id: 'lectures' }, { id: 'notes' }, { id: 'exams' }],
  });
  assert.deepEqual(legacySchema.types, ['exams', 'study'], '旧目录 schema 归一到五类');
});

test('旧分享链接的 type 归到对应新类别并写回新参数', () => {
  const schema = schemaFromCatalog(catalogFixture);
  for (const [legacy, expected] of [
    ['lectures', 'study'],
    ['notes', 'study'],
    ['open_book', 'study'],
    ['guides', 'study'],
    ['homework', 'homework'],
    ['projects', 'projects'],
  ]) {
    const filters = parseFilters(new URLSearchParams({ type: legacy }), schema);
    assert.equal(filters.type, expected, `${legacy} → ${expected}`);
    assert.equal(serializeFilters(filters).get('type'), expected);
  }
  const legacyYear = parseFilters(new URLSearchParams({ type: 'notes', year: '2025' }), schema);
  assert.equal(legacyYear.type, 'study');
  assert.equal(legacyYear.year, 'all', '非试题分类不保留年份条件');
  assert.equal(serializeFilters({ type: 'lectures' }).get('type'), 'study', '写链接时用新分类 id');
});

test('学年区间只按学年展示，不折算成公历年', () => {
  assert.equal(normalizeAcademicYear('2025-2026'), '2025-2026');
  assert.equal(normalizeAcademicYear(' 2025-2026 '), '2025-2026');
  assert.equal(normalizeAcademicYear('2025-2027'), null, '结束年必须是开始年 + 1');
  assert.equal(normalizeAcademicYear('2025—2026'), null, '契约只接受 ASCII 连字符');
  assert.equal(normalizeAcademicYear('2025'), null);
  assert.equal(normalizeAcademicYear(20252026), null);
  assert.equal(formatAcademicYear('2025-2026'), '2025—2026 学年');
  assert.equal(formatAcademicYear('bad'), '');

  assert.deepEqual(
    resourceAcademicYears({ coverage: { academic_years: ['2024-2025', '2025-2026', '2024-2025', 'x'] } }),
    ['2025-2026', '2024-2025'],
  );
  assert.equal(
    resourceYearText({ coverage: { years: [], academic_years: ['2025-2026'] } }),
    '2025—2026 学年',
  );
  assert.equal(
    resourceYearText({ coverage: { years: [2024], academic_years: ['2025-2026'] } }),
    '2024 年',
    '有公历年时先展示公历年',
  );
  assert.equal(resourceYearText({ coverage: { years: [] } }), '年份待确认');
});

test('位置类型：数据的 page_kind 优先，缺失时按 URL 形态保守判断', () => {
  assert.equal(classifyUrlKind('https://github.com/u/r/tree/main/x'), 'directory');
  assert.equal(classifyUrlKind('https://github.com/u/r/blob/main/x.pdf'), 'file');
  assert.equal(classifyUrlKind('https://github.com/u/r'), 'page');
  assert.equal(classifyUrlKind('https://example.org/a/b.pdf'), 'file');
  assert.equal(classifyUrlKind('https://example.org/a/b.PDF?download=1'), 'file');
  assert.equal(
    classifyUrlKind('https://example.org/dir/'),
    'page',
    '末尾斜杠不足以证明是资料目录，按普通页面处理',
  );
  assert.equal(classifyUrlKind('https://example.org/course/123'), 'page');
  assert.equal(
    classifyUrlKind('https://share.feixu.site/计算机类/图论/2019年秋季学期图论期末试题.pdf/答案.pdf'),
    'directory',
    '嵌套 .pdf/ 路径是目录入口，不当作文件',
  );
  assert.equal(classifyUrlKind('javascript:alert(1)'), 'page');

  assert.equal(isDirectFileUrl('https://example.org/x.zip'), true);
  assert.equal(isDirectFileUrl('https://example.org/dir/'), false);
  assert.equal(isDirectFileUrl('https://example.org/download?id=1'), false);

  assert.equal(locationPageKind({ page_url: 'https://github.com/u/r/tree/main' }), 'directory');
  assert.equal(
    locationPageKind({ page_url: 'https://github.com/u/r/tree/main', page_kind: 'page' }),
    'page',
    '显式 page_kind 优先',
  );
  assert.equal(
    locationPageKind({ page_url: 'https://example.org/x.pdf', page_kind: 'directory' }),
    'directory',
  );
  assert.equal(locationPageKind({ page_url: null }), 'page');
});

test('位置链接：保留真实目标类型，合并下载网页文案并去重', () => {
  const mixed = locationLinkEntries({
    page_url: 'https://github.com/u/r/tree/main/x',
    download_url: 'https://raw.githubusercontent.com/u/r/main/x/a.pdf',
  });
  assert.deepEqual(
    mixed.map((entry) => [entry.label, entry.role]),
    [
      ['资料目录', 'page'],
      ['打开文件', 'download'],
    ],
  );

  const sameUrl = locationLinkEntries({
    page_url: 'https://example.org/a.pdf',
    download_url: 'https://example.org/a.pdf/',
  });
  assert.deepEqual(sameUrl.map(({ label, role }) => [label, role]), [['打开文件', 'download']]);

  const softPage = locationLinkEntries({ download_page: 'https://example.org/files/download' });
  assert.equal(softPage[0].label, '前往原站');
  const softDownload = locationLinkEntries({
    page_url: 'https://example.org/course/123',
    download_url: 'https://example.org/download?id=1',
  });
  assert.deepEqual(
    softDownload.map((entry) => entry.label),
    ['原始页面', '前往原站'],
    '非文件形态的 download_url 不标成打开文件',
  );

  const directoryDownload = locationLinkEntries({
    download_page: 'https://github.com/u/r/tree/main/files',
  });
  assert.deepEqual(
    directoryDownload.map((entry) => [entry.label, entry.role]),
    [['资料目录', 'download_page']],
    '目录不会被标成下载',
  );

  assert.equal(
    canonicalUrlKey('https://Example.org/a/b/'),
    canonicalUrlKey('https://example.org/a/b'),
  );
  assert.equal(
    canonicalUrlKey('https://example.org/%E8%AF%95.pdf'),
    canonicalUrlKey('https://example.org/试.pdf'),
  );
});

test('链接计划：简洁模式保留原始出处和文件直链，详情不重复', () => {
  const resource = studyFixture({
    locations: [
      locationFixture({
        sourceId: 'src-a',
        pageUrl: 'https://example.org/course/',
      }),
      locationFixture({
        sourceId: 'src-b',
        pageUrl: 'https://example.org/course/',
        downloadPage: 'https://example.org/course/download',
        downloadUrl: 'https://cdn.example.org/course/2019.pdf',
      }),
      locationFixture({
        sourceId: 'src-c',
        pageUrl: 'https://github.com/u/r/blob/main/2019.pdf',
      }),
    ],
  });

  const plan = resourceLinkPlan(resource);
  assert.equal(plan.compact.location.source_id, 'src-b');
  assert.equal(plan.compact.entry.label, '打开文件');
  assert.equal(plan.compact.entry.url, 'https://cdn.example.org/course/2019.pdf');
  assert.equal(plan.compact.original.location.source_id, 'src-a');
  assert.equal(plan.compact.original.entry.url, 'https://example.org/course/');

  const seen = new Set();
  for (const { entries } of plan.details) {
    for (const entry of entries) {
      assert.equal(seen.has(entry.key), false, '详情里的等价 URL 只出现一次');
      seen.add(entry.key);
    }
  }
  assert.equal(seen.size, 4);
  assert.deepEqual(plan.details.flatMap(({ entries }) => entries.map(({ label }) => label)),
    ['原始页面', '前往原站', '打开文件', '文件页面']);

  const onlyFile = resourceLinkPlan(
    studyFixture({
      locations: [
        locationFixture({
          pageUrl: 'https://example.org/x.pdf',
          downloadUrl: 'https://example.org/x.pdf',
        }),
      ],
    }),
  );
  assert.equal(onlyFile.details[0].entries.length, 1);
  assert.equal(onlyFile.compact.entry.label, '打开文件');
  assert.equal(onlyFile.compact.original, undefined);

  const pageOnly = resourceLinkPlan(
    studyFixture({ locations: [locationFixture({ pageUrl: 'https://github.com/u/r/blob/main/2019.pdf' })] }),
  );
  assert.equal(pageOnly.compact.entry.label, '文件页面');
});

test('简洁行摘要：试题与小测保留年份、卷别、形式与解答标记', () => {
  const labels = {
    examKind: new Map([
      ['final', '期末'],
      ['quiz', '小测'],
    ]),
    examForm: new Map([
      ['original', '原题'],
      ['recollection', '回忆版'],
      ['practice', '模拟练习'],
    ]),
  };

  assert.deepEqual(resourceFacts(examResource({ id: 'e', years: [2025] }), labels), ['2025 年', '期末']);
  const academicOnly = examResource({ id: 'a', years: [] });
  academicOnly.coverage.academic_years = ['2025-2026'];
  assert.deepEqual(resourceFacts(academicOnly, labels), ['2025—2026 学年', '期末']);
  assert.deepEqual(resourceFacts(examResource({ id: 'u', years: [] }), labels), [
    '年份待确认',
    '期末',
  ]);

  const quiz = studyFixture({
    type: 'homework',
    coverage: { years: [2024], exam_kind: 'quiz', exam_form: 'recollection', has_solutions: true },
  });
  assert.deepEqual(resourceFacts(quiz, labels), ['2024 年', '小测', '含解答']);
  assert.deepEqual(resourceMarkers(quiz, labels), ['回忆版']);

  const homework = studyFixture({ type: 'homework' });
  assert.deepEqual(resourceFacts(homework, labels), [], '普通作业不显示年份和卷别');
  assert.deepEqual(resourceMarkers(homework, labels), []);
  assert.deepEqual(resourceMarkers({ coverage: { exam_form: 'practice' } }, labels), ['模拟练习']);

  const accessLabels = new Map([
    ['public', '公开'],
    ['login', '需登录'],
  ]);
  assert.equal(accessMarker('login', { access: accessLabels }), '需登录');
  assert.equal(accessMarker('public', { access: accessLabels }), '');
  assert.equal(accessMarker('unknown', { access: accessLabels }), '');
  assert.equal(accessMarker(null), '');
});

test('说明文字不重复相同内容，互相包含时只保留更完整的一份', () => {
  assert.deepEqual(resourceNotes({ notes: '同样的说明', coverage: { note: '同样的说明' } }), {
    coverage: '同样的说明',
    extra: '',
  });
  assert.deepEqual(
    resourceNotes({ notes: '旧备注：未读正文；已核验卷头。', coverage: { note: '未读正文' } }),
    { coverage: '旧备注：未读正文；已核验卷头。', extra: '' },
  );
  assert.deepEqual(resourceNotes({ notes: '补充 A', coverage: { note: '覆盖 B' } }), {
    coverage: '覆盖 B',
    extra: '补充 A',
  });
  assert.deepEqual(resourceNotes({ notes: '   ', coverage: { note: '' } }), {
    coverage: '',
    extra: '',
  });
});

test('课程统计把旧分类计入学习资料', () => {
  const course = {
    code: 'X1',
    name: '统计',
    kind: 'common',
    tags: [],
    resources: [{ type: 'lectures' }, { type: 'notes' }, { type: 'exams' }],
  };
  const summary = courseSummary(course);
  assert.equal(summary.total, 3);
  assert.deepEqual(
    summary.types.map((entry) => [entry.type, entry.count]),
    [
      ['exams', 1],
      ['study', 2],
    ],
  );
});

test('课程详情页结构与模式脚本', async () => {
  const html = await readFile(new URL('../site/course.html', import.meta.url), 'utf8');
  assert.match(html, /<div id="resource-sections"><\/div>/);
  assert.match(html, /<section id="not-found" class="empty-state" hidden/);
  assert.match(
    html,
    /<button type="button" class="icon-circle-btn mode-icon-btn" data-mode-toggle aria-pressed="false" aria-label="切换简洁或详细模式" hidden>[\s\S]*<button type="button" class="icon-circle-btn theme-icon-btn" data-theme-toggle aria-label="切换外观主题" hidden>/,
  );
  assert.match(
    html,
    /<dl id="site-stats" class="site-stats" aria-label="访问统计" hidden>[\s\S]*<dt>仓库浏览（近 14 天）<\/dt>[\s\S]*<dd data-stat-value="repo_views_14d"><\/dd>[\s\S]*<dt>网站累计浏览<\/dt>[\s\S]*<dd data-stat-value="site_total_views"><\/dd>/,
  );
});

test('来源页预留统计槽位在无数据时隐藏、有数据时独立展示，并含双态模式开关', () => {
  const baseDataset = {
    courses: [{ code: 'CS1001', name: '示例课程' }],
    courseMetadata: { CS1001: { kind: 'common', tags: [] } },
    tags: [],
    resources: [],
    sources: [],
    monitoring: null,
  };
  const baseReport = {
    coverage: [],
    sources: [],
    generalLogs: [],
    courseLogs: [],
    unmappedLogs: [],
    blocked: [],
    incomplete: [],
    health: {},
    checkedAt: null,
    withResources: 0,
    withoutResources: 1,
    resources: 0,
    courseCount: 1,
    sourceCount: 0,
    usedSourceCount: 0,
    logCount: 0,
  };

  const emptyCatalog = buildCatalog(baseDataset);
  assert.deepEqual(emptyCatalog.stats, {
    repo_views_yesterday: null, repo_views_14d: null, site_views_yesterday: null,
    site_total_views: null, repo_views_date_utc: null, site_views_date_utc: null,
    collected_at: null, collected_at_beijing: null,
  });
  const emptyHtml = renderSourcesHtml({ ...baseReport, catalog: emptyCatalog });
  assert.match(emptyHtml, /<dl id="site-stats" class="site-stats" aria-label="访问统计" hidden>/);
  assert.match(
    emptyHtml,
    /<div class="stat-pill" data-stat-item="repo_views_14d" hidden>[\s\S]*<dt>仓库浏览（近 14 天）<\/dt>[\s\S]*<dd data-stat-value="repo_views_14d"><\/dd>/,
  );
  assert.match(
    emptyHtml,
    /<div class="stat-pill" data-stat-item="site_total_views" hidden>[\s\S]*<dt>网站累计浏览<\/dt>[\s\S]*<dd data-stat-value="site_total_views"><\/dd>/,
  );
  assert.match(
    emptyHtml,
    /<button type="button" class="icon-circle-btn mode-icon-btn" data-mode-toggle aria-pressed="false" aria-label="切换简洁或详细模式" hidden>[\s\S]*<button type="button" class="icon-circle-btn theme-icon-btn" data-theme-toggle aria-label="切换外观主题" hidden>/,
  );

  const filledCatalog = buildCatalog({
    ...baseDataset,
    monitoring: {
      links: [],
      repositories: {},
    },
    traffic: { repo_views_yesterday: 0, repo_views_14d: 1234, site_views_yesterday: 23, site_total_views: 5678,
      repo_views_date_utc: '2026-11-17', site_views_date_utc: '2026-11-17', collected_at: '2026-11-18T17:02:03.000Z' },
  });
  assert.deepEqual(filledCatalog.stats, {
    repo_views_yesterday: 0, repo_views_14d: 1234, site_views_yesterday: 23,
    site_total_views: 5678, repo_views_date_utc: '2026-11-17', site_views_date_utc: '2026-11-17',
    collected_at: '2026-11-18T17:02:03.000Z', collected_at_beijing: '2026-11-19 01:02:03',
  });
  const filledHtml = renderSourcesHtml({ ...baseReport, catalog: filledCatalog });
  assert.match(filledHtml, /<dl id="site-stats" class="site-stats" aria-label="访问统计">/);
  assert.match(filledHtml, /<dt>仓库昨日浏览（UTC） · 2026-11-17<\/dt>\s*<dd data-stat-value="repo_views_yesterday">0<\/dd>/);
  assert.match(filledHtml, /<time datetime="2026-11-18T17:02:03.000Z"[^>]*>2026-11-19 01:02:03<\/time>/);
  const missing = buildCatalog({ ...baseDataset, traffic: { repo_views_date_utc: '2026-11-17', site_views_date_utc: '2026-11-17' } });
  const missingHtml = renderSourcesHtml({ ...baseReport, catalog: missing });
  assert.match(missingHtml, /仓库昨日浏览（UTC） · 2026-11-17<\/dt>\s*<dd[^>]*>暂无数据<\/dd>/);
  assert.match(missingHtml, /网站昨日浏览（UTC） · 2026-11-17<\/dt>\s*<dd[^>]*>暂无数据<\/dd>/);
  assert.match(filledHtml, /<dt>网站昨日浏览（UTC） · 2026-11-17<\/dt>\s*<dd data-stat-value="site_views_yesterday">23<\/dd>/);
  assert.match(
    filledHtml,
    /<div class="stat-pill" data-stat-item="repo_views_14d">\s*<dt>仓库浏览（近 14 天）<\/dt>\s*<dd data-stat-value="repo_views_14d">1,234<\/dd>/,
  );
  assert.match(
    filledHtml,
    /<div class="stat-pill" data-stat-item="site_total_views">\s*<dt>网站累计浏览<\/dt>\s*<dd data-stat-value="site_total_views">5,678<\/dd>/,
  );
});

test('公告栏入口图标、配置数据与衍生项目边界', async () => {
  const indexHtml = await readFile(new URL('../site/index.html', import.meta.url), 'utf8');
  const courseHtml = await readFile(new URL('../site/course.html', import.meta.url), 'utf8');
  const readme = await readFile(new URL('../README.md', import.meta.url), 'utf8');
  const projectTemplate = await readFile(
    new URL('../.github/ISSUE_TEMPLATE/suggest-project.yml', import.meta.url),
    'utf8',
  );
  const emptyCatalog = buildCatalog({
    courses: [{ code: 'CS1001', name: '示例课程' }],
    courseMetadata: { CS1001: { kind: 'common', tags: [] } },
    tags: [],
    resources: [],
    sources: [],
    monitoring: null,
  });
  const sourcesHtml = renderSourcesHtml({
    coverage: [],
    sources: [],
    generalLogs: [],
    courseLogs: [],
    unmappedLogs: [],
    blocked: [],
    incomplete: [],
    health: {},
    checkedAt: null,
    withResources: 0,
    withoutResources: 1,
    resources: 0,
    courseCount: 1,
    sourceCount: 0,
    usedSourceCount: 0,
    logCount: 0,
    catalog: emptyCatalog,
  });

  const togglePattern =
    /<button type="button" class="icon-circle-btn announcement-toggle" aria-label="公告栏" title="公告栏" aria-haspopup="dialog" aria-expanded="false" aria-controls="announcements" hidden>[\s\S]*?<rect x="2\.75" y="6\.25" width="14\.5" height="10\.75" rx="2"><\/rect>/;
  assert.match(indexHtml, togglePattern);
  assert.match(courseHtml, togglePattern);
  assert.match(sourcesHtml, togglePattern);

  assert.equal(ANNOUNCEMENTS.news.length >= 2, true);
  assert.match(ANNOUNCEMENTS.news[0].title, /公告栏/);
  assert.match(ANNOUNCEMENTS.news.map((item) => item.summary).join('\n'), /2,782/);
  assert.equal(new Set(ANNOUNCEMENTS.news.map((item) => item.id)).size, ANNOUNCEMENTS.news.length);
  assert.match(ANNOUNCEMENTS.submitProjectUrl, /template=suggest-project\.yml$/);
  assert.equal(ANNOUNCEMENTS.projects.some((p) => p.name === 'USTC Question Bank' && p.author === 'DDNdles'), true);
  assert.doesNotMatch(readme, /## 基于本仓库做的项目/);
  assert.match(projectTemplate, /^name:\s*推荐衍生项目/m);
  assert.match(projectTemplate, /title:\s*'\[衍生项目\] '/);
  assert.match(projectTemplate, /id:\s*project-url/);
});