async function apiForm(path, formData) {
    const session = await waitForSession();

    if (!session) {
        throw new Error("NO_SESSION");
    }

    const token = session.access_token;

    const res = await fetch(API + path, {
        method: "POST",
        headers: {
            Authorization: `Bearer ${token}`
        },
        body: formData
    });

    if (!res.ok) {
    let err;

    try {
        err = await res.json();
    } catch {
        err = { detail: "UNKNOWN_ERROR" };
    }

    if (err.detail === "DAILY_LIMIT_EXCEEDED") {
        showToast("Daily API limit exceeded ⏳", "error");
        throw new Error("LIMIT");
    }

    if (err.detail === "INVALID_API_KEY") {
        showToast("Invalid API key 🔑", "error");
        openKeyModal();
        throw new Error("BAD_KEY");
    }

    if (err.detail === "NO_API_KEY") {
        showToast("Add API key first 🔑", "error");
        openKeyModal();
        throw new Error("NO_KEY");
    }

    throw new Error(err.detail || "Upload failed");
}

    return res.json();
}

function changeAvatar() {
    document.getElementById('change-avatar-input').click();
}

const avatarInput = document.getElementById('change-avatar-input');

if (avatarInput) {
    avatarInput.addEventListener('change', async function () {
        const file = this.files[0];
        if (!file || !state.activePersona) return;

        const form = new FormData();
        form.append("avatar", file);

        await apiForm(`/persona/${state.activePersona.id}/avatar`, form);

        showToast("Profile updated ✅", "success");

        loadDashboard();
        openChat(state.activePersona.id);
    });
}

function setupChatMenu() {
    const menu = document.querySelector(".chat-menu");
    const dropdown = document.getElementById("chat-menu-dropdown");

    if (!menu || !dropdown) return;

    menu.onclick = function (e) {
        e.stopPropagation();
        dropdown.style.display =
            dropdown.style.display === "block" ? "none" : "block";
    };

    document.addEventListener("click", function (e) {
        if (!menu.contains(e.target)) {
            dropdown.style.display = "none";
        }
    });
}


// ══════════════════════════════════════
//  CONFIG
// ══════════════════════════════════════
const API = 'https://projekt-girlfriend-backend.onrender.com';
const SUPABASE_URL = 'https://piqjezrulfrnuwjubalz.supabase.co';
const SUPABASE_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBpcWplenJ1bGZybnV3anViYWx6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzY0MDU5NzcsImV4cCI6MjA5MTk4MTk3N30.Usad9cv36s1GxOD6Yu49Myc6Ty8605gWu5b_o7uKHHM';

// Supabase client — handles session, token refresh, everything
const sb = supabase.createClient(SUPABASE_URL, SUPABASE_ANON);

// ══════════════════════════════════════
//  STATE  (no user tokens stored here)
// ══════════════════════════════════════
let state = {
    user: null,
    personas: [],
    activePersona: null,
    chatHistory: [],
    isSending: false,
    selectedRel: null,
    chatFile: null,
    currentStep: 1,
    hasApiKey: false,
};

// ══════════════════════════════════════
//  SCREEN ROUTER
// ══════════════════════════════════════
function showScreen(id) {
    document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
    document.getElementById(id).classList.add('active');
}

// ══════════════════════════════════════
//  AUTH  — all via Supabase
// ══════════════════════════════════════
function showAuth(mode) {
    showScreen('auth');
    switchAuthTab(mode);
}

function switchAuthTab(mode) {
    const isLogin = mode === 'login';
    document.getElementById('tab-login').classList.toggle('active', isLogin);
    document.getElementById('tab-signup').classList.toggle('active', !isLogin);
    document.getElementById('auth-sub').textContent = isLogin ? 'Sign in to your account' : 'Create your account';
    document.getElementById('auth-btn').textContent = isLogin ? 'Sign In' : 'Create Account';
    document.getElementById('name-field').style.display = isLogin ? 'none' : 'block';
    document.getElementById('auth-error').style.display = 'none';
    document.getElementById('auth-btn').dataset.mode = mode;
}

