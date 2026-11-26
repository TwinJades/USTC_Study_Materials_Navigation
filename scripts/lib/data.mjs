/**
 * 单一数据契约：路径、枚举、加载、严格校验、采集归并、分区。
 *
 * 本模块不联网，不写正式数据。相对路径一律相对仓库根解析。
 */

import { fileURLToPath } from 'node:url';
import path from 'node:path';
import {
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';

const MODULE_DIR = path.dirname(fileURLToPath(import.meta.url));

export const ROOT = path.resolve(MODULE_DIR, '..', '..');
export const DATA_DIR = path.join(ROOT, 'data');
export const MONITORING_SCHEMA_VERSION = 1;

/**
 * 仓库内固定数据位置。全部为绝对路径，便于脚本直接使用。
 */
export function createPaths(root = ROOT) {
  const repoRoot = path.resolve(root);
  const dataDir = path.join(repoRoot, 'data');
  return Object.freeze({
    root: repoRoot,
    dataDir,
    courses: path.join(dataDir, 'courses.json'),
    courseMetadata: path.join(dataDir, 'course-metadata.json'),
    tags: path.join(dataDir, 'tags.json'),
    resources: path.join(dataDir, 'resources.json'),
    sources: path.join(dataDir, 'sources.json'),
    researchLog: path.join(dataDir, 'research-log.jsonl'),
    monitoring: path.join(dataDir, 'monitoring.json'),
    generatedFiles: path.join(dataDir, 'generated-files.json'),
    withResourcesDir: path.join(dataDir, 'with-resources'),
    withoutResourcesDir: path.join(dataDir, 'without-resources'),
  });
}

export const paths = createPaths(ROOT);

export const COURSE_KINDS = Object.freeze(['common', 'general', 'professional']);
export const COURSE_KIND_LABELS = Object.freeze({
  common: '通修课',
  general: '通识课',
  professional: '专业课',
});

export const RESOURCE_TYPES = Object.freeze([
  'exams',
  'homework',
  'study',
  'books',
  'projects',
]);
export const RESOURCE_TYPE_LABELS = Object.freeze({
  exams: '试题与解析',
  homework: '作业、习题与小测',
  study: '学习资料',
  books: '教材与参考书',
  projects: '大作业与考核作品',
});

export const ACCESS_LEVELS = Object.freeze([
  'public',
  'login',
  'campus',
  'paid',
  'unknown',
]);
export const ACCESS_LABELS = Object.freeze({
  public: '公开',
  login: '需登录',
  campus: '校园网',
  paid: '付费',
  unknown: '待确认',
});

export const EXAM_KINDS = Object.freeze([
  'midterm',
  'final',
  'quiz',
  'mixed',
  'unknown',
]);
export const EXAM_KIND_LABELS = Object.freeze({
  midterm: '期中',
  final: '期末',
  quiz: '小测',
  mixed: '期中期末混合',
  unknown: '卷别待确认',
});

export const EXAM_FORMS = Object.freeze([
  'original',
  'recollection',
  'practice',
  'unknown',
]);
export const EXAM_FORM_LABELS = Object.freeze({
  original: '原题',
  recollection: '回忆版',
  practice: '模拟练习',
  unknown: '待确认',
});

/**
 * 资料位置类型：目录、具体文件页、原始页面。旧数据缺省视为 page。
 * 目录或页面不得被当成可下载文件；只有 download_url 才代表直接下载入口。
 */
export const LOCATION_PAGE_KINDS = Object.freeze(['directory', 'file', 'page']);
export const PAGE_KIND_LABELS = Object.freeze({
  directory: '资料目录',
  file: '文件页面',
  page: '原始页面',
});

export function normalizePageKind(value) {
  return LOCATION_PAGE_KINDS.includes(value) ? value : 'page';
}

const ACADEMIC_YEAR_PATTERN = /^(20\d{2})-(20\d{2})$/;

/**
 * 校验学年区间字符串 `YYYY-YYYY`（ASCII 连字符），结束年必须是开始年 + 1。
 * 返回 {start,end} 或 null。学年不等于公历年，不得自行折算。
 */
export function parseAcademicYear(value) {
  if (typeof value !== 'string') return null;
  const match = ACADEMIC_YEAR_PATTERN.exec(value);
  if (!match) return null;
  const start = Number(match[1]);
  const end = Number(match[2]);
  return end === start + 1 ? { start, end } : null;
}

/** 展示用：ASCII `2025-2026` → `2025—2026 学年`；非法输入返回空串。 */
export function formatAcademicYearLabel(value) {
  const parsed = parseAcademicYear(value);
  return parsed ? `${parsed.start}—${parsed.end} 学年` : '';
}

export const SOURCE_KINDS = Object.freeze([
  'repository',
  'website',
  'index',
  'tool',
  'stub',
  'mirror',
]);
export const SOURCE_KIND_LABELS = Object.freeze({
  repository: '资料库',
  website: '网站',
  index: '索引',
  tool: '工具',
  stub: '占位页',
  mirror: '镜像',
});

export const RESEARCH_SCOPES = Object.freeze(['source', 'course', 'query']);
export const RESEARCH_CHANNELS = Object.freeze([
  'github',
  'icourse',
  'web',
  'catalog',
]);
export const RESEARCH_OUTCOMES = Object.freeze([
  'reviewed',
  'no_relevant_result',
  'candidate',
  'duplicate',
  'tool',
  'stub',
  'blocked',
]);
export const RESEARCH_OUTCOME_LABELS = Object.freeze({
  reviewed: '已查看',
  no_relevant_result: '无相关结果',
  candidate: '待核验',
  duplicate: '重复或镜像',
  tool: '工具',
  stub: '暂无内容',
  blocked: '访问受限',
});

/**
 * 只有这些终态能支撑「该路径已完成首轮检索」。
 * candidate/duplicate/tool/stub 仍保留在日志与统计中，但不能单独算完成。
 */
export const RESEARCH_TERMINAL_OUTCOMES = Object.freeze([
  'reviewed',
  'no_relevant_result',
  'blocked',
]);

export const LINK_STATUSES = Object.freeze([
  'reachable',
  'missing',
  'unknown',
  'unchecked',
]);
export const LINK_STATUS_LABELS = Object.freeze({
  reachable: '可访问',
  missing: '无法找到',
  unknown: '无法自动确认',
  unchecked: '未检查',
});

export const ENUM_LABELS = Object.freeze({
  kind: COURSE_KIND_LABELS,
  resourceType: RESOURCE_TYPE_LABELS,
  access: ACCESS_LABELS,
  examKind: EXAM_KIND_LABELS,
  examForm: EXAM_FORM_LABELS,
  pageKind: PAGE_KIND_LABELS,
});

/**
 * 固定学科标签。hint 只用于研究工作，不是自动分类规则。
 * 标签必须按课程内容判定，不得按学院/代码前缀整院盲标。
 */
export const TAG_DEFINITIONS = Object.freeze(
  [
    ['math', '数学', '数学分析、高等代数、几何、微分方程、复变、泛函、拓扑、数论'],
    ['statistics', '统计', '概率论、数理统计、随机过程、回归、时间序列'],
    ['physics', '物理', '普通物理、量子力学、电动力学、光学、原子物理'],
    ['astronomy', '天文', '天文、天体、宇宙学、观测'],
    ['earth', '地球科学', '地质、地球物理、地球化学、大气、海洋'],
    ['space', '空间科学', '空间、等离子体、太阳、行星'],
    ['chemistry', '化学', '无机、有机、分析、物理化学、结构化学、高分子'],
    ['materials', '材料', '材料科学、材料物理、材料化学、材料加工'],
    ['biology', '生命科学', '生物、细胞、遗传、生态、生理、微生物、系统生物学'],
    ['medicine', '医学', '临床、解剖、药理、病理、免疫'],
    ['biomedical', '生物医学工程', '生物医学工程、医学影像、生物材料、神经工程'],
    ['environment', '环境', '环境科学、环境污染、生态修复、水处理'],
    ['mechanics', '力学', '理论力学、材料力学、流体力学、弹性力学'],
    ['instruments', '机械与仪器', '机械、仪器、测量、传感器、工程制图'],
    ['thermal', '热能', '热力学、传热、燃烧、制冷、热工'],
    ['safety', '安全', '安全科学、火灾、风险评估、应急'],
    ['nuclear', '核科学', '核物理、辐射、反应堆、核技术'],
    ['electronics', '电子', '电路、模拟电子、数字电子、电子系统'],
    ['communications', '通信', '通信、信号与系统、电磁场、微波、信息论'],
    ['control', '自动化', '自动控制、控制理论、机器人、过程控制'],
    ['ic', '集成电路', '集成电路、芯片、EDA、半导体器件、VLSI'],
    ['cs', '计算机', '程序设计、数据结构、算法、操作系统、编译、数据库、网络'],
    ['ai', '人工智能', '人工智能、机器学习、深度学习、模式识别、自然语言处理、计算机视觉'],
    ['security', '网络安全', '网络安全、密码学、信息安全、系统安全'],
    ['economics', '经济', '经济学、微观、宏观、计量、博弈论'],
    ['finance', '金融', '金融、投资、公司理财、金融工程、保险'],
    ['management', '管理', '管理、运筹、组织、市场营销、会计'],
    ['philosophy', '哲学', '哲学、逻辑、伦理、美学、科技哲学'],
    ['history', '历史', '历史、史学、考古'],
    ['literature', '文学', '文学、小说、诗歌、比较文学'],
    ['arts', '艺术', '艺术、音乐、美术、设计、戏剧'],
    ['languages', '外语', '英语、日语、德语、法语、俄语、翻译'],
    ['sports', '体育', '体育、运动、健身、球类'],
    ['politics', '思政', '思政、马克思主义、中国特色社会主义、思想道德'],
    ['psychology', '心理', '心理、认知、社会心理、发展心理'],
    ['innovation', '创新创业', '创新创业、创业、创新管理'],
  ].map(([id, label, hint]) => Object.freeze({ id, label, hint })),
);

export const TAG_IDS = Object.freeze(TAG_DEFINITIONS.map((tag) => tag.id));
export const TAG_LABELS = Object.freeze(
  Object.fromEntries(TAG_DEFINITIONS.map((tag) => [tag.id, tag.label])),
);
const TAG_BY_ID = new Map(TAG_DEFINITIONS.map((tag) => [tag.id, tag]));

export const SEMESTER_TARGETS = Object.freeze([
  Object.freeze({ id: 401, code: '20251', label: '2025秋', order: 0 }),
  Object.freeze({ id: 421, code: '20252', label: '2026春', order: 1 }),
  Object.freeze({ id: 441, code: '20253', label: '2026夏', order: 2 }),
  Object.freeze({ id: 461, code: '20261', label: '2026秋', order: 3 }),
]);

export const CATALOG_BASE_URL = 'https://catalog.ustc.edu.cn';
export const COURSE_QUERY_URL = `${CATALOG_BASE_URL}/query/lesson`;

const COURSE_KIND_SET = new Set(COURSE_KINDS);
const RESOURCE_TYPE_SET = new Set(RESOURCE_TYPES);
const ACCESS_SET = new Set(ACCESS_LEVELS);
const EXAM_KIND_SET = new Set(EXAM_KINDS);
const EXAM_FORM_SET = new Set(EXAM_FORMS);
const SOURCE_KIND_SET = new Set(SOURCE_KINDS);
const RESEARCH_SCOPE_SET = new Set(RESEARCH_SCOPES);
const RESEARCH_CHANNEL_SET = new Set(RESEARCH_CHANNELS);
const RESEARCH_OUTCOME_SET = new Set(RESEARCH_OUTCOMES);
const RESEARCH_TERMINAL_SET = new Set(RESEARCH_TERMINAL_OUTCOMES);
const LINK_STATUS_SET = new Set(LINK_STATUSES);
const LOCATION_PAGE_KIND_SET = new Set(LOCATION_PAGE_KINDS);
// 与 scripts/lib/github.mjs 的 treeToFiles 一致：基线只记录文件 blob 与子模块 commit。
const GIT_OBJECT_TYPES = new Set(['blob', 'commit']);
const GENERAL_CATEGORIES = new Set(['核心通识', '素能拓展课程']);
const RESEARCH_PATH_CHANNELS = Object.freeze(['github', 'icourse', 'web']);

/* ------------------------------------------------------------------ */
/* 错误与通用工具                                                      */
/* ------------------------------------------------------------------ */

export class DataFileError extends Error {
  constructor(file, message, cause) {
    super(`${file}: ${message}`, { cause });
    this.name = 'DataFileError';
    this.file = file;
  }
}

export class DataValidationError extends Error {
  constructor(issues, message = '数据校验失败') {
    const errors = (issues ?? []).filter((issue) => issue.severity === 'error');
    const first = errors.slice(0, 5).map(formatIssue).join('\n');
    super(errors.length ? `${message}（${errors.length} 项错误）\n${first}` : message);
    this.name = 'DataValidationError';
    this.issues = issues ?? [];
  }
}

export function formatIssue(issue) {
  const location = [issue.file, issue.path].filter(Boolean).join(' ');
  return `${issue.severity === 'warning' ? '警告' : '错误'} ${location}: ${issue.message}`;
}

export function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function makeCollector() {
  return {
    errors: [],
    warnings: [],
    error(file, pathText, message) {
      this.errors.push({ severity: 'error', file, path: pathText ?? '', message });
    },
    warn(file, pathText, message) {
      this.warnings.push({ severity: 'warning', file, path: pathText ?? '', message });
    },
  };
}

function checkExactKeys(value, allowed, file, pathText, collector) {
  if (!isPlainObject(value)) return;
  const allowedSet = new Set(allowed);
  for (const key of Object.keys(value)) {
    if (!allowedSet.has(key)) {
      collector.error(file, pathText, `不允许的字段「${key}」`);
    }
  }
}

function requireString(value, file, pathText, label, collector, { allowEmpty = false } = {}) {
  if (typeof value !== 'string') {
    collector.error(file, pathText, `${label}必须是字符串`);
    return null;
  }
  if (value !== value.trim()) {
    collector.error(file, pathText, `${label}不能包含首尾空白`);
    return null;
  }
  if (!allowEmpty && value.length === 0) {
    collector.error(file, pathText, `${label}不能为空`);
    return null;
  }
  return value;
}

function requireStringArray(value, file, pathText, label, collector, { allowEmpty = true } = {}) {
  if (!Array.isArray(value)) {
    collector.error(file, pathText, `${label}必须是数组`);
    return null;
  }
  if (!allowEmpty && value.length === 0) {
    collector.error(file, pathText, `${label}不能为空`);
    return null;
  }
  const seen = new Set();
  for (let i = 0; i < value.length; i += 1) {
    const itemPath = `${pathText}[${i}]`;
    if (typeof value[i] !== 'string' || value[i].trim() === '') {
      collector.error(file, itemPath, `${label}的元素必须是不为空的字符串`);
      continue;
    }
    if (value[i] !== value[i].trim()) {
      collector.error(file, itemPath, `${label}的元素不能包含首尾空白`);
    }
    if (seen.has(value[i])) {
      collector.error(file, itemPath, `${label}存在重复值「${value[i]}」`);
    }
    seen.add(value[i]);
  }
  return value;
}

function isIsoDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function isIsoDateTime(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T/.test(value)) return false;
  return !Number.isNaN(new Date(value).getTime());
}

