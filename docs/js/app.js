import { judgeAll, ageOn, FIELD_LABELS, HOUSEHOLD_LABELS, todayStr } from './engine.js';
import * as store from './store.js';
import { NEEDS, NEED_LABELS, needsOf, matchedNeeds } from './needs.js';

/* ---------------- 공통 도구 ---------------- */
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = (v) =>
  String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const nl2br = (s) => esc(s).replace(/\n/g, '<br>');
const won = (n) => (n >= 10000 ? `${Math.round(n / 10000).toLocaleString()}만원` : `${n.toLocaleString()}원`);
const ymd = (s) => (s && s.length === 8 ? `${s.slice(0, 4)}.${s.slice(4, 6)}.${s.slice(6)}` : s || '');
const app = $('#app');

const ROLE = {
  family: { label: '자녀·가족', title: '부모님', who: '부모님' },
  supporter: { label: '생활지원사', title: '담당 어르신', who: '어르신' },
  caregiver: { label: '요양보호사', title: '담당 어르신', who: '어르신' },
};
const isCareWorker = () => ['supporter', 'caregiver'].includes(store.getState().settings.role);

const ACTION_LABELS = {
  applied: '신청 완료',
  notEligible: '해당 없음',
  rejected: '탈락',
  visit: '방문 때 안내',
  told: '안내함',
};
const DONE = new Set(['applied', 'notEligible', 'rejected', 'told']);

let DATA = { services: [], meta: null, standards: null, error: null };

function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => t.classList.remove('show'), 2600);
}

function applyFontScale() {
  document.documentElement.dataset.font = store.getState().settings.fontScale || 'normal';
}

/* ---------------- 데이터 ---------------- */
async function loadData() {
  try {
    const [services, meta, standards] = await Promise.all(
      ['data/services.json', 'data/meta.json', 'data/standards.json'].map((u) =>
        fetch(u, { cache: 'no-cache' }).then((r) => {
          if (!r.ok) throw new Error(`${u} ${r.status}`);
          return r.json();
        }),
      ),
    );
    DATA = { services, meta, standards, error: null };
  } catch (e) {
    DATA.error = e.message;
  }
}

const regions = () => DATA.meta?.regions || {};

function resultsFor(elder) {
  return judgeAll(DATA.services, elder, DATA.standards);
}

/** 체크한 '도움이 필요한 분야'에 해당하는 복지를 앞으로 (같은 조건이면 원래 순서 유지) */
function byNeeds(results, elder) {
  if (!elder.needs?.length) return results;
  return results
    .map((r, i) => ({ r, i, n: matchedNeeds(r.service, elder.needs).length }))
    .sort((a, b) => (b.n > 0) - (a.n > 0) || a.i - b.i)
    .map((x) => x.r);
}

function categorize(elder) {
  const results = byNeeds(resultsFor(elder), elder);
  const actions = store.getActions(elder.id);
  const seen = store.getSeen(elder.id);
  const done = (r) => DONE.has(actions[r.service.id]?.status);
  return {
    all: results,
    new: results.filter((r) => !seen.has(r.service.id) && !done(r)),
    likely: results.filter((r) => r.status === 'likely' && !done(r)),
    check: results.filter((r) => r.status === 'check' && !done(r)),
    visit: results.filter((r) => actions[r.service.id]?.status === 'visit'),
    done: results.filter(done),
  };
}

/* ---------------- 알림 ---------------- */
async function notifyNew() {
  const s = store.getState().settings;
  if (!s.notify || !('Notification' in window) || Notification.permission !== 'granted') return;
  const reg = await navigator.serviceWorker?.getRegistration();
  for (const elder of store.getState().elders) {
    const notified = store.getNotified(elder.id);
    const fresh = categorize(elder).new.filter((r) => !notified.has(r.service.id));
    if (!fresh.length) continue;
    const title = `${elder.nickname}께 새 복지 ${fresh.length}건`;
    const body = fresh
      .slice(0, 3)
      .map((r) => `· ${r.service.name}`)
      .join('\n');
    const opts = { body, tag: `elder-${elder.id}`, icon: 'icons/icon-192.png', badge: 'icons/icon-192.png', data: { url: `#/elder/${elder.id}?tab=new` } };
    if (reg) reg.showNotification(title, opts);
    else new Notification(title, opts);
    store.markNotified(elder.id, fresh.map((r) => r.service.id));
  }
}

/** 어르신 등록 시점의 복지는 '새 소식'이 아니라 기본 목록으로 둠 */
function baseline(elder) {
  const ids = resultsFor(elder).map((r) => r.service.id);
  store.markSeen(elder.id, ids);
  store.markNotified(elder.id, ids);
}

