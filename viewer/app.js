/* Static report presentation by Codex. This file never runs a package or contract. */
(() => {
  'use strict';

  const SCHEMA = 'packproof-report-v1';
  const MAX_BYTES = 8 * 1024 * 1024;
  const MAX_REPORTS = 500;
  const MAX_DISPLAY_TEXT = 120000;
  const OUTCOMES = ['PASS', 'FAIL', 'INCONCLUSIVE'];
  const STAGES = ['Source', 'Archive', 'Consumer', 'Checks'];
  const $ = (id) => document.getElementById(id);
  const state = { collection: null, selected: 0, stage: 'Consumer', imported: false, loading: false, loadVersion: 0 };
  const isRecord = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
  const record = (value) => isRecord(value) ? value : {};
  const string = (value, fallback = 'Not recorded') => typeof value === 'string' && value.length ? value : fallback;
  const display = (value) => value == null ? 'Not recorded' : typeof value === 'object' ? JSON.stringify(value) : String(value);

  function element(tag, className, value) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (value !== undefined) node.textContent = value;
    return node;
  }

  function button(label, className, handler) {
    const node = element('button', className, label);
    node.type = 'button';
    node.addEventListener('click', handler);
    return node;
  }

  function announce(message) { $('live-status').textContent = message; }

  function badge(value) {
    const text = string(value, 'NOT RECORDED').toUpperCase();
    const tone = ['pass', 'fail', 'inconclusive', 'error', 'timeout'].includes(text.toLowerCase()) ? text.toLowerCase() : 'neutral';
    return element('span', `status status-${tone}`, text);
  }

  function date(value) {
    if (typeof value !== 'string' || !value) return 'Timestamp not recorded';
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) return `Unrecognized timestamp: ${value}`;
    return new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'UTC' }).format(parsed) + ' UTC';
  }

  function validateCollection(value) {
    if (!isRecord(value)) throw new Error('Use one PackProof report or an object containing a reports array.');
    const collection = Array.isArray(value.reports) ? value : { reports: [value] };
    if (collection.reports.length > MAX_REPORTS) throw new Error(`This viewer supports up to ${MAX_REPORTS} reports in one collection.`);
    collection.reports.forEach((report, index) => {
      const prefix = `Report ${index + 1}: `;
      if (!isRecord(report) || report.$schema !== SCHEMA) throw new Error(prefix + `expected $schema "${SCHEMA}".`);
      if (typeof report.caseName !== 'string' || !report.caseName.trim()) throw new Error(prefix + 'caseName must be a non-empty string.');
      if (!isRecord(report.result) || !OUTCOMES.includes(report.result.outcome)) throw new Error(prefix + 'result.outcome must be PASS, FAIL, or INCONCLUSIVE.');
      for (const field of ['archive', 'consumer', 'contract', 'environment', 'verify', 'sourceBaseline']) {
        if (report[field] != null && !isRecord(report[field])) throw new Error(prefix + field + ' must be an object or null.');
      }
      if (report.archive?.packedFiles != null && (!Array.isArray(report.archive.packedFiles) || report.archive.packedFiles.some((item) => typeof item !== 'string'))) {
        throw new Error(prefix + 'archive.packedFiles must be an array of file paths.');
      }
      if (report.expectedOutcome != null && !OUTCOMES.includes(report.expectedOutcome)) throw new Error(prefix + 'expectedOutcome must be PASS, FAIL, or INCONCLUSIVE.');
    });
    if (collection.sourceBaseline != null && !isRecord(collection.sourceBaseline)) throw new Error('Collection sourceBaseline must be an object or null.');
    return collection;
  }

  function parseCollection(text) {
    let value;
    try { value = JSON.parse(text.replace(/^\uFEFF/, '')); }
    catch { throw new Error('The file is not valid JSON. Export a complete PackProof report and try again.'); }
    return validateCollection(value);
  }

  function baselineFor(report) {
    const local = record(report.sourceBaseline);
    if (local.status && local.status !== 'not-run') return { value: local, shared: false };
    const shared = record(state.collection?.sourceBaseline);
    if (shared.status && shared.status !== 'not-run') return { value: shared, shared: true };
    return { value: local, shared: false };
  }

  function setCollection(collection, imported, filename = '') {
    state.collection = collection;
    state.imported = imported;
    state.selected = Math.max(0, collection.reports.findIndex((report) => report.caseName === 'missing-template-operation'));
    $('case-search').value = '';
    $('outcome-filter').value = 'all';
    $('import-error').hidden = true;
    $('report-file').removeAttribute('aria-invalid');
    $('load-error').hidden = true;
    $('loading-state').hidden = true;
    $('browser-layout').hidden = !collection.reports.length;
    $('empty-state').hidden = Boolean(collection.reports.length);
    $('reset-data').hidden = !imported;
    $('report-count').textContent = `${collection.reports.length} ${collection.reports.length === 1 ? 'record' : 'records'}`;
    const savedDate = collection.generatedAt || collection.reports[0]?.recordedAt;
    $('collection-caption').textContent = `${imported ? `Local import · ${filename}` : 'Saved evidence'} · ${date(savedDate)}`;
    const baseNote = 'Saved reports only. This viewer does not execute packages, rerun checks, or authenticate the origin of imported evidence.';
    $('evidence-note').textContent = typeof collection.evidenceNote === 'string' && collection.evidenceNote.trim() ? `${collection.evidenceNote} ${baseNote}` : baseNote;
    $('source-commit').textContent = collection.sourceCommit ? `Recorded source commit · ${display(collection.sourceCommit)}` : 'Source commit not included in this collection.';
    renderComparison();
    renderList();
    if (collection.reports.length) renderReport();
    announce(`${collection.reports.length} reports loaded${imported ? ' from a local file' : ''}.`);
  }

  async function loadSaved() {
    if (state.loading) return;
    const version = ++state.loadVersion;
    state.loading = true;
    $('retry-data').disabled = true;
    $('reset-data').disabled = true;
    $('loading-state').hidden = Boolean(state.collection);
    $('load-error').hidden = true;
    try {
      const response = await fetch('./data.json', { cache: 'no-store', credentials: 'omit' });
      if (!response.ok) throw new Error(`Saved data returned HTTP ${response.status}.`);
      const blob = await response.blob();
      if (blob.size > MAX_BYTES) throw new Error('The saved collection exceeds the 8 MB display limit.');
      const collection = parseCollection(await blob.text());
      if (version === state.loadVersion) setCollection(collection, false);
    } catch (error) {
      if (version !== state.loadVersion) return;
      $('load-error-text').textContent = `${error.message} Serve the viewer folder over local HTTP, or use Import JSON to open a report directly from your computer.`;
      $('load-error').hidden = false;
      if (!state.collection) $('collection-caption').textContent = 'No saved evidence loaded';
    } finally {
      state.loading = false;
      $('loading-state').hidden = true;
      $('retry-data').disabled = false;
      $('reset-data').disabled = false;
    }
  }

  async function importFile(file) {
    if (!file) return;
    $('import-trigger').disabled = true;
    $('import-trigger').setAttribute('aria-busy', 'true');
    try {
      if (file.size > MAX_BYTES) throw new Error('This file exceeds 8 MB. Import a smaller report collection.');
      const collection = parseCollection(await file.text());
      // Only a valid import replaces a pending default fetch. An invalid file
      // must not suppress saved evidence that is still loading.
      state.loadVersion += 1;
      setCollection(collection, true, file.name);
    } catch (error) {
      $('import-error').textContent = `Could not import ${file.name}. ${error.message} Your current evidence is unchanged. Choose another JSON file to retry.`;
      $('import-error').hidden = false;
      $('report-file').setAttribute('aria-invalid', 'true');
    } finally {
      $('import-trigger').disabled = false;
      $('import-trigger').removeAttribute('aria-busy');
      $('report-file').value = '';
    }
  }

  function renderComparison() {
    const reports = state.collection.reports;
    const missing = reports.find((report) => report.caseName === 'missing-template-operation');
    const fixed = reports.find((report) => report.caseName === 'fixed-operation');
    const sourcePassed = missing && baselineFor(missing).value.status === 'pass';
    const headline = $('hero-title');
    headline.replaceChildren();
    if (missing?.result.outcome === 'FAIL' && sourcePassed) {
      headline.append(document.createTextNode('Source passed.'), element('br'), document.createTextNode('The archive did not.'));
      $('hero-description').textContent = 'A label template existed in the source tree but was missing from the package. The saved consumer run exposes the gap.';
    } else {
      headline.append(document.createTextNode('Read the artifact.'), element('br'), document.createTextNode('Trace the evidence.'));
      $('hero-description').textContent = 'A source test sees your working tree. A consumer gets your archive. Follow the saved evidence from one to the other.';
    }
    $('comparison').hidden = !(missing && fixed);
    if (!missing || !fixed) return;
    const container = $('comparison-cases');
    container.replaceChildren();
    [[missing, '01 / Missing template', 'A file left behind', 'The operation reads a template from the installed package.'], [fixed, '02 / Fixed package', 'The template ships', 'The corrected archive includes the operation’s template.']].forEach(([report, label, title, description]) => {
      const card = element('article', 'comparison-case');
      const top = element('div', 'comparison-top');
      top.append(element('p', '', label), badge(report.result.outcome));
      card.append(top, element('h3', '', title), element('p', '', description));
      const paths = record(report.archive).packedFiles;
      const template = Array.isArray(paths) ? paths.find((path) => /(?:^|\/)templates?\//i.test(path)) : null;
      const fileEvidence = element('div', 'file-evidence');
      fileEvidence.append(element('span', '', template || 'templates/'), element('strong', '', Array.isArray(paths) ? template ? 'IN FILE LIST' : 'NOT IN FILE LIST' : 'LIST NOT RECORDED'));
      card.append(fileEvidence, button('Inspect this record ↗', 'text-button', () => {
        state.selected = reports.indexOf(report);
        $('case-search').value = '';
        $('outcome-filter').value = 'all';
        renderList();
        renderReport();
        $('report-detail').focus({ preventScroll: true });
        $('evidence-browser').scrollIntoView({ block: 'start' });
      }));
      container.append(card);
    });
    const hashA = missing.contract?.contractCopiedSHA256;
    const hashB = fixed.contract?.contractCopiedSHA256;
    const sameContract = typeof hashA === 'string' && /^[a-f\d]{64}$/i.test(hashA) && hashA.toLowerCase() === String(hashB).toLowerCase();
    $('comparison-note').textContent = `${sameContract ? 'Matching recorded contract hashes link these two runs.' : 'Inspect the recorded contracts to compare the operations.'} Outcomes describe these saved runs; expected control results remain separate below.`;
    const subtitle = $('comparison-title').parentElement.nextElementSibling;
    subtitle.replaceChildren(document.createTextNode('Recorded control cases'), element('br'), element('span', 'muted', sameContract ? 'Same recorded contract hash' : 'Compare contract evidence'));
  }

  function renderList() {
    if (!state.collection) return;
    const query = $('case-search').value.trim().toLowerCase();
    const outcome = $('outcome-filter').value;
    const list = $('case-list');
    list.replaceChildren();
    let count = 0;
    state.collection.reports.forEach((report, index) => {
      const searchable = `${report.caseName} ${string(report.archive?.packageName, '')}`.toLowerCase();
      if (!searchable.includes(query) || (outcome !== 'all' && report.result.outcome !== outcome)) return;
      count += 1;
      const node = button('', 'case-button', () => {
        state.selected = index;
        updateSelection();
        renderReport();
        announce(`${report.caseName}. Observed ${report.result.outcome}.`);
      });
      node.dataset.index = String(index);
      node.setAttribute('aria-current', index === state.selected ? 'true' : 'false');
      const meta = element('span', 'case-meta');
      meta.append(badge(report.result.outcome), element('span', 'case-number', String(index + 1).padStart(2, '0')));
      node.append(element('span', 'case-name', report.caseName), meta);
      list.append(node);
    });
    $('visible-count').textContent = `${count}`;
    $('empty-filter').hidden = count !== 0;
    $('clear-filters').hidden = !(query || outcome !== 'all');
  }

  function updateSelection() {
    for (const node of $('case-list').children) node.setAttribute('aria-current', Number(node.dataset.index) === state.selected ? 'true' : 'false');
  }

  function renderReport() {
    const report = state.collection.reports[state.selected];
    const detail = $('report-detail');
    detail.replaceChildren();
    const header = element('header', 'report-header');
    const kicker = element('div', 'report-kicker');
    kicker.append(element('p', 'eyebrow', `Record ${String(state.selected + 1).padStart(2, '0')}`), element('span', 'mono muted', state.imported ? 'LOCAL IMPORT' : 'SAVED REPORT'));
    const title = element('h2', 'report-title', report.caseName);
    title.id = 'report-title';
    const outcome = element('div', 'outcome-summary');
    outcome.append(badge(report.result.outcome), element('p', '', string(report.result.reason, 'No outcome reason recorded.')));
    const expected = element('p', 'control-expectation');
    if (report.expectedOutcome) {
      expected.append(document.createTextNode('Expected control outcome: '), element('strong', '', report.expectedOutcome), document.createTextNode(` · ${report.expectedOutcome === report.result.outcome ? 'Observed as expected' : 'Does not match expectation'}.`));
    } else expected.textContent = 'Expected control outcome: not supplied.';
    header.append(kicker, title, element('p', 'report-timestamp', `Recorded ${date(report.recordedAt)} · Observed consumer outcome`), outcome, expected);
    const tabs = element('div', 'stage-tabs');
    tabs.setAttribute('role', 'tablist');
    tabs.setAttribute('aria-label', 'Evidence stage');
    STAGES.forEach((stage, index) => {
      const tab = button('', 'stage-tab', () => setStage(stage));
      tab.id = `tab-${stage.toLowerCase()}`;
      tab.setAttribute('role', 'tab');
      tab.setAttribute('aria-controls', 'stage-panel');
      tab.append(element('span', '', String(index + 1).padStart(2, '0')), document.createTextNode(stage));
      tab.addEventListener('keydown', (event) => {
        let next;
        if (event.key === 'ArrowRight') next = (index + 1) % STAGES.length;
        if (event.key === 'ArrowLeft') next = (index + STAGES.length - 1) % STAGES.length;
        if (event.key === 'Home') next = 0;
        if (event.key === 'End') next = STAGES.length - 1;
        if (next !== undefined) { event.preventDefault(); setStage(STAGES[next]); tabs.children[next].focus(); }
      });
      tabs.append(tab);
    });
    const panel = element('section', 'stage-content');
    panel.id = 'stage-panel';
    panel.setAttribute('role', 'tabpanel');
    panel.tabIndex = 0;
    const footer = element('footer', 'report-footer');
    footer.append(element('p', '', `${SCHEMA} · Original values preserved in the download.`), button('Download report JSON ↓', 'button button-quiet', () => download(report)));
    detail.append(header, tabs, panel, footer);
    setStage(state.stage);
  }

  function setStage(stage) {
    state.stage = stage;
    STAGES.forEach((name) => {
      const tab = $(`tab-${name.toLowerCase()}`);
      tab.setAttribute('aria-selected', name === stage ? 'true' : 'false');
      tab.tabIndex = name === stage ? 0 : -1;
    });
    const panel = $('stage-panel');
    panel.setAttribute('aria-labelledby', `tab-${stage.toLowerCase()}`);
    panel.replaceChildren();
    const report = state.collection.reports[state.selected];
    ({ Source: renderSource, Archive: renderArchive, Consumer: renderConsumer, Checks: renderChecks })[stage](panel, report);
  }

  function heading(container, title, description, status) {
    const row = element('div', 'stage-heading');
    row.append(element('h3', '', title));
    if (status) row.append(badge(status));
    container.append(row, element('p', 'stage-description', description));
  }

  function facts(container, rows) {
    const dl = element('dl', 'facts');
    rows.forEach(([label, value, code]) => dl.append(element('dt', '', label), element('dd', code ? 'code-value' : '', display(value))));
    container.append(dl);
  }

  function disclosure(container, title) {
    const details = element('details');
    details.append(element('summary', '', title));
    container.append(details);
    return details;
  }

  function raw(container, value) {
    const text = typeof value === 'string' ? value || '(empty)' : JSON.stringify(value, null, 2) ?? 'Not recorded';
    const pre = element('pre', '', text.slice(0, MAX_DISPLAY_TEXT));
    pre.tabIndex = 0;
    container.append(pre);
    if (text.length > MAX_DISPLAY_TEXT) container.append(element('p', 'muted', 'Display shortened. Download the report JSON for the complete value.'));
  }

  function outputs(container, { stdout, stderr, error }, title = 'Raw process output') {
    const details = disclosure(container, title);
    details.append(element('p', 'log-title', 'stdout'));
    raw(details, stdout);
    details.append(element('p', 'log-title', 'stderr'));
    raw(details, stderr);
    if (error) { details.append(element('p', 'log-title', 'process error')); raw(details, error); }
  }

  function hash(container, label, value) {
    const block = element('div', 'hash-block');
    const line = element('div', 'hash-label');
    line.append(element('span', '', label));
    if (typeof value === 'string' && value) line.append(button('Copy hash', '', async (event) => {
      const control = event.currentTarget;
      try {
        if (!navigator.clipboard?.writeText) throw new Error('Clipboard unavailable');
        await navigator.clipboard.writeText(value);
        control.textContent = 'Copied';
        announce(`${label} copied.`);
        window.setTimeout(() => { control.textContent = 'Copy hash'; }, 1800);
      } catch {
        control.textContent = 'Select hash below';
        announce('Clipboard access is unavailable. Select the hash text below and copy it manually.');
      }
    }));
    block.append(line, element('code', 'hash-value', string(value)));
    container.append(block);
  }

  function renderSource(container, report) {
    const { value: source, shared } = baselineFor(report);
    heading(container, 'The source baseline', shared ? 'This collection includes a shared source baseline. It is separate evidence, not a consumer run for this case.' : 'The recorded source test runs against the working tree. Its outcome does not replace the consumer contract result.', source.status);
    if (!source.status || source.status === 'not-run') {
      container.append(element('p', 'not-recorded', string(source.reason, 'No source baseline was recorded for this report.')));
      return;
    }
    facts(container, [['Recorded', date(source.recordedAt)], ['Exit code', source.exit], ['Timed out', source.timedOut], ['Signal', source.signal || 'None recorded'], ['Command', Array.isArray(source.command) ? source.command.join(' ') : source.command, true]]);
    hash(container, 'Source test script · SHA-256', source.scriptHash);
    outputs(container, source, 'Source test output');
    raw(disclosure(container, 'Complete source baseline record'), source);
  }

  function renderArchive(container, report) {
    const archive = record(report.archive);
    heading(container, 'What went into the archive', 'Recorded npm pack identity and file list. The browser does not open or re-hash the archive.');
    facts(container, [['Package', archive.packageName, true], ['Source fixture', archive.fixtureDir, true], ['Archive path', archive.tarballPath, true], ['Pack exit code', archive.packExit], ['Timed out', archive.packTimedOut], ['Signal', archive.packSignal || 'None recorded']]);
    hash(container, 'Packed archive · SHA-256', archive.archiveSHA256);
    const files = archive.packedFiles;
    const details = disclosure(container, Array.isArray(files) ? `Packed files · ${files.length}` : 'Packed files · not recorded');
    details.open = true;
    if (Array.isArray(files) && files.length) {
      const list = element('ul', 'file-list');
      files.forEach((path) => list.append(element('li', '', path)));
      details.append(list);
    } else details.append(element('p', 'not-recorded', Array.isArray(files) ? 'No files were listed in this report.' : 'The packed file list was not recorded.'));
    outputs(container, { stdout: archive.packStdout, stderr: archive.packStderr, error: archive.packError }, 'npm pack output');
  }

  function renderConsumer(container, report) {
    const consumer = record(report.consumer);
    const contract = record(report.contract);
    heading(container, 'The installed-package operation', 'A contract exercises the package installed from the archive. These are the saved process results, including failed assertions and timeouts.');
    facts(container, [['Installed package', consumer.installedPkgName, true], ['Consumer path', consumer.consumerDir, true], ['Install exit code', consumer.installExit], ['Contract exit code', contract.exitCode], ['Contract timed out', contract.timedOut], ['Contract signal', contract.signal || 'None recorded'], ['Timeout bound', typeof contract.timeoutMs === 'number' ? `${contract.timeoutMs} ms` : null], ['Executed copy', contract.contractCopiedPath, true]]);
    hash(container, 'Executed contract copy · SHA-256 before execution', contract.contractCopiedSHA256);
    outputs(container, contract, 'Contract stdout / stderr');
    outputs(container, { stdout: consumer.installStdout, stderr: consumer.installStderr, error: consumer.installError }, 'npm install output');
    raw(disclosure(container, 'Recorded commands'), report.commands);
    raw(disclosure(container, 'Environment and consumer identity'), { environment: report.environment, consumer });
  }

  function renderChecks(container, report) {
    const verify = record(report.verify);
    heading(container, 'The evidence prerequisites', 'These check results were recorded by PackProof. A missing or inconclusive prerequisite cannot establish a consumer PASS.');
    if (!Object.keys(verify).length) {
      container.append(element('p', 'not-recorded', 'No verification record is present. The displayed outcome is the report’s declared result.'));
      return;
    }
    facts(container, [['All required checks', verify.allRequired === true ? 'Recorded as satisfied' : verify.allRequired === false ? 'Recorded as not satisfied' : 'Not recorded'], ['Failure reason', verify.failureReason || 'None recorded']]);
    const labels = { isolation: 'Consumer isolation', identity: 'Installed package identity', contractHash: 'Executed contract bytes', installedBytes: 'Installed bytes / archive integrity', contractHashAfter: 'Contract hash after execution' };
    const list = element('div', 'check-list');
    for (const [key, label] of Object.entries(labels)) {
      if (key === 'contractHashAfter' && !verify[key]) continue;
      const check = record(verify[key]);
      const row = element('div', 'check-row');
      const top = element('div', 'check-row-header');
      top.append(element('h4', '', label), badge(check.status));
      row.append(top, element('p', '', string(check.reason, 'No check result was recorded.')));
      if (Object.keys(check).length) raw(disclosure(row, 'Inspect check record'), check);
      list.append(row);
    }
    container.append(list);
    if (verify.before) raw(disclosure(container, 'Before-execution verification record'), verify.before);
    raw(disclosure(container, 'Complete verification record'), verify);
  }

  function download(report) {
    const url = URL.createObjectURL(new Blob([JSON.stringify(report, null, 2) + '\n'], { type: 'application/json' }));
    const link = element('a');
    link.href = url;
    link.download = `${report.caseName.replace(/[^a-zA-Z0-9._-]/g, '-').slice(0, 100) || 'packproof'}-report.json`;
    document.body.append(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    announce('Report JSON download started.');
  }

  $('import-trigger').addEventListener('click', () => $('report-file').click());
  $('empty-import').addEventListener('click', () => $('report-file').click());
  $('report-file').addEventListener('change', (event) => importFile(event.target.files[0]));
  $('retry-data').addEventListener('click', loadSaved);
  $('reset-data').addEventListener('click', loadSaved);
  $('case-search').addEventListener('input', renderList);
  $('outcome-filter').addEventListener('change', renderList);
  $('clear-filters').addEventListener('click', () => {
    $('case-search').value = '';
    $('outcome-filter').value = 'all';
    renderList();
    $('case-search').focus();
  });
  loadSaved();
})();
