import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import {
  ACCESS_LABELS,
  COURSE_KIND_LABELS,
  DataFileError,
  DataValidationError,
  EXAM_FORM_LABELS,
  EXAM_KIND_LABELS,
  LINK_STATUS_LABELS,
  LOCATION_PAGE_KINDS,
  MONITORING_SCHEMA_VERSION,
  RESOURCE_TYPE_LABELS,
  RESOURCE_TYPES,
  ROOT,
  SEMESTER_TARGETS,
  TAG_IDS,
  buildPartitions,
  classifyCourseKind,
  computeResearchCoverage,
  createEmptyMonitoring,
  createPaths,
  decodeCourseCode,
  diffGeneratedManifest,
  encodeCourseCode,
  filterUndergraduateLessons,
  formatAcademicYearLabel,
  generatePartitionFiles,
  loadGeneratedManifest,
  loadRepository,
  loadResources,
  loadSources,
  mergeCourseRecords,
  mergeExactMirrors,
  normalizePageKind,
  parseAcademicYear,
  parsePublicHttpUrl,
  partitionPath,
  readJson,
  selectTargetSemesters,
  summarizeDataset,
  validateRepository,
  writeJsonAtomic,
} from '../scripts/lib/data.mjs';
import { buildCatalog } from '../scripts/build.mjs';

/* ------------------------------------------------------------------ */
/* Fixtures                                                            */
/* ------------------------------------------------------------------ */

const COURSES = [
  { code: '001001', name: '数学分析' },
  { code: '001002', name: '高等数学' },
  { code: 'CS0101', name: '计算机程序设计' },
  { code: 'PHYS1008B+', name: '大学物理B+' },
];

const CHANNELS = ['github', 'icourse', 'web'];
const CHANNEL_URLS = {
  github: 'https://github.com/search?q=USTC',
  icourse: 'https://icourse.club/search/?q=USTC',
  web: 'https://example.com/ustc-course',
};

function lesson(code, name, overrides = {}) {
  const education = overrides.education ?? '本科';
  const category = Object.prototype.hasOwnProperty.call(overrides, 'category')
    ? overrides.category
    : '专业选修';
  const gradation = Object.prototype.hasOwnProperty.call(overrides, 'gradation')
    ? overrides.gradation
    : '专业选修';
  const value = {
    course: code || name ? { code, cn: name } : null,
    education: education ? { cn: education } : null,
    courseCategory: category ? { cn: category } : null,
    courseGradation: gradation ? { cn: gradation } : null,
    graduateAndPostgraduate: overrides.graduateAndPostgraduate === true,
  };
  if (overrides.dropCourse) value.course = null;
  if (overrides.dropEducation) value.education = null;
  if (overrides.dropCategory) value.courseCategory = null;
  if (overrides.dropGradation) value.courseGradation = null;
  return value;
}

function makeSource(overrides = {}) {
  return {
    id: 'example-repo',
    name: '示例资料库',
    url: 'https://github.com/example/repo',
    maintainer: 'example',
    kind: 'repository',
    github: { owner: 'example', repo: 'repo', branch: 'main' },
    notes: '',
    ...overrides,
  };
}

function makeLocation(overrides = {}) {
  return {
    source_id: 'example-repo',
    page_url: 'https://github.com/example/repo/blob/main/exam.pdf',
    download_page: null,
    download_url: null,
    access: 'public',
    license_note: '未单独核验，不继承仓库根许可',
    attribution: 'example/repo',
    ...overrides,
  };
}

function makeResource(overrides = {}) {
  return {
    id: 'res-001',
    course_codes: ['001001'],
    type: 'exams',
    title: '2020 数学分析期末试卷',
    authors: ['某同学'],
    notes: '',
    coverage: {
      years: [2020],
      exam_kind: 'final',
      exam_form: 'original',
      has_solutions: false,
      evidence_url: 'https://example.com/exam/2020',
      note: '',
    },
    locations: [makeLocation()],
    verified_at: '2026-11-18',
    ...overrides,
  };
}

/** 无试题属性的资料覆盖（学习资料/教材/作业/项目默认形态）。 */
function plainCoverage(overrides = {}) {
  return {
    years: [],
    exam_kind: null,
    exam_form: null,
    has_solutions: null,
    evidence_url: null,
    note: '',
    ...overrides,
  };
}

function makeMetadata() {
  return {
    '001001': {
      kind: 'common',
      tags: ['math'],
      basis_url: 'https://catalog.ustc.edu.cn/query/lesson',
      basis_note: '官方本科开课：数学分析，课程层次通修。',
    },
    '001002': {
      kind: 'common',
      tags: ['math'],
      basis_url: 'https://catalog.ustc.edu.cn/query/lesson',
      basis_note: '官方本科开课：高等数学，课程层次通修。',
    },
    CS0101: {
      kind: 'professional',
      tags: ['cs'],
      basis_url: 'https://catalog.ustc.edu.cn/query/lesson',
      basis_note: '官方本科开课：计算机程序设计，课程层次专业选修。',
    },
    'PHYS1008B+': {
      kind: 'common',
      tags: ['physics'],
      basis_url: 'https://catalog.ustc.edu.cn/query/lesson',
      basis_note: '官方本科开课：大学物理B+，课程层次通修。',
    },
  };
}

function makeResearchLog() {
  const records = [];
  let index = 0;
  for (const course of COURSES) {
    for (const channel of CHANNELS) {
      index += 1;
      records.push({
        id: `log-${String(index).padStart(3, '0')}`,
        date: '2026-11-18',
        scope: 'course',
        channel,
        course_codes: [course.code],
        source_ids: [],
        query: `${course.code} ${course.name}`,
        url: CHANNEL_URLS[channel],
        checked_scope: '测试 fixture：实际检查记录占位',
        outcome: 'no_relevant_result',
        notes: '',
      });
    }
  }
  return records;
}

function validData() {
  return {
    courses: structuredClone(COURSES),
    courseMetadata: makeMetadata(),
    tags: [
      { id: 'math', label: '数学' },
      { id: 'physics', label: '物理' },
      { id: 'cs', label: '计算机' },
    ],
    resources: [],
    sources: [makeSource()],
    researchLog: makeResearchLog(),
    monitoring: createEmptyMonitoring(),
  };
}

async function writeFixture(t, { data = validData(), includeMonitoring = true } = {}) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'ustc-course-nav-'));
  t.after(async () => {
    await rm(root, { recursive: true, force: true });
  });
  const locations = createPaths(root);
  await mkdir(locations.dataDir, { recursive: true });
  const pairs = [
    [locations.courses, data.courses],
    [locations.courseMetadata, data.courseMetadata],
    [locations.tags, data.tags],
    [locations.resources, data.resources],
    [locations.sources, data.sources],
  ];
  for (const [file, value] of pairs) {
    await writeFile(file, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  }
  await writeFile(
    locations.researchLog,
    `${data.researchLog.map((record) => JSON.stringify(record)).join('\n')}\n`,
    'utf8',
  );
  if (includeMonitoring) {
    await writeFile(
      locations.monitoring,
      `${JSON.stringify(data.monitoring, null, 2)}\n`,
      'utf8',
    );
  }
  return { root, locations };
}