function isHexSha(value) {
  return typeof value === 'string' && /^[0-9a-f]{40}$|^[0-9a-f]{64}$/i.test(value);
}

function isPrivateIpv4(host) {
  const match = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!match) return false;
  const octets = match.slice(1).map(Number);
  if (octets.some((part) => part > 255)) return true;
  const [a, b] = octets;
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168)
  );
}

function isPrivateIpv6(host) {
  const value = host.replace(/^\[|\]$/g, '').toLowerCase();
  if (value === '::' || value === '::1') return true;
  if (/^f[cd][0-9a-f]{0,2}:/.test(value)) return true;
  if (/^fe[89ab][0-9a-f]?:/.test(value)) return true;
  const mapped = value.match(/^::ffff:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/);
  return mapped ? isPrivateIpv4(mapped[1]) : false;
}

/**
 * 只接受公开 http/https URL：拒绝账号密码、localhost、私网、链路本地。
 * 返回 URL 对象；不合法返回 null。
 */
export function parsePublicHttpUrl(value) {
  if (typeof value !== 'string' || value.length === 0 || value !== value.trim()) return null;
  let url;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
  if (url.username || url.password) return null;
  const host = url.hostname.toLowerCase().replace(/\.$/, '');
  if (!host) return null;
  if (
    host === 'localhost' ||
    host.endsWith('.localhost') ||
    host.endsWith('.local') ||
    host.endsWith('.internal') ||
    host.endsWith('.home.arpa')
  ) {
    return null;
  }
  if (host.includes(':') ? isPrivateIpv6(host) : isPrivateIpv4(host)) return null;
  return url;
}

export function isPublicHttpUrl(value) {
  return parsePublicHttpUrl(value) !== null;
}

function requirePublicUrl(value, file, pathText, label, collector, { allowNull = false } = {}) {
  if (value === null && allowNull) return null;
  const url = parsePublicHttpUrl(value);
  if (!url) {
    collector.error(file, pathText, `${label}必须是公开 http/https URL，且不能含账号密码或指向本机/私网`);
    return null;
  }
  return url;
}

function resolveFilePath(filePath) {
  return path.isAbsolute(filePath) ? filePath : path.resolve(ROOT, filePath);
}

/**
 * 严格读取 JSON。仅在文件不存在且显式传入 fallback 时返回 fallback；
 * 解析错误、权限错误等一律抛出。
 */
export function readJson(filePath, fallbackValue) {
  const hasFallback = arguments.length >= 2;
  const absolute = resolveFilePath(filePath);
  let text;
  try {
    text = readFileSync(absolute, 'utf8');
  } catch (error) {
    if (error?.code === 'ENOENT' && hasFallback) return fallbackValue;
    throw new DataFileError(absolute, `读取失败：${error?.message ?? error}`, error);
  }
  try {
    return JSON.parse(text.replace(/^\uFEFF/, ''));
  } catch (error) {
    throw new DataFileError(absolute, `JSON 解析失败：${error?.message ?? error}`, error);
  }
}

/**
 * 确定性 JSON 写入：两空格缩进 + 换行，同目录临时文件后 rename。
 */
export function writeJsonAtomic(filePath, value) {
  const absolute = resolveFilePath(filePath);
  mkdirSync(path.dirname(absolute), { recursive: true });
  const temporary = path.join(
    path.dirname(absolute),
    `.${path.basename(absolute)}.${process.pid}.${Date.now()}.tmp`,
  );
  try {
    writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
    renameSync(temporary, absolute);
  } catch (error) {
    try {
      rmSync(temporary, { force: true });
    } catch {
      // 忽略清理错误，保留原始失败。
    }
    throw error;
  }
  return absolute;
}

function readResearchLogFile(absolute) {
  let text;
  try {
    text = readFileSync(absolute, 'utf8');
  } catch (error) {
    throw new DataFileError(absolute, `读取失败：${error?.message ?? error}`, error);
  }
  const rows = [];
  const lines = text.replace(/^\uFEFF/, '').split(/\r?\n/);
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index].trim();
    if (!line) continue;
    try {
      rows.push(JSON.parse(line));
    } catch (error) {
      throw new DataFileError(
        `${absolute}:${index + 1}`,
        `JSONL 解析失败：${error?.message ?? error}`,
        error,
      );
    }
  }
  return rows;
}

/* ------------------------------------------------------------------ */
/* 加载                                                                 */
/* ------------------------------------------------------------------ */

/**
 * 加载全部核心数据。monitoring 缺失时为 null（监控首次运行前允许）。
 */
export function loadRepository(root = ROOT) {
  const locations = createPaths(root);
  return {
    courses: readJson(locations.courses),
    courseMetadata: readJson(locations.courseMetadata),
    tags: readJson(locations.tags),
    resources: readJson(locations.resources),
    sources: readJson(locations.sources),
    researchLog: readResearchLogFile(locations.researchLog),
    monitoring: readJson(locations.monitoring, null),
  };
}

export function createEmptyMonitoring() {
  return {
    schema_version: MONITORING_SCHEMA_VERSION,
    checked_at: null,
    links: [],
    repositories: {},
    issue_number: null,
  };
}

/**
 * 只加载并校验来源数组。适合监控脚本，不要求课程/元数据完整。
 */
export function loadSources(root = ROOT) {
  const locations = createPaths(root);
  const value = readJson(locations.sources);
  const collector = makeCollector();
  validateSourcesList(value, collector);
  if (collector.errors.length) throw new DataValidationError(collector.errors, '来源数据校验失败');
  return value;
}

/**
 * 只加载并校验资料数组及其来源引用。适合监控脚本，不要求课程元数据完整。
 */
