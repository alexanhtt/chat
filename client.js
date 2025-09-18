// 🔑 Sinh ID cho user và lưu vào localStorage
let clientId = localStorage.getItem("clientId");
if (!clientId) {
  clientId = crypto.randomUUID();
  localStorage.setItem("clientId", clientId);
}

let role=null, adminToken=null, targetUserId=null;
const chatEl = document.getElementById('chat');
const chatAdminEl = document.getElementById('chatAdmin');

function append(el, text, cls){
  if(cls === 'sys'){
    const d = document.createElement('div');
    d.innerText = text;
    d.className = 'sys';
    el.appendChild(d);
  } else {
    const wrap = document.createElement('div');
    wrap.style.display = 'flex';
    const d = document.createElement('div');
    d.innerText = text;
    d.className = cls ? ('msg ' + cls) : 'msg';
    wrap.appendChild(d);
    el.appendChild(wrap);
  }
  el.scrollTop = el.scrollHeight;
}

// Load lịch sử user
async function loadUserHistory(){
  const r = await fetch('/user/history?client_id=' + clientId);
  const j = await r.json();
  if(j.ok){
    (j.history || []).forEach(m => {
      const cls = m.sender === 'user' ? 'me' : 'other';
      append(chatEl, `${m.sender} [${m.ts}]: ${m.message}`, cls);
    });
  }
}

// --- User chọn vai trò ---
document.getElementById('btnUser').onclick = async () => {
  role='user';
  document.getElementById('choice').style.display='none';
  document.getElementById('userPanel').style.display='block';

  append(chatEl, 'Chỉ Anhtt mới nhìn thấy đoạn chat này!', 'sys');

  try { await loadUserHistory(); }
  catch(e){ console.error('History load error', e); }

  const es = new EventSource('/events?role=user&client_id=' + clientId);
  es.addEventListener('message', e => {
    const d = JSON.parse(e.data);
    const cls = d.sender==='user' ? 'me' : 'other';
    append(chatEl, `${d.sender} [${d.ts}]: ${d.message}`, cls);
  });
};

// --- User gửi ---
document.getElementById('sendUser').onclick = async () => {
  const m = document.getElementById('msg').value||'';
  if(!m) return;
  await fetch('/message', { 
    method:'POST', headers:{'Content-Type':'application/json'},
    body: JSON.stringify({ role:'user', client_id: clientId, message: m })
  });
  document.getElementById('msg').value='';
};
// Enter để gửi (User)
document.getElementById('msg').addEventListener("keydown", function(e){
  if(e.key === "Enter"){ e.preventDefault(); document.getElementById("sendUser").click(); }
});

// --- Admin login ---
document.getElementById('btnAdmin').onclick = () => {
  role='admin';
  document.getElementById('choice').style.display='none';
  document.getElementById('adminLogin').style.display='block';
};

document.getElementById('loginBtn').onclick = async () => {
  const pw = document.getElementById('adminPw').value || '';
  const r = await fetch('/admin-login', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ password: pw })});
  const j = await r.json();
  if (!j.ok) { document.getElementById('loginMsg').innerText = 'Login failed'; return; }
  adminToken = j.token;
  document.getElementById('adminLogin').style.display='none';
  document.getElementById('adminPanel').style.display='block';

  const es = new EventSource('/events?role=admin&token='+adminToken);
  es.addEventListener('user-list', e => { const d=JSON.parse(e.data); populateUserList(d.users||[]); });
  es.addEventListener('message', e => {
    const d = JSON.parse(e.data);
    if (d.user_id === targetUserId) {
      const cls = d.sender==='admin' ? 'me' : 'other';
      append(chatAdminEl, `${d.sender} [${d.ts}]: ${d.message}`, cls);
    }
    loadUsers();
  });
  es.addEventListener('presence', e => loadUsers());
  loadUsers();
};

async function loadUsers(){
  if(!adminToken) return;
  const r = await fetch('/admin/users?token=' + adminToken);
  const j = await r.json();
  if (j.ok) populateUserList(j.users || []);
}

function populateUserList(users){
  const ul = document.getElementById('userList');
  ul.innerHTML = '';
  users.forEach(uid => {
    const b = document.createElement('button');
    b.innerText = uid;
    b.onclick = () => openAdminChat(uid);
    ul.appendChild(b);
  });
}

async function openAdminChat(uid){
  targetUserId = uid;
  document.getElementById('adminChat').style.display = 'block';
  document.getElementById('chatWith').innerText = uid;
  chatAdminEl.innerHTML = '';
  const r = await fetch('/admin/history?token=' + adminToken + '&user_id=' + encodeURIComponent(uid));
  const j = await r.json();
  if (j.ok) (j.history||[]).forEach(m => {
    const cls = m.sender === 'admin' ? 'me' : 'other';
    append(chatAdminEl, `${m.sender} [${m.ts}]: ${m.message}`, cls);
  });
}

// --- Admin gửi ---
document.getElementById('sendAdmin').onclick = async () => {
  const m = document.getElementById('adminMsg').value || '';
  if (!m || !targetUserId) return;
  await fetch('/message', { 
    method:'POST', headers:{'Content-Type':'application/json'},
    body: JSON.stringify({ role:'admin', token: adminToken, user_id: targetUserId, message: m })
  });
  document.getElementById('adminMsg').value = '';
};
// Enter để gửi (Admin)
document.getElementById('adminMsg').addEventListener("keydown", function(e){
  if(e.key === "Enter"){ e.preventDefault(); document.getElementById("sendAdmin").click(); }
});
