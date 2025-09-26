let clientId = localStorage.getItem("clientId") || (crypto.randomUUID());
localStorage.setItem("clientId", clientId);

let role=null, adminToken=null, targetUserId=null;
const chatEl=document.getElementById('chat'), chatAdminEl=document.getElementById('chatAdmin');

function append(el, text, cls){
  el.insertAdjacentHTML("beforeend",
    cls==="sys"
      ? `<div class="sys">${text}</div>`
      : `<div style="display:flex"><div class="msg ${cls||""}">${text}</div></div>`
  );
  el.scrollTop=el.scrollHeight;
}

async function loadUserHistory(){
  const r=await fetch('/user/history?client_id='+clientId);
  const j=await r.json();
  if(j.ok) (j.history||[]).forEach(m=>{
    append(chatEl, `${m.sender} [${m.ts}]: ${m.message}`, m.sender==='user'?'me':'other');
  });
}

// --- User ---
document.getElementById('btnUser').onclick=async()=>{
  role='user';
  document.getElementById('choice').style.display='none';
  document.getElementById('userPanel').style.display='block';
  append(chatEl,'Chỉ Anhtt mới nhìn thấy đoạn chat này!','sys');
  await loadUserHistory();
  const es=new EventSource('/events?role=user&client_id='+clientId);
  es.addEventListener('message',e=>{
    const d=JSON.parse(e.data);
    append(chatEl, `${d.sender} [${d.ts}]: ${d.message}`, d.sender==='user'?'me':'other');
  });
};

function bindEnter(id, btn){ document.getElementById(id).addEventListener("keydown",e=>{
  if(e.key==="Enter"){ e.preventDefault(); document.getElementById(btn).click(); }
});}

document.getElementById('sendUser').onclick=async()=>{
  const m=document.getElementById('msg').value.trim();
  if(!m) return;
  await fetch('/message',{method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify({role:'user',client_id:clientId,message:m})});
  document.getElementById('msg').value='';
};
bindEnter("msg","sendUser");

// --- Admin ---
document.getElementById('btnAdmin').onclick=()=>{
  role='admin';
  document.getElementById('choice').style.display='none';
  document.getElementById('adminLogin').style.display='block';
};

document.getElementById('loginBtn').onclick=async()=>{
  const pw=document.getElementById('adminPw').value||'';
  const r=await fetch('/admin-login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({password:pw})});
  const j=await r.json();
  if(!j.ok){ document.getElementById('loginMsg').innerText='Login failed'; return; }
  adminToken=j.token;
  document.getElementById('adminLogin').style.display='none';
  document.getElementById('adminPanel').style.display='block';

  const es=new EventSource('/events?role=admin&token='+adminToken);
  es.addEventListener('message',e=>{
    const d=JSON.parse(e.data);
    if(d.user_id===targetUserId){
      append(chatAdminEl, `${d.sender} [${d.ts}]: ${d.message}`, d.sender==='admin'?'me':'other');
    }
    loadUsers();
  });
  loadUsers();
};

async function loadUsers(){
  if(!adminToken) return;
  const r=await fetch('/admin/users?token='+adminToken);
  const j=await r.json();
  if(j.ok) populateUserList(j.users||[]);
}

function populateUserList(users){
  const ul=document.getElementById('userList');
  ul.innerHTML='';
  users.forEach(uid=>{
    const b=document.createElement('button');
    b.innerText=uid; b.onclick=()=>openAdminChat(uid); ul.appendChild(b);
  });
}

async function openAdminChat(uid){
  targetUserId=uid;
  document.getElementById('adminChat').style.display='block';
  document.getElementById('chatWith').innerText=uid;
  chatAdminEl.innerHTML='';
  const r=await fetch('/admin/history?token='+adminToken+'&user_id='+encodeURIComponent(uid));
  const j=await r.json();
  if(j.ok)(j.history||[]).forEach(m=>{
    append(chatAdminEl, `${m.sender} [${m.ts}]: ${m.message}`, m.sender==='admin'?'me':'other');
  });
}

document.getElementById('sendAdmin').onclick=async()=>{
  const m=document.getElementById('adminMsg').value.trim();
  if(!m||!targetUserId) return;
  await fetch('/message',{method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify({role:'admin',token:adminToken,user_id:targetUserId,message:m})});
  document.getElementById('adminMsg').value='';
};
bindEnter("adminMsg","sendAdmin");