function messages(result, severity = 'error') {
  const key = severity === 'warning' ? 'warnings' : 'errors';
  return (result[key] ?? []).map((issue) => issue.message).join('\n');
}

/* ------------------------------------------------------------------ */
/* 采集筛选与归并                                                      */
/* ------------------------------------------------------------------ */

test('本科筛选：排除研究生，保留本科本研贯通，缺字段进 invalid', () => {
  const lessons = [
    lesson('001001', '数学分析', { gradation: '通修', graduateAndPostgraduate: true }),
    lesson('001002', '高等数学', { education: '研究生' }),
    lesson('CS0101', '计算机程序设计', { dropEducation: true }),
    lesson('', '缺课程代码', { dropCourse: true }),
  ];
  const filtered = filterUndergraduateLessons(lessons);
  assert.equal(filtered.total, 4);
  assert.equal(filtered.records.length, 1);
  assert.equal(filtered.records[0].code, '001001');
  assert.equal(filtered.records[0].graduateAndPostgraduate, true);
  assert.equal(filtered.skipped.length, 1);
  assert.equal(filtered.skipped[0].education, '研究生');
  assert.equal(filtered.invalid.length, 2);
  assert.deepEqual(filtered.invalid[0].problems, ['education.cn']);
  assert.ok(filtered.invalid[1].problems.includes('course.code'));
});

test('缺 courseCategory 或 courseGradation 即无效，不静默归为专业课', () => {
  const lessons = [
    lesson('001003', '缺课程类别', { dropCategory: true, gradation: '通修' }),
    lesson('001004', '缺课程层次', { dropGradation: true, category: '专业选修' }),
    lesson('001005', '空课程类别', { category: '' }),
  ];
  const filtered = filterUndergraduateLessons(lessons);
  assert.equal(filtered.records.length, 0);
  assert.deepEqual(
    filtered.invalid.map((item) => item.problems),
    [
      ['courseCategory.cn'],
      ['courseGradation.cn'],
      ['courseCategory.cn'],
    ],
  );

  const merged = mergeCourseRecords([
    { code: '20251', label: '2025秋', order: 0, lessons },
  ]);
  assert.equal(merged.courses.length, 0);
  assert.equal(merged.invalid.length, 3);
  assert.equal(merged.stats.invalid_count, 3);
});

test('同码跨学期去重取最新名称，同名不同码不合并', () => {
  const merged = mergeCourseRecords([
    {
      code: '20251',
      label: '2025秋',
      order: 0,
      lessons: [
        lesson('001001', '数学分析I', { gradation: '通修' }),
        lesson('001002', '同名课程'),
      ],
    },
    {
      code: '20261',
      label: '2026秋',
      order: 3,
      lessons: [
        lesson('001001', '数学分析II', { gradation: '通修' }),
        lesson('009999', '同名课程'),
      ],
    },
  ]);

  assert.equal(merged.courses.length, 3);
  assert.deepEqual(
    merged.courses.find((course) => course.code === '001001'),
    { code: '001001', name: '数学分析II' },
  );
  assert.ok(merged.courses.some((course) => course.code === '001002'));
  assert.ok(merged.courses.some((course) => course.code === '009999'));
  assert.equal(merged.nameChanges.length, 1);
  assert.equal(merged.nameChanges[0].current_name, '数学分析II');
  assert.deepEqual(merged.nameChanges[0].previous_names, ['数学分析I']);
  assert.equal(merged.conflicts.length, 0);
  assert.equal(merged.stats.merged_courses, 3);
});

test('同一学期同码异名或最终 kind 不同才冲突，不静默选择', () => {
  const merged = mergeCourseRecords([
    {
      code: '20251',
      label: '2025秋',
      order: 0,
      lessons: [
        lesson('001001', '数学分析I', { gradation: '通修' }),
        lesson('001001', '数学分析（新）', { gradation: '专业核心' }),
      ],
    },
  ]);
  assert.ok(merged.conflicts.some((conflict) => conflict.type === 'name'));
  assert.ok(merged.conflicts.some((conflict) => conflict.type === 'kind'));
  assert.equal(merged.courses.length, 1);
});

test('同码同 kind 的原始 category/gradation/贯通标记差异不拦截', () => {
  const merged = mergeCourseRecords([
    {
      code: '20251',
      label: '2025秋',
      order: 0,
      lessons: [
        lesson('001001', '数学分析', {
          category: '核心通识',
          gradation: '通修',
          graduateAndPostgraduate: true,
        }),
        lesson('001001', '数学分析', {
          category: '素能拓展课程',
          gradation: '专业选修',
          graduateAndPostgraduate: false,
        }),
      ],
    },
  ]);
  assert.equal(merged.conflicts.length, 0);
  assert.equal(merged.courses.length, 1);
  assert.equal(merged.coursesDetailed[0].kind, 'general');
});

test('同一学期同码完全重复记录只算一门且不报冲突', () => {
  const merged = mergeCourseRecords([
    {
      code: '20251',
      label: '2025秋',
      order: 0,
      lessons: [lesson('001001', '数学分析'), lesson('001001', '数学分析')],
    },
  ]);
  assert.equal(merged.courses.length, 1);
  assert.equal(merged.stats.semesters[0].undergraduate_lessons, 2);
  assert.equal(merged.stats.semesters[0].undergraduate_courses, 1);
  assert.equal(merged.conflicts.length, 0);
});

test('分类互斥且优先级：核心通识/素能拓展优先于通修，其余专业', () => {
  assert.equal(classifyCourseKind({ category: '核心通识', gradation: '通修' }), 'general');
  assert.equal(classifyCourseKind({ category: '素能拓展课程', gradation: '专业选修' }), 'general');
  assert.equal(classifyCourseKind({ category: null, gradation: '通修' }), 'common');
  assert.equal(classifyCourseKind({ category: '专业选修', gradation: '专业核心' }), 'professional');
  assert.equal(classifyCourseKind({ category: '', gradation: '' }), 'professional');
  assert.equal(COURSE_KIND_LABELS.general, '通识课');
});

test('目标学期只按固定 id/code 匹配，缺少即报告 missing', () => {
  const official = SEMESTER_TARGETS.map((target) => ({
    id: target.id,
    code: target.code,
    name: target.label,
  }));
  const { selected, missing } = selectTargetSemesters(
    [...official, { id: 999, code: '99999', name: '非目标学期' }],
  );
  assert.equal(selected.length, 4);
  assert.equal(missing.length, 0);
  assert.deepEqual(
    selected.map((semester) => semester.code),
    ['20251', '20252', '20253', '20261'],
  );

  const withoutSummer = selectTargetSemesters(
    official.filter((semester) => semester.code !== '20253'),
  );
  assert.deepEqual(withoutSummer.missing, [{ id: 441, code: '20253' }]);
  assert.equal(withoutSummer.selected.length, 3);
});