export function loadResources(root = ROOT) {
  const locations = createPaths(root);
  const sources = loadSources(root);
  const value = readJson(locations.resources);
  const collector = makeCollector();
  const sourcesById = new Map(
    Array.isArray(sources)
      ? sources.filter(isPlainObject).map((source) => [source.id, source])
      : [],
  );
  validateResourcesList(value, collector, {
    sourcesById,
    courseByCode: null,
    checkCourseRefs: false,
  });
  if (collector.errors.length) throw new DataValidationError(collector.errors, '资料数据校验失败');
  return value;
}

/**
 * 读取 generated-files.json 中由构建维护的仓库相对路径清单。
 * 文件不存在返回 []；格式错误抛出。
 */
export function loadGeneratedManifest(root = ROOT) {
  const locations = createPaths(root);
  const value = readJson(locations.generatedFiles, { files: [] });
  const files = Array.isArray(value) ? value : value?.files;
  if (!Array.isArray(files) || files.some((entry) => typeof entry !== 'string')) {
    throw new DataFileError(locations.generatedFiles, 'generated-files.json 必须是 {files: string[]}');
  }
  return [...files];
}

export function diffGeneratedManifest(previousFiles, nextFiles) {
  const previous = new Set(previousFiles ?? []);
  const next = new Set(nextFiles ?? []);
  return {
    added: [...next].filter((file) => !previous.has(file)).sort(),
    removed: [...previous].filter((file) => !next.has(file)).sort(),
    unchanged: [...next].filter((file) => previous.has(file)).sort(),
  };
}

/* ------------------------------------------------------------------ */
/* 官方开课采集的纯函数                                                */
/* ------------------------------------------------------------------ */

function readCn(value) {
  if (typeof value === 'string') return normalizeCn(value);
  if (isPlainObject(value) && typeof value.cn === 'string') return normalizeCn(value.cn);
  return null;
}

function normalizeCn(value) {
  return typeof value === 'string' ? value.normalize('NFKC').trim() : '';
}

/**
 * 将官方开课记录解析为课程归属所需的最小字段。不保留教师、教学班、人数。
 */
export function describeLesson(lesson) {
  const course = isPlainObject(lesson?.course) ? lesson.course : null;
  const code = typeof course?.code === 'string' ? course.code.trim() : '';
  const name = typeof course?.cn === 'string' ? course.cn.trim() : '';
  const education = readCn(lesson?.education);
  const categoryValue = readCn(lesson?.courseCategory);
  const gradationValue = readCn(lesson?.courseGradation);
  const category = categoryValue || null;
  const gradation = gradationValue || null;
  const problems = [];
  if (!code) problems.push('course.code');
  if (!name) problems.push('course.cn');
  if (!education) problems.push('education.cn');
  // 分类字段是 kind 的唯一依据；缺失时必须拒绝，不能静默落到 professional。
  if (!categoryValue) problems.push('courseCategory.cn');
  if (!gradationValue) problems.push('courseGradation.cn');
  return {
    code,
    name,
    education,
    category,
    gradation,
    graduateAndPostgraduate: lesson?.graduateAndPostgraduate === true,
    problems,
  };
}

/**
 * 只保留 education.cn === 「本科」。本研贯通（graduateAndPostgraduate=true）仍保留。
 */
export function filterUndergraduateLessons(lessons) {
  const records = [];
  const invalid = [];
  const skipped = [];
  const input = Array.isArray(lessons) ? lessons : [];
  for (let index = 0; index < input.length; index += 1) {
    const description = describeLesson(input[index]);
    if (description.problems.length) {
      invalid.push({
        lesson_index: index,
        code: description.code || null,
        problems: description.problems,
      });
      continue;
    }
    if (description.education !== '本科') {
      skipped.push({
        education: description.education,
        graduateAndPostgraduate: description.graduateAndPostgraduate,
      });
      continue;
    }
    records.push(description);
  }
  return { records, invalid, skipped, total: input.length };
}

/**
 * 三类互斥且完备：核心通识/素能拓展课程 → general；其余通修 → common；其余 → professional。
 */
export function classifyCourseKind({ category, gradation } = {}) {
  const categoryName = normalizeCn(category);
  const gradationName = normalizeCn(gradation);
  if (GENERAL_CATEGORIES.has(categoryName)) return 'general';
  if (gradationName === '通修') return 'common';
  return 'professional';
}

function basisNote(semester, description) {
  const category = description.category ?? '未标注';
  const gradation = description.gradation ?? '未标注';
  const gap = description.graduateAndPostgraduate ? '；本研贯通' : '';
  return `依据${semester.label ?? semester.code}（${semester.code}）官方本科开课记录：课程类别「${category}」，课程层次「${gradation}」${gap}。`;
}

function uniqueInOrder(values) {
  const seen = new Set();
  const result = [];
  for (const value of values) {
    if (!seen.has(value)) {
      seen.add(value);
      result.push(value);
    }
  }
  return result;
}

/**
 * 合并多学期官方记录。入参按时间从旧到新排列：
 * [{id,code,label,lessons:[...]}]
 *
 * 只按 code 精确去重；同名不同码保留；最新学期名称与分类生效。
 * 同一学期同码异名/异分类记为 conflict，采集脚本据此拒绝覆盖。
 */
export function mergeCourseRecords(semesters, options = {}) {
  const semesterList = Array.isArray(semesters) ? semesters : [];
  const occurrences = new Map();
  const conflicts = [];
  const invalid = [];
  const semesterStats = [];
  const skippedEducation = new Map();

  for (const semester of semesterList) {
    const code = String(semester?.code ?? '');
    const label = semester?.label ?? code;
    const filtered = filterUndergraduateLessons(semester?.lessons);
    const byCode = new Map();

    for (const problem of filtered.invalid) {
      invalid.push({ semester_code: code, ...problem });
    }
    for (const skip of filtered.skipped) {
      skippedEducation.set(skip.education, (skippedEducation.get(skip.education) ?? 0) + 1);
    }

    for (const record of filtered.records) {
      const occurrence = {
        semester_code: code,
        semester_label: label,
        semester_order: Number.isInteger(semester?.order) ? semester.order : semesterStats.length,
        ...record,
      };
      const existing = occurrences.get(record.code) ?? [];
      existing.push(occurrence);
      occurrences.set(record.code, existing);
      if (!byCode.has(record.code)) byCode.set(record.code, []);
      byCode.get(record.code).push(occurrence);
    }

    for (const [courseCode, records] of byCode) {
      const names = new Set(records.map((record) => record.name));
      // 只有名称或最终 kind 冲突才需要官方人工核验。
      // 原始 category/gradation 文本不同但映射到同一 kind 时，不拦截采集。
      const kinds = new Set(records.map((record) => classifyCourseKind(record)));
      const evidence = records.map((record) => ({
        semester_code: record.semester_code,
        semester_label: record.semester_label,
        name: record.name,
        category: record.category,
        gradation: record.gradation,
        kind: classifyCourseKind(record),
        graduateAndPostgraduate: record.graduateAndPostgraduate,
      }));
      if (names.size > 1) {
        conflicts.push({
          type: 'name',
          semester_code: code,
          code: courseCode,
          values: [...names],
          records: evidence,
        });
      }
      if (kinds.size > 1) {
        conflicts.push({
          type: 'kind',
          semester_code: code,
          code: courseCode,
          values: [...kinds],
          records: evidence,
        });
      }
    }

    semesterStats.push({
      code,
      label,
      total_lessons: filtered.total,
      undergraduate_lessons: filtered.records.length,
      undergraduate_courses: byCode.size,
      skipped_by_education: filtered.skipped.length,
      invalid_lessons: filtered.invalid.length,
    });
  }

  const coursesDetailed = [];
  const nameChanges = [];
  const classificationChanges = [];

  for (const [code, records] of occurrences) {
    const sorted = records
      .map((record, index) => ({ ...record, _index: index }))
      .sort((a, b) =>
        a.semester_order === b.semester_order
          ? a._index - b._index
          : a.semester_order - b.semester_order,
      );
    const latest = sorted[sorted.length - 1];
    const names = uniqueInOrder(sorted.map((record) => record.name));
    if (names.length > 1) {
      nameChanges.push({
        code,
        current_name: latest.name,
        previous_names: names.filter((name) => name !== latest.name),
        semesters: sorted
          .filter((record) => record.name !== latest.name)
          .map((record) => ({ code: record.semester_code, label: record.semester_label, name: record.name })),
      });
    }

    const classifications = uniqueInOrder(
      sorted.map((record) => `${record.category ?? ''}\u0000${record.gradation ?? ''}`),
    );
    if (classifications.length > 1) {
      classificationChanges.push({
        code,
        current: { category: latest.category, gradation: latest.gradation },
        history: sorted.map((record) => ({
          semester_code: record.semester_code,
          semester_label: record.semester_label,
          category: record.category,
          gradation: record.gradation,
        })),
      });
    }

    const kind = classifyCourseKind(latest);
    coursesDetailed.push({
      code,
      name: latest.name,
      kind,
      basis_url: COURSE_QUERY_URL,
      basis_note: basisNote(
        { code: latest.semester_code, label: latest.semester_label },
        latest,
      ),
      semester_code: latest.semester_code,
      semester_label: latest.semester_label,
      category: latest.category,
      gradation: latest.gradation,
      graduateAndPostgraduate: latest.graduateAndPostgraduate,
    });
  }

  coursesDetailed.sort((a, b) => (a.code < b.code ? -1 : a.code > b.code ? 1 : 0));

  return {
    courses: coursesDetailed.map(({ code, name }) => ({ code, name })),
    coursesDetailed,
    nameChanges,
    classificationChanges,
    conflicts,
    invalid,
    stats: {
      semesters: semesterStats,
      merged_courses: coursesDetailed.length,
      skipped_by_education: Object.fromEntries([...skippedEducation.entries()].sort()),
      conflict_count: conflicts.length,
      invalid_count: invalid.length,
      name_change_count: nameChanges.length,
      classification_change_count: classificationChanges.length,
    },
  };
}

/**
 * 供研究阶段填标签的元数据草稿。tags 故意留空，必须逐课按内容判定后填写。
 */
export function createMetadataDraft(mergeResult) {
  const draft = {};
  for (const course of mergeResult?.coursesDetailed ?? []) {
    draft[course.code] = {
      kind: course.kind,
      tags: [],
      basis_url: course.basis_url,
      basis_note: course.basis_note,
    };
  }
  return draft;
}

/**
 * 从官方 semester/list 响应中定位四个固定目标学期。
 * 缺少任一目标即返回 missing，不自动采用其它学期。
 */