async function doAuth() {
    const mode = document.getElementById('auth-btn').dataset.mode || 'login';
    const email = document.getElementById('auth-email').value.trim();
    const pass = document.getElementById('auth-password').value;
    const name = document.getElementById('auth-name').value.trim();

    if (!email || !pass) { showAuthError('Please fill in all fields.'); return; }

    let result;
    if (mode === 'login') {
        result = await sb.auth.signInWithPassword({ email, password: pass });
    } else {
        result = await sb.auth.signUp({
            email, password: pass,
            options: { data: { name: name || email.split('@')[0] } }
        });
    }

    if (result.error) { showAuthError(result.error.message); return; }

    // Supabase stores the session internally (IndexedDB / memory) — we just read it
    const session = result.data.session;
    if (!session) {
        showAuthError('Check your email to confirm your account, then sign in.');
        return;
    }

    state.user = {
        id: result.data.user.id,
        email: result.data.user.email,
        name: result.data.user.user_metadata?.name || name || email.split('@')[0],
    };

    showToast('Welcome! 🌸', 'success');
    loadDashboard();
    showScreen('dashboard');
}

async function doLogout() {
    await sb.auth.signOut();   // clears Supabase session
    state.user = null;
    state.personas = [];
    showScreen('landing');
}

function showAuthError(msg) {
    const el = document.getElementById('auth-error');
    el.textContent = msg; el.style.display = 'block';
}

// Get fresh access token from live Supabase session — used for every API call
async function getToken() {
    const { data } = await sb.auth.getSession();
    return data?.session?.access_token || null;
}

async function waitForSession() {
    let tries = 0;

    while (tries < 10) {
        const { data } = await sb.auth.getSession();

        if (data && data.session && data.session.access_token) {
            return data.session;
        }

        await new Promise(r => setTimeout(r, 200));
        tries++;
    }

    return null;
}

// ══════════════════════════════════════
//  DASHBOARD
// ══════════════════════════════════════
async function loadDashboard() {

    const nameEl = document.getElementById('user-display-name');
    const emailEl = document.getElementById('user-email-nav');
    nameEl.textContent = state.user?.name || 'you';
    emailEl.textContent = state.user?.email || '';

    const session = await waitForSession();

    if (!session) {
        console.error("No session found");
        showToast("Session expired. Please login again.", "error");
        showScreen('landing');
        return;
    }

    try {
        const keyCheck = await api('/api-key/exists', 'GET');
        state.hasApiKey = keyCheck.has_key;

        updateApiKeyUI();

        if (!state.hasApiKey) {
            renderEmptyState();
            setTimeout(() => openKeyModal(), 500);
            return;
        }

        const res = await api('/persona/list', 'GET');
        state.personas = res.personas || [];
        renderPersonaList(state.personas);

    } catch (e) {
        console.error("Dashboard failed:", e);
        showToast("Something went wrong", "error");
    }
}

const REL_CONFIG = {
    crush: { emoji: '💜', label: 'Crush' },
    best_friend: { emoji: '🤝', label: 'Best Friend' },
    ex: { emoji: '🥀', label: 'Ex' },
    friend: { emoji: '😊', label: 'Friend' },
    girlfriend: { emoji: '💛', label: 'Girlfriend' },
    boyfriend: { emoji: '💛', label: 'Boyfriend' },
    colleague: { emoji: '💼', label: 'Colleague' },
};

function renderEmptyState() {
    const list = document.getElementById('persona-list');

    list.innerHTML = `
        <div style="text-align:center; padding:40px; opacity:0.8;">
            <h3>🔑 API Key Required</h3>
            <p>Add your Groq API key to start creating personas and chatting.</p>
            <button class="btn btn-primary" onclick="openKeyModal()">
                Add API Key
            </button>
        </div>
    `;
}

function renderPersonaList(personas) {
    const list = document.getElementById('persona-list');
    list.innerHTML = '';

    personas.forEach(p => {
        const rel = p.persona_json?.identity?.relationship_type || 'friend';
        const cfg = REL_CONFIG[rel] || REL_CONFIG.friend;

        const lastMsg = "Tap to start chatting...";
        const time = formatTime(p.updated_at || p.created_at);

        const item = document.createElement('div');
        item.className = 'chat-item';

        item.innerHTML = `
            <div class="chat-avatar">
                ${p.avatar_url
                ? `<img src="${p.avatar_url}" class="avatar-img">`
                : cfg.emoji
            }
            </div>

            <div class="chat-content">
                <div class="chat-name-row">
                    <div class="chat-name">${p.persona_name}</div>
                    <div class="chat-time">${time}</div>
                </div>

                <div class="chat-preview">${lastMsg}</div>
            </div>
        `;

        item.onclick = () => openChat(p.id);

        list.appendChild(item);
    });
}