/* ------------------------------------------------------------------ */
/* 分区与课程代码                                                      */
/* ------------------------------------------------------------------ */

test('空资料→新增资料后分区迁移，课程始终恰好一个分区', () => {
  const data = validData();
  const before = buildPartitions(data);
  assert.equal(before.length, COURSES.length);
  assert.ok(before.every((entry) => entry.bucket === 'without-resources'));
  assert.ok(before.every((entry) => entry.resource_ids.length === 0));

  data.resources = [makeResource()];
  const after = buildPartitions(data);
  assert.equal(after.length, COURSES.length);
  const math = after.find((entry) => entry.code === '001001');
  assert.equal(math.bucket, 'with-resources');
  assert.deepEqual(math.resource_ids, ['res-001']);
  assert.equal(after.filter((entry) => entry.bucket === 'without-resources').length, 3);
  assert.equal(new Set(after.map((entry) => entry.code)).size, COURSES.length);

  const result = validateRepository(data);
  assert.equal(result.errors.length, 0, messages(result));
  assert.equal(result.stats.courses.withResources, 1);
  assert.equal(result.stats.courses.withoutResources, 3);
});

test('分区文件路径编码保留前导零和加号，清单可确定性复现', () => {
  assert.equal(encodeCourseCode('001001'), '001001');
  assert.equal(encodeCourseCode('PHYS1008B+'), 'PHYS1008B%2B');
  assert.equal(decodeCourseCode('PHYS1008B%2B'), 'PHYS1008B+');
  assert.equal(
    partitionPath({ bucket: 'with-resources', code: 'PHYS1008B+' }),
    'data/with-resources/PHYS1008B%2B.json',
  );
  assert.equal(
    partitionPath('without-resources', '001001'),
    'data/without-resources/001001.json',
  );

  const params = new URLSearchParams({ code: 'PHYS1008B+' });
  assert.equal(params.toString(), 'code=PHYS1008B%2B');
  assert.equal(params.get('code'), 'PHYS1008B+');

  const data = validData();
  data.resources = [makeResource({ course_codes: ['PHYS1008B+'] })];
  const generated = generatePartitionFiles(data);
  assert.equal(generated.manifest.files.length, COURSES.length);
  assert.ok(
    generated.manifest.files.includes('data/with-resources/PHYS1008B%2B.json'),
  );
  const phys = generated.files.find((file) =>
    file.path.endsWith('PHYS1008B%2B.json'),
  );
  assert.deepEqual(phys.data, {
    code: 'PHYS1008B+',
    name: '大学物理B+',
    kind: 'common',
    tags: ['physics'],
    resource_ids: ['res-001'],
  });
});

/* ------------------------------------------------------------------ */
/* 精确镜像合并                                                        */
/* ------------------------------------------------------------------ */

test('集中入口优先于已证实首发的分散入口，保留作者而不并列展示镜像', () => {
  const sha = 'a'.repeat(64);
  const first = makeResource({
    id: 'res-b',
    authors: ['B'],
    locations: [
      makeLocation({
        page_url: 'https://github.com/example/repo/blob/main/b.pdf',
        attribution: 'b',
      }),
    ],
  });
  const second = makeResource({
    id: 'res-a',
    authors: ['A'],
    locations: [
      makeLocation({
        page_url: 'https://github.com/example/repo/blob/main/a.pdf',
        attribution: 'a',
      }),
    ],
  });
  const result = mergeExactMirrors(
    [first, second],
    [
      { resource_id: 'res-b', sha, algorithm: 'sha256' },
      { resource_id: 'res-a', sha, algorithm: 'sha256' },
    ],
    new Map([['res-a', { centralized: true }], ['res-b', { primary: true }]]),
  );
  assert.equal(result.resources.length, 1);
  const kept = result.resources[0];
  assert.equal(kept.id, 'res-a');
  assert.deepEqual(kept.authors, ['A', 'B']);
  assert.deepEqual(kept.locations, second.locations);
  assert.deepEqual(result.merged, [{ kept_id: 'res-a', removed_ids: ['res-b'] }]);
  assert.deepEqual(result.conflicts, []);
});

test('同等集中度优先已证实的一手入口，Git blob 与短摘要不能触发合并', () => {
  const secondary = makeResource({ id: 'a-collection' });
  const primary = makeResource({ id: 'z-author' });
  const resources = [secondary, primary];
  const priority = new Map([
    [secondary.id, { centralized: true }],
    [primary.id, { centralized: true, primary: true }],
  ]);
  const evidence = (sha, algorithm) => resources.map(r => ({ resource_id: r.id, sha, algorithm }));
  const ranked = mergeExactMirrors(resources, evidence('a'.repeat(64), 'sha256'), priority);
  assert.deepEqual(ranked.merged, [{ kept_id: primary.id, removed_ids: [secondary.id] }]);
  for (const [sha, algorithm] of [['a'.repeat(64), 'git-blob'], ['a'.repeat(40), 'sha256']]) {
    assert.deepEqual(mergeExactMirrors(resources, evidence(sha, algorithm), priority).merged, []);
  }
});

test('mergeExactMirrors 同名不同 SHA 保留为两条', () => {
  const first = makeResource({ id: 'res-a', title: '同名试卷' });
  const second = makeResource({ id: 'res-b', title: '同名试卷' });
  const result = mergeExactMirrors(
    [first, second],
    [
      { resource_id: 'res-a', sha: 'a'.repeat(64), algorithm: 'sha256' },
      { resource_id: 'res-b', sha: 'b'.repeat(64), algorithm: 'sha256' },
    ],
  );
  assert.equal(result.resources.length, 2);
  assert.deepEqual(result.merged, []);
});

test('mergeExactMirrors 同年异卷保留为两条', () => {
  const first = makeResource({ id: 'res-a', title: '2020 期末 A 卷' });
  const second = makeResource({ id: 'res-b', title: '2020 期末 B 卷' });
  const result = mergeExactMirrors(
    [first, second],
    [
      { resource_id: 'res-a', sha: 'a'.repeat(64), algorithm: 'sha256' },
      { resource_id: 'res-b', sha: 'b'.repeat(64), algorithm: 'sha256' },
    ],
  );
  assert.equal(result.resources.length, 2);
  assert.deepEqual(result.merged, []);
});

test('mergeExactMirrors 课程归属不同不合', () => {
  const sha = 'c'.repeat(64);
  const first = makeResource({ id: 'res-a', course_codes: ['001001'] });
  const second = makeResource({ id: 'res-b', course_codes: ['001002'] });
  const result = mergeExactMirrors(
    [first, second],
    [
      { resource_id: 'res-a', sha, algorithm: 'sha256' },
      { resource_id: 'res-b', sha, algorithm: 'sha256' },
    ],
  );
  assert.equal(result.resources.length, 2);
  assert.deepEqual(result.merged, []);
});

