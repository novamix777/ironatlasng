// 1) Pega aquí los datos de tu proyecto Supabase (Settings > API).
// La "anon key" es PÚBLICA por diseño: la seguridad real la ponen las políticas RLS de setup.sql.
// NUNCA pegues aquí la "service_role key".
const SUPABASE_URL = 'https://TU-PROYECTO.supabase.co';
const SUPABASE_ANON_KEY = 'TU_ANON_KEY';

const db = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
const $ = s => document.querySelector(s);
const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
let me = null, current = null, sub = null, signup = false;

const authMsg = t => { $('#authMsg').textContent = t || ''; };

// ---------- Acceso ----------
function setMode(s) {
  signup = s;
  $('#tabLogin').classList.toggle('on', !s); $('#tabSignup').classList.toggle('on', s);
  $('#username').hidden = !s; $('#username').required = s;
  $('#authBtn').textContent = s ? 'Crear cuenta' : 'Entrar';
  $('#password').autocomplete = s ? 'new-password' : 'current-password';
  authMsg();
}
$('#tabLogin').onclick = () => setMode(false);
$('#tabSignup').onclick = () => setMode(true);

$('#authForm').addEventListener('submit', async e => {
  e.preventDefault(); authMsg();
  const email = $('#email').value.trim(), password = $('#password').value, username = $('#username').value.trim();
  $('#authBtn').disabled = true;
  try {
    if (signup) {
      if (!/^[A-Za-z0-9_]{3,20}$/.test(username)) return authMsg('Usuario: 3-20 caracteres (letras, números o _).');
      const { data, error } = await db.auth.signUp({ email, password, options: { data: { username } } });
      if (error) return authMsg('No se pudo crear la cuenta. Revisa los datos o prueba otro usuario.');
      if (!data.session) return authMsg('Cuenta creada. Confirma tu correo y luego entra.');
    } else {
      const { error } = await db.auth.signInWithPassword({ email, password });
      if (error) return authMsg('Correo o contraseña incorrectos.');
    }
    await start();
  } finally { $('#authBtn').disabled = false; }
});

$('#logout').onclick = async () => { await db.auth.signOut(); location.reload(); };

async function start() {
  const { data: { session } } = await db.auth.getSession();
  if (!session) return;
  const { data, error } = await db.from('profiles').select('id,username,role,banned').eq('id', session.user.id).single();
  if (error || !data || data.banned) {
    await db.auth.signOut();
    return authMsg(data && data.banned ? 'Tu cuenta está suspendida.' : 'No se pudo cargar tu perfil.');
  }
  me = data;
  $('#auth').hidden = true; $('#app').hidden = false;
  $('#who').textContent = me.username + (me.role === 'admin' ? ' (admin)' : '');
  $('#adminBtn').hidden = me.role !== 'admin';
  await loadChannels();
}

// ---------- Secciones y chat ----------
async function loadChannels() {
  const { data } = await db.from('channels').select('*').order('id');
  const nav = $('#channels'); nav.replaceChildren();
  (data || []).forEach(c => {
    const b = el('button', current && current.id === c.id ? 'on' : '', '# ' + c.name);
    b.onclick = () => { showChat(); openChannel(c); };
    nav.append(b);
  });
  if (!current && data && data[0]) openChannel(data[0]);
  return data || [];
}

function renderMsg(m) {
  const box = el('div', 'm'); box.dataset.id = m.id;
  const head = el('div');
  head.append(el('b', '', m.profiles ? m.profiles.username : '?'), el('time', '', new Date(m.created_at).toLocaleString('es', { dateStyle: 'short', timeStyle: 'short' })));
  if (me && (m.user_id === me.id || me.role === 'admin')) {
    const d = el('button', 'del', 'Borrar');
    d.onclick = () => db.from('messages').delete().eq('id', m.id);
    head.append(d);
  }
  box.append(head, el('p', '', m.content)); // textContent: el contenido nunca se interpreta como HTML
  return box;
}