function formatTime(ts) {
    if (!ts) return '';

    const date = new Date(ts);

    return date.toLocaleTimeString('en-IN', {
        hour: '2-digit',
        minute: '2-digit'
    });
}

async function deletePersona(id, e) {
    e.stopPropagation();
    if (!confirm('Delete this persona and all memories?')) return;
    try {
        await api(`/persona/${id}`, 'DELETE');
        showToast('Persona deleted 🗑', 'info');
    } catch (e) {
        state.personas = state.personas.filter(p => p.id !== id);
    }
    loadDashboard();
}

// ══════════════════════════════════════
//  CREATE PERSONA
// ══════════════════════════════════════
function openCreate() {
    state.chatFile = null; state.selectedRel = null; state.currentStep = 1;
    document.getElementById('chat-file-input').value = '';
    document.getElementById('file-name-display').style.display = 'none';
    document.getElementById('upload-zone').classList.remove('file-chosen');
    ['chat-speaker-name', 'persona-name', 'user-name'].forEach(id => document.getElementById(id).value = '');
    document.getElementById('persona-gender').value = '';
    document.getElementById('user-gender').value = '';
    buildRelOptions();
    goStep(1, false);
    showScreen('create');
}

function buildRelOptions() {
    const RELS = [
        { value: 'friend', label: 'Friend', description: 'Casual friend — warm but not deep' },
        { value: 'best_friend', label: 'Best Friend', description: 'Close friend — can be blunt, very comfortable' },
        { value: 'crush', label: 'Crush', description: 'Romantic interest — slightly guarded, aware of tension' },
        { value: 'girlfriend', label: 'Partner', description: 'Romantic partner — affectionate, possessive at times' },
        { value: 'ex', label: 'Ex', description: 'Ex-partner — complicated, can be cold or nostalgic' },
        { value: 'colleague', label: 'Colleague', description: 'Work/school acquaintance — polite but not personal' },
    ];
    const container = document.getElementById('rel-options');
    container.innerHTML = '';
    RELS.forEach(r => {
        const pill = document.createElement('div');
        pill.className = 'opt-pill' + (state.selectedRel === r.value ? ' selected' : '');
        pill.dataset.value = r.value;
        const cfg = REL_CONFIG[r.value] || REL_CONFIG.friend;
        pill.innerHTML = `${cfg.emoji} ${r.label}<span class="tooltip">${r.description}</span>`;
        pill.onclick = () => {
            document.querySelectorAll('#rel-options .opt-pill').forEach(p => p.classList.remove('selected'));
            pill.classList.add('selected');
            state.selectedRel = r.value;
        };
        container.appendChild(pill);
    });
}

function handleFileSelect(input) {
    const file = input.files[0];
    if (!file) return;
    state.chatFile = file;
    const zone = document.getElementById('upload-zone');
    const nameEl = document.getElementById('file-name-display');
    zone.classList.add('file-chosen');
    nameEl.style.display = 'block';
    nameEl.textContent = `✓ ${file.name}`;
}

function goStep(n, validate = true) {
    if (validate && n > state.currentStep) {
        if (state.currentStep === 1 && !state.chatFile) { showToast('Please upload a chat file first.', 'error'); return; }
        if (state.currentStep === 2) {
            if (!document.getElementById('chat-speaker-name').value.trim()) { showToast("Enter their name as it appears in the chat.", 'error'); return; }
            if (!document.getElementById('persona-name').value.trim()) { showToast("Enter a display name.", 'error'); return; }
            if (!document.getElementById('persona-gender').value) { showToast("Select their gender.", 'error'); return; }
            if (!document.getElementById('user-gender').value) { showToast("Select your gender.", 'error'); return; }
        }
    }
    state.currentStep = n;
    document.querySelectorAll('.step-panel').forEach((p, i) => p.classList.toggle('active', i + 1 === n));
    document.querySelectorAll('.steps .step').forEach((s, i) => {
        s.classList.toggle('active', i + 1 === n);
        s.classList.toggle('done', i + 1 < n);
    });
}