test('mergeExactMirrors 同 SHA 但 coverage 年份/卷型/解答矛盾时拒绝合并并报告', () => {
  const sha = 'd'.repeat(64);
  const patches = [
    { years: [2021] },
    { exam_kind: 'midterm' },
    { has_solutions: true },
  ];
  for (const [index, patch] of patches.entries()) {
    const first = makeResource({ id: `conf-a-${index}` });
    const second = makeResource({
      id: `conf-b-${index}`,
      coverage: { ...first.coverage, ...patch },
    });
    const result = mergeExactMirrors(
      [first, second],
      [
        { resource_id: first.id, sha, algorithm: 'sha256' },
        { resource_id: second.id, sha, algorithm: 'sha256' },
      ],
    );
    assert.equal(result.resources.length, 2);
    assert.deepEqual(result.merged, []);
    assert.equal(result.conflicts.length, 1);
    assert.equal(result.conflicts[0].reason, 'coverage_mismatch');
    assert.deepEqual(
      result.conflicts[0].resource_ids,
      [first.id, second.id].sort(),
    );
  }
});

test('mergeExactMirrors 无证据不合并', () => {
  const first = makeResource({ id: 'res-a' });
  const second = makeResource({ id: 'res-b' });
  const result = mergeExactMirrors([first, second], []);
  assert.equal(result.resources.length, 2);
  assert.deepEqual(result.merged, []);
});

test('mergeExactMirrors 只按证据摘要+type+课程集合同组，算法/证据集合不同不合', () => {
  const sha = 'e'.repeat(64);
  const pair = (first, second) => [
    { resource_id: first.id, sha, algorithm: 'sha256' },
    { resource_id: second.id, sha, algorithm: 'sha256' },
  ];

  const typeFirst = makeResource({ id: 'type-a', type: 'exams' });
  const typeSecond = makeResource({ id: 'type-b', type: 'study' });
  const typeResult = mergeExactMirrors([typeFirst, typeSecond], pair(typeFirst, typeSecond));
  assert.equal(typeResult.resources.length, 2);
  assert.deepEqual(typeResult.merged, []);

  const codesFirst = makeResource({ id: 'codes-a', course_codes: ['001001', '001002'] });
  const codesSecond = makeResource({
    id: 'codes-b',
    course_codes: ['001002', '001001', '001001'],
  });
  const codesResult = mergeExactMirrors(
    [codesFirst, codesSecond],
    pair(codesFirst, codesSecond),
  );
  assert.deepEqual(codesResult.merged, [
    { kept_id: 'codes-a', removed_ids: ['codes-b'] },
  ]);

  const blobHash = makeResource({ id: 'algo-a' });
  const byteHash = makeResource({ id: 'algo-b' });
  const algoResult = mergeExactMirrors(
    [blobHash, byteHash],
    [
      { resource_id: 'algo-a', sha, algorithm: 'git-blob' },
      { resource_id: 'algo-b', sha, algorithm: 'sha256' },
    ],
  );
  assert.equal(algoResult.resources.length, 2);
  assert.deepEqual(algoResult.merged, []);

  const single = makeResource({ id: 'ev-a' });
  const doubled = makeResource({ id: 'ev-b' });
  const evidenceSetResult = mergeExactMirrors(
    [single, doubled],
    [
      { resource_id: 'ev-a', sha: '2'.repeat(64), algorithm: 'sha256' },
      { resource_id: 'ev-a', sha, algorithm: 'sha256' },
      { resource_id: 'ev-b', sha, algorithm: 'sha256' },
    ],
  );
  assert.equal(evidenceSetResult.resources.length, 2);
  assert.deepEqual(evidenceSetResult.merged, []);
});

test('mergeExactMirrors coverage 矛盾不跨签名合并，同签名精确镜像仍合并并报告冲突', () => {
  const sha = 'f'.repeat(64);
  const first = makeResource({ id: 'mix-a', verified_at: '2026-11-17' });
  const second = makeResource({ id: 'mix-b', verified_at: '2026-11-18' });
  const conflicting = makeResource({
    id: 'mix-c',
    coverage: { ...first.coverage, years: [2021] },
  });
  const result = mergeExactMirrors(
    [first, second, conflicting],
    [first, second, conflicting].map((resource) => ({
      resource_id: resource.id,
      sha,
      algorithm: 'sha256',
    })),
  );
  assert.equal(result.resources.length, 2);
  assert.equal(result.resources[0].id, 'mix-a');
  assert.equal(result.resources[0].locations.length, 1);
  assert.equal(result.resources[0].verified_at, '2026-11-18');
  assert.equal(result.resources[1].id, 'mix-c');
  assert.deepEqual(result.merged, [{ kept_id: 'mix-a', removed_ids: ['mix-b'] }]);
  assert.equal(result.conflicts.length, 1);
  assert.equal(result.conflicts[0].reason, 'coverage_mismatch');
  assert.deepEqual(result.conflicts[0].resource_ids, ['mix-a', 'mix-b', 'mix-c']);
});

/* ------------------------------------------------------------------ */
/* 严格校验                                                            */
/* ------------------------------------------------------------------ */

test('完整 fixture 通过校验且无警告', async (t) => {
  await writeFixture(t);
  const result = validateRepository(validData());
  assert.equal(result.errors.length, 0, messages(result));
  assert.equal(result.warnings.length, 0, messages(result, 'warning'));
  assert.equal(result.stats.courses.total, 4);
  assert.equal(result.stats.researchLog.coverage.complete, true);
});

