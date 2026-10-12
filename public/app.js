// Interface de la todo list : tout l'état vient de GET /api/state,
// chaque action appelle l'API puis recharge l'état.
const $ = (sel) => document.querySelector(sel);

let db = { categories: [], labels: [], tasks: [] };
let view = null; // { type: 'category' | 'label', id }
const expanded = new Set();

const STATUS_LABEL = { todo: 'À faire', doing: 'En cours', done: 'Fait' };

async function api(method, path, body) {
  const res = await fetch(`/api${path}`, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error);
  return data;
}

async function act(method, path, body) {
  try {
    await api(method, path, body);
    await refresh();
  } catch (err) {
    alert(err.message);
  }
}

async function refresh() {
  db = await api('GET', '/state');
  if (view?.type === 'category' && !db.categories.some((c) => c.id === view.id)) view = null;
  if (view?.type === 'label' && !db.labels.some((l) => l.name === view.id)) view = null;
  if (!view && db.categories[0]) view = { type: 'category', id: db.categories[0].id };
  render();
}

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const parseLabels = (s) => s.split(',').map((l) => l.trim()).filter(Boolean);
const childrenOf = (id) => db.tasks.filter((t) => t.parentId === id);
const openCount = (pred) => db.tasks.filter((t) => pred(t) && t.status !== 'done').length;

function render() {
  $('#categories').innerHTML = db.categories
    .map((c) => navItem('category', c.id, c.name, openCount((t) => t.categoryId === c.id), true))
    .join('');
  $('#labels').innerHTML = db.labels
    .map((l) => navItem('label', l.name, `#${l.name}`, openCount((t) => t.labels.includes(l.name)), false))
    .join('');

  const header = $('#view-header');
  const list = $('#tasks');
  $('#new-task').hidden = view?.type !== 'category';

  if (!view) {
    header.innerHTML = '<h2>Commence par créer une catégorie</h2>';
    list.innerHTML = '';
    return;
  }

  if (view.type === 'category') {
    const cat = db.categories.find((c) => c.id === view.id);
    header.innerHTML = `<h2>${esc(cat.name)}</h2>`;
    const roots = db.tasks.filter((t) => t.categoryId === cat.id && !t.parentId);
    list.innerHTML = roots.length ? `<ul class="tree">${roots.map(renderTask).join('')}</ul>` : empty();
  } else {
    header.innerHTML = `<h2><span class="chip">#${esc(view.id)}</span></h2>`;
    // Vue par label : tâches à plat, regroupées par catégorie, avec le chemin du parent.
    const tagged = db.tasks.filter((t) => t.labels.includes(view.id));
    list.innerHTML = tagged.length
      ? db.categories
          .map((c) => {
            const inCat = tagged.filter((t) => t.categoryId === c.id);
            if (!inCat.length) return '';
            return `<h3>${esc(c.name)}</h3><ul class="tree">${inCat.map((t) => renderTask(t, { flat: true })).join('')}</ul>`;
          })
          .join('')
      : empty();
  }
}

const empty = () => '<p class="hint">Aucune tâche ici.</p>';

function navItem(type, id, name, count, deletable) {
  const active = view?.type === type && view.id === id ? ' class="active"' : '';
  return `<li${active}>
    <button class="nav-link" data-action="select" data-type="${type}" data-id="${esc(id)}">${esc(name)}</button>
    ${count ? `<span class="count">${count}</span>` : ''}
    ${deletable ? `<button class="icon" data-action="rename-category" data-id="${esc(id)}" title="Renommer">✎</button>` : ''}
    <button class="icon" data-action="delete-${type}" data-id="${esc(id)}" title="Supprimer">×</button>
  </li>`;
}

function parentPath(task) {
  const names = [];
  for (let p = db.tasks.find((t) => t.id === task.parentId); p; p = db.tasks.find((t) => t.id === p.parentId)) {
    names.unshift(p.title);
  }
  return names.length ? `<span class="path">${esc(names.join(' › '))} ›</span> ` : '';
}