async function submitCreate() {

    if (!state.hasApiKey) {
        showToast("Add API key first 🔑", "error");
        openKeyModal();
        return;
    }

    if (!state.selectedRel) { showToast('Choose a relationship type.', 'error'); return; }

    const form = new FormData();
    form.append('file', state.chatFile);
    form.append('chat_speaker_name', document.getElementById('chat-speaker-name').value.trim());
    form.append('persona_name', document.getElementById('persona-name').value.trim());
    form.append('relationship_type', state.selectedRel);
    form.append('persona_gender', document.getElementById('persona-gender').value);
    form.append('user_gender', document.getElementById('user-gender').value);
    form.append('user_name', document.getElementById('user-name').value.trim() || state.user?.name || 'User');

    const avatarFile = document.getElementById('persona-avatar').files[0];

    if (avatarFile) {
        form.append("avatar", avatarFile);
    }

    showLoading('Analysing their messages…');

    try {
        const res = await apiForm('/persona/create', form);
        hideLoading();
        if (res.error) { showToast(res.error, 'error'); return; }
        showToast(`${res.persona?.identity?.persona_name || 'Persona'} is ready! 🌸`, 'success');
        loadDashboard();
        showScreen('dashboard');
    } catch (err) {
        hideLoading();
        showToast('Could not reach backend. Make sure it\'s running.', 'error');
    }
}

// ══════════════════════════════════════
//  CHAT
// ══════════════════════════════════════
async function openChat(personaId, e) {
    if (e) e.stopPropagation();

    const persona = state.personas.find(p => p.id === personaId);
    if (!persona) return;

    state.activePersona = persona;
    const avatarEl = document.getElementById("chat-avatar-header");

    if (persona.avatar_url) {
        avatarEl.innerHTML = `<img src="${persona.avatar_url}" class="avatar-img">`;
    } else {
        avatarEl.innerHTML = "👤";
    }

    document.getElementById("chat-persona-name").textContent = persona.persona_name;

    state.chatHistory = []; // reset on open

    showScreen('chat');

    const msgs = document.getElementById('chat-messages');
    msgs.innerHTML = ""; // clear UI

    try {
        const hist = await api(`/chat/history/${personaId}`, 'GET');

        if (hist.messages?.length) {
            state.chatHistory = hist.messages;

            hist.messages.forEach(m => {
                const msgText = m.content || m.message || m.text || "";

                // detect role properly
                let finalRole;

                if (m.role === "user" || m.sender === "user" || m.is_user === true) {
                    finalRole = "user";
                } else {
                    finalRole = "persona";
                }

                appendMessage(finalRole, msgText, false);
            });

            scrollToBottom();
        }

    } catch (e) {
        console.error("History load failed:", e);
    }
}
function getOpeningPrompt(rel, name) {
    const prompts = {
        crush: `Start a conversation with ${name}… 💜`,
        ex: `Reach out to ${name}… 🥀`,
        best_friend: `Say hey to ${name} 👋`,
        friend: `Chat with ${name} 😊`,
        girlfriend: `Talk to ${name} 💛`,
        boyfriend: `Talk to ${name} 💛`,
        colleague: `Message ${name} 💼`,
    };
    return prompts[rel] || `Say something to ${name}…`;
}

function appendMessage(role, text, animate = true) {
    const safeText = (text ?? "").toString();
    const container = document.getElementById('chat-messages');
    document.getElementById('chat-empty')?.remove();

    const wrapper = document.createElement('div');
    wrapper.className = `msg ${role}`;
    if (!animate) wrapper.style.animation = 'none';

    const rel = state.activePersona?.persona_json?.identity?.relationship_type || 'friend';
    const cfg = REL_CONFIG[rel] || REL_CONFIG.friend;
    const avatarEmoji = role === 'persona' ? cfg.emoji : '🫵';

    const time = new Date().toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });

    const isUser = role === "user";

    wrapper.innerHTML = `
  <div class="msg-bubble ${isUser ? "user-bubble" : "persona-bubble"}">
    <span class="msg-text">${safeText}</span>

    <div class="msg-meta">
      <span class="msg-time">${time}</span>
      ${isUser ? '<span class="msg-ticks">✓✓</span>' : ''}
    </div>
  </div>
`;
    container.appendChild(wrapper);
    scrollToBottom();
}