test('未知枚举、重复 ID、悬空引用和空白必需值均失败', () => {
  {
    const data = validData();
    data.courses.push({ code: '001001', name: '重复课程' });
    const result = validateRepository(data);
    assert.match(messages(result), /课程代码重复/);
  }
  {
    const data = validData();
    data.courseMetadata.ZZZ = {
      kind: 'professional',
      tags: ['math'],
      basis_url: 'https://catalog.ustc.edu.cn/query/lesson',
      basis_note: '悬空',
    };
    const result = validateRepository(data);
    assert.match(messages(result), /悬空课程代码/);
  }
  {
    const data = validData();
    delete data.courseMetadata['001001'];
    const result = validateRepository(data);
    assert.match(messages(result), /缺少 course-metadata/);
  }
  {
    const data = validData();
    data.courseMetadata['001001'].kind = 'other';
    const result = validateRepository(data);
    assert.match(messages(result), /未知类别/);
  }
  {
    const data = validData();
    data.courseMetadata['001001'].tags = [];
    const result = validateRepository(data);
    assert.match(messages(result), /不能为空/);
  }
  {
    const data = validData();
    data.tags.push({ id: 'other', label: '其他' });
    const result = validateRepository(data);
    assert.match(messages(result), /禁止「其他\/other」标签/);
  }
  {
    const data = validData();
    data.courseMetadata['001001'].tags = ['other'];
    const result = validateRepository(data);
    assert.match(messages(result), /禁止「其他」标签/);
  }
  {
    const data = validData();
    data.tags.find((tag) => tag.id === 'math').label = '数学X';
    const result = validateRepository(data);
    assert.match(messages(result), /标签名称与固定枚举不一致/);
  }
  {
    const data = validData();
    data.resources = [makeResource({ course_codes: ['NOPE'] })];
    const result = validateRepository(data);
    assert.match(messages(result), /悬空课程代码/);
  }
  {
    const data = validData();
    const resource = makeResource();
    resource.locations[0].source_id = 'missing-source';
    data.resources = [resource];
    const result = validateRepository(data);
    assert.match(messages(result), /悬空来源/);
  }
  {
    const data = validData();
    data.sources = [makeSource({ kind: 'tool' })];
    data.resources = [makeResource()];
    const result = validateRepository(data);
    assert.match(messages(result), /工具或空壳，不能作为正式资料位置/);
  }
  {
    const data = validData();
    data.researchLog[0].course_codes = ['NOPE'];
    const result = validateRepository(data);
    assert.match(messages(result), /悬空课程代码/);
  }
  {
    const data = validData();
    data.monitoring.links = [
      {
        url: 'https://example.com/',
        status: 'green',
        http_status: 200,
        reason: 'ok',
        checked_at: '2026-11-18T00:00:00.000Z',
        final_url: null,
      },
    ];
    const result = validateRepository(data);
    assert.match(messages(result), /未知状态/);
  }
});

test('资料类型固定为五类，旧分类必须迁移', () => {
  assert.deepEqual([...RESOURCE_TYPES], [
    'exams',
    'homework',
    'study',
    'books',
    'projects',
  ]);
  assert.deepEqual(Object.keys(RESOURCE_TYPE_LABELS), [...RESOURCE_TYPES]);
  for (const legacy of ['lectures', 'notes', 'open_book', 'guides']) {
    const data = validData();
    data.resources = [makeResource({ type: legacy })];
    assert.match(messages(validateRepository(data)), /未知资料类型/);
  }
});

test('homework 保留小测元数据，exams 禁用 quiz，其余类别必须清空试题字段', () => {
  const data = validData();
  data.resources = [
    makeResource({
      id: 'hw-quiz',
      type: 'homework',
      title: '第 3 次课堂小测',
      coverage: plainCoverage({
        academic_years: ['2025-2026'],
        exam_kind: 'quiz',
        exam_form: 'recollection',
        has_solutions: true,
        note: '回忆版，含解答',
      }),
    }),
    makeResource({
      id: 'hw-plain',
      type: 'homework',
      title: '习题课作业',
      coverage: plainCoverage(),
    }),
  ];
  const result = validateRepository(data);
  assert.equal(result.errors.length, 0, messages(result));
  assert.equal(result.stats.resources.byType.homework, 2);

  const examsQuiz = validData();
  examsQuiz.resources = [
    makeResource({
      type: 'exams',
      coverage: { ...makeResource().coverage, exam_kind: 'quiz' },
    }),
  ];
  assert.match(messages(validateRepository(examsQuiz)), /小测归入 homework/);

  const homeworkMidterm = validData();
  homeworkMidterm.resources = [
    makeResource({
      type: 'homework',
      coverage: { ...makeResource().coverage, exam_kind: 'midterm' },
    }),
  ];
  assert.match(messages(validateRepository(homeworkMidterm)), /只能是 quiz 或 null/);

  const homeworkBadForm = validData();
  homeworkBadForm.resources = [
    makeResource({
      type: 'homework',
      coverage: plainCoverage({ exam_kind: 'quiz', exam_form: 'scan' }),
    }),
  ];
  assert.match(messages(validateRepository(homeworkBadForm)), /未知试题形式/);

  for (const type of ['study', 'books', 'projects']) {
    const invalid = validData();
    invalid.resources = [
      makeResource({
        type,
        coverage: plainCoverage({
          exam_kind: 'quiz',
          exam_form: 'unknown',
          has_solutions: false,
        }),
        ...(type === 'books'
          ? {
              locations: [
                makeLocation({
                  page_url: 'https://example.com/book.pdf',
                  download_url: 'https://example.com/book.pdf',
                }),
              ],
            }
          : {}),
      }),
    ];
    assert.match(
      messages(validateRepository(invalid)),
      /只有试题与小测作业/,
      type,
    );
  }
});

test('学年区间只接受 YYYY-YYYY 且不折算公历年', () => {
  assert.deepEqual(parseAcademicYear('2025-2026'), { start: 2025, end: 2026 });
  assert.equal(parseAcademicYear('2025-2027'), null);
  assert.equal(parseAcademicYear('25-26'), null);
  assert.equal(parseAcademicYear(2025), null);
  assert.equal(formatAcademicYearLabel('2025-2026'), '2025—2026 学年');
  assert.equal(formatAcademicYearLabel('bad'), '');

  const data = validData();
  data.resources = [
    makeResource({
      type: 'exams',
      coverage: {
        ...makeResource().coverage,
        years: [],
        academic_years: ['2024-2025', '2025-2026'],
      },
    }),
  ];
  assert.equal(validateRepository(data).errors.length, 0);

  const malformed = validData();
  malformed.resources = [
    makeResource({
      coverage: { ...makeResource().coverage, years: [], academic_years: ['2025-2027'] },
    }),
  ];
  assert.match(messages(validateRepository(malformed)), /学年必须是 ASCII 的 YYYY-YYYY/);

  const duplicate = validData();
  duplicate.resources = [
    makeResource({
      coverage: {
        ...makeResource().coverage,
        years: [],
        academic_years: ['2025-2026', '2025-2026'],
      },
    }),
  ];
  assert.match(messages(validateRepository(duplicate)), /学年重复/);
});

test('page_kind 可选，缺省为 page，非法值报错', () => {
  assert.deepEqual([...LOCATION_PAGE_KINDS], ['directory', 'file', 'page']);
  assert.equal(normalizePageKind(undefined), 'page');
  assert.equal(normalizePageKind(null), 'page');
  assert.equal(normalizePageKind('directory'), 'directory');
  assert.equal(normalizePageKind('video'), 'page');

  const data = validData();
  data.resources = [makeResource({ locations: [makeLocation({ page_kind: 'directory' })] })];
  assert.equal(validateRepository(data).errors.length, 0);

  const invalid = validData();
  invalid.resources = [makeResource({ locations: [makeLocation({ page_kind: 'archive' })] })];
  assert.match(messages(validateRepository(invalid)), /未知位置类型/);
});

