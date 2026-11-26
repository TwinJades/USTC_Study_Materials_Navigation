/**
 * 公告栏模块：顶栏入口、localStorage 未读提醒、桌面双栏宽板 / 竖屏居中卡片。
 *
 * 维护说明：
 * - 新增阶段性大更新时，在 ANNOUNCEMENTS.news 最前面插入一条带有新唯一 id 的记录，
 *   页面会自动为未读用户点亮入口红点；打开一次即记录已读并跨标签页同步。
 * - 只录入经核对的站内说明与公开 http / https 链接，不请求远端内容。
 */

export const ANNOUNCEMENTS = {
  seenStorageKey: 'ustc-course-nav.announcements.seen',
  news: [
    {
      id: '2026-11-25-announcements',
      date: '2026-11-25',
      tag: '新功能',
      tagTone: 'feature',
      isLatest: true,
      title: '公告栏上线，集中查看站内更新与衍生项目',
      summary:
        '顶栏新增公告栏入口，集中发布阶段性大更新与社区衍生项目；不会自动弹窗，也不影响当前搜索条件与显示模式。',
    },
    {
      id: '2026-11-25-catalog-growth',
      date: '2026-11-25',
      tag: '资料扩充',
      tagTone: 'data',
      title: '资料规模大幅扩充，接入多来源并与「我的科大」互通',
      summary:
        '全站覆盖 1,184 门本科课程，其中 405 门已收录 2,782 条资料；整合 Amsors 评课数据包，接入「我的科大」分享入口（网页版「功能 → 学习 → 课程资料」底部也可直达本站），并同步 DDNdles 结构化题库至 47 门课程。',
    },
    {
      id: '2026-11-23-v2-ui',
      date: '2026-11-23',
      tag: '版本升级',
      tagTone: 'ui',
      title: '新版「也西书架」上线，出处与原帖指路更清晰',
      summary:
        '上线浅色 / 深色外观与简洁 / 详细双模式，补齐需登录的评课原帖入口；详细模式可查看原始出处、收录依据及部分已核验直链的文件大小与 SHA-256。',
    },
  ],
  changelogUrl: 'https://github.com/TwinJades/USTC_Study_Materials_Navigation/blob/main/CHANGELOG.md',
  submitProjectUrl:
    'https://github.com/TwinJades/USTC_Study_Materials_Navigation/issues/new?template=suggest-project.yml',
  projects: [
    {
      id: 'ustc-question-bank',
      name: 'USTC Question Bank',
      author: 'DDNdles',
      tags: ['结构化题库', 'JSONL'],
      summary:
        '参考也西书架等索引整理的中科大本科课程结构化题库，按课程与知识点组织题目与解析，提供机读 JSONL 数据。',
      repoUrl: 'https://github.com/DDNdles/USTC-Question-Bank',
      noticeUrl: 'https://github.com/DDNdles/USTC-Question-Bank/blob/main/NOTICE.md',
    },
  ],
};

const WIDE_QUERY = '(min-width: 44rem)';
const LATEST_ID = ANNOUNCEMENTS.news[0]?.id ?? '';
const SVG_NS = 'http://www.w3.org/2000/svg';

function safeExternalUrl(raw) {
  if (typeof raw !== 'string' || !raw.trim()) return null;
  try {
    const url = new URL(raw);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.toString() : null;
  } catch {
    return null;
  }
}

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined && text !== null) node.textContent = text;
  return node;
}

function externalLink(url, label, className, arrowText = ' ↗') {
  const safe = safeExternalUrl(url);
  if (!safe) return null;
  const link = el('a', className);
  link.href = safe;
  link.target = '_blank';
  link.rel = 'noopener noreferrer';
  link.append(document.createTextNode(label));
  if (arrowText) {
    link.append(el('span', 'link-arrow', arrowText));
  }
  return link;
}

function createSvgIcon(paths, size = 18) {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 20 20');
  svg.setAttribute('width', String(size));
  svg.setAttribute('height', String(size));
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '1.6');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.setAttribute('aria-hidden', 'true');
  for (const spec of paths) {
    const child = document.createElementNS(SVG_NS, spec.tag);
    for (const [attr, value] of Object.entries(spec.attrs)) {
      child.setAttribute(attr, String(value));
    }
    svg.append(child);
  }
  return svg;
}

function createBoardBadgeSvg() {
  return createSvgIcon([
    { tag: 'path', attrs: { d: 'M6.5 2.75V6.25M13.5 2.75V6.25' } },
    { tag: 'rect', attrs: { x: 2.75, y: 6.25, width: 14.5, height: 10.75, rx: 2 } },
    { tag: 'path', attrs: { d: 'M6 10.25h8M6 13.5h5.25' } },
  ]);
}