export function selectTargetSemesters(semesterList, targets = SEMESTER_TARGETS) {
  const list = Array.isArray(semesterList) ? semesterList : [];
  const selected = [];
  const missing = [];
  for (const target of targets) {
    const match = list.find(
      (entry) =>
        isPlainObject(entry) &&
        String(entry.id) === String(target.id) &&
        String(entry.code) === String(target.code),
    );
    if (!match) {
      missing.push({ id: target.id, code: target.code });
      continue;
    }
    selected.push({
      id: target.id,
      code: target.code,
      order: target.order,
      label:
        (typeof match.name === 'string' && match.name.trim()) ||
        (typeof match.cn === 'string' && match.cn.trim()) ||
        (typeof match.title === 'string' && match.title.trim()) ||
        target.label,
    });
  }
  return { selected, missing };
}


/* ------------------------------------------------------------------ */
/* 分区                                                                 */
/* ------------------------------------------------------------------ */

export function encodeCourseCode(code) {
  return encodeURIComponent(String(code));
}

export function decodeCourseCode(value) {
  try {
    return decodeURIComponent(String(value));
  } catch {
    return null;
  }
}

export function partitionPath(partitionOrBucket, code) {
  let bucket = partitionOrBucket;
  let courseCode = code;
  if (isPlainObject(partitionOrBucket)) {
    bucket = partitionOrBucket.bucket;
    courseCode = partitionOrBucket.code;
  }
  if (bucket !== 'with-resources' && bucket !== 'without-resources') {
    throw new Error(`未知分区：${String(bucket)}`);
  }
  if (typeof courseCode !== 'string' || courseCode.length === 0) {
    throw new Error('分区缺少课程代码');
  }
  return `data/${bucket}/${encodeURIComponent(courseCode)}.json`;
}

/**
 * 每门课程恰好一个分区，按 code 排序。资料只要确认挂到该课程即进入 with-resources。
 */
export function buildPartitions(dataset) {
  const courses = Array.isArray(dataset?.courses) ? dataset.courses : [];
  const courseMetadata = isPlainObject(dataset?.courseMetadata)
    ? dataset.courseMetadata
    : {};
  const resources = Array.isArray(dataset?.resources) ? dataset.resources : [];

  const resourceIdsByCourse = new Map();
  for (const resource of resources) {
    if (!isPlainObject(resource) || !Array.isArray(resource.course_codes)) continue;
    for (const code of resource.course_codes) {
      if (typeof code !== 'string') continue;
      if (!resourceIdsByCourse.has(code)) resourceIdsByCourse.set(code, new Set());
      resourceIdsByCourse.get(code).add(resource.id);
    }
  }

  return courses
    .map((course) => {
      const metadata = courseMetadata[course.code];
      if (!isPlainObject(metadata)) {
        throw new Error(`课程 ${course.code} 缺少 course-metadata 记录，无法分区`);
      }
      if (!COURSE_KIND_SET.has(metadata.kind)) {
        throw new Error(`课程 ${course.code} 的 kind 非法：${String(metadata.kind)}`);
      }
      if (!Array.isArray(metadata.tags)) {
        throw new Error(`课程 ${course.code} 的 tags 必须是数组`);
      }
      const resourceIds = [...(resourceIdsByCourse.get(course.code) ?? [])]
        .filter((id) => typeof id === 'string' && id.length > 0)
        .sort();
      return {
        bucket: resourceIds.length ? 'with-resources' : 'without-resources',
        code: course.code,
        name: course.name,
        kind: metadata.kind,
        tags: [...metadata.tags],
        resource_ids: resourceIds,
      };
    })
    .sort((a, b) => (a.code < b.code ? -1 : a.code > b.code ? 1 : 0));
}

/**
 * 生成分区文件内容与 generated-files.json 清单。路径为仓库相对 POSIX 路径。
 */
export function generatePartitionFiles(dataset) {
  const entries = buildPartitions(dataset);
  const files = entries.map((entry) => ({
    path: partitionPath(entry),
    data: {
      code: entry.code,
      name: entry.name,
      kind: entry.kind,
      tags: [...entry.tags],
      resource_ids: [...entry.resource_ids],
    },
  }));
  return {
    entries,
    files,
    manifest: { files: files.map((file) => file.path).sort() },
  };
}

/* ------------------------------------------------------------------ */
/* 精确镜像合并                                                        */
/* ------------------------------------------------------------------ */

function mirrorCoverageSignature(coverage) {
  if (!isPlainObject(coverage)) return '\u0000missing';
  const years = Array.isArray(coverage.years)
    ? [...new Set(coverage.years.filter((year) => Number.isInteger(year)))].sort((a, b) => a - b)
    : [];
  const academicYears = Array.isArray(coverage.academic_years)
    ? [...new Set(coverage.academic_years.filter((value) => parseAcademicYear(value) !== null))].sort()
    : [];
  return JSON.stringify({
    years,
    academic_years: academicYears,
    exam_kind: coverage.exam_kind ?? null,
    exam_form: coverage.exam_form ?? null,
    has_solutions: coverage.has_solutions ?? null,
  });
}

function uniqueMirrorStrings(values) {
  const seen = new Set();
  const result = [];
  for (const value of values) {
    if (typeof value !== 'string' || value.length === 0 || seen.has(value)) continue;
    seen.add(value);
    result.push(value);
  }
  return result;
}

function normalizeMirrorEvidence(evidence, knownIds) {
  const grouped = new Map();
  for (const entry of Array.isArray(evidence) ? evidence : []) {
    if (!isPlainObject(entry)) continue;
    if (typeof entry.resource_id !== 'string' || !knownIds.has(entry.resource_id)) continue;
    if (entry.algorithm !== 'sha256' || typeof entry.sha !== 'string' || !/^[0-9a-f]{64}$/u.test(entry.sha)) continue;
    const sha = entry.sha;
    if (!grouped.has(entry.resource_id)) grouped.set(entry.resource_id, new Map());
    grouped.get(entry.resource_id).set(`${entry.algorithm}:${sha}`, {
      algorithm: entry.algorithm,
      sha,
    });
  }
  const result = new Map();
  for (const [resourceId, entries] of grouped) {
    result.set(
      resourceId,
      [...entries.values()].sort((a, b) =>
        `${a.algorithm}:${a.sha}` < `${b.algorithm}:${b.sha}` ? -1 : 1,
      ),
    );
  }
  return result;
}

function compareStableIds(a, b) {
  return a < b ? -1 : a > b ? 1 : 0;
}

function mergeMirrorGroup(kept, removed) {
  const merged = structuredClone(kept);
  // Keep the winning resource's complete set, including distinct companion files.
  merged.authors = uniqueMirrorStrings(
    [kept, ...removed].flatMap((resource) =>
      Array.isArray(resource.authors) ? resource.authors : [],
    ),
  );
  const notes = uniqueMirrorStrings(
    [kept, ...removed].flatMap((resource) =>
      typeof resource.notes === 'string' ? [resource.notes] : [],
    ),
  );
  merged.notes = notes.join('；');
  const verifiedDates = [kept, ...removed]
    .map((resource) => resource.verified_at)
    .filter(isIsoDate)
    .sort();
  if (verifiedDates.length) merged.verified_at = verifiedDates[verifiedDates.length - 1];
  return merged;
}

/**
 * 按真实独立文件摘要合并精确镜像。
 *
 * evidence 只接受完整文件 SHA-256；调用方须确认每组证据涵盖资源所有成员。
 * priority 按资源 ID 提供已核实的 { centralized, primary } 布尔标记，缺省不推断。
 * 只有 coverage 的 years/exam_kind/exam_form/has_solutions 也一致才合并；
 * 矛盾时不合并，并在 conflicts 中报告待人工核验。
 * 无证据、目录 tree SHA、标题/年份相似都不合并。
 * 返回 {resources, merged:[{kept_id,removed_ids}], conflicts}。
 * conflicts 是内部报告，不写入正式 resources schema。
 */
export function mergeExactMirrors(resources, evidence = [], priority = new Map()) {
  const list = Array.isArray(resources) ? resources : [];
  const knownIds = new Set(
    list
      .filter((resource) => isPlainObject(resource) && typeof resource.id === 'string')
      .map((resource) => resource.id),
  );
  const evidenceByResource = normalizeMirrorEvidence(evidence, knownIds);
  const baseGroups = new Map();

  for (const resource of list) {
    if (!isPlainObject(resource) || typeof resource.id !== 'string') continue;
    const entries = evidenceByResource.get(resource.id);
    if (!entries?.length) continue;
    if (
      !isPlainObject(resource.coverage) ||
      typeof resource.type !== 'string' ||
      !Array.isArray(resource.course_codes)
    ) {
      continue;
    }
    const evidenceKey = entries
      .map((entry) => `${entry.algorithm}:${entry.sha}`)
      .sort()
      .join('|');
    const courseCodes = [
      ...new Set(resource.course_codes.filter((code) => typeof code === 'string')),
    ].sort();
    const baseKey = `${evidenceKey}\u0000${resource.type}\u0000${courseCodes.join('\u0001')}`;
    if (!baseGroups.has(baseKey)) {
      baseGroups.set(baseKey, {
        evidence: entries,
        type: resource.type,
        course_codes: courseCodes,
        resources: [],
      });
    }
    baseGroups.get(baseKey).resources.push(resource);
  }

  const replacements = new Map();
  const removedIds = new Set();
  const merged = [];
  const conflicts = [];

  for (const group of baseGroups.values()) {
    if (group.resources.length < 2) continue;
    const byCoverage = new Map();
    for (const resource of group.resources) {
      const signature = mirrorCoverageSignature(resource.coverage);
      if (!byCoverage.has(signature)) byCoverage.set(signature, []);
      byCoverage.get(signature).push(resource);
    }
    if (byCoverage.size > 1) {
      conflicts.push({
        reason: 'coverage_mismatch',
        evidence: group.evidence.map((entry) => ({ ...entry })),
        type: group.type,
        course_codes: [...group.course_codes],
        resource_ids: group.resources.map((resource) => resource.id).sort(compareStableIds),
        coverage_signatures: [...byCoverage.keys()].sort(),
        coverages: [...byCoverage.values()].map((subset) => structuredClone(subset[0].coverage)),
      });
    }

    for (const coverageGroup of byCoverage.values()) {
      if (coverageGroup.length < 2) continue;
      const score = (id) => {
        const proof = priority.get(id);
        return 2 * Number(proof?.centralized === true) + Number(proof?.primary === true);
      };
      const sorted = [...coverageGroup].sort((a, b) => score(b.id) - score(a.id) || compareStableIds(a.id, b.id));
      const kept = sorted[0];
      const removed = sorted.slice(1);
      replacements.set(kept.id, mergeMirrorGroup(kept, removed));
      for (const resource of removed) removedIds.add(resource.id);
      merged.push({
        kept_id: kept.id,
        removed_ids: removed.map((resource) => resource.id).sort(compareStableIds),
      });
    }
  }

  const output = [];
  for (const resource of list) {
    if (isPlainObject(resource) && removedIds.has(resource.id)) continue;
    if (isPlainObject(resource) && replacements.has(resource.id)) {
      output.push(replacements.get(resource.id));
    } else {
      output.push(resource);
    }
  }

  merged.sort((a, b) => compareStableIds(a.kept_id, b.kept_id));
  conflicts.sort((a, b) =>
    compareStableIds(a.resource_ids.join('\u0000'), b.resource_ids.join('\u0000')),
  );
  return { resources: output, merged, conflicts };
}