test('教材与参考书必须是公开、免登录、免费的完整 PDF 直链', () => {
  const book = makeResource({
    id: 'book-open',
    type: 'books',
    title: '开放离散数学',
    coverage: plainCoverage(),
    locations: [
      makeLocation({
        page_url: 'https://example.com/books/discrete.pdf',
        download_url: 'https://example.com/books/discrete.pdf',
        page_kind: 'file',
      }),
    ],
  });
  const ok = validData();
  ok.resources = [book];
  const passed = validateRepository(ok);
  assert.equal(passed.errors.length, 0, messages(passed));

  const noPdf = validData();
  noPdf.resources = [
    {
      ...structuredClone(book),
      locations: [{ ...structuredClone(book.locations[0]), download_url: null }],
    },
  ];
  assert.match(messages(validateRepository(noPdf)), /公开直链完整 PDF/);

  for (const url of ['https://example.com/book.pdf/chapters', 'https://example.com/view?file=book.pdf']) {
    noPdf.resources[0].locations[0].download_url = url;
    assert.match(messages(validateRepository(noPdf)), /公开直链完整 PDF/);
  }

  const login = validData();
  login.resources = [
    {
      ...structuredClone(book),
      locations: [{ ...structuredClone(book.locations[0]), access: 'login' }],
    },
  ];
  const loginErrors = messages(validateRepository(login));
  assert.match(loginErrors, /只能登记权利方公开/);
  assert.match(loginErrors, /公开直链完整 PDF/);
});

test('catalog 下发五类枚举、学年与显式位置类型', () => {
  const data = validData();
  data.resources = [
    makeResource({ locations: [makeLocation({ page_kind: 'directory' })] }),
    makeResource({
      id: 'res-quiz',
      type: 'homework',
      title: '课堂小测',
      coverage: plainCoverage({
        academic_years: ['2025-2026'],
        exam_kind: 'quiz',
        exam_form: 'unknown',
      }),
    }),
  ];
  const catalog = buildCatalog(data);
  assert.deepEqual(
    catalog.resource_types.map((item) => item.id),
    ['exams', 'homework', 'study', 'books', 'projects'],
  );
  const course = catalog.courses.find((item) => item.code === '001001');
  const exam = course.resources.find((resource) => resource.id === 'res-001');
  assert.equal(exam.locations[0].page_kind, 'directory');
  const quiz = course.resources.find((resource) => resource.id === 'res-quiz');
  assert.deepEqual(quiz.coverage.academic_years, ['2025-2026']);
});

/* ------------------------------------------------------------------ */
/* 文件快照                                                            */
/* ------------------------------------------------------------------ */

const SNAPSHOT_SHA = 'c9a1ecd44feb9fa26d537eeed79985d9c0d10ea112b40c745e4e9f9524b3ff19';
const SOLUTION_SHA = 'f8219467dfb07ffa44c5de1bc51faee3aa8afc154d6f6b7deaf0b0691feacb11';

function makeSnapshot(overrides = {}) {
  return {
    sha256: SNAPSHOT_SHA,
    bytes: 241152,
    checked_at: '2026-11-19',
    ...overrides,
  };
}

/** 单条公开直链试卷；fileSnapshot 为 undefined 时不带 file_snapshot 字段。 */
function examWithSnapshot(fileSnapshot, locationOverrides = {}) {
  const data = validData();
  data.resources = [
    makeResource({
      locations: [
        makeLocation({
          page_url: 'https://example.com/exam/2020-final.pdf',
          download_url: 'https://example.com/exam/2020-final.pdf',
          page_kind: 'file',
          ...locationOverrides,
          ...(fileSnapshot === undefined ? {} : { file_snapshot: fileSnapshot }),
        }),
      ],
    }),
  ];
  return data;
}

test('评课登录原帖可下发多个摘要，但不能披露附件地址或混用公开快照', () => {
  const snapshots = [makeSnapshot(), makeSnapshot({ sha256: SOLUTION_SHA })];
  const location = {
    source_id: 'icourse-club', access: 'login', page_kind: 'page',
    page_url: 'https://icourse.club/course/123/#review-456',
    download_url: null, download_page: null, attachment_snapshots: snapshots,
  };
  const fixture = (overrides = {}) => {
    const data = examWithSnapshot(undefined, { ...location, ...overrides });
    data.sources.push({ ...data.sources[0], id: 'icourse-club' });
    return data;
  };
  const data = fixture();
  const valid = validateRepository(data);
  assert.equal(valid.errors.length, 0, messages(valid));
  const projected = buildCatalog(data).courses.find((course) => course.code === '001001')
    .resources[0].locations[0];
  assert.deepEqual(projected.attachment_snapshots, snapshots);
  assert.equal(projected.download_url, null);
  for (const overrides of [
    { source_id: data.sources[0].id }, { access: 'public' }, { page_kind: 'file' },
    { download_url: 'https://example.com/test.pdf' }, { download_page: 'https://example.com/files' },
    { page_url: 'https://icourse.club/course/123/' }, { file_snapshot: makeSnapshot() },
    { role: 'solution' }, { attachment_snapshots: [] },
    { attachment_snapshots: [snapshots[0], snapshots[0]] },
    { attachment_snapshots: [...snapshots].reverse() },
    { attachment_snapshots: [makeSnapshot({ url: 'https://example.com/file' })] },
    { attachment_snapshots: [makeSnapshot({ checked_at: '2026-02-30' })] },
  ]) {
    const invalid = validateRepository(fixture(overrides));
    assert.ok(invalid.errors.some((issue) => issue.path.includes('.attachment_snapshots')), JSON.stringify(overrides));
  }
});

test('公开直链的文件快照通过校验，目录按位置下发摘要且不虚构缺省快照', () => {
  const data = validData();
  data.resources = [
    makeResource({
      locations: [
        makeLocation({
          page_url: 'https://example.com/exam/2020-final.pdf',
          download_url: 'https://example.com/exam/2020-final.pdf',
          page_kind: 'file',
          file_snapshot: makeSnapshot(),
        }),
        makeLocation({
          page_url: 'https://example.com/exam/2020-notes',
          page_kind: 'page',
        }),
      ],
    }),
  ];
  const result = validateRepository(data);
  assert.equal(result.errors.length, 0, messages(result));

  const catalog = buildCatalog(data);
  const exam = catalog.courses.find((course) => course.code === '001001').resources[0];
  assert.deepEqual(exam.locations[0].file_snapshot, makeSnapshot());
  assert.deepEqual(Object.keys(exam.locations[0].file_snapshot).sort(), [
    'bytes',
    'checked_at',
    'sha256',
  ]);
  assert.ok(!('file_snapshot' in exam.locations[1]));
  assert.ok(!('role' in exam.locations[0]));
});