function createCloseSvg() {
  return createSvgIcon(
    [{ tag: 'path', attrs: { d: 'M5.25 5.25l9.5 9.5M14.75 5.25l-9.5 9.5' } }],
    16,
  );
}

let cachedDisplayTransition;
function canTransitionDisplay() {
  if (cachedDisplayTransition !== undefined) return cachedDisplayTransition;
  if (!window.CSS?.supports?.('transition-behavior', 'allow-discrete') || !document.body) {
    return false;
  }
  const probe = document.createElement('div');
  probe.style.cssText = 'transition: display 1s allow-discrete !important; display: block;';
  document.body.appendChild(probe);
  getComputedStyle(probe).display;
  probe.style.display = 'none';
  cachedDisplayTransition = getComputedStyle(probe).display === 'block';
  probe.remove();
  return cachedDisplayTransition;
}

function supportsTopLayerExit() {
  return Boolean(window.CSS?.supports?.('overlay', 'auto') && canTransitionDisplay());
}

function readSeenId() {
  try {
    return localStorage.getItem(ANNOUNCEMENTS.seenStorageKey);
  } catch {
    return LATEST_ID;
  }
}

function writeSeenId(id) {
  try {
    if (id) localStorage.setItem(ANNOUNCEMENTS.seenStorageKey, id);
  } catch {
    // 存储不可用时静默降级。
  }
}

function buildNewsList() {
  const list = el('ol', 'announcement-news-list');
  for (const item of ANNOUNCEMENTS.news) {
    const li = el('li', 'announcement-news-item');
    if (item.isLatest) li.dataset.latest = 'true';

    const meta = el('div', 'announcement-news-aside');
    const dateEl = el('time', 'announcement-news-date', item.date);
    dateEl.dateTime = item.date;
    meta.append(dateEl);
    if (item.tag) {
      const badge = el('span', 'announcement-tag', item.tag);
      if (item.tagTone) badge.dataset.tone = item.tagTone;
      meta.append(badge);
    }

    const content = el('div', 'announcement-news-content');
    const titleEl = el('h3', 'announcement-item-title', item.title);
    if (item.isLatest) {
      titleEl.append(el('span', 'announcement-latest-pill', '最新'));
    }
    content.append(titleEl);
    content.append(el('p', 'announcement-item-summary', item.summary));

    li.append(meta, content);
    list.append(li);
  }
  return list;
}

function buildProjectsList() {
  const list = el('ul', 'announcement-project-list');
  for (const project of ANNOUNCEMENTS.projects) {
    const li = el('li', 'announcement-project-card');

    const head = el('div', 'announcement-project-head');
    const titleGroup = el('div', 'announcement-project-title-group');
    titleGroup.append(el('h3', 'announcement-item-title', project.name));
    if (project.author) {
      titleGroup.append(el('span', 'announcement-project-author', `作者：${project.author}`));
    }
    head.append(titleGroup);

    if (Array.isArray(project.tags) && project.tags.length > 0) {
      const tagRow = el('div', 'announcement-project-tags');
      for (const tag of project.tags) {
        tagRow.append(el('span', 'announcement-chip', tag));
      }
      head.append(tagRow);
    }

    const summary = el('p', 'announcement-item-summary', project.summary);

    const actions = el('div', 'announcement-project-actions');
    const repoLink = externalLink(project.repoUrl, '访问项目仓库', 'link-button primary-link');
    const noticeLink = externalLink(project.noticeUrl, '出处说明（NOTICE）', 'link-button');
    if (repoLink) actions.append(repoLink);
    if (noticeLink) actions.append(noticeLink);

    li.append(head, summary);
    if (actions.childNodes.length > 0) li.append(actions);
    list.append(li);
  }
  return list;
}