/* ---------------- 라우터 ---------------- */
function parseHash() {
  const [path, query] = location.hash.replace(/^#/, '').split('?');
  const parts = path.split('/').filter(Boolean);
  return { parts, query: new URLSearchParams(query || '') };
}

function route() {
  applyFontScale();
  const { parts, query } = parseHash();
  renderNav(parts[0] || '');
  window.scrollTo(0, 0);
  if (DATA.error && parts[0] !== 'settings') return renderError();
  const [a, b, c] = parts;
  if (!a) return renderHome();
  if (a === 'start' && b) {
    store.updateSettings({ role: b });
    location.hash = '#/elder/new';
    return;
  }
  if (a === 'elder' && b === 'new') return renderElderForm(null);
  if (a === 'elder' && b && c === 'edit') return renderElderForm(store.getElder(b));
  if (a === 'elder' && b) return renderElder(b, query.get('tab'));
  if (a === 'visits') return renderVisits();
  if (a === 'settings') return renderSettings();
  if (a === 'import' && b) return renderImport(b);
  if (a === 'about') return renderAbout();
  renderHome();
}

function renderNav(current) {
  const s = store.getState();
  const items = [
    ['', '홈'],
    ...(isCareWorker() ? [['visits', '방문 목록']] : []),
    ['settings', '설정'],
  ];
  $('#nav').innerHTML = s.settings.role
    ? items.map(([k, label]) => `<a href="#/${k}" class="${current === k ? 'on' : ''}">${label}</a>`).join('')
    : '';
}

function renderError() {
  app.innerHTML = `<section class="panel"><h2>데이터를 불러오지 못했어요</h2>
  <p>인터넷 연결을 확인한 뒤 다시 시도해 주세요.</p><p class="muted">${esc(DATA.error)}</p>
  <button class="btn" onclick="location.reload()">다시 시도</button></section>`;
}

/* ---------------- 홈 ---------------- */
function renderHome() {
  const s = store.getState();
  if (!s.settings.role || !s.elders.length) return renderWelcome();
  const role = ROLE[s.settings.role] || ROLE.family;
  const cards = s.elders
    .map((e) => {
      const c = categorize(e);
      const age = ageOn(e.birthDate);
      return `<a class="elder-card" href="#/elder/${e.id}${c.new.length ? '?tab=new' : ''}">
        <div class="elder-head"><strong>${esc(e.nickname)}</strong>${c.new.length ? `<span class="badge new">새 소식 ${c.new.length}</span>` : ''}</div>
        <div class="muted">${esc([e.sido, e.sigungu].filter(Boolean).join(' '))}${age !== null ? ` · 만 ${age}세` : ''}</div>
        ${e.needs?.length ? `<div class="need-tags">${e.needs.map((k) => `<span>${esc(NEED_LABELS[k] || k)}</span>`).join('')}</div>` : ''}
        <div class="counts">
          <span><b>${c.likely.length}</b>받을 가능성 높음</span>
          <span><b>${c.check.length}</b>확인 필요</span>
          ${isCareWorker() ? `<span><b>${c.visit.length}</b>방문 때 안내</span>` : `<span><b>${c.done.filter((r) => store.getActions(e.id)[r.service.id]?.status === 'applied').length}</b>신청 완료</span>`}
        </div></a>`;
    })
    .join('');
  app.innerHTML = `
    <section class="hero">
      <h1>${role.title} 복지, 놓치지 않게</h1>
      <p>${esc(role.label)}${s.settings.org ? ` · ${esc(s.settings.org)}` : ''} · 복지 정보 ${DATA.meta?.count?.toLocaleString() ?? 0}건 확인 중 · ${DATA.meta ? new Date(DATA.meta.updatedAt).toLocaleDateString('ko-KR') : ''} 갱신</p>
    </section>
    ${!s.settings.notify && 'Notification' in window ? `<div class="notice"><span>새 복지가 나오면 알려드릴까요?</span> <button class="btn small" data-action="enable-notify">알림 켜기</button></div>` : ''}
    <div class="elder-grid">${cards}
      <a class="elder-card add" href="#/elder/new"><span class="plus">＋</span>${isCareWorker() ? '어르신 추가' : '부모님 추가'}</a>
    </div>`;
}

function renderWelcome() {
  app.innerHTML = `
  <section class="hero">
    <h1>새 복지가 나오면,<br>부모님 대신 제가 알려드릴게요</h1>
    <p>어르신이 직접 복지로를 찾지 않아도 됩니다. 부모님 정보를 한 번 등록하면 AI가 전국 복지사업을 매일 확인해서,
    받으실 수 있는 복지를 자녀나 돌봄 선생님께 알려드립니다.</p>
  </section>
  <h2 class="section-title">누구로 시작할까요?</h2>
  <div class="role-grid">
    <a class="role-card" href="#/start/family"><strong>자녀·가족</strong><span>부모님 복지를 챙겨요</span></a>
    <a class="role-card" href="#/start/supporter"><strong>생활지원사</strong><span>노인맞춤돌봄 담당 어르신을 챙겨요</span></a>
    <a class="role-card" href="#/start/caregiver"><strong>요양보호사</strong><span>장기요양 담당 어르신을 챙겨요</span></a>
  </div>
  <p class="muted center">가족이 없는 어르신은 생활지원사·요양보호사 선생님이 대신 등록할 수 있어요.<br>
  모든 정보는 이 기기 안에만 저장됩니다. <a href="#/about">개인정보 안내</a></p>`;
}

/* ---------------- 어르신 등록·수정 ---------------- */
function options(list, selected, placeholder) {
  return (
    (placeholder ? `<option value="">${placeholder}</option>` : '') +
    list.map(([v, l]) => `<option value="${esc(v)}" ${String(v) === String(selected ?? '') ? 'selected' : ''}>${esc(l)}</option>`).join('')
  );
}
const radios = (name, list, selected) =>
  `<div class="seg">${list
    .map(
      ([v, l]) =>
        `<label><input type="radio" name="${name}" value="${v}" ${String(v) === String(selected ?? '') ? 'checked' : ''}><span>${l}</span></label>`,
    )
    .join('')}</div>`;
const YNU = [
  ['yes', '예'],
  ['no', '아니오'],
  ['unknown', '모름'],
];

function sggOptions(sido, selected) {
  const list = regions()[sido] || [];
  const custom = selected && !list.includes(selected);
  return (
    options(
      list.map((x) => [x, x]),
      custom ? '' : selected,
      list.length ? '시·군·구 선택' : '(시·군·구 없음)',
    ) + `<option value="__custom" ${custom ? 'selected' : ''}>목록에 없음 (직접 입력)</option>`
  );
}

function incomeHint(size) {
  const st = DATA.standards;
  if (!st) return '';
  const n = Math.min(Math.max(Number(size) || 1, 1), 6);
  const m = st.medianIncome.bySize[String(n)];
  return `${n}인 가구 기준중위소득(${st.year}년): 50% ${won(m * 0.5)} · 100% ${won(m)}<br>
  기초연금 선정기준액: 혼자 사시면 ${won(st.basicPension.single)}, 부부는 ${won(st.basicPension.couple)} 이하`;
}

function renderElderForm(elder) {
  const s = store.getState();
  if (!s.settings.role) {
    location.hash = '#/';
    return;
  }
  const e = elder || { household: '', householdSize: '', basicPension: 'unknown', basicLivelihood: 'unknown', nearPoor: 'unknown', ltcGrade: 'unknown', disability: 'unknown', veteran: 'unknown' };
  const who = ROLE[s.settings.role]?.who || '어르신';
  const sidoList = Object.keys(regions());
  const sggCustom = e.sigungu && !(regions()[e.sido] || []).includes(e.sigungu);
  app.innerHTML = `
  <form id="elder-form" class="panel form" novalidate>
    <h2>${elder ? `${esc(elder.nickname)} 정보 수정` : `${who} 등록`}</h2>
    <p class="muted">아는 만큼만 입력하세요. 모르는 항목은 '모름'으로 두면 '확인 필요'로 안내해 드려요.</p>

    <fieldset><legend>1. 기본 정보</legend>
      <label class="field">부르는 이름 <input name="nickname" required maxlength="20" placeholder="예: 어머니, 김○○ 어르신" value="${esc(e.nickname)}"></label>
      <label class="field">생년월일 <input name="birthDate" type="date" required min="1900-01-01" max="${todayStr()}" value="${esc(e.birthDate)}"></label>
      <div class="field">성별 ${radios('gender', [['female', '여성'], ['male', '남성']], e.gender)}</div>
    </fieldset>

    <fieldset><legend>2. 사는 곳</legend>
      <div class="row2">
        <label class="field">시·도 <select name="sido" required>${options(sidoList.map((x) => [x, x]), e.sido, '시·도 선택')}</select></label>
        <label class="field">시·군·구 <select name="sigunguSel">${sggOptions(e.sido, e.sigungu)}</select></label>
      </div>
      <label class="field ${sggCustom ? '' : 'hidden'}" id="sgg-custom">시·군·구 직접 입력 <input name="sigunguCustom" placeholder="예: 종로구" value="${sggCustom ? esc(e.sigungu) : ''}"></label>
      <label class="field">지금 주소로 이사 온 시기 <small>(선택 · '○년 이상 거주' 조건 판정용)</small><input name="residenceSince" type="month" value="${esc(e.residenceSince)}"></label>
    </fieldset>

    <fieldset><legend>3. 함께 사는 가족</legend>
      <div class="field">가구 형태 ${radios('household', Object.entries(HOUSEHOLD_LABELS), e.household)}</div>
      <label class="field">가구원 수 (본인 포함) <input name="householdSize" type="number" min="1" max="12" inputmode="numeric" value="${esc(e.householdSize)}" placeholder="예: 1"></label>
    </fieldset>

    <fieldset><legend>4. 도움이 필요한 부분 <small>(여러 개 선택 · 선택)</small></legend>
      <p class="hint">${who}께 요즘 가장 필요한 도움을 골라 주세요. 해당 분야 복지를 맨 앞에 보여드려요.</p>
      <div class="need-pick">${NEEDS.map(
        (n) => `<label><input type="checkbox" name="needs" value="${n.key}" ${e.needs?.includes(n.key) ? 'checked' : ''}><span><b>${esc(n.label)}</b><small>${esc(n.desc)}</small></span></label>`,
      ).join('')}</div>
    </fieldset>

    <fieldset><legend>5. 수급·소득 (아는 만큼)</legend>
      <div class="field">기초연금을 받고 계신가요? ${radios('basicPension', YNU, e.basicPension)}</div>
      <div class="field">기초생활수급자(생계·의료·주거급여)이신가요? ${radios('basicLivelihood', YNU, e.basicLivelihood)}</div>
      <div class="field">차상위계층이신가요? ${radios('nearPoor', YNU, e.nearPoor)}</div>
      <label class="field">장기요양등급 <select name="ltcGrade">${options(
        [['unknown', '모름'], ['none', '없음'], ['1', '1등급'], ['2', '2등급'], ['3', '3등급'], ['4', '4등급'], ['5', '5등급'], ['cognitive', '인지지원등급']],
        e.ltcGrade,
      )}</select></label>
      <label class="field">월 소득인정액 (대략, 만원) <small>(모르면 비워 두세요)</small>
        <input name="incomeManwon" type="number" min="0" step="1" inputmode="numeric" value="${e.incomeMonthly ? Math.round(e.incomeMonthly / 10000) : ''}" placeholder="예: 120"></label>
      <p class="hint" id="income-hint">${incomeHint(e.householdSize || (e.household === 'couple' ? 2 : 1))}</p>
    </fieldset>

    <fieldset><legend>6. 민감정보 (선택 · 별도 동의 필요)</legend>
      <div class="field">등록 장애인이신가요? ${radios('disability', YNU, e.disability)}</div>
      <div class="field">국가유공자·보훈대상자이신가요? ${radios('veteran', YNU, e.veteran)}</div>
    </fieldset>

    <fieldset class="consent"><legend>7. ${who} 동의</legend>
      <p>${who}의 정보를 등록하고 복지 알림을 받으려면 <b>${who} 본인(또는 법정대리인)의 동의</b>가 필요해요.
      정보는 이 기기에만 저장되고, 언제든 삭제할 수 있어요.</p>
      <div class="row2">
        <label class="field">동의 받은 방법 <select name="consentMethod">${options(
          [['phone', '전화'], ['sms', '문자'], ['inPerson', '직접 만나서'], ['guardian', '법정대리인 동의']],
          e.consent?.method || 'phone',
        )}</select></label>
        <div class="field"><span>동의 요청 문자</span><a class="btn ghost" id="sms-consent" href="#">문자 보내기</a></div>
      </div>
      <label class="check"><input type="checkbox" name="consent" ${e.consent ? 'checked' : ''}> ${who}께 정보 등록과 복지 알림에 대한 동의를 받았습니다.</label>
      <label class="check"><input type="checkbox" name="consentSensitive" ${e.consent?.sensitive ? 'checked' : ''}> 장애·보훈 정보(민감정보) 입력에 대해서도 별도로 동의를 받았습니다.</label>
    </fieldset>

    <div class="form-actions">
      ${elder ? `<button type="button" class="btn danger ghost" data-action="delete-elder" data-id="${elder.id}">삭제</button>` : ''}
      <a class="btn ghost" href="${elder ? `#/elder/${elder.id}` : '#/'}">취소</a>
      <button class="btn primary" type="submit">${elder ? '저장' : '등록하고 복지 찾기'}</button>
    </div>
  </form>`;

  const f = $('#elder-form');
  f.sido.addEventListener('change', () => {
    f.sigunguSel.innerHTML = sggOptions(f.sido.value, '');
    $('#sgg-custom').classList.add('hidden');
  });
  f.sigunguSel.addEventListener('change', () => $('#sgg-custom').classList.toggle('hidden', f.sigunguSel.value !== '__custom'));
  const updateHint = () => {
    const size = f.householdSize.value || ({ single: 1, couple: 2 }[f.household.value] ?? 1);
    $('#income-hint').innerHTML = incomeHint(size);
  };
  f.householdSize.addEventListener('input', updateHint);
  $$('input[name=household]', f).forEach((r) =>
    r.addEventListener('change', () => {
      if (!f.householdSize.value && r.value !== 'other') f.householdSize.value = r.value === 'single' ? 1 : 2;
      updateHint();
    }),
  );
  $('#sms-consent').addEventListener('click', (ev) => {
    ev.preventDefault();
    const name = s.settings.name ? `${s.settings.name}입니다. ` : '';
    const body = `${name}'효도알림' 앱에 어르신의 생년월일·사는 지역 등을 등록해서, 받으실 수 있는 새 복지가 나오면 제가 알림을 받아 안내해 드리려고 합니다. 동의하시면 "네"라고 답장 부탁드려요. 언제든 그만둘 수 있습니다.`;
    location.href = `sms:?&body=${encodeURIComponent(body)}`;
  });
  f.addEventListener('submit', (ev) => {
    ev.preventDefault();
    const v = Object.fromEntries(new FormData(f));
    const sigungu = v.sigunguSel === '__custom' ? (v.sigunguCustom || '').trim() : v.sigunguSel || '';
    const errs = [];
    if (!v.nickname?.trim()) errs.push('부르는 이름');
    if (!v.birthDate) errs.push('생년월일');
    if (!v.sido) errs.push('시·도');
    if (!sigungu && (regions()[v.sido] || []).length) errs.push('시·군·구');
    if (errs.length) return toast(`${errs.join(', ')}을(를) 입력해 주세요.`);
    if (!v.consent) return toast(`${who} 동의를 받은 뒤 체크해 주세요.`);
    const sensitiveGiven = ['yes', 'no'].includes(v.disability) || ['yes', 'no'].includes(v.veteran);
    if (sensitiveGiven && !v.consentSensitive) return toast('장애·보훈 정보는 별도 동의가 필요해요. 동의를 받지 않았다면 "모름"으로 두세요.');

    const isNew = !elder;
    const saved = {
      ...(elder || {}),
      id: elder?.id || store.newId(),
      nickname: v.nickname.trim(),
      birthDate: v.birthDate,
      gender: v.gender || '',
      sido: v.sido,
      sigungu,
      residenceSince: v.residenceSince || '',
      household: v.household || '',
      needs: new FormData(f).getAll('needs'),
      householdSize: v.householdSize ? Number(v.householdSize) : '',
      basicPension: v.basicPension || 'unknown',
      basicLivelihood: v.basicLivelihood || 'unknown',
      nearPoor: v.nearPoor || 'unknown',
      ltcGrade: v.ltcGrade || 'unknown',
      incomeMonthly: v.incomeManwon !== '' && v.incomeManwon != null ? Number(v.incomeManwon) * 10000 : '',
      disability: v.disability || 'unknown',
      veteran: v.veteran || 'unknown',
      consent: {
        at: elder?.consent?.at || new Date().toISOString(),
        method: v.consentMethod,
        sensitive: !!v.consentSensitive,
      },
      createdAt: elder?.createdAt || new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    store.saveElder(saved);
    if (isNew) baseline(saved);
    toast(isNew ? '등록했어요. 받으실 수 있는 복지를 찾았어요.' : '저장했어요.');
    location.hash = `#/elder/${saved.id}`;
  });
}