test('配套解答直链可带独立快照，目录仍区分主入口与解答', () => {
  const data = validData();
  data.resources = [
    makeResource({
      id: 'hw-001',
      type: 'homework',
      title: '2020 数学分析作业',
      coverage: plainCoverage({ years: [2020] }),
      locations: [
        makeLocation({
          page_url: 'https://example.com/hw/2020.pdf',
          download_url: 'https://example.com/hw/2020.pdf',
          page_kind: 'file',
          file_snapshot: makeSnapshot(),
        }),
        makeLocation({
          page_url: 'https://example.com/hw/2020-solution.pdf',
          download_url: 'https://example.com/hw/2020-solution.pdf',
          page_kind: 'file',
          role: 'solution',
          file_snapshot: makeSnapshot({ sha256: SOLUTION_SHA, bytes: 98304 }),
        }),
      ],
    }),
  ];
  const result = validateRepository(data);
  assert.equal(result.errors.length, 0, messages(result));

  const catalog = buildCatalog(data);
  const homework = catalog.courses.find((course) => course.code === '001001').resources[0];
  assert.equal(homework.locations[0].role, undefined);
  assert.equal(homework.locations[1].role, 'solution');
  assert.equal(homework.locations[0].file_snapshot.sha256, SNAPSHOT_SHA);
  assert.equal(homework.locations[1].file_snapshot.sha256, SOLUTION_SHA);
  assert.equal(homework.locations[1].file_snapshot.bytes, 98304);
});

test('文件快照拒绝短摘要、非法字节数、非法日期与多余字段', () => {
  const cases = [
    ['截断到 16 位', makeSnapshot({ sha256: SNAPSHOT_SHA.slice(0, 16) }), /完整的小写 SHA-256/],
    ['大写摘要', makeSnapshot({ sha256: SNAPSHOT_SHA.toUpperCase() }), /完整的小写 SHA-256/],
    ['字节数为 0', makeSnapshot({ bytes: 0 }), /文件字节数必须是正整数/],
    ['字节数非整数', makeSnapshot({ bytes: 12.5 }), /文件字节数必须是正整数/],
    ['日期格式错误', makeSnapshot({ checked_at: '2026/11/19' }), /取样日期/],
    ['多余字段', makeSnapshot({ etag: 'W/"abc"' }), /不允许的字段「etag」/],
  ];
  for (const [label, snapshot, pattern] of cases) {
    assert.match(messages(validateRepository(examWithSnapshot(snapshot))), pattern, label);
  }
  assert.match(messages(validateRepository(examWithSnapshot('abc'))), /文件快照必须是对象/);
});

test('文件快照只能附在免登录的公开直链上', () => {
  const snapshot = makeSnapshot();
  const missingDirect = messages(
    validateRepository(examWithSnapshot(snapshot, { download_url: null })),
  );
  assert.match(missingDirect, /文件快照必须对应免登录的文件直链/);

  const loginOnly = messages(
    validateRepository(examWithSnapshot(snapshot, { access: 'login' })),
  );
  assert.match(loginOnly, /文件快照必须对应免登录的文件直链/);

  const privateHost = messages(
    validateRepository(examWithSnapshot(snapshot, { download_url: 'http://127.0.0.1/exam.pdf' })),
  );
  assert.match(privateHost, /本机\/私网/);
});

test('研究三路径缺口默认警告，strict 时为错误；blocked 不算零结果', () => {
  const missing = validData();
  missing.researchLog = missing.researchLog.filter(
    (record) => !(record.course_codes[0] === '001001' && record.channel === 'web'),
  );
  const warned = validateRepository(missing);
  assert.equal(warned.errors.length, 0, messages(warned));
  assert.match(messages(warned, 'warning'), /缺少三路径检索记录/);
  const strict = validateRepository(missing, { requireResearchCoverage: true });
  assert.match(messages(strict), /缺少三路径检索记录/);
  assert.equal(strict.stats.researchLog.coverage.complete, false);
  assert.deepEqual(strict.stats.researchLog.coverage.missing[0].missing, ['web']);

  const blocked = validData();
  for (const record of blocked.researchLog) {
    if (record.course_codes[0] === '001001') record.outcome = 'blocked';
  }
  const coverage = computeResearchCoverage(blocked);
  assert.equal(coverage.complete, true);
  assert.deepEqual(coverage.blockedOnly, [{ code: '001001', name: '数学分析' }]);
});

test('研究路径终态：candidate/duplicate/tool/stub 不单独完成，reviewed+candidate 完成', () => {
  const candidateOnly = validData();
  for (const record of candidateOnly.researchLog) {
    if (record.course_codes[0] === '001001' && record.channel === 'web') {
      record.outcome = 'candidate';
    }
  }
  const coverage = computeResearchCoverage(candidateOnly);
  assert.equal(coverage.complete, false);
  assert.deepEqual(coverage.missing, [
    { code: '001001', name: '数学分析', missing: ['web'] },
  ]);
  assert.equal(coverage.byChannel.web, COURSES.length - 1);
  assert.equal(coverage.byOutcome.candidate, 1);
  assert.match(
    messages(validateRepository(candidateOnly, { requireResearchCoverage: true })),
    /缺少三路径检索记录/,
  );

  for (const outcome of ['duplicate', 'tool', 'stub']) {
    const data = validData();
    for (const record of data.researchLog) {
      if (record.course_codes[0] === '001001' && record.channel === 'github') {
        record.outcome = outcome;
      }
    }
    const result = computeResearchCoverage(data);
    assert.equal(result.complete, false, outcome);
    assert.deepEqual(result.missing[0].missing, ['github'], outcome);
  }

  const mixed = validData();
  for (const record of mixed.researchLog) {
    if (record.course_codes[0] === '001001' && record.channel === 'web') {
      record.outcome = 'reviewed';
    }
  }
  mixed.researchLog.push({
    id: 'log-extra-001',
    date: '2026-11-18',
    scope: 'course',
    channel: 'web',
    course_codes: ['001001'],
    source_ids: [],
    query: '001001 数学分析 USTC 资料',
    url: CHANNEL_URLS.web,
    checked_scope: '测试 fixture：同一路径先记候选，后实际查看',
    outcome: 'candidate',
    notes: '',
  });
  const mixedCoverage = computeResearchCoverage(mixed);
  assert.equal(mixedCoverage.complete, true);
  assert.equal(mixedCoverage.byChannel.web, COURSES.length);
});