/* ------------------------------------------------------------------ */
/* 校验：基础字段                                                      */
/* ------------------------------------------------------------------ */

function validateCourses(courses, collector) {
  const file = 'data/courses.json';
  const byCode = new Map();
  if (!Array.isArray(courses)) {
    collector.error(file, '', '顶层必须是数组');
    return byCode;
  }
  let previousCode = null;
  for (let index = 0; index < courses.length; index += 1) {
    const item = courses[index];
    const itemPath = `[${index}]`;
    if (!isPlainObject(item)) {
      collector.error(file, itemPath, '课程记录必须是对象');
      continue;
    }
    checkExactKeys(item, ['code', 'name'], file, itemPath, collector);
    const code = requireString(item.code, file, `${itemPath}.code`, '课程代码', collector);
    requireString(item.name, file, `${itemPath}.name`, '课程名称', collector);
    if (!code) continue;
    if (/[\u0000-\u001f]/.test(code)) {
      collector.error(file, `${itemPath}.code`, '课程代码不能包含控制字符');
    }
    if (byCode.has(code)) {
      collector.error(file, `${itemPath}.code`, `课程代码重复：「${code}」`);
      continue;
    }
    if (previousCode !== null && code < previousCode) {
      collector.error(file, `${itemPath}.code`, '课程必须按代码升序排列');
    }
    previousCode = code;
    byCode.set(code, item);
  }
  return byCode;
}

function validateTags(tags, collector) {
  const file = 'data/tags.json';
  const declared = new Map();
  const labels = new Map();
  if (!Array.isArray(tags)) {
    collector.error(file, '', '顶层必须是数组');
    return { declared, labels };
  }
  for (let index = 0; index < tags.length; index += 1) {
    const item = tags[index];
    const itemPath = `[${index}]`;
    if (!isPlainObject(item)) {
      collector.error(file, itemPath, '标签必须是对象');
      continue;
    }
    checkExactKeys(item, ['id', 'label'], file, itemPath, collector);
    const id = requireString(item.id, file, `${itemPath}.id`, '标签 ID', collector);
    const label = requireString(item.label, file, `${itemPath}.label`, '标签名称', collector);
    if (!id || !label) continue;
    if (id === 'other' || label === 'other' || id === '其他' || label === '其他') {
      collector.error(file, `${itemPath}`, '禁止「其他/other」标签');
      continue;
    }
    const canonical = TAG_BY_ID.get(id);
    if (!canonical) {
      collector.error(file, `${itemPath}.id`, `未知标签 ID：「${id}」`);
      continue;
    }
    if (label !== canonical.label) {
      collector.error(
        file,
        `${itemPath}.label`,
        `标签名称与固定枚举不一致：应为「${canonical.label}」`,
      );
    }
    if (declared.has(id)) {
      collector.error(file, `${itemPath}.id`, `标签 ID 重复：「${id}」`);
      continue;
    }
    if (labels.has(label)) {
      collector.error(file, `${itemPath}.label`, `标签名称重复：「${label}」`);
    }
    declared.set(id, item);
    labels.set(label, id);
  }
  return { declared, labels };
}

function validateMetadata(metadata, courseByCode, tagState, collector) {
  const file = 'data/course-metadata.json';
  const usedTags = new Set();
  if (!isPlainObject(metadata)) {
    collector.error(file, '', '顶层必须是以课程代码为键的对象');
    return usedTags;
  }
  for (const [code, value] of Object.entries(metadata)) {
    const itemPath = `["${code}"]`;
    if (!courseByCode.has(code)) {
      collector.error(file, itemPath, `悬空课程代码：「${code}」不在 courses.json 中`);
    }
    if (!isPlainObject(value)) {
      collector.error(file, itemPath, '元数据必须是对象');
      continue;
    }
    checkExactKeys(value, ['kind', 'tags', 'basis_url', 'basis_note'], file, itemPath, collector);
    if (!COURSE_KIND_SET.has(value.kind)) {
      collector.error(file, `${itemPath}.kind`, `未知类别：「${String(value.kind)}」`);
    }
    const tagIds = requireStringArray(value.tags, file, `${itemPath}.tags`, '学科标签', collector, {
      allowEmpty: false,
    });
    if (tagIds) {
      for (let index = 0; index < tagIds.length; index += 1) {
        const tagId = tagIds[index];
        if (tagId === 'other' || tagId === '其他') {
          collector.error(file, `${itemPath}.tags[${index}]`, '禁止「其他」标签');
          continue;
        }
        if (!TAG_BY_ID.has(tagId)) {
          collector.error(file, `${itemPath}.tags[${index}]`, `未知标签：「${tagId}」`);
        } else if (!tagState.declared.has(tagId)) {
          collector.error(
            file,
            `${itemPath}.tags[${index}]`,
            `标签「${tagId}」未在 data/tags.json 登记`,
          );
        }
        usedTags.add(tagId);
      }
    }
    requirePublicUrl(value.basis_url, file, `${itemPath}.basis_url`, '分类依据 URL', collector);
    requireString(value.basis_note, file, `${itemPath}.basis_note`, '分类依据说明', collector);
  }
  for (const code of courseByCode.keys()) {
    if (!Object.prototype.hasOwnProperty.call(metadata, code)) {
      collector.error(file, `["${code}"]`, '课程缺少 course-metadata 记录');
    }
  }
  return usedTags;
}

function validateGithubField(github, file, pathText, collector) {
  if (github === null) return;
  if (!isPlainObject(github)) {
    collector.error(file, pathText, 'github 必须是 {owner,repo,branch} 或 null');
    return;
  }
  checkExactKeys(github, ['owner', 'repo', 'branch'], file, pathText, collector);
  const owner = requireString(github.owner, file, `${pathText}.owner`, 'GitHub owner', collector);
  const repo = requireString(github.repo, file, `${pathText}.repo`, 'GitHub 仓库名', collector);
  requireString(github.branch, file, `${pathText}.branch`, 'GitHub 分支', collector);
  for (const [value, label] of [
    [owner, 'owner'],
    [repo, 'repo'],
  ]) {
    if (value && !/^[A-Za-z0-9_.-]+$/.test(value)) {
      collector.error(file, `${pathText}.${label}`, `GitHub ${label} 含非法字符`);
    }
  }
}

function validateSourcesList(sources, collector) {
  const file = 'data/sources.json';
  const byId = new Map();
  if (!Array.isArray(sources)) {
    collector.error(file, '', '顶层必须是数组');
    return byId;
  }
  for (let index = 0; index < sources.length; index += 1) {
    const item = sources[index];
    const itemPath = `[${index}]`;
    if (!isPlainObject(item)) {
      collector.error(file, itemPath, '来源必须是对象');
      continue;
    }
    checkExactKeys(
      item,
      ['id', 'name', 'url', 'maintainer', 'kind', 'github', 'notes'],
      file,
      itemPath,
      collector,
    );
    const id = requireString(item.id, file, `${itemPath}.id`, '来源 ID', collector);
    requireString(item.name, file, `${itemPath}.name`, '来源名称', collector);
    requirePublicUrl(item.url, file, `${itemPath}.url`, '来源 URL', collector);
    requireString(item.maintainer, file, `${itemPath}.maintainer`, '维护者', collector);
    if (!SOURCE_KIND_SET.has(item.kind)) {
      collector.error(file, `${itemPath}.kind`, `未知来源类型：「${String(item.kind)}」`);
    }
    validateGithubField(item.github, file, `${itemPath}.github`, collector);
    if (typeof item.notes !== 'string') {
      collector.error(file, `${itemPath}.notes`, 'notes 必须是字符串');
    }
    if (id) {
      if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(id)) {
        collector.error(file, `${itemPath}.id`, '来源 ID 只能包含字母、数字、点、下划线、连字符');
      }
      if (byId.has(id)) {
        collector.error(file, `${itemPath}.id`, `来源 ID 重复：「${id}」`);
      } else {
        byId.set(id, item);
      }
    }
    if (isPlainObject(item.github) && typeof item.url === 'string') {
      const url = parsePublicHttpUrl(item.url);
      if (url && url.hostname.toLowerCase() !== 'github.com') {
        collector.warn(
          file,
          `${itemPath}.url`,
          '登记了 GitHub owner/repo，但 url 不在 github.com；请确认对应关系',
        );
      }
    }
  }
  return byId;
}

const COVERAGE_KEYS = Object.freeze([
  'years',
  'academic_years',
  'exam_kind',
  'exam_form',
  'has_solutions',
  'evidence_url',
  'note',
]);