/* ---------------- 어르신별 복지 목록 ---------------- */
const PAGE = 40;
let listState = { key: '', limit: PAGE, q: '', need: '' };

function renderElder(id, tab) {
  const elder = store.getElder(id);
  if (!elder) {
    location.hash = '#/';
    return;
  }
  const c = categorize(elder);
  const tabs = [
    ['new', '새 소식', c.new.length],
    ['likely', '받을 가능성 높음', c.likely.length],
    ['check', '확인 필요', c.check.length],
    ...(isCareWorker() ? [['visit', '방문 때 안내', c.visit.length]] : []),
    ['done', '처리함', c.done.length],
  ];
  if (!tab || !tabs.some(([k]) => k === tab)) tab = c.new.length ? 'new' : 'likely';
  const key = `${id}:${tab}`;
  if (listState.key !== key) listState = { key, limit: PAGE, q: '', need: listState.key.startsWith(`${id}:`) ? listState.need : '' };

  const age = ageOn(elder.birthDate);
  const missingCount = {};
  for (const r of c.check) for (const m of r.missing) missingCount[m] = (missingCount[m] || 0) + 1;
  const topMissing = Object.entries(missingCount).sort((a, b) => b[1] - a[1]).slice(0, 2);

  app.innerHTML = `
  <section class="elder-top">
    <div>
      <h1>${esc(elder.nickname)}</h1>
      <p class="muted">${esc([elder.sido, elder.sigungu].filter(Boolean).join(' '))}${age !== null ? ` · 만 ${age}세` : ''}${elder.household ? ` · ${HOUSEHOLD_LABELS[elder.household]}` : ''}</p>
    </div>
    <div class="top-actions">
      <button class="btn ghost small" data-action="invite" data-id="${id}">${isCareWorker() ? '공유 링크' : '가족 초대'}</button>
      <a class="btn ghost small" href="#/elder/${id}/edit">정보 수정</a>
    </div>
  </section>
  ${
    topMissing.length
      ? `<div class="notice"><span>${topMissing.map(([f, n]) => `<b>${FIELD_LABELS[f] || f}</b>를 입력하면 ${n}건`).join(', ')}을 더 정확히 판정할 수 있어요. <a href="#/elder/${id}/edit">입력하기</a></span></div>`
      : ''
  }
  ${
    elder.needs?.length
      ? ''
      : `<div class="notice"><span><b>도움이 필요한 부분</b>(생계비·병원비·돌봄 등)을 체크하면 그 분야 복지를 먼저 보여드려요. <a href="#/elder/${id}/edit">체크하기</a></span></div>`
  }
  <nav class="tabs" role="tablist">${tabs
    .map(([k, l, n]) => `<a role="tab" href="#/elder/${id}?tab=${k}" class="${k === tab ? 'on' : ''}" aria-selected="${k === tab}">${l} <span>${n}</span></a>`)
    .join('')}</nav>
  <div class="chips" role="group" aria-label="분야로 보기" id="need-chips"></div>
  <div class="list-tools">
    <input type="search" id="q" placeholder="복지 이름으로 찾기" value="${esc(listState.q)}" aria-label="복지 검색">
    ${tab === 'new' && c.new.length ? `<button class="btn small" data-action="seen-all" data-id="${id}">모두 확인함</button>` : ''}
  </div>
  <div id="svc-list"></div>`;

  // 분야 칩: 체크한 분야를 먼저, 나머지는 뒤에
  const mine = elder.needs || [];
  const order = [...mine, ...NEEDS.map((n) => n.key).filter((k) => !mine.includes(k))];
  const drawChips = () => {
    const count = (k) => c[tab].filter((r) => needsOf(r.service).includes(k)).length;
    $('#need-chips').innerHTML =
      `<button class="chip ${listState.need ? '' : 'on'}" data-action="need" data-need="">전체 <span>${c[tab].length}</span></button>` +
      order
        .map((k) => {
          const n = count(k);
          if (!n && !mine.includes(k)) return '';
          return `<button class="chip ${listState.need === k ? 'on' : ''} ${mine.includes(k) ? 'mine' : ''}" data-action="need" data-need="${k}" aria-pressed="${listState.need === k}">${mine.includes(k) ? '★ ' : ''}${esc(NEED_LABELS[k])} <span>${n}</span></button>`;
        })
        .join('');
  };
  const drawList = () => {
    drawChips();
    const q = listState.q.trim();
    const items = c[tab]
      .filter((r) => !listState.need || needsOf(r.service).includes(listState.need))
      .filter((r) => !q || r.service.name.includes(q) || (r.service.easy || '').includes(q));
    const shown = items.slice(0, listState.limit);
    $('#svc-list').innerHTML = items.length
      ? shown.map((r) => serviceCard(elder, r)).join('') +
        (items.length > shown.length ? `<button class="btn ghost wide" data-action="more">더 보기 (${items.length - shown.length}건 남음)</button>` : '')
      : `<p class="empty">${listState.need ? `이 목록에는 '${esc(NEED_LABELS[listState.need])}' 분야 복지가 없어요. 다른 탭도 확인해 보세요.` : emptyText(tab)}</p>`;
  };
  drawList();
  $('#q').addEventListener('input', (ev) => {
    listState.q = ev.target.value;
    listState.limit = PAGE;
    drawList();
  });
  renderElder.drawList = drawList;
}

