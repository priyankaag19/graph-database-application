// public/js/app.js
// Vanilla JS, no build step. Talks to the Express API under /api.

const els = {
  dbStatus: document.getElementById('dbStatus'),
  plannerForm: document.getElementById('plannerForm'),
  personSelect: document.getElementById('personSelect'),
  jobSelect: document.getElementById('jobSelect'),
  loadingState: document.getElementById('loadingState'),
  emptyState: document.getElementById('emptyState'),
  errorState: document.getElementById('errorState'),
  errorMessage: document.getElementById('errorMessage'),
  results: document.getElementById('results'),
  matchDial: document.getElementById('matchDial'),
  matchPercent: document.getElementById('matchPercent'),
  resultsHeading: document.getElementById('resultsHeading'),
  resultsSubheading: document.getElementById('resultsSubheading'),
  routeTrack: document.getElementById('routeTrack'),
  similarTransitions: document.getElementById('similarTransitions'),
  skillPathForm: document.getElementById('skillPathForm'),
  fromSkill: document.getElementById('fromSkill'),
  toSkill: document.getElementById('toSkill'),
  skillPathResult: document.getElementById('skillPathResult'),
};

async function fetchJSON(url) {
  const res = await fetch(url);
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `Request failed (${res.status})`);
  }
  return res.json();
}

function setState(name) {
  els.loadingState.hidden = name !== 'loading';
  els.emptyState.hidden = name !== 'empty';
  els.errorState.hidden = name !== 'error';
  els.results.hidden = name !== 'results';
}

function showError(message) {
  els.errorMessage.textContent = message;
  setState('error');
}

async function checkHealth() {
  try {
    const health = await fetchJSON('/health');
    els.dbStatus.textContent = 'CognoDB connected';
    els.dbStatus.dataset.state = 'ok';
  } catch (err) {
    els.dbStatus.textContent = 'CognoDB unreachable';
    els.dbStatus.dataset.state = 'down';
  }
}

function populateSelect(select, items, labelFn) {
  select.innerHTML = '';
  const placeholder = document.createElement('option');
  placeholder.value = '';
  placeholder.disabled = true;
  placeholder.selected = true;
  placeholder.textContent = 'Choose one…';
  select.appendChild(placeholder);
  for (const item of items) {
    const opt = document.createElement('option');
    opt.value = item.id;
    opt.textContent = labelFn(item);
    select.appendChild(opt);
  }
}

async function loadDropdowns() {
  try {
    const [people, jobs, skills] = await Promise.all([
      fetchJSON('/api/people'),
      fetchJSON('/api/jobs'),
      fetchJSON('/api/skills'),
    ]);

    populateSelect(els.personSelect, people, (p) => `${p.name} — ${p.currentTitle || 'no title on file'}`);
    populateSelect(els.jobSelect, jobs, (j) => `${j.title} (${j.level})`);
    populateSelect(els.fromSkill, skills, (s) => s.name);
    populateSelect(els.toSkill, skills, (s) => s.name);
  } catch (err) {
    showError(`Could not load data from the server. ${err.message}`);
  }
}

function renderRouteTrack(gapRows) {
  els.routeTrack.innerHTML = '';
  for (const row of gapRows) {
    const station = document.createElement('div');
    station.className = `station ${row.hasSkill ? 'has' : 'gap'}`;

    const coursesHtml = (row.courses || [])
      .slice(0, 2)
      .map(
        (c) =>
          `<li><a href="${escapeAttr(c.url)}" target="_blank" rel="noopener">${escapeHtml(c.name)}</a> <span class="course-depth">· ${escapeHtml(c.depth || '')}</span></li>`
      )
      .join('');

    station.innerHTML = `
      <span class="station-dot" aria-hidden="true"></span>
      <span class="station-importance">weight ${row.importance ?? '—'}/5</span>
      <span class="station-name">${escapeHtml(row.skillName)}</span>
      <span class="station-tag">${row.hasSkill ? 'already have it' : 'gap to close'}</span>
      ${!row.hasSkill && coursesHtml ? `<ul class="station-courses">${coursesHtml}</ul>` : ''}
    `;
    els.routeTrack.appendChild(station);
  }
}