function validateCoverage(coverage, resourceType, file, pathText, collector) {
  if (!isPlainObject(coverage)) {
    collector.error(file, pathText, 'coverage 必须是对象');
    return;
  }
  checkExactKeys(coverage, COVERAGE_KEYS, file, pathText, collector);
  if (!Array.isArray(coverage.years)) {
    collector.error(file, `${pathText}.years`, 'years 必须是数组');
  } else {
    const seen = new Set();
    for (let index = 0; index < coverage.years.length; index += 1) {
      const year = coverage.years[index];
      if (!Number.isInteger(year) || year < 1900 || year > 2100) {
        collector.error(file, `${pathText}.years[${index}]`, '年份必须是 1900—2100 的整数');
      } else if (seen.has(year)) {
        collector.error(file, `${pathText}.years[${index}]`, `年份重复：${year}`);
      }
      seen.add(year);
    }
  }

  // 可选学年区间：只知道学年时只写 academic_years，不折算成公历年。
  if (coverage.academic_years !== undefined) {
    if (!Array.isArray(coverage.academic_years)) {
      collector.error(file, `${pathText}.academic_years`, 'academic_years 必须是数组');
    } else {
      const seen = new Set();
      for (let index = 0; index < coverage.academic_years.length; index += 1) {
        const value = coverage.academic_years[index];
        if (!parseAcademicYear(value)) {
          collector.error(
            file,
            `${pathText}.academic_years[${index}]`,
            '学年必须是 ASCII 的 YYYY-YYYY，且结束年为开始年 + 1，如 2025-2026',
          );
          continue;
        }
        if (seen.has(value)) {
          collector.error(file, `${pathText}.academic_years[${index}]`, `学年重复：${value}`);
        }
        seen.add(value);
      }
    }
  }

  const validSolutions = (value) =>
    value === null || value === true || value === false;
  if (resourceType === 'exams') {
    if (!EXAM_KIND_SET.has(coverage.exam_kind)) {
      collector.error(file, `${pathText}.exam_kind`, `未知试题类型：「${String(coverage.exam_kind)}」`);
    } else if (coverage.exam_kind === 'quiz') {
      collector.error(file, `${pathText}.exam_kind`, '小测归入 homework，不能登记为 exams');
    }
    if (!EXAM_FORM_SET.has(coverage.exam_form)) {
      collector.error(file, `${pathText}.exam_form`, `未知试题形式：「${String(coverage.exam_form)}」`);
    }
    if (!validSolutions(coverage.has_solutions)) {
      collector.error(file, `${pathText}.has_solutions`, 'has_solutions 必须是 true/false/null');
    }
  } else if (resourceType === 'homework') {
    if (coverage.exam_kind === 'quiz') {
      if (
        coverage.exam_form !== null &&
        coverage.exam_form !== undefined &&
        !EXAM_FORM_SET.has(coverage.exam_form)
      ) {
        collector.error(file, `${pathText}.exam_form`, `未知试题形式：「${String(coverage.exam_form)}」`);
      }
      if (!validSolutions(coverage.has_solutions)) {
        collector.error(file, `${pathText}.has_solutions`, 'has_solutions 必须是 true/false/null');
      }
    } else if (coverage.exam_kind === null) {
      for (const key of ['exam_form', 'has_solutions']) {
        if (coverage[key] !== null) {
          collector.error(
            file,
            `${pathText}.${key}`,
            '非小测作业的 exam_kind/exam_form/has_solutions 必须为 null',
          );
        }
      }
    } else {
      collector.error(
        file,
        `${pathText}.exam_kind`,
        '作业的 exam_kind 只能是 quiz 或 null；期中期末归入 exams',
      );
    }
  } else {
    for (const key of ['exam_kind', 'exam_form', 'has_solutions']) {
      if (coverage[key] !== null) {
        collector.error(
          file,
          `${pathText}.${key}`,
          '只有试题与小测作业可带 exam_kind/exam_form/has_solutions，其余资料必须为 null',
        );
      }
    }
  }
  if (coverage.evidence_url !== null) {
    requirePublicUrl(
      coverage.evidence_url,
      file,
      `${pathText}.evidence_url`,
      'coverage.evidence_url',
      collector,
      { allowNull: true },
    );
  }
  if (typeof coverage.note !== 'string') {
    collector.error(file, `${pathText}.note`, 'coverage.note 必须是字符串');
  }
}

function isDirectPdfUrl(value) {
  const url = parsePublicHttpUrl(value);
  if (url === null) return false;
  return /\.pdf$/iu.test(url.pathname);
}

/**
 * 教材与参考书只收权利方公开、免登录、免费且能直达完整 PDF 的文件。
 * 目录页、登录下载、付费墙和来源不明扫描都不算。
 */
function validateBookLocations(resource, itemPath, file, collector) {
  const locations = resource.locations;
  for (let index = 0; index < locations.length; index += 1) {
    const location = locations[index];
    if (!isPlainObject(location)) continue;
    if (location.access !== 'public') {
      collector.error(
        file,
        `${itemPath}.locations[${index}].access`,
        '教材与参考书只能登记权利方公开、免登录、免费的入口',
      );
    }
  }
  const hasDirectPdf = locations.some(
    (location) =>
      isPlainObject(location) &&
      location.access === 'public' &&
      isDirectPdfUrl(location.download_url),
  );
  if (!hasDirectPdf) {
    collector.error(
      file,
      `${itemPath}.locations`,
      '教材与参考书需要至少一个公开直链完整 PDF：access=public 且 download_url 指向 .pdf 文件',
    );
  }
}

function validateResource(
  resource,
  itemPath,
  collector,
  { sourcesById, courseByCode, checkCourseRefs },
) {
  const file = 'data/resources.json';
  if (!isPlainObject(resource)) {
    collector.error(file, itemPath, '资料必须是对象');
    return;
  }
  checkExactKeys(
    resource,
    ['id', 'course_codes', 'type', 'title', 'authors', 'notes', 'exercise_source', 'coverage', 'locations', 'verified_at'],
    file,
    itemPath,
    collector,
  );
  const id = requireString(resource.id, file, `${itemPath}.id`, '资料 ID', collector);
  if (id && !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(id)) {
    collector.error(file, `${itemPath}.id`, '资料 ID 只能包含字母、数字、点、下划线、连字符');
  }

  const courseCodes = requireStringArray(
    resource.course_codes,
    file,
    `${itemPath}.course_codes`,
    '适用课程代码',
    collector,
    { allowEmpty: false },
  );
  if (courseCodes && checkCourseRefs) {
    for (let index = 0; index < courseCodes.length; index += 1) {
      if (!courseByCode.has(courseCodes[index])) {
        collector.error(
          file,
          `${itemPath}.course_codes[${index}]`,
          `悬空课程代码：「${courseCodes[index]}」不在 courses.json 中`,
        );
      }
    }
  }

  if (!RESOURCE_TYPE_SET.has(resource.type)) {
    collector.error(file, `${itemPath}.type`, `未知资料类型：「${String(resource.type)}」`);
  }
  requireString(resource.title, file, `${itemPath}.title`, '资料标题', collector);
  const authors = requireStringArray(resource.authors, file, `${itemPath}.authors`, '作者', collector);
  if (authors && authors.length === 0) {
    collector.warn(file, `${itemPath}.authors`, '未登记公开署名；请确认确实无法署名');
  }
  if (typeof resource.notes !== 'string') {
    collector.error(file, `${itemPath}.notes`, 'notes 必须是字符串');
  }
  if (resource.exercise_source !== undefined) {
    requireString(resource.exercise_source, file, `${itemPath}.exercise_source`, '习题出处', collector);
    if (resource.type !== 'homework') {
      collector.error(file, `${itemPath}.exercise_source`, '习题出处只用于作业、习题与小测');
    }
  }
  validateCoverage(resource.coverage, resource.type, file, `${itemPath}.coverage`, collector);
  if (!isIsoDate(resource.verified_at)) {
    collector.error(file, `${itemPath}.verified_at`, 'verified_at 必须是有效日期 YYYY-MM-DD');
  }

  if (!Array.isArray(resource.locations) || resource.locations.length === 0) {
    collector.error(file, `${itemPath}.locations`, 'locations 必须是非空数组');
    return;
  }
  for (let index = 0; index < resource.locations.length; index += 1) {
    const location = resource.locations[index];
    const locationPath = `${itemPath}.locations[${index}]`;
    if (!isPlainObject(location)) {
      collector.error(file, locationPath, 'location 必须是对象');
      continue;
    }
    checkExactKeys(
      location,
      [
        'source_id',
        'page_url',
        'download_page',
        'download_url',
        'access',
        'license_note',
        'attribution',
        'page_kind',
        'role',
        'file_snapshot',
        'attachment_snapshots',
      ],
      file,
      locationPath,
      collector,
    );
    if (location.role !== undefined && (
      location.role !== 'solution' || resource.type !== 'homework' || location.access !== 'public'
    )) {
      collector.error(file, `${locationPath}.role`, '仅公开的习题配套解答可标为 solution');
    }
    if (
      location.page_kind !== undefined &&
      !LOCATION_PAGE_KIND_SET.has(location.page_kind)
    ) {
      collector.error(
        file,
        `${locationPath}.page_kind`,
        `未知位置类型：「${String(location.page_kind)}」；只能是 directory/file/page`,
      );
    }
    const sourceId = requireString(
      location.source_id,
      file,
      `${locationPath}.source_id`,
      '来源 ID',
      collector,
    );
    if (sourceId) {
      const source = sourcesById.get(sourceId);
      if (!source) {
        collector.error(file, `${locationPath}.source_id`, `悬空来源：「${sourceId}」`);
      } else if (source.kind === 'tool' || source.kind === 'stub') {
        collector.error(
          file,
          `${locationPath}.source_id`,
          `来源「${sourceId}」是工具或空壳，不能作为正式资料位置`,
        );
      } else if (source.kind === 'index') {
        collector.warn(
          file,
          `${locationPath}.source_id`,
          `来源「${sourceId}」是索引页；请确认 page_url 直达实际资料而非索引首页`,
        );
      }
    }
    requirePublicUrl(location.page_url, file, `${locationPath}.page_url`, '资料原页面 URL', collector);
    if (location.download_page !== null) {
      requirePublicUrl(
        location.download_page,
        file,
        `${locationPath}.download_page`,
        '下载页 URL',
        collector,
        { allowNull: true },
      );
    }
    if (location.download_url !== null) {
      requirePublicUrl(
        location.download_url,
        file,
        `${locationPath}.download_url`,
        '直链 URL',
        collector,
        { allowNull: true },
      );
    }
    if (location.file_snapshot !== undefined) {
      const snapshotPath = `${locationPath}.file_snapshot`;
      if (location.access !== 'public' || !location.download_url) {
        collector.error(file, snapshotPath, '文件快照必须对应免登录的文件直链');
      }
      validateSnapshotShape(location.file_snapshot, snapshotPath, file, collector);
    }
    if (location.attachment_snapshots !== undefined) {
      const snapshotPath = `${locationPath}.attachment_snapshots`;
      if (location.source_id !== 'icourse-club' || location.access !== 'login' ||
          location.page_kind !== 'page' || location.download_url !== null ||
          location.download_page !== null || location.file_snapshot !== undefined ||
          location.role !== undefined || typeof location.page_url !== 'string' ||
          !/^https:\/\/icourse\.club\/course\/\d+\/#review-\d+$/.test(location.page_url)) {
        collector.error(file, snapshotPath, '附件取样仅适用于需登录的评课社区原帖位置');
      }
      const snapshots = location.attachment_snapshots;
      if (!Array.isArray(snapshots) || snapshots.length === 0) {
        collector.error(file, snapshotPath, '附件取样必须是非空数组');
      } else {
        let previous;
        for (const [index, snapshot] of snapshots.entries()) {
          const entryPath = `${snapshotPath}[${index}]`;
          validateSnapshotShape(snapshot, entryPath, file, collector);
          if (typeof snapshot?.sha256 !== 'string') continue;
          if (previous !== undefined && snapshot.sha256 <= previous) {
            collector.error(file, `${entryPath}.sha256`, '附件摘要必须按 SHA-256 升序且不重复');
          }
          previous = snapshot.sha256;
        }
      }
    }
    if (!ACCESS_SET.has(location.access)) {
      collector.error(file, `${locationPath}.access`, `未知访问级别：「${String(location.access)}」`);
    }
    requireString(location.license_note, file, `${locationPath}.license_note`, '许可说明', collector);
    const attribution = requireString(
      location.attribution,
      file,
      `${locationPath}.attribution`,
      '署名/出处',
      collector,
      { allowEmpty: true },
    );
    if (attribution === '') {
      collector.warn(file, `${locationPath}.attribution`, '未填写署名/出处');
    }
  }
  if (resource.locations.every((location) => location?.role === 'solution')) {
    collector.error(file, `${itemPath}.locations`, '配套解答不能替代习题主入口');
  }
  if (resource.type === 'books') {
    validateBookLocations(resource, itemPath, file, collector);
  }
}