function emptyText(tab) {
  return {
    new: '새로 나온 복지가 없어요. 새 복지가 나오면 여기에 표시돼요.',
    likely: '받을 가능성이 높은 복지가 아직 없어요. 정보를 더 입력하면 찾을 수 있을지도 몰라요.',
    check: '확인이 필요한 복지가 없어요.',
    visit: '방문 때 안내할 복지가 없어요. 복지 카드에서 "방문 때 안내"를 누르면 여기에 모여요.',
    done: '아직 처리한 복지가 없어요.',
  }[tab];
}

const PHONE_RE = /(\d{2,4}-\d{3,4}-\d{4}|\b1\d{2,3}(?:-\d{4})?\b|\b\d{3,4}-\d{4}\b)/;

function contactHtml(c) {
  const text = [c.name, c.value].filter(Boolean).join(' ');
  const m = text.match(PHONE_RE);
  return m ? `${esc(text.replace(m[0], ''))} <a href="tel:${m[0].replace(/-/g, '')}">${esc(m[0])}</a>` : esc(text);
}

function serviceCard(elder, r) {
  const s = r.service;
  const action = store.getActions(elder.id)[s.id]?.status;
  const isNew = !store.getSeen(elder.id).has(s.id);
  const where = s.src === 'L' ? [s.ctpv, s.sgg].filter(Boolean).join(' ') : '전국';
  const needHit = matchedNeeds(s, elder.needs);
  const pill = r.status === 'likely' ? '<span class="pill ok">받을 가능성 높음</span>' : '<span class="pill warn">확인 필요</span>';
  const icon = (ok) => (ok === true ? '<i class="ok" aria-label="충족">✓</i>' : ok === false ? '<i class="fail" aria-label="미충족">✕</i>' : '<i class="unk" aria-label="확인 필요">?</i>');
  const careBtns = isCareWorker()
    ? `<button class="btn small ${action === 'visit' ? 'on' : ''}" data-action="act" data-status="visit" data-id="${s.id}">방문 때 안내</button>
       <button class="btn small ${action === 'told' ? 'on' : ''}" data-action="act" data-status="told" data-id="${s.id}">안내함</button>`
    : '';
  return `<article class="svc ${r.status}">
    <details>
      <summary>
        <div class="svc-head">${pill}${isNew ? '<span class="badge new">새</span>' : ''}${action ? `<span class="badge">${ACTION_LABELS[action]}</span>` : ''}${needHit.map((k) => `<span class="badge need">${esc(NEED_LABELS[k])}</span>`).join('')}</div>
        <h3>${esc(s.name)}</h3>
        <p class="easy">${esc(s.easy)}</p>
        <p class="meta">${esc(where)} · ${esc(s.org)}${s.cycle ? ` · ${esc(s.cycle)}` : ''}</p>
      </summary>
      <div class="svc-body">
        <h4>왜 이렇게 판단했나요</h4>
        <ul class="checks">${r.checks.map((c) => `<li>${icon(c.ok)}<span><b>${esc(c.label)}</b> ${esc(c.detail || '')}</span></li>`).join('')}</ul>
        ${r.missing.length ? `<p class="hint">${r.missing.map((m) => FIELD_LABELS[m] || m).join(', ')}를 입력하면 더 정확해져요.</p>` : ''}
        ${s.benefit ? `<h4>지원 내용</h4><p>${nl2br(s.benefit)}</p>` : ''}
        ${s.apply ? `<h4>신청 방법</h4><p>${nl2br(s.apply)}</p>` : ''}
        ${s.contacts?.length ? `<h4>문의</h4><ul class="plain">${s.contacts.map((c) => `<li>${contactHtml(c)}</li>`).join('')}</ul>` : ''}
        ${s.forms?.length ? `<h4>서식</h4><ul class="plain">${s.forms.map((f) => `<li><a href="${esc(f.url)}" target="_blank" rel="noopener">${esc(f.name)}</a></li>`).join('')}</ul>` : ''}
        ${s.targetText ? `<details class="raw"><summary>지원대상 원문 보기</summary><p>${nl2br(s.targetText)}</p>${s.rules?.evidence ? `<p class="muted">판정 근거: “${esc(s.rules.evidence)}”</p>` : ''}</details>` : ''}
        <p class="ai-note">${
          s.by === 'gemini'
            ? 'AI가 원문을 분석해 만든 판정이에요. 최종 자격은 담당 기관에서 확인해 주세요.'
            : '간이 자동 분석 결과라 정확도가 낮을 수 있어요. 담당 기관에 꼭 확인해 주세요.'
        }</p>
        <div class="svc-actions">
          ${s.link ? `<a class="btn small ghost" href="${esc(s.link)}" target="_blank" rel="noopener">복지로에서 보기</a>` : ''}
          <button class="btn small ghost" data-action="share" data-id="${s.id}">${isCareWorker() ? '보호자에게 공유' : '가족에게 공유'}</button>
          ${careBtns}
          <button class="btn small ${action === 'applied' ? 'on' : ''}" data-action="act" data-status="applied" data-id="${s.id}">신청 완료</button>
          <button class="btn small ${action === 'notEligible' ? 'on' : ''}" data-action="act" data-status="notEligible" data-id="${s.id}">해당 없음</button>
          <button class="btn small ${action === 'rejected' ? 'on' : ''}" data-action="act" data-status="rejected" data-id="${s.id}">탈락</button>
        </div>
      </div>
    </details>
  </article>`;
}