async function openChannel(c) {
  current = c;
  $('#ctitle').textContent = '# ' + c.name; $('#cdesc').textContent = c.description || '';
  $('#sendForm').hidden = c.admin_only && me.role !== 'admin';
  [...$('#channels').children].forEach(b => b.classList.toggle('on', b.textContent === '# ' + c.name));
  const list = $('#msgs'); list.replaceChildren();
  const { data } = await db.from('messages').select('id,user_id,content,created_at,profiles(username)')
    .eq('channel_id', c.id).order('created_at', { ascending: false }).limit(100);
  (data || []).reverse().forEach(m => list.append(renderMsg(m)));
  list.scrollTop = list.scrollHeight;
  if (sub) db.removeChannel(sub);
  sub = db.channel('ch-' + c.id)
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages', filter: 'channel_id=eq.' + c.id }, async p => {
      const { data: m } = await db.from('messages').select('id,user_id,content,created_at,profiles(username)').eq('id', p.new.id).single();
      if (!m) return;
      const near = list.scrollHeight - list.scrollTop - list.clientHeight < 80;
      list.append(renderMsg(m)); if (near) list.scrollTop = list.scrollHeight;
    })
    .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'messages' }, p => {
      const n = list.querySelector('[data-id="' + CSS.escape(String(p.old.id)) + '"]'); if (n) n.remove();
    }).subscribe();
}

$('#sendForm').addEventListener('submit', async e => {
  e.preventDefault();
  const i = $('#msgInput'), text = i.value.trim();
  if (!text || !current) return;
  i.disabled = true;
  const { error } = await db.from('messages').insert({ channel_id: current.id, content: text });
  i.disabled = false; i.focus();
  if (!error) i.value = '';
});

// ---------- Administración ----------
const showChat = () => { $('#admin').hidden = true; $('#chat').hidden = false; };
$('#closeAdmin').onclick = showChat;
$('#adminBtn').onclick = async () => { $('#chat').hidden = true; $('#admin').hidden = false; await renderAdmin(); };

async function renderAdmin() {
  const chans = await loadChannels();
  const cl = $('#chList'); cl.replaceChildren();
  chans.forEach(c => {
    const row = el('div', 'item'); const del = el('button', '', 'Eliminar');
    del.onclick = async () => { if (confirm('¿Eliminar #' + c.name + ' y todos sus mensajes?')) { await db.from('channels').delete().eq('id', c.id); if (current && current.id === c.id) current = null; renderAdmin(); } };
    row.append(el('span', '', '# ' + c.name + (c.admin_only ? ' (solo admins)' : '')), del); cl.append(row);
  });
  const { data: users } = await db.from('profiles').select('id,username,role,banned').order('username');
  const ul = $('#userList'); ul.replaceChildren();
  (users || []).forEach(u => {
    const row = el('div', 'item'); row.append(el('span', '', u.username + ' · ' + u.role + (u.banned ? ' · suspendido' : '')));
    if (u.id !== me.id) {
      const ban = el('button', '', u.banned ? 'Reactivar' : 'Suspender');
      ban.onclick = async () => { await db.from('profiles').update({ banned: !u.banned }).eq('id', u.id); renderAdmin(); };
      const rol = el('button', '', u.role === 'admin' ? 'Quitar admin' : 'Hacer admin');
      rol.onclick = async () => { await db.from('profiles').update({ role: u.role === 'admin' ? 'user' : 'admin' }).eq('id', u.id); renderAdmin(); };
      row.append(rol, ban);
    }
    ul.append(row);
  });
}

$('#chForm').addEventListener('submit', async e => {
  e.preventDefault();
  const { error } = await db.from('channels').insert({ name: $('#chName').value.trim(), description: $('#chDesc').value.trim() || null, admin_only: $('#chAdminOnly').checked });
  if (!error) { e.target.reset(); renderAdmin(); }
});

start();
