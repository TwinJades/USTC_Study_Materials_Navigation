const trigger = document.querySelector('.announcement-toggle');
const panel = document.createElement('dialog');
panel.id = 'announcements';
panel.className = 'announcement-panel';
panel.setAttribute('aria-labelledby', 'announcement-title');
// Maintainer-authored HTML only; never feed remote content into this template.
panel.innerHTML = `
  <header>
    <h2 id="announcement-title">公告栏</h2>
    <button type="button" class="secondary" data-close>关闭</button>
  </header>
  <div role="tablist" aria-label="公告分类">
    <button type="button" class="secondary" role="tab" id="announcement-news-tab" aria-controls="announcement-news" aria-selected="true" autofocus>近期更新</button>
    <button type="button" class="secondary" role="tab" id="announcement-projects-tab" aria-controls="announcement-projects" aria-selected="false" tabindex="-1">衍生项目</button>
  </div>
  <div role="tabpanel" id="announcement-news" aria-labelledby="announcement-news-tab" tabindex="0">
    <p>新版页面已上线。课程详情的详细模式可查看资料来源、收录依据和已核验文件的取样信息。</p>
    <p><a href="https://github.com/TwinJades/USTC_Study_Materials_Navigation/blob/main/CHANGELOG.md">查看完整更新日志</a></p>
  </div>
  <div role="tabpanel" id="announcement-projects" aria-labelledby="announcement-projects-tab" tabindex="0" hidden>
    <p><a href="https://github.com/DDNdles/USTC-Question-Bank">USTC Question Bank（DDNdles）</a>：参考也西书架等索引整理的中科大本科课程结构化题库，按课程与知识点组织题目和解析，提供 JSONL 数据。</p>
  </div>`;

document.body.append(panel);
const tabs = [...panel.querySelectorAll('[role="tab"]')];
const tabpanels = tabs.map((tab) => document.getElementById(tab.getAttribute('aria-controls')));

function selectTab(index) {
  tabs.forEach((tab, i) => {
    const selected = i === index;
    tab.setAttribute('aria-selected', String(selected));
    tab.tabIndex = selected ? 0 : -1;
    tab.autofocus = selected;
    tabpanels[i].hidden = !selected;
  });
}

for (const [index, tab] of tabs.entries()) {
  tab.addEventListener('focus', () => selectTab(index));
  tab.addEventListener('click', () => tab.focus());
  tab.addEventListener('keydown', (event) => {
    let next;
    switch (event.key) {
      case 'ArrowLeft': next = (index - 1 + tabs.length) % tabs.length; break;
      case 'ArrowRight': next = (index + 1) % tabs.length; break;
      case 'Home': next = 0; break;
      case 'End': next = tabs.length - 1; break;
      default: return;
    }
    event.preventDefault();
    tabs[next].focus();
  });
}

const close = panel.querySelector('[data-close]');
if (typeof panel.showPopover === 'function') {
  panel.setAttribute('popover', 'auto');
  close.setAttribute('popovertarget', panel.id);
  close.setAttribute('popovertargetaction', 'hide');
} else {
  // Native dialog keeps the announcement usable in browsers without Popover.
  trigger.removeAttribute('popovertarget');
  trigger.addEventListener('click', () => panel.showModal());
  close.addEventListener('click', () => panel.close());
}
trigger.hidden = false;