/* ---------------- 방문 목록 (돌봄종사자) ---------------- */
function renderVisits() {
  const elders = store.getState().elders;
  const groups = elders
    .map((e) => ({ e, items: categorize(e).visit }))
    .filter((g) => g.items.length);
  app.innerHTML = `<section class="hero compact"><h1>방문 때 안내할 복지</h1><p>어르신 댁에 방문하실 때 이 목록을 보고 안내해 주세요.</p></section>
  ${
    groups.length
      ? groups
          .map(
            (g) => `<section class="panel visit-group"><h2><a href="#/elder/${g.e.id}?tab=visit">${esc(g.e.nickname)}</a> <span class="muted">${esc(g.e.sigungu || g.e.sido)}</span></h2>
      <ul class="visit-list">${g.items
        .map(
          (r) => `<li><div><b>${esc(r.service.name)}</b><p class="muted">${esc(r.service.easy)}</p></div>
        <button class="btn small" data-action="told" data-elder="${g.e.id}" data-id="${r.service.id}">안내함</button></li>`,
        )
        .join('')}</ul></section>`,
          )
          .join('')
      : '<p class="empty">방문 때 안내할 복지가 없어요. 어르신별 복지 카드에서 "방문 때 안내"를 눌러 모아 두세요.</p>'
  }`;
}