function renderTask(task, { flat = false } = {}) {
  const kids = childrenOf(task.id);
  const doneKids = kids.filter((k) => k.status === 'done').length;
  const isOpen = expanded.has(task.id);
  const chips = task.labels
    .map((l) => `<button class="chip" data-action="select" data-type="label" data-id="${esc(l)}">#${esc(l)}</button>`)
    .join('');

  return `<li class="task ${task.status}">
    <div class="row">
      <input type="checkbox" data-action="toggle" data-id="${task.id}" ${task.status === 'done' ? 'checked' : ''} aria-label="Terminer">
      <button class="title" data-action="expand" data-id="${task.id}">${flat ? parentPath(task) : ''}${esc(task.title)}</button>
      ${task.status === 'doing' ? '<span class="badge">en cours</span>' : ''}
      ${task.log.length ? `<span class="badge muted" title="Entrées de journal">📝 ${task.log.length}</span>` : ''}
      ${kids.length ? `<span class="badge muted">${doneKids}/${kids.length}</span>` : ''}
      ${chips}
      <span class="spacer"></span>
      <button class="icon" data-action="add-subtask" data-id="${task.id}" title="Ajouter une sous-tâche">+</button>
      <button class="icon" data-action="delete-task" data-id="${task.id}" title="Supprimer">×</button>
    </div>
    ${isOpen ? renderDetails(task) : ''}
    ${!flat && kids.length ? `<ul class="tree">${kids.map((k) => renderTask(k)).join('')}</ul>` : ''}
  </li>`;
}

function renderDetails(task) {
  return `<div class="details" data-id="${task.id}">
    <label>Statut
      <select data-field="status">
        ${Object.entries(STATUS_LABEL).map(([v, l]) => `<option value="${v}" ${v === task.status ? 'selected' : ''}>${l}</option>`).join('')}
      </select>
    </label>
    <label>Labels <input data-field="labels" value="${esc(task.labels.join(', '))}" placeholder="urgent, achat, claude…"></label>
    <label>Notes / instructions <textarea data-field="notes" rows="3">${esc(task.notes)}</textarea></label>
    <div class="log">
      <h4>Journal</h4>
      ${task.log.length ? `<ol>${task.log.map((e) => `<li><span class="by ${e.by}">${e.by}</span> <time>${new Date(e.at).toLocaleString('fr-FR')}</time><p>${esc(e.text)}</p></li>`).join('')}</ol>` : '<p class="hint">Vide.</p>'}
      <form class="inline-form" data-action="log" data-id="${task.id}">
        <input name="text" placeholder="Ajouter une note au journal" autocomplete="off" required>
        <button type="submit">Noter</button>
      </form>
    </div>
  </div>`;
}

document.addEventListener('click', (e) => {
  const el = e.target.closest('[data-action]');
  if (!el || el.tagName === 'FORM') return;
  const { action, id, type } = el.dataset;

  if (action === 'select') {
    view = { type, id };
    render();
  } else if (action === 'expand') {
    expanded.has(id) ? expanded.delete(id) : expanded.add(id);
    render();
  } else if (action === 'toggle') {
    act('PATCH', `/tasks/${id}`, { status: el.checked ? 'done' : 'todo' });
  } else if (action === 'add-subtask') {
    const title = prompt('Sous-tâche :');
    if (title?.trim()) act('POST', '/tasks', { title, parentId: id });
  } else if (action === 'delete-task') {
    const n = childrenOf(id).length;
    if (confirm(n ? `Supprimer cette tâche et ses sous-tâches ?` : 'Supprimer cette tâche ?')) act('DELETE', `/tasks/${id}`);
  } else if (action === 'rename-category') {
    const cat = db.categories.find((c) => c.id === id);
    const name = prompt('Nouveau nom :', cat.name);
    if (name?.trim()) act('PATCH', `/categories/${id}`, { name });
  } else if (action === 'delete-category') {
    if (confirm('Supprimer la catégorie et toutes ses tâches ?')) act('DELETE', `/categories/${id}`);
  } else if (action === 'delete-label') {
    if (confirm(`Supprimer le label #${id} de toutes les tâches ?`)) act('DELETE', `/labels/${encodeURIComponent(id)}`);
  }
});

// Champs du panneau de détail : enregistrés à la sortie du champ.
document.addEventListener('change', (e) => {
  const field = e.target.dataset.field;
  if (!field) return;
  const id = e.target.closest('.details').dataset.id;
  const value = field === 'labels' ? parseLabels(e.target.value) : e.target.value;
  act('PATCH', `/tasks/${id}`, { [field]: value });
});

document.addEventListener('submit', (e) => {
  e.preventDefault();
  const form = e.target;
  const data = Object.fromEntries(new FormData(form));
  if (form.id === 'new-category') {
    act('POST', '/categories', { name: data.name }).then(() => {
      const created = db.categories.at(-1);
      if (created) view = { type: 'category', id: created.id };
      render();
    });
  } else if (form.id === 'new-task') {
    act('POST', '/tasks', { title: data.title, categoryId: view.id, labels: parseLabels(data.labels) });
  } else if (form.dataset.action === 'log') {
    act('POST', `/tasks/${form.dataset.id}/log`, { text: data.text, by: 'user' });
  }
  form.reset();
});

// Recharge quand on revient sur l'onglet, pour voir ce que Claude a modifié entre-temps.
document.addEventListener('visibilitychange', () => document.visibilityState === 'visible' && refresh());

refresh();