function validateSnapshotShape(snapshot, snapshotPath, file, collector) {
  if (!isPlainObject(snapshot)) {
    collector.error(file, snapshotPath, '文件快照必须是对象');
    return;
  }
  checkExactKeys(snapshot, ['sha256', 'bytes', 'checked_at'], file, snapshotPath, collector);
  if (typeof snapshot.sha256 !== 'string' || !/^[0-9a-f]{64}$/.test(snapshot.sha256)) {
    collector.error(file, `${snapshotPath}.sha256`, '必须是完整的小写 SHA-256 十六进制值');
  }
  if (!Number.isSafeInteger(snapshot.bytes) || snapshot.bytes <= 0) {
    collector.error(file, `${snapshotPath}.bytes`, '文件字节数必须是正整数');
  }
  if (!isIsoDate(snapshot.checked_at)) {
    collector.error(file, `${snapshotPath}.checked_at`, '取样日期必须是有效日期 YYYY-MM-DD');
  }
}

function validateResourcesList(resources, collector, context) {
  const file = 'data/resources.json';
  if (!Array.isArray(resources)) {
    collector.error(file, '', '顶层必须是数组');
    return;
  }
  const seen = new Set();
  for (let index = 0; index < resources.length; index += 1) {
    const item = resources[index];
    const itemPath = `[${index}]`;
    validateResource(item, itemPath, collector, context);
    if (isPlainObject(item) && typeof item.id === 'string') {
      if (seen.has(item.id)) {
        collector.error(file, `${itemPath}.id`, `资料 ID 重复：「${item.id}」`);
      }
      seen.add(item.id);
    }
  }
}

function validateResearchLog(records, collector, { courseByCode, sourcesById }) {
  const file = 'data/research-log.jsonl';
  if (!Array.isArray(records)) {
    collector.error(file, '', '顶层必须是数组');
    return;
  }
  const seen = new Set();
  for (let index = 0; index < records.length; index += 1) {
    const item = records[index];
    const itemPath = `[${index}]`;
    if (!isPlainObject(item)) {
      collector.error(file, itemPath, '记录必须是对象');
      continue;
    }
    checkExactKeys(
      item,
      ['id', 'date', 'scope', 'channel', 'course_codes', 'source_ids', 'query', 'url', 'checked_scope', 'outcome', 'notes'],
      file,
      itemPath,
      collector,
    );
    const id = requireString(item.id, file, `${itemPath}.id`, '记录 ID', collector);
    if (id) {
      if (!/^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(id)) {
        collector.error(file, `${itemPath}.id`, '记录 ID 只能包含字母、数字、点、下划线、连字符、冒号');
      }
      if (seen.has(id)) {
        collector.error(file, `${itemPath}.id`, `记录 ID 重复：「${id}」`);
      }
      seen.add(id);
    }
    if (!isIsoDate(item.date)) {
      collector.error(file, `${itemPath}.date`, 'date 必须是有效日期 YYYY-MM-DD');
    }
    if (!RESEARCH_SCOPE_SET.has(item.scope)) {
      collector.error(file, `${itemPath}.scope`, `未知 scope：「${String(item.scope)}」`);
    }
    if (!RESEARCH_CHANNEL_SET.has(item.channel)) {
      collector.error(file, `${itemPath}.channel`, `未知 channel：「${String(item.channel)}」`);
    }
    if (!RESEARCH_OUTCOME_SET.has(item.outcome)) {
      collector.error(file, `${itemPath}.outcome`, `未知 outcome：「${String(item.outcome)}」`);
    }
    const courseCodes = requireStringArray(
      item.course_codes,
      file,
      `${itemPath}.course_codes`,
      '课程代码',
      collector,
    );
    if (courseCodes) {
      for (let codeIndex = 0; codeIndex < courseCodes.length; codeIndex += 1) {
        if (!courseByCode.has(courseCodes[codeIndex])) {
          collector.error(
            file,
            `${itemPath}.course_codes[${codeIndex}]`,
            `悬空课程代码：「${courseCodes[codeIndex]}」`,
          );
        }
      }
    }
    const sourceIds = requireStringArray(
      item.source_ids,
      file,
      `${itemPath}.source_ids`,
      '来源 ID',
      collector,
    );
    if (sourceIds) {
      for (let sourceIndex = 0; sourceIndex < sourceIds.length; sourceIndex += 1) {
        if (!sourcesById.has(sourceIds[sourceIndex])) {
          collector.error(
            file,
            `${itemPath}.source_ids[${sourceIndex}]`,
            `悬空来源：「${sourceIds[sourceIndex]}」`,
          );
        }
      }
    }
    if (item.scope === 'course' && courseCodes && courseCodes.length === 0) {
      collector.error(file, `${itemPath}.course_codes`, 'scope=course 时必须填写课程代码');
    }
    if (item.scope === 'source' && sourceIds && sourceIds.length === 0) {
      collector.error(file, `${itemPath}.source_ids`, 'scope=source 时必须填写来源 ID');
    }
    requireString(item.query, file, `${itemPath}.query`, '检索词/操作说明', collector);
    requirePublicUrl(item.url, file, `${itemPath}.url`, '实际检查 URL', collector);
    requireString(item.checked_scope, file, `${itemPath}.checked_scope`, '检查范围', collector);
    if (typeof item.notes !== 'string') {
      collector.error(file, `${itemPath}.notes`, 'notes 必须是字符串');
    }
  }
}

function validateMonitoring(monitoring, collector, { sourcesById }, options) {
  const file = 'data/monitoring.json';
  if (monitoring === null) {
    if (options.requireMonitoring) {
      collector.error(file, '', '缺少 monitoring.json（未载入外链巡检快照）');
    } else {
      collector.warn(file, '', '尚未生成 monitoring.json，本次离线构建不含外链巡检结果');
    }
    return;
  }
  if (!isPlainObject(monitoring)) {
    collector.error(file, '', '顶层必须是对象');
    return;
  }
  checkExactKeys(
    monitoring,
    ['schema_version', 'checked_at', 'links', 'repositories', 'issue_number'],
    file,
    '',
    collector,
  );
  if (monitoring.schema_version !== MONITORING_SCHEMA_VERSION) {
    collector.error(file, 'schema_version', `必须为 ${MONITORING_SCHEMA_VERSION}`);
  }
  if (monitoring.checked_at !== null && !isIsoDateTime(monitoring.checked_at)) {
    collector.error(file, 'checked_at', '必须是 ISO 时间或 null');
  }
  if (!Array.isArray(monitoring.links)) {
    collector.error(file, 'links', 'links 必须是数组');
  } else {
    const urls = new Set();
    for (let index = 0; index < monitoring.links.length; index += 1) {
      const link = monitoring.links[index];
      const linkPath = `links[${index}]`;
      if (!isPlainObject(link)) {
        collector.error(file, linkPath, '链接结果必须是对象');
        continue;
      }
      checkExactKeys(
        link,
        ['url', 'status', 'http_status', 'reason', 'checked_at', 'final_url'],
        file,
        linkPath,
        collector,
      );
      requirePublicUrl(link.url, file, `${linkPath}.url`, '链接 URL', collector);
      if (typeof link.url === 'string') {
        if (urls.has(link.url)) {
          collector.error(file, `${linkPath}.url`, `链接重复：「${link.url}」`);
        }
        urls.add(link.url);
      }
      if (!LINK_STATUS_SET.has(link.status)) {
        collector.error(file, `${linkPath}.status`, `未知状态：「${String(link.status)}」`);
      }
      if (
        link.http_status !== null &&
        (!Number.isInteger(link.http_status) || link.http_status < 100 || link.http_status > 599)
      ) {
        collector.error(file, `${linkPath}.http_status`, 'http_status 必须是 100—599 的整数或 null');
      }
      requireString(link.reason, file, `${linkPath}.reason`, '状态原因', collector);
      if (link.checked_at !== null && !isIsoDateTime(link.checked_at)) {
        collector.error(file, `${linkPath}.checked_at`, '必须是 ISO 时间或 null');
      }
      if (link.final_url !== null) {
        // final_url 是实际跳转结果，可能是私网/非 http 目标；只校验类型与非空。
        requireString(link.final_url, file, `${linkPath}.final_url`, '最终 URL', collector);
      }
    }
  }

  if (!isPlainObject(monitoring.repositories)) {
    collector.error(file, 'repositories', 'repositories 必须是以 source_id 为键的对象');
  } else {
    for (const [sourceId, baseline] of Object.entries(monitoring.repositories)) {
      const basePath = `repositories["${sourceId}"]`;
      if (sourcesById) {
        const source = sourcesById.get(sourceId);
        if (!source) {
          collector.error(file, basePath, `悬空来源：「${sourceId}」`);
        } else if (source.github === null) {
          collector.warn(file, basePath, `来源「${sourceId}」未登记 GitHub，却有文件基线`);
        }
      }
      if (!isPlainObject(baseline)) {
        collector.error(file, basePath, '基线必须是对象');
        continue;
      }
      checkExactKeys(baseline, ['head_sha', 'files', 'last_checked_at'], file, basePath, collector);
      if (!isHexSha(baseline.head_sha)) {
        collector.error(file, `${basePath}.head_sha`, 'head_sha 必须是 40 或 64 位十六进制');
      }
      if (!isIsoDateTime(baseline.last_checked_at)) {
        collector.error(file, `${basePath}.last_checked_at`, '必须是 ISO 时间');
      }
      if (!Array.isArray(baseline.files)) {
        collector.error(file, `${basePath}.files`, 'files 必须是数组');
        continue;
      }
      const filePaths = new Set();
      for (let index = 0; index < baseline.files.length; index += 1) {
        const entry = baseline.files[index];
        const entryPath = `${basePath}.files[${index}]`;
        if (!isPlainObject(entry)) {
          collector.error(file, entryPath, '文件条目必须是对象');
          continue;
        }
        checkExactKeys(entry, ['path', 'sha', 'type'], file, entryPath, collector);
        const entryFile = requireString(entry.path, file, `${entryPath}.path`, '文件路径', collector);
        if (entryFile) {
          if (filePaths.has(entryFile)) {
            collector.error(file, `${entryPath}.path`, `文件路径重复：「${entryFile}」`);
          }
          filePaths.add(entryFile);
        }
        if (!isHexSha(entry.sha)) {
          collector.error(file, `${entryPath}.sha`, 'sha 必须是 40 或 64 位十六进制');
        }
        if (!GIT_OBJECT_TYPES.has(entry.type)) {
          collector.error(file, `${entryPath}.type`, `未知 Git 对象类型：「${String(entry.type)}」`);
        }
      }
    }
  }

  if (
    monitoring.issue_number !== null &&
    (!Number.isInteger(monitoring.issue_number) || monitoring.issue_number <= 0)
  ) {
    collector.error(file, 'issue_number', '必须是正整数或 null');
  }
}