/* ---------------- 설정 ---------------- */
function renderSettings() {
  const s = store.getState().settings;
  const m = DATA.meta;
  app.innerHTML = `
  <form id="settings" class="panel form">
    <h2>설정</h2>
    <fieldset><legend>나의 정보</legend>
      <label class="field">역할 <select name="role">${options(Object.entries(ROLE).map(([k, v]) => [k, v.label]), s.role, '선택')}</select></label>
      <label class="field">내 이름 <small>(동의 요청 문자에 들어가요 · 선택)</small><input name="name" maxlength="20" value="${esc(s.name)}"></label>
      <label class="field">소속 기관 <small>(생활지원사·요양보호사 · 선택)</small><input name="org" maxlength="40" value="${esc(s.org)}" placeholder="예: ○○노인복지센터"></label>
    </fieldset>
    <fieldset><legend>보기</legend>
      <div class="field">글자 크기 ${radios('fontScale', [['normal', '보통'], ['large', '크게'], ['xlarge', '아주 크게']], s.fontScale)}</div>
    </fieldset>
    <fieldset><legend>알림</legend>
      <label class="check"><input type="checkbox" name="notify" ${s.notify ? 'checked' : ''}> 새 복지가 나오면 이 기기로 알림 받기</label>
      <p class="hint">앱을 열 때와, 지원하는 휴대폰(안드로이드 크롬에 설치한 경우)에서는 하루 한 번 자동으로 확인해 알려드려요.</p>
    </fieldset>
    <div class="form-actions"><button class="btn primary" type="submit">저장</button></div>
  </form>

  <section class="panel">
    <h2>백업·옮기기</h2>
    <p class="muted">다른 기기로 옮기거나 백업할 때 쓰세요. 파일에는 등록한 어르신 정보가 들어 있으니 안전하게 보관하세요.</p>
    <div class="form-actions left">
      <button class="btn" data-action="export">백업 파일 저장</button>
      <label class="btn ghost">백업 파일 불러오기<input type="file" accept="application/json" id="import-file" hidden></label>
      <button class="btn danger ghost" data-action="clear">모든 정보 삭제</button>
    </div>
  </section>

  <section class="panel">
    <h2>데이터 정보</h2>
    ${
      m
        ? `<ul class="plain">
      <li>확인 중인 복지사업: ${m.count.toLocaleString()}건 (AI 분석 ${m.aiCount.toLocaleString()}건${m.pending ? `, 수집 대기 ${m.pending.toLocaleString()}건` : ''})</li>
      <li>마지막 갱신: ${new Date(m.updatedAt).toLocaleString('ko-KR')}</li>
      <li>AI 모델: ${esc(m.models.primary)} (자격요건 분석), ${esc(m.models.lite)} (쉬운 설명)</li>
      <li>데이터 출처: 한국사회보장정보원 중앙부처·지자체 복지서비스 (공공데이터포털)</li></ul>`
        : '<p>데이터를 불러오지 못했어요.</p>'
    }
    <p><a href="#/about">개인정보 처리 안내</a></p>
  </section>`;

  const f = $('#settings');
  f.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const v = Object.fromEntries(new FormData(f));
    const notify = !!v.notify;
    if (notify && 'Notification' in window && Notification.permission !== 'granted') {
      const p = await Notification.requestPermission();
      if (p !== 'granted') toast('알림 권한이 허용되지 않았어요. 브라우저 설정에서 허용해 주세요.');
    }
    store.updateSettings({ role: v.role, name: v.name.trim(), org: v.org.trim(), fontScale: v.fontScale || 'normal', notify });
    if (notify) registerPeriodicSync();
    applyFontScale();
    renderNav('settings');
    toast('저장했어요.');
  });
  $('#import-file').addEventListener('change', async (ev) => {
    const file = ev.target.files[0];
    if (!file) return;
    try {
      store.importAll(await file.text());
      toast('불러왔어요.');
      location.hash = '#/';
    } catch (e) {
      toast(e.message);
    }
  });
}