function buildPanel() {
  const panel = el('dialog', 'announcement-panel');
  panel.id = 'announcements';
  panel.setAttribute('aria-labelledby', 'announcement-title');
  panel.setAttribute('closedby', 'any');
  panel.tabIndex = -1;
  panel.autofocus = true;

  const header = el('header', 'announcement-header');
  const titleWrap = el('div', 'announcement-title-wrap');
  const iconBadge = el('span', 'announcement-title-badge');
  iconBadge.setAttribute('aria-hidden', 'true');
  iconBadge.append(createBoardBadgeSvg());

  const titleCopy = el('div', 'announcement-title-copy');
  const title = el('h2', 'announcement-title', '公告栏');
  title.id = 'announcement-title';
  const subtitle = el('p', 'announcement-subtitle', '重要更新与社区衍生项目');
  titleCopy.append(title, subtitle);
  titleWrap.append(iconBadge, titleCopy);

  const closeBtn = el('button', 'announcement-close');
  closeBtn.type = 'button';
  closeBtn.setAttribute('data-close', '');
  closeBtn.setAttribute('aria-label', '关闭公告栏');
  closeBtn.title = '关闭';
  closeBtn.append(createCloseSvg());
  header.append(titleWrap, closeBtn);

  const tablist = el('div', 'announcement-tablist');
  tablist.setAttribute('role', 'tablist');
  tablist.setAttribute('aria-label', '公告分类');

  const newsTab = el('button', 'announcement-tab');
  newsTab.type = 'button';
  newsTab.id = 'announcement-news-tab';
  newsTab.setAttribute('role', 'tab');
  newsTab.setAttribute('aria-selected', 'true');
  newsTab.append(el('span', 'announcement-tab-label', '近期更新'));
  newsTab.append(el('span', 'announcement-tab-count', String(ANNOUNCEMENTS.news.length)));

  const projectsTab = el('button', 'announcement-tab');
  projectsTab.type = 'button';
  projectsTab.id = 'announcement-projects-tab';
  projectsTab.setAttribute('role', 'tab');
  projectsTab.setAttribute('aria-selected', 'false');
  projectsTab.tabIndex = -1;
  projectsTab.append(el('span', 'announcement-tab-label', '衍生项目'));
  projectsTab.append(el('span', 'announcement-tab-count', String(ANNOUNCEMENTS.projects.length)));

  tablist.append(newsTab, projectsTab);

  const body = el('div', 'announcement-body');

  const newsPanel = el('div', 'announcement-tabpanel');
  newsPanel.id = 'announcement-news';
  newsPanel.setAttribute('role', 'tabpanel');
  newsPanel.setAttribute('aria-labelledby', newsTab.id);
  newsPanel.tabIndex = 0;
  const newsInner = el('div', 'announcement-tabpanel-inner');
  newsInner.append(buildNewsList());
  newsPanel.append(newsInner);

  const projectsPanel = el('div', 'announcement-tabpanel');
  projectsPanel.id = 'announcement-projects';
  projectsPanel.setAttribute('role', 'tabpanel');
  projectsPanel.setAttribute('aria-labelledby', projectsTab.id);
  projectsPanel.hidden = 'until-found';
  const projectsInner = el('div', 'announcement-tabpanel-inner');
  projectsInner.append(buildProjectsList());
  projectsPanel.append(projectsInner);

  body.append(newsPanel, projectsPanel);

  const footer = el('footer', 'announcement-footer');
  const footerNews = el('div', 'announcement-footer-row');
  footerNews.append(el('span', 'announcement-footer-note', '阶段性大更新摘要'));
  const changelogLink = externalLink(
    ANNOUNCEMENTS.changelogUrl,
    '查看完整更新日志',
    'announcement-footer-link',
    ' →',
  );
  if (changelogLink) footerNews.append(changelogLink);

  const footerProjects = el('div', 'announcement-footer-row');
  footerProjects.hidden = true;
  footerProjects.append(el('span', 'announcement-footer-note', '欢迎推荐基于也西书架的公开衍生项目'));
  const submitLink = externalLink(
    ANNOUNCEMENTS.submitProjectUrl,
    '在 GitHub 推荐衍生项目',
    'announcement-footer-link',
    ' →',
  );
  if (submitLink) footerProjects.append(submitLink);

  footer.append(footerNews, footerProjects);

  panel.append(header, tablist, body, footer);
  return {
    panel,
    tablist,
    closeBtn,
    tabs: [newsTab, projectsTab],
    tabpanels: [newsPanel, projectsPanel],
    footerRows: [footerNews, footerProjects],
  };
}