test('monitoring 缺失/严格要求和 schema 约束', () => {
  const data = validData();
  data.monitoring = null;
  const relaxed = validateRepository(data);
  assert.equal(relaxed.errors.length, 0);
  assert.match(messages(relaxed, 'warning'), /尚未生成 monitoring\.json/);
  const strict = validateRepository(data, { requireMonitoring: true });
  assert.match(messages(strict), /缺少 monitoring\.json/);

  const invalid = validData();
  invalid.monitoring.schema_version = 2;
  invalid.monitoring.issue_number = '12';
  const invalidMonitoring = validateRepository(invalid);
  assert.ok(invalidMonitoring.errors.some((issue) => issue.path === 'schema_version'));
  assert.ok(invalidMonitoring.errors.some((issue) => issue.path === 'issue_number'));

  const duplicate = validData();
  duplicate.monitoring.links = [
    {
      url: 'https://example.com/',
      status: 'reachable',
      http_status: 200,
      reason: 'HTTP 200',
      checked_at: '2026-11-18T00:00:00.000Z',
      final_url: 'https://example.com/',
    },
    {
      url: 'https://example.com/',
      status: 'reachable',
      http_status: 200,
      reason: 'HTTP 200',
      checked_at: '2026-11-18T00:00:00.000Z',
      final_url: 'https://example.com/',
    },
  ];
  assert.match(messages(validateRepository(duplicate)), /链接重复/);

  const privateFinal = validData();
  privateFinal.monitoring.links = [
    {
      url: 'https://example.com/',
      status: 'unknown',
      http_status: null,
      reason: 'private_host',
      checked_at: '2026-11-18T00:00:00.000Z',
      final_url: 'http://127.0.0.1/',
    },
  ];
  assert.equal(validateRepository(privateFinal).errors.length, 0);
});

/* ------------------------------------------------------------------ */
/* 加载/写入/清单/URL                                                  */
/* ------------------------------------------------------------------ */

test('loadRepository 读取全部数据，monitoring 缺失为 null', async (t) => {
  const { root } = await writeFixture(t, { includeMonitoring: false });
  const dataset = loadRepository(root);
  assert.equal(dataset.courses.length, 4);
  assert.equal(dataset.courseMetadata['001001'].kind, 'common');
  assert.equal(dataset.tags.length, 3);
  assert.deepEqual(dataset.resources, []);
  assert.equal(dataset.sources.length, 1);
  assert.equal(dataset.researchLog.length, 12);
  assert.equal(dataset.monitoring, null);
});

test('loadSources/loadResources 返回已验证数组，非法资源抛 DataValidationError', async (t) => {
  const { root, locations } = await writeFixture(t);
  assert.equal(loadSources(root).length, 1);
  assert.deepEqual(loadResources(root), []);

  const resource = makeResource();
  resource.locations[0].source_id = 'missing-source';
  await writeJsonAtomic(locations.resources, [resource]);
  assert.throws(() => loadResources(root), DataValidationError);
});

test('readJson 仅 ENOENT 使用 fallback，解析错误仍抛出', async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'ustc-course-nav-json-'));
  t.after(async () => {
    await rm(root, { recursive: true, force: true });
  });
  const missing = path.join(root, 'missing.json');
  assert.deepEqual(readJson(missing, { fallback: true }), { fallback: true });
  assert.throws(() => readJson(missing), DataFileError);

  const broken = path.join(root, 'broken.json');
  await writeFile(broken, '{not json', 'utf8');
  assert.throws(() => readJson(broken, { fallback: true }), DataFileError);
});

test('writeJsonAtomic 输出两空格 JSON 加换行，generated 清单可读可 diff', async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'ustc-course-nav-write-'));
  t.after(async () => {
    await rm(root, { recursive: true, force: true });
  });
  const file = path.join(root, 'nested', 'value.json');
  writeJsonAtomic(file, { b: 1, a: 2 });
  assert.deepEqual(readJson(file), { b: 1, a: 2 });
  const text = await import('node:fs/promises').then((fs) => fs.readFile(file, 'utf8'));
  assert.equal(text, '{\n  "b": 1,\n  "a": 2\n}\n');

  assert.deepEqual(loadGeneratedManifest(root), []);
  const locations = createPaths(root);
  writeJsonAtomic(locations.generatedFiles, {
    files: ['data/with-resources/001001.json', 'data/without-resources/001002.json'],
  });
  assert.deepEqual(loadGeneratedManifest(root), [
    'data/with-resources/001001.json',
    'data/without-resources/001002.json',
  ]);
  assert.deepEqual(
    diffGeneratedManifest(
      ['data/a.json', 'data/b.json'],
      ['data/b.json', 'data/c.json'],
    ),
    {
      added: ['data/c.json'],
      removed: ['data/a.json'],
      unchanged: ['data/b.json'],
    },
  );
});

test('URL 只接受公开 http/https', () => {
  assert.ok(parsePublicHttpUrl('https://example.com/path'));
  assert.equal(parsePublicHttpUrl('ftp://example.com'), null);
  assert.equal(parsePublicHttpUrl('https://user:pass@example.com'), null);
  assert.equal(parsePublicHttpUrl('http://127.0.0.1:4173/'), null);
  assert.equal(parsePublicHttpUrl('http://[::1]/'), null);
  assert.equal(parsePublicHttpUrl('http://192.168.1.1/'), null);
  assert.equal(parsePublicHttpUrl('http://localhost/'), null);
});

test('枚举 labels 完整且有序', () => {
  assert.deepEqual(Object.keys(COURSE_KIND_LABELS), [
    'common',
    'general',
    'professional',
  ]);
  assert.equal(RESOURCE_TYPE_LABELS.exams, '试题与解析');
  assert.equal(RESOURCE_TYPE_LABELS.homework, '作业、习题与小测');
  assert.equal(RESOURCE_TYPE_LABELS.study, '学习资料');
  assert.equal(RESOURCE_TYPE_LABELS.books, '教材与参考书');
  assert.equal(RESOURCE_TYPE_LABELS.projects, '大作业与考核作品');
  assert.equal(ACCESS_LABELS.login, '需登录');
  assert.equal(EXAM_KIND_LABELS.unknown, '卷别待确认');
  assert.equal(EXAM_FORM_LABELS.recollection, '回忆版');
  assert.equal(LINK_STATUS_LABELS.unchecked, '未检查');
  assert.equal(MONITORING_SCHEMA_VERSION, 1);
  assert.equal(TAG_IDS.length, 36);
  assert.equal(new Set(TAG_IDS).size, TAG_IDS.length);
  assert.ok(!TAG_IDS.includes('other'));
});

test('summarizeDataset 统计分区、类型与监控状态且不抛', () => {
  const data = validData();
  data.resources = [makeResource()];
  data.monitoring.links = [
    {
      url: 'https://example.com/',
      status: 'reachable',
      http_status: 200,
      reason: 'HTTP 200',
      checked_at: '2026-11-18T00:00:00.000Z',
      final_url: 'https://example.com/',
    },
  ];
  const stats = summarizeDataset(data);
  assert.equal(stats.courses.total, 4);
  assert.equal(stats.courses.withResources, 1);
  assert.equal(stats.resources.byType.exams, 1);
  assert.deepEqual(Object.keys(stats.resources.byType), [...RESOURCE_TYPES]);
  assert.equal(stats.monitoring.linkStatuses.reachable, 1);
  assert.equal(stats.researchLog.coverage.complete, true);
  assert.ok(path.isAbsolute(ROOT));
});