function renderAbout() {
  app.innerHTML = `<section class="panel prose">
  <h2>개인정보 처리 안내</h2>
  <ul>
    <li><b>저장 위치</b>: 입력한 어르신 정보는 이 기기의 브라우저 안에만 저장되며, 서버로 전송되지 않습니다.</li>
    <li><b>판정 방식</b>: 공개된 복지사업 데이터를 기기로 내려받아, 기기 안에서 어르신 정보와 비교합니다.</li>
    <li><b>동의</b>: 어르신(또는 법정대리인)의 동의를 받은 경우에만 등록하세요. 장애·보훈 정보는 별도 동의가 필요합니다.</li>
    <li><b>최소 수집</b>: 주민등록번호, 연락처, 정확한 주소는 받지 않습니다.</li>
    <li><b>삭제</b>: 어르신 정보 수정 화면의 '삭제' 또는 설정의 '모든 정보 삭제'로 언제든 지울 수 있습니다.</li>
    <li><b>공유 링크</b>: 가족 초대·공유 링크에는 어르신 정보가 담깁니다. 믿을 수 있는 가족·보호자에게만 보내세요.</li>
    <li><b>판정의 한계</b>: 이 앱의 결과는 안내용입니다. 실제 자격은 신청 기관의 심사로 결정됩니다.</li>
  </ul>
  <a class="btn ghost" href="#/">돌아가기</a></section>`;
}

/* ---------------- 가족 초대 (링크로 어르신 정보 공유) ---------------- */
const b64url = {
  enc: (str) => {
    const bytes = new TextEncoder().encode(str);
    let bin = '';
    bytes.forEach((b) => (bin += String.fromCharCode(b)));
    return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  },
  dec: (s) => {
    const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/'));
    return new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
  },
};
const SHARE_FIELDS = ['nickname', 'birthDate', 'gender', 'sido', 'sigungu', 'residenceSince', 'household', 'householdSize', 'needs', 'basicPension', 'basicLivelihood', 'nearPoor', 'ltcGrade', 'incomeMonthly', 'disability', 'veteran', 'consent'];

function inviteLink(elder) {
  const data = Object.fromEntries(SHARE_FIELDS.map((k) => [k, elder[k]]));
  return `${location.origin}${location.pathname}#/import/${b64url.enc(JSON.stringify({ v: 1, elder: data }))}`;
}