function showTyping() {
    const container = document.getElementById('chat-messages');
    const el = document.createElement('div');
    el.className = 'msg persona'; el.id = 'typing-indicator';
    el.innerHTML = `<div class="msg-avatar">💭</div><div class="msg-bubble"><div class="typing-indicator"><div class="typing-dot"></div><div class="typing-dot"></div><div class="typing-dot"></div></div></div>`;
    container.appendChild(el);
    scrollToBottom();
}

function hideTyping() {
    document.getElementById('typing-indicator')?.remove();
}

async function sendMessage() {
    if (!state.hasApiKey) {
        showToast("Add API key first 🔑", "error");
        openKeyModal();
        return;
    }
    if (state.isSending) return;
    const input = document.getElementById('chat-input');
    const text = input.value.trim();
    if (!text || !state.activePersona) return;

    input.value = ''; autoResize(input);
    appendMessage('user', text);
    state.chatHistory.push({
        role: "user",
        content: text
    });
    state.isSending = true;
    document.getElementById('send-btn').disabled = true;
    showTyping();

    try {
        const res = await api('/chat/send', 'POST', {
            persona_id: state.activePersona.id,
            message: text
        });
        hideTyping();
        const reply = res.reply || res.message || res.response || "⚠️ No reply";

        appendMessage('persona', reply);

        state.chatHistory.push({
            role: "persona",
            content: reply
        });
        if (res.memory_saved) showMemoryToast();
    } catch (e) {
        hideTyping();
        console.error("Chat send failed:", e);

        // don't show fake message if it's a known handled error
        if (e.message === "LIMIT" || e.message === "BAD_KEY" || e.message === "NO_KEY") {
            return;
        }

        appendMessage('persona', "⚠️ Something went wrong.");
        showToast("Message failed. Try again.", "error");
    }

    state.isSending = false;
    document.getElementById('send-btn').disabled = false;
}

async function deleteCurrentPersona() {

    document.getElementById("chat-menu-dropdown").style.display = "none";

    if (!state.activePersona) return;

    if (!window.confirm("Delete this persona permanently?")) return;
    try {
        await api(`/persona/${state.activePersona.id}`, "DELETE");

        showToast("Persona deleted 🗑", "info");

        state.activePersona = null;
        showScreen("dashboard");
        loadDashboard();

    } catch (e) {
        console.error(e);
        showToast("Failed to delete persona", "error");
    }
}

function handleChatKey(e) {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); }
}

function autoResize(el) {
    el.style.height = 'auto';
    el.style.height = Math.min(el.scrollHeight, 120) + 'px';
}

function scrollToBottom() {
    const msgs = document.getElementById('chat-messages');
    msgs.scrollTop = msgs.scrollHeight;
}

function showMemoryToast() {
    const t = document.getElementById('memory-toast');
    t.classList.add('show');
    setTimeout(() => t.classList.remove('show'), 3000);
}