function initAnnouncements() {
  const trigger = document.querySelector('.announcement-toggle');
  if (!trigger) return;

  const { panel, tablist, closeBtn, tabs, tabpanels, footerRows } = buildPanel();
  document.body.append(panel);

  const wideMedia = window.matchMedia?.(WIDE_QUERY);

  function syncTabOrientation() {
    const isVertical = Boolean(wideMedia ? wideMedia.matches : true);
    tablist.setAttribute('aria-orientation', isVertical ? 'vertical' : 'horizontal');
  }

  function syncUnreadUi() {
    const hasUnread = Boolean(LATEST_ID) && readSeenId() !== LATEST_ID;
    if (hasUnread) {
      trigger.dataset.unread = 'true';
      trigger.setAttribute('aria-label', '公告栏（有新更新）');
      trigger.title = '公告栏（有新更新）';
    } else {
      delete trigger.dataset.unread;
      trigger.setAttribute('aria-label', '公告栏');
      trigger.title = '公告栏';
    }
  }

  function markSeen() {
    if (!LATEST_ID) return;
    writeSeenId(LATEST_ID);
    syncUnreadUi();
  }

  function syncTriggerOpenState(open) {
    trigger.setAttribute('aria-expanded', String(open));
    if (open) {
      trigger.dataset.open = 'true';
      markSeen();
      syncTabOrientation();
    } else {
      delete trigger.dataset.open;
    }
  }

  function selectTab(index) {
    tabs.forEach((tab, i) => {
      const selected = i === index;
      tab.setAttribute('aria-selected', String(selected));
      tab.tabIndex = selected ? 0 : -1;
      const tp = tabpanels[i];
      if (selected) {
        tp.hidden = false;
        tp.setAttribute('tabindex', '0');
      } else {
        tp.hidden = 'until-found';
        tp.removeAttribute('tabindex');
      }
      if (footerRows[i]) footerRows[i].hidden = !selected;
    });
  }

  function openPanel() {
    panel.removeAttribute('data-closing');
    syncTabOrientation();
    if (!panel.open) {
      panel.showModal();
      syncTriggerOpenState(true);
    }
  }

  async function closePanel() {
    if (!panel.open) return;
    const reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    if (!reducedMotion && !supportsTopLayerExit()) {
      if (panel.hasAttribute('data-closing')) return;
      panel.setAttribute('data-closing', '');
      const animations = panel.getAnimations({ subtree: true });
      if (animations.length > 0) {
        await Promise.race([
          Promise.allSettled(animations.map((anim) => anim.finished)),
          new Promise((resolve) => setTimeout(resolve, 2000)),
        ]);
      }
      if (!panel.hasAttribute('data-closing')) return;
      panel.removeAttribute('data-closing');
    } else {
      panel.removeAttribute('data-closing');
    }

    if (panel.open) panel.close();
  }

  // Tablist 键盘导航（支持横向/纵向箭头切换，selection follows focus）与 find-in-page 自动展开。
  for (const [index, tab] of tabs.entries()) {
    tab.addEventListener('focus', () => selectTab(index));
    tab.addEventListener('click', () => selectTab(index));
    tab.addEventListener('keydown', (event) => {
      let next;
      switch (event.key) {
        case 'ArrowLeft':
        case 'ArrowUp':
          next = (index - 1 + tabs.length) % tabs.length;
          break;
        case 'ArrowRight':
        case 'ArrowDown':
          next = (index + 1) % tabs.length;
          break;
        case 'Home':
          next = 0;
          break;
        case 'End':
          next = tabs.length - 1;
          break;
        default:
          return;
      }
      event.preventDefault();
      tabs[next].focus();
    });
  }

  tabpanels.forEach((tp, index) => {
    tp.addEventListener('beforematch', () => selectTab(index));
  });

  trigger.addEventListener('click', () => {
    if (panel.open) closePanel();
    else openPanel();
  });

  closeBtn.addEventListener('click', () => closePanel());

  panel.addEventListener('cancel', (event) => {
    if (event.cancelable && !supportsTopLayerExit()) {
      event.preventDefault();
      closePanel();
    }
  });

  panel.addEventListener('close', () => {
    panel.returnValue = '';
    panel.removeAttribute('data-closing');
    syncTriggerOpenState(panel.open);
  });

  // Safari 等不支持 <dialog closedby="any"> 的浏览器降级为点遮罩关闭。
  if (!('closedBy' in HTMLDialogElement.prototype)) {
    const isOutsideDialog = (event) => {
      const rect = panel.getBoundingClientRect();
      return (
        event.clientX < rect.left ||
        event.clientX > rect.right ||
        event.clientY < rect.top ||
        event.clientY > rect.bottom
      );
    };
    let pressedOutside = false;
    panel.addEventListener('pointerdown', (event) => {
      pressedOutside = panel.open && isOutsideDialog(event);
    });
    panel.addEventListener('pointerup', (event) => {
      if (pressedOutside && panel.open && isOutsideDialog(event)) {
        closePanel();
      }
      pressedOutside = false;
    });
  }

  window.addEventListener('resize', syncTabOrientation, { passive: true });
  wideMedia?.addEventListener?.('change', syncTabOrientation);

  window.addEventListener('storage', (event) => {
    if (event.key === null || event.key === ANNOUNCEMENTS.seenStorageKey) {
      syncUnreadUi();
    }
  });

  syncTabOrientation();
  selectTab(0);
  syncUnreadUi();
  trigger.hidden = false;
}

if (typeof document !== 'undefined') {
  initAnnouncements();
}