function renderImport(code) {
  let elder;
  try {
    elder = JSON.parse(b64url.dec(code)).elder;
    if (!elder?.nickname) throw new Error();
  } catch {
    app.innerHTML = '<section class="panel"><h2>초대 링크가 올바르지 않아요</h2><a class="btn" href="#/">홈으로</a></section>';
    return;
  }
  const s = store.getState();
  app.innerHTML = `<section class="panel">
    <h2>${esc(elder.nickname)} 정보를 받았어요</h2>
    <p>${esc([elder.sido, elder.sigungu].filter(Boolean).join(' '))} · ${esc(elder.birthDate || '')}</p>
    <p class="muted">가져오면 이 기기에서도 같은 복지 알림을 받을 수 있어요.</p>
    ${!s.settings.role ? `<label class="field">나의 역할 <select id="imp-role">${options(Object.entries(ROLE).map(([k, v]) => [k, v.label]), 'family')}</select></label>` : ''}
    <div class="form-actions left"><button class="btn primary" id="do-import">가져오기</button><a class="btn ghost" href="#/">취소</a></div>
  </section>`;
  $('#do-import').addEventListener('click', () => {
    if (!s.settings.role) store.updateSettings({ role: $('#imp-role').value });
    const saved = { ...elder, id: store.newId(), createdAt: new Date().toISOString(), importedAt: new Date().toISOString() };
    store.saveElder(saved);
    baseline(saved);
    history.replaceState(null, '', `${location.pathname}#/elder/${saved.id}`);
    route();
    toast('가져왔어요.');
  });
}

/* ---------------- 공유 ---------------- */
async function shareText(title, text, url) {
  if (navigator.share) {
    try {
      await navigator.share({ title, text, url });
      return;
    } catch (e) {
      if (e.name === 'AbortError') return;
    }
  }
  await navigator.clipboard?.writeText([text, url].filter(Boolean).join('\n'));
  toast('복사했어요. 카카오톡이나 문자에 붙여 넣어 보내세요.');
}

/* ---------------- 이벤트 ---------------- */
document.addEventListener('click', async (ev) => {
  const el = ev.target.closest('[data-action]');
  if (!el) return;
  const { action, id } = el.dataset;
  const { parts, query } = parseHash();
  const elderId = parts[0] === 'elder' ? parts[1] : el.dataset.elder;

  if (action === 'act') {
    const cur = store.getActions(elderId)[id]?.status;
    store.setAction(elderId, id, cur === el.dataset.status ? null : el.dataset.status);
    store.markSeen(elderId, [id]);
    const open = el.closest('details')?.open;
    renderElder(elderId, query.get('tab'));
    if (open) {
      const card = $$('#svc-list button[data-id]').find((b) => b.dataset.id === id)?.closest('details');
      if (card) card.open = true;
    }
    toast(cur === el.dataset.status ? '표시를 취소했어요.' : `'${ACTION_LABELS[el.dataset.status]}'(으)로 표시했어요.`);
  } else if (action === 'told') {
    store.setAction(el.dataset.elder, id, 'told');
    renderVisits();
    toast('안내함으로 표시했어요.');
  } else if (action === 'seen-all') {
    const c = categorize(store.getElder(id));
    store.markSeen(id, c.new.map((r) => r.service.id));
    location.hash = `#/elder/${id}?tab=likely`;
  } else if (action === 'need') {
    listState.need = el.dataset.need;
    listState.limit = PAGE;
    renderElder.drawList?.();
  } else if (action === 'more') {
    listState.limit += PAGE;
    renderElder.drawList?.();
  } else if (action === 'share') {
    const elder = store.getElder(elderId);
    const s = DATA.services.find((x) => x.id === id);
    if (!elder || !s) return;
    const where = s.src === 'L' ? [s.ctpv, s.sgg].filter(Boolean).join(' ') : '전국';
    const apply = (s.apply || '').split('\n')[0];
    const text = `[효도알림] ${elder.nickname}께 해당될 수 있는 복지예요.\n· ${s.name} (${where})\n· ${s.easy}${apply ? `\n· 신청: ${apply}` : ''}`;
    shareText(s.name, text, s.link);
  } else if (action === 'invite') {
    const elder = store.getElder(id);
    if (!confirm('이 링크에는 어르신 정보(생년월일·지역 등)가 담겨요. 믿을 수 있는 가족·보호자에게만 보내세요. 계속할까요?')) return;
    shareText(`${elder.nickname} 복지 알림 함께 받기`, `[효도알림] ${elder.nickname} 복지 알림을 함께 받아요. 링크를 눌러 등록하세요.`, inviteLink(elder));
  } else if (action === 'delete-elder') {
    if (!confirm('이 어르신의 정보와 기록을 모두 삭제할까요? 되돌릴 수 없어요.')) return;
    store.deleteElder(id);
    toast('삭제했어요.');
    location.hash = '#/';
  } else if (action === 'export') {
    const blob = new Blob([store.exportAll()], { type: 'application/json' });
    const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: `hyodo-backup-${todayStr()}.json` });
    a.click();
    URL.revokeObjectURL(a.href);
  } else if (action === 'clear') {
    if (!confirm('이 기기에 저장된 모든 정보를 삭제할까요? 되돌릴 수 없어요.')) return;
    store.clearAll();
    location.hash = '#/';
    route();
  } else if (action === 'enable-notify') {
    const p = await Notification.requestPermission();
    if (p === 'granted') {
      store.updateSettings({ notify: true });
      // 지금 있는 것은 알림 대상에서 제외하고, 앞으로 새로 나오는 것만 알림
      for (const e of store.getState().elders) store.markNotified(e.id, resultsFor(e).map((r) => r.service.id));
      registerPeriodicSync();
      toast('알림을 켰어요. 새 복지가 나오면 알려드릴게요.');
      renderHome();
    } else toast('알림 권한이 허용되지 않았어요.');
  }
});

/* ---------------- 서비스 워커 ---------------- */
async function registerPeriodicSync() {
  try {
    const reg = await navigator.serviceWorker?.ready;
    if (reg && 'periodicSync' in reg) {
      const status = await navigator.permissions.query({ name: 'periodic-background-sync' });
      if (status.state === 'granted') await reg.periodicSync.register('welfare-check', { minInterval: 24 * 60 * 60 * 1000 });
    }
  } catch {
    /* 지원하지 않는 브라우저 */
  }
}

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}

/* ---------------- 시작 ---------------- */
window.addEventListener('hashchange', route);
applyFontScale();
app.innerHTML = '<p class="loading">복지 정보를 불러오는 중…</p>';
await loadData();
route();
notifyNew();