// ══════════════════════════════════════
//  API HELPERS
// ══════════════════════════════════════
async function api(path, method = 'GET', body = null) {

    const session = await waitForSession();

    if (!session) {
        throw new Error("NO_SESSION");
    }

    const token = session.access_token;

    const res = await fetch(API + path, {
        method,
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`
        },
        body: body ? JSON.stringify(body) : null
    });

    if (!res.ok) {
    let err;

    try {
        err = await res.json();
    } catch {
        err = { detail: "UNKNOWN_ERROR" };
    }

    if (err.detail === "DAILY_LIMIT_EXCEEDED") {
        showToast("Daily API limit exceeded ⏳", "error");
        throw new Error("LIMIT");
    }

    if (err.detail === "INVALID_API_KEY") {
        showToast("Invalid API key 🔑", "error");
        openKeyModal();
        throw new Error("BAD_KEY");
    }

    if (err.detail === "NO_API_KEY") {
        showToast("Add API key first 🔑", "error");
        openKeyModal();
        throw new Error("NO_KEY");
    }

    throw new Error(err.detail || "Request failed");
}

    return res.json();
}

// ══════════════════════════════════════
//  UI UTILS
// ══════════════════════════════════════
function showLoading(text = 'Loading…') {
    document.getElementById('loading-text').textContent = text;
    document.getElementById('loading').classList.add('active');
}
function hideLoading() {
    document.getElementById('loading').classList.remove('active');
}

let toastTimer;
function showToast(msg, type = 'info') {
    const t = document.getElementById('toast');
    t.textContent = msg; t.className = `toast ${type} show`;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove('show'), 3500);
}

function escapeHtml(text) {
    return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\n/g, '<br>');
}

// ══════════════════════════════════════
//  DRAG & DROP
// ══════════════════════════════════════
function setupDnD() {
    const zone = document.getElementById('upload-zone');
    if (!zone) return;

    zone.addEventListener('dragover', e => {
        e.preventDefault();
        zone.classList.add('drag');
    });

    zone.addEventListener('dragleave', () => zone.classList.remove('drag'));

    zone.addEventListener('drop', e => {
        e.preventDefault();
        zone.classList.remove('drag');

        const file = e.dataTransfer.files[0];

        if (file && file.name.endsWith('.txt')) {
            state.chatFile = file;

            zone.classList.add('file-chosen');

            const n = document.getElementById('file-name-display');
            n.style.display = 'block';
            n.textContent = `✓ ${file.name}`;
        } else {
            showToast('Please drop a .txt WhatsApp export.', 'error');
        }
    });
}

// ══════════════════════════════════════
//  BOOT — restore session from Supabase
// ══════════════════════════════════════
sb.auth.onAuthStateChange((event, session) => {
    if (session?.user) {
        state.user = {
            id: session.user.id,
            email: session.user.email,
            name: session.user.user_metadata?.name || session.user.email.split('@')[0],
        };
        if (document.getElementById('dashboard').classList.contains('active') === false
            && !['create', 'chat'].some(id => document.getElementById(id).classList.contains('active'))) {
            loadDashboard();
            showScreen('dashboard');
        }
    } else if (event === 'SIGNED_OUT') {
        state.user = null;
        showScreen('landing');
    }
});

window.addEventListener("DOMContentLoaded", async () => {

    const { data } = await sb.auth.getSession();

    if (data?.session) {
        const user = data.session.user;

        state.user = {
            id: user.id,
            email: user.email,
            name: user.user_metadata?.name || user.email.split('@')[0]
        };

        console.log("Session restored:", state.user);

        showScreen('dashboard');
        loadDashboard();

        setupChatMenu();
        setupDnD();

    } else {
        console.log("No session found");
        showScreen('landing');
    }
});

async function saveKey() {
    const key = document.getElementById("api-key-input").value.trim();

    if (!key) {
        showToast("Enter API key", "error");
        return;
    }

    try {
        await api('/api-key/save', 'POST', { key });

        state.hasApiKey = true;

        updateApiKeyUI();
        closeKeyModal();

        showToast("API key saved successfully 🔑", "success");

        // clear input AFTER saving
        document.getElementById("api-key-input").value = "";

    } catch (e) {
        console.error(e);
        showToast("Failed to save key", "error");
    }
}

function updateApiKeyUI() {
    const btn = document.getElementById("apiKeyBtn");
    const status = document.getElementById("apiKeyStatus");

    if (!btn) return;

    if (state.hasApiKey) {
        btn.textContent = "Edit API Key";
        if (status) status.textContent = "API Key Added ✅";
    } else {
        btn.textContent = "Add API Key";
        if (status) status.textContent = "No API Key ❌";
    }
}

const modal = document.getElementById("api-key-modal");

document.addEventListener("DOMContentLoaded", () => {
    const modal = document.getElementById("api-key-modal");

    if (modal) {
        modal.addEventListener("click", (e) => {
            if (e.target.id === "api-key-modal") {
                closeKeyModal();
            }
        });
    }
});

function openKeyModal() {
    document.getElementById("api-key-input").value = "";
    document.getElementById("api-key-modal").classList.add("active");
}

function closeKeyModal() {
    document.getElementById("api-key-modal").classList.remove("active");
}