function renderSimilarTransitions(rows) {
  els.similarTransitions.innerHTML = '';
  if (!rows.length) {
    els.similarTransitions.innerHTML = '<li>No recorded transitions into this role yet.</li>';
    return;
  }
  for (const row of rows) {
    const li = document.createElement('li');
    const chips = row.bridgingSkills.map((s) => `<span class="chip">${escapeHtml(s)}</span>`).join('');
    li.innerHTML = `
      <span class="t-name">${escapeHtml(row.name)}</span>
      <span class="t-meta">${escapeHtml(row.currentTitle || '')}${row.company ? ' · ' + escapeHtml(row.company) : ''} · ${row.bridgeCount} bridging skill${row.bridgeCount === 1 ? '' : 's'}</span>
      <div class="t-skills">${chips}</div>
    `;
    els.similarTransitions.appendChild(li);
  }
}

function escapeHtml(str) {
  return String(str ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function escapeAttr(str) {
  return escapeHtml(str);
}

async function runPlanner(personId, jobId) {
  setState('loading');
  try {
    const [gapRows, jobMatches, similar, personProfile, jobList] = await Promise.all([
      fetchJSON(`/api/gap-analysis?personId=${encodeURIComponent(personId)}&jobId=${encodeURIComponent(jobId)}`),
      fetchJSON(`/api/job-match/${encodeURIComponent(personId)}`),
      fetchJSON(`/api/similar-transitions?jobId=${encodeURIComponent(jobId)}`),
      fetchJSON(`/api/people/${encodeURIComponent(personId)}`),
      fetchJSON('/api/jobs'),
    ]);

    const targetJob = jobList.find((j) => j.id === jobId);
    const matchForTarget = jobMatches.find((m) => m.jobId === jobId);
    const pct = matchForTarget ? matchForTarget.matchPercentage : 0;

    els.matchPercent.textContent = `${pct}%`;
    els.resultsHeading.textContent = `${personProfile.name} → ${targetJob ? targetJob.title : 'target role'}`;
    const gapCount = gapRows.filter((r) => !r.hasSkill).length;
    els.resultsSubheading.textContent = gapCount === 0
      ? 'Every required skill is already covered — this route is clear.'
      : `${gapCount} skill${gapCount === 1 ? '' : 's'} to close out of ${gapRows.length} required.`;

    renderRouteTrack(gapRows);
    renderSimilarTransitions(similar);

    setState('results');
  } catch (err) {
    showError(err.message || 'Could not chart that route.');
  }
}

els.plannerForm.addEventListener('submit', (e) => {
  e.preventDefault();
  const personId = els.personSelect.value;
  const jobId = els.jobSelect.value;
  if (!personId || !jobId) return;
  runPlanner(personId, jobId);
});

els.skillPathForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const fromSkillId = els.fromSkill.value;
  const toSkillId = els.toSkill.value;
  if (!fromSkillId || !toSkillId) return;

  els.skillPathResult.innerHTML = '<span class="path-node">Searching…</span>';
  try {
    const result = await fetchJSON(`/api/skill-path?fromSkillId=${encodeURIComponent(fromSkillId)}&toSkillId=${encodeURIComponent(toSkillId)}`);
    if (!result.skillPath || !result.skillPath.length) {
      els.skillPathResult.innerHTML = '<span class="path-node">No connected path found within 6 hops.</span>';
      return;
    }
    els.skillPathResult.innerHTML = result.skillPath
      .map((n) => `<span class="path-node">${escapeHtml(n.name)}</span>`)
      .join('<span class="path-arrow">→</span>');
  } catch (err) {
    els.skillPathResult.innerHTML = `<span class="path-node">${escapeHtml(err.message)}</span>`;
  }
});

checkHealth();
loadDropdowns();
setState('empty');