// A remote baseline can still contain sources removed from the current registry.
export function validateMonitoringBaseline(monitoring) {
  const collector = makeCollector();
  validateMonitoring(monitoring, collector, { sourcesById: null }, { requireMonitoring: true });
  return collector.errors;
}

/* ------------------------------------------------------------------ */
/* 校验入口与统计                                                      */
/* ------------------------------------------------------------------ */

export function computeResearchCoverage(dataset) {
  const courses = Array.isArray(dataset?.courses) ? dataset.courses : [];
  const records = Array.isArray(dataset?.researchLog) ? dataset.researchLog : [];
  const byCode = new Map();
  for (const course of courses) {
    if (!isPlainObject(course) || typeof course.code !== 'string') continue;
    byCode.set(course.code, {
      code: course.code,
      name: course.name,
      channels: { github: [], icourse: [], web: [] },
    });
  }
  const byChannel = Object.fromEntries(RESEARCH_PATH_CHANNELS.map((channel) => [channel, 0]));
  const byOutcome = {};
  for (const record of records) {
    if (isPlainObject(record) && typeof record.outcome === 'string') {
      byOutcome[record.outcome] = (byOutcome[record.outcome] ?? 0) + 1;
    }
    if (
      !isPlainObject(record) ||
      !RESEARCH_PATH_CHANNELS.includes(record.channel) ||
      !Array.isArray(record.course_codes)
    ) {
      continue;
    }
    for (const code of record.course_codes) {
      const course = byCode.get(code);
      if (!course) continue;
      course.channels[record.channel].push(record.outcome ?? null);
    }
  }
  const missing = [];
  const blockedOnly = [];
  let completeCourses = 0;
  for (const course of byCode.values()) {
    const missingChannels = RESEARCH_PATH_CHANNELS.filter(
      (channel) =>
        !course.channels[channel].some((outcome) => RESEARCH_TERMINAL_SET.has(outcome)),
    );
    if (missingChannels.length) {
      missing.push({ code: course.code, name: course.name, missing: missingChannels });
    } else {
      completeCourses += 1;
      const allBlocked = RESEARCH_PATH_CHANNELS.every((channel) => {
        const outcomes = course.channels[channel];
        return (
          outcomes.some((outcome) => outcome === 'blocked') &&
          !outcomes.some((outcome) => outcome === 'reviewed' || outcome === 'no_relevant_result')
        );
      });
      if (allBlocked) blockedOnly.push({ code: course.code, name: course.name });
    }
    for (const channel of RESEARCH_PATH_CHANNELS) {
      if (course.channels[channel].some((outcome) => RESEARCH_TERMINAL_SET.has(outcome))) {
        byChannel[channel] += 1;
      }
    }
  }
  return {
    totalCourses: byCode.size,
    completeCourses,
    missingCount: missing.length,
    complete: missing.length === 0,
    missing,
    missingSample: missing.slice(0, 20),
    blockedOnly,
    byChannel,
    byOutcome,
  };
}

export function summarizeDataset(dataset) {
  const courses = Array.isArray(dataset?.courses) ? dataset.courses : [];
  const metadata = isPlainObject(dataset?.courseMetadata) ? dataset.courseMetadata : {};
  const resources = Array.isArray(dataset?.resources) ? dataset.resources : [];
  const sources = Array.isArray(dataset?.sources) ? dataset.sources : [];
  const researchLog = Array.isArray(dataset?.researchLog) ? dataset.researchLog : [];

  const kindCounts = Object.fromEntries(COURSE_KINDS.map((kind) => [kind, 0]));
  for (const course of courses) {
    const kind = metadata[course?.code]?.kind;
    if (Object.hasOwn(kindCounts, kind)) kindCounts[kind] += 1;
  }

  const resourceTypeCounts = Object.fromEntries(RESOURCE_TYPES.map((type) => [type, 0]));
  const accessCounts = Object.fromEntries(ACCESS_LEVELS.map((access) => [access, 0]));
  const courseCodesWithResources = new Set();
  for (const resource of resources) {
    if (isPlainObject(resource) && Object.hasOwn(resourceTypeCounts, resource.type)) {
      resourceTypeCounts[resource.type] += 1;
    }
    if (isPlainObject(resource) && Array.isArray(resource.course_codes)) {
      for (const code of resource.course_codes) courseCodesWithResources.add(code);
    }
    if (isPlainObject(resource) && Array.isArray(resource.locations)) {
      for (const location of resource.locations) {
        if (isPlainObject(location) && Object.hasOwn(accessCounts, location.access)) {
          accessCounts[location.access] += 1;
        }
      }
    }
  }

  const sourceKindCounts = Object.fromEntries(SOURCE_KINDS.map((kind) => [kind, 0]));
  for (const source of sources) {
    if (isPlainObject(source) && Object.hasOwn(sourceKindCounts, source.kind)) {
      sourceKindCounts[source.kind] += 1;
    }
  }

  const statusCounts = Object.fromEntries(LINK_STATUSES.map((status) => [status, 0]));
  const monitoring = isPlainObject(dataset?.monitoring) ? dataset.monitoring : null;
  const links = Array.isArray(monitoring?.links) ? monitoring.links : [];
  for (const link of links) {
    if (isPlainObject(link) && Object.hasOwn(statusCounts, link.status)) {
      statusCounts[link.status] += 1;
    }
  }

  const researchCoverage = computeResearchCoverage({ courses, researchLog });
  const withResources = courses.filter((course) => courseCodesWithResources.has(course?.code)).length;

  return {
    courses: {
      total: courses.length,
      withResources,
      withoutResources: Math.max(0, courses.length - withResources),
      kinds: kindCounts,
    },
    courseMetadata: { total: Object.keys(metadata).length },
    resources: {
      total: resources.length,
      byType: resourceTypeCounts,
      byAccess: accessCounts,
      coursesCovered: courseCodesWithResources.size,
    },
    sources: { total: sources.length, byKind: sourceKindCounts },
    researchLog: {
      total: researchLog.length,
      byChannel: researchCoverage.byChannel,
      byOutcome: researchCoverage.byOutcome,
      coverage: researchCoverage,
    },
    monitoring: {
      present: monitoring !== null,
      checked_at: monitoring?.checked_at ?? null,
      linkStatuses: statusCounts,
      links: links.length,
      repositories: isPlainObject(monitoring?.repositories)
        ? Object.keys(monitoring.repositories).length
        : 0,
    },
  };
}

/**
 * 严格校验完整数据集，不抛异常。返回 {errors,warnings,stats}。
 * options.requireResearchCoverage=true 时把每课三路径缺口升级为错误。
 * options.requireMonitoring=true 时要求 monitoring.json 存在。
 */
export function validateRepository(dataset, options = {}) {
  const collector = makeCollector();
  const settings = {
    requireResearchCoverage: options.requireResearchCoverage === true,
    requireMonitoring: options.requireMonitoring === true,
  };

  if (!isPlainObject(dataset)) {
    collector.error('data', '', '数据集必须是对象');
    return {
      errors: collector.errors,
      warnings: collector.warnings,
      stats: summarizeDataset({}),
    };
  }

  const courses = dataset.courses;
  const courseByCode = validateCourses(courses, collector);
  if (Array.isArray(courses) && courses.length === 0) {
    collector.error('data/courses.json', '', '课程主清单为空，不能发布');
  }

  const tagState = validateTags(dataset.tags, collector);
  const usedTags = validateMetadata(dataset.courseMetadata, courseByCode, tagState, collector);
  for (const [id] of tagState.declared) {
    if (!usedTags.has(id)) {
      collector.warn('data/tags.json', `["${id}"]`, '标签已登记但没有任何课程使用');
    }
  }

  const sources = dataset.sources;
  const sourcesById = validateSourcesList(sources, collector);
  validateResourcesList(dataset.resources, collector, {
    sourcesById,
    courseByCode,
    checkCourseRefs: true,
  });
  validateResearchLog(dataset.researchLog, collector, { courseByCode, sourcesById });
  validateMonitoring(dataset.monitoring, collector, { sourcesById }, settings);

  const researchCoverage = computeResearchCoverage({ courses, researchLog: dataset.researchLog });
  if (!researchCoverage.complete) {
    const sample = researchCoverage.missingSample
      .map((course) => `${course.code}(${course.missing.join('/')})`)
      .join('、');
    const message = `有 ${researchCoverage.missingCount} 门课程缺少三路径检索记录；示例：${sample}`;
    if (settings.requireResearchCoverage) {
      collector.error('data/research-log.jsonl', '', message);
    } else {
      collector.warn('data/research-log.jsonl', '', message);
    }
  }

  return {
    errors: collector.errors,
    warnings: collector.warnings,
    stats: summarizeDataset(dataset),
  };
}
