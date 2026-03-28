const STORAGE_KEY = "zachetka-state-v1";

// ============ СОСТОЯНИЕ ============
let state = {
  users: [],
  posts: [],
  currentUserId: null,
  nextUserId: 3,
  nextPostId: 3,
  nextCommentId: 2
};

// ============ ПРОВЕРКА SUPABASE ============
let useSupabase = typeof window.supabase !== 'undefined' && window.supabase;
if (useSupabase) {
  console.log('✅ Supabase подключен');
} else {
  console.log('⚠️ Supabase не подключен, используется локальное хранилище');
}

// ============ ЗАГРУЗКА ДАННЫХ ============
async function loadFromSupabase() {
  if (!useSupabase) return false;
  
  try {
    const { data: users, error: usersError } = await window.supabase
      .from('users')
      .select('*');
    if (usersError) throw usersError;
    state.users = users || [];
    console.log('Загружено пользователей:', state.users.length);
    
    const { data: posts, error: postsError } = await window.supabase
      .from('posts')
      .select('*')
      .order('created_at', { ascending: false });
    if (postsError) throw postsError;
    
    for (let post of (posts || [])) {
      const { data: comments } = await window.supabase
        .from('comments')
        .select('*')
        .eq('post_id', post.id);
      post.comments = comments || [];
    }
    state.posts = posts || [];
    console.log('Загружено постов:', state.posts.length);
    
    return true;
  } catch (error) {
    console.error('Ошибка загрузки:', error);
    return false;
  }
}

function saveStateLocally() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify({
    users: state.users,
    posts: state.posts,
    currentUserId: state.currentUserId,
    nextUserId: state.nextUserId,
    nextPostId: state.nextPostId,
    nextCommentId: state.nextCommentId
  }));
}

function loadStateLocally() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const saved = JSON.parse(raw);
      state.users = saved.users || [];
      state.posts = saved.posts || [];
      state.currentUserId = saved.currentUserId;
      state.nextUserId = saved.nextUserId || 3;
      state.nextPostId = saved.nextPostId || 3;
      state.nextCommentId = saved.nextCommentId || 2;
    }
  } catch (e) {
    console.error('Ошибка загрузки из localStorage:', e);
  }
}

// Проверка сессии
async function checkSession() {
  if (!useSupabase) return;
  
  try {
    const { data: { session }, error } = await window.supabase.auth.getSession();
    if (error) throw error;
    
    if (session) {
      console.log('Сессия найдена:', session.user.email);
      const user = state.users.find(u => u.email === session.user.email);
      if (user) {
        state.currentUserId = user.id;
        console.log('Пользователь восстановлен:', user.username);
      } else {
        console.log('Пользователь не найден в таблице users, создаем...');
        // Если пользователь есть в Auth, но нет в таблице - создаем
        const { data: newUser, error: insertError } = await window.supabase
          .from('users')
          .insert([{
            id: session.user.id,
            email: session.user.email,
            username: session.user.user_metadata?.username || session.user.email.split('@')[0],
            display_name: session.user.user_metadata?.display_name || session.user.email.split('@')[0],
            created_at: new Date(),
            following: []
          }])
          .select()
          .single();
        
        if (!insertError && newUser) {
          state.users.push(newUser);
          state.currentUserId = newUser.id;
          console.log('Пользователь создан:', newUser);
        }
      }
    } else {
      console.log('Нет активной сессии');
    }
  } catch (error) {
    console.error('Ошибка проверки сессии:', error);
  }
}

async function initData() {
  if (useSupabase) {
    await loadFromSupabase();
    await checkSession();
  }
  if (!state.users.length) loadStateLocally();
  if (!state.users.length) {
    const now = Date.now();
    state.users = [
      { id: 1, displayName: "Ванек Зонт", username: "zachetka", avatarUrl: "", createdAt: now - 1000 * 60 * 60 * 24 * 10, following: [2], clan: "Клан ФТК" },
      { id: 2, displayName: "seriqas", username: "seriqas", avatarUrl: "", createdAt: now - 1000 * 60 * 60 * 24 * 30, following: [1], clan: null }
    ];
    state.posts = [
      { id: 1, authorId: 2, text: "Пример поста в вашей социальной сети Zachetka.", createdAt: now - 1000 * 60 * 53, likes: [1], comments: [{ id: 1, authorId: 1, text: "Круто выглядит!", createdAt: now - 1000 * 60 * 10 }] },
      { id: 2, authorId: 1, text: "Добро пожаловать в Социальную Сеть Zachetka!", createdAt: now - 1000 * 60 * 60, likes: [2], comments: [] }
    ];
  }
  saveStateLocally();
}

// ============ РАБОТА С SUPABASE ============
async function registerUserSupabase(displayName, username, email, password, avatarUrl = '') {
  if (!useSupabase) {
    const newUser = { id: state.nextUserId++, displayName, username, avatarUrl, createdAt: Date.now(), following: [] };
    state.users.push(newUser);
    state.currentUserId = newUser.id;
    saveStateLocally();
    return { success: true, user: newUser };
  }
  try {
    console.log('Регистрация:', username, email);
    
    // Регистрация в Supabase Auth
    const { data: authData, error: authError } = await window.supabase.auth.signUp({ 
      email: email, 
      password: password,
      options: {
        data: { 
          username: username, 
          display_name: displayName 
        }
      }
    });
    
    if (authError) {
      console.error('Ошибка Auth:', authError);
      throw authError;
    }
    
    console.log('Auth успешен, user id:', authData.user?.id);
    
    // Создаем запись в таблице users
    const { data: userData, error: userError } = await window.supabase
      .from('users')
      .insert([{
        id: authData.user.id,
        email: email,
        username: username,
        display_name: displayName,
        avatar_url: avatarUrl,
        created_at: new Date(),
        following: []
      }])
      .select()
      .single();
    
    if (userError) {
      console.error('Ошибка создания пользователя в таблице:', userError);
      throw userError;
    }
    
    console.log('Пользователь создан в таблице:', userData);
    state.users.push(userData);
    state.currentUserId = userData.id;
    saveStateLocally();
    
    return { success: true, user: userData };
  } catch (error) {
    console.error('Ошибка регистрации:', error);
    return { success: false, error: error.message };
  }
}

async function loginUserSupabase(username, password) {
  if (!useSupabase) {
    const user = state.users.find(u => u.username === username);
    if (!user) return { success: false, error: 'Пользователь не найден' };
    state.currentUserId = user.id;
    saveStateLocally();
    return { success: true, user };
  }
  try {
    console.log('Попытка входа:', username);
    
    // Сначала находим пользователя по username в нашей таблице
    const user = state.users.find(u => u.username === username);
    if (!user) {
      console.log('Пользователь не найден в таблице users');
      return { success: false, error: 'Пользователь не найден' };
    }
    
    console.log('Найден пользователь в таблице, email:', user.email);
    
    // Пытаемся войти через Auth
    const { data: authData, error: authError } = await window.supabase.auth.signInWithPassword({ 
      email: user.email, 
      password: password 
    });
    
    if (authError) {
      console.error('Ошибка Auth:', authError.message);
      return { success: false, error: 'Неверный пароль' };
    }
    
    console.log('Вход успешен');
    state.currentUserId = user.id;
    saveStateLocally();
    
    return { success: true, user: user };
  } catch (error) {
    console.error('Ошибка входа:', error);
    return { success: false, error: 'Ошибка входа: ' + error.message };
  }
}

async function logoutUserSupabase() {
  if (useSupabase) await window.supabase.auth.signOut();
  state.currentUserId = null;
  saveStateLocally();
}

async function createPostSupabase(text) {
  const currentUser = getCurrentUser();
  if (!currentUser) return false;
  
  if (!useSupabase) {
    const newPost = { 
      id: state.nextPostId++, 
      authorId: currentUser.id, 
      text, 
      createdAt: Date.now(), 
      likes: [], 
      comments: [] 
    };
    state.posts.unshift(newPost);
    saveStateLocally();
    updateAllUI();
    return true;
  }
  
  try {
    const { data, error } = await window.supabase
      .from('posts')
      .insert([{ 
        author_id: currentUser.id, 
        text: text, 
        created_at: new Date(), 
        likes: [] 
      }])
      .select()
      .single();
    
    if (error) throw error;
    
    data.comments = [];
    state.posts.unshift(data);
    updateAllUI();
    return true;
  } catch (error) {
    console.error('Ошибка создания поста:', error);
    return false;
  }
}

async function deletePostSupabase(postId) {
  const currentUser = getCurrentUser();
  if (!currentUser) return false;
  const post = state.posts.find(p => p.id === postId);
  const isAuthor = useSupabase ? post?.author_id === currentUser.id : post?.authorId === currentUser.id;
  if (!post || !isAuthor) { alert("Нельзя удалить чужой пост!"); return false; }
  if (!confirm("Удалить пост?")) return false;
  if (!useSupabase) {
    state.posts = state.posts.filter(p => p.id !== postId);
    saveStateLocally();
    updateAllUI();
    return true;
  }
  try {
    await window.supabase.from('posts').delete().eq('id', postId);
    state.posts = state.posts.filter(p => p.id !== postId);
    updateAllUI();
    return true;
  } catch (error) {
    console.error('Ошибка удаления:', error);
    return false;
  }
}

async function toggleLikeSupabase(postId) {
  const currentUser = getCurrentUser();
  if (!currentUser) return;
  const post = state.posts.find(p => p.id === postId);
  if (!post) return;
  const likes = post.likes || [];
  const hasLiked = likes.includes(currentUser.id);
  const newLikes = hasLiked ? likes.filter(id => id !== currentUser.id) : [...likes, currentUser.id];
  if (!useSupabase) {
    post.likes = newLikes;
    saveStateLocally();
    updateAllUI();
    return;
  }
  try {
    await window.supabase.from('posts').update({ likes: newLikes }).eq('id', postId);
    post.likes = newLikes;
    updateAllUI();
  } catch (error) {
    console.error('Ошибка лайка:', error);
  }
}

async function addCommentSupabase(postId, text) {
  const currentUser = getCurrentUser();
  if (!currentUser) return;
  if (!useSupabase) {
    const post = state.posts.find(p => p.id === postId);
    if (post) {
      post.comments.push({ id: state.nextCommentId++, authorId: currentUser.id, text, createdAt: Date.now() });
      saveStateLocally();
      updateAllUI();
    }
    return;
  }
  try {
    const { data, error } = await window.supabase.from('comments').insert([{ post_id: postId, author_id: currentUser.id, text, created_at: new Date() }]).select().single();
    if (!error && data) {
      const post = state.posts.find(p => p.id === postId);
      if (post) { if (!post.comments) post.comments = []; post.comments.push(data); }
      updateAllUI();
    }
  } catch (error) {
    console.error('Ошибка комментария:', error);
  }
}

// ============ ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ ============
function getUser(id) {
  return state.users.find(u => u.id === id) || null;
}
function getCurrentUser() { return state.currentUserId ? getUser(state.currentUserId) : null; }
function timeAgo(timestamp) {
  const diffSec = Math.floor((Date.now() - timestamp) / 1000);
  if (diffSec < 60) return "только что";
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin} мин. назад`;
  const diffHours = Math.floor(diffMin / 60);
  if (diffHours < 24) return `${diffHours} ч. назад`;
  const diffDays = Math.floor(diffHours / 24);
  return `${diffDays} дн. назад`;
}
function fileToDataUrl(file) { return new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.onerror = () => reject(reader.error); reader.readAsDataURL(file); }); }

// ============ ТЕМА ============
function getCurrentTheme() { return localStorage.getItem('theme') || 'light'; }
function setTheme(theme) {
  if (theme === 'dark') { document.documentElement.setAttribute('data-theme', 'dark'); localStorage.setItem('theme', 'dark'); const btn = document.getElementById('theme-toggle'); if (btn) btn.textContent = '☀️'; }
  else { document.documentElement.removeAttribute('data-theme'); localStorage.setItem('theme', 'light'); const btn = document.getElementById('theme-toggle'); if (btn) btn.textContent = '🌙'; }
}
function toggleTheme() { setTheme(getCurrentTheme() === 'light' ? 'dark' : 'light'); }

// ============ ОТРИСОВКА ============
function renderTopClans() {
  const clanTopListEl = document.getElementById("clan-top-list");
  if (!clanTopListEl) return;
  const counts = {};
  state.users.forEach(u => { if (u.clan) counts[u.clan] = (counts[u.clan] || 0) + 1; });
  const entries = Object.entries(counts).sort((a, b) => b[1] - a[1]);
  clanTopListEl.innerHTML = "";
  if (!entries.length) { clanTopListEl.innerHTML = '<span class="empty-text">Пока никто не выбрал клан</span>'; return; }
  entries.forEach(([name, count]) => { const btn = document.createElement("button"); btn.className = "tag-pill"; btn.textContent = `${name} · ${count} чел.`; clanTopListEl.appendChild(btn); });
}

function renderFeed() {
  const feedListEl = document.getElementById("feed-list");
  if (!feedListEl) return;
  
  const current = getCurrentUser();
  let posts = [...state.posts];
  
  posts.sort((a, b) => {
    const timeA = a.createdAt || new Date(a.created_at).getTime();
    const timeB = b.createdAt || new Date(b.created_at).getTime();
    return timeB - timeA;
  });
  
  feedListEl.innerHTML = "";
  
  posts.forEach(post => {
    const authorId = post.authorId || post.author_id;
    const author = getUser(authorId);
    if (!author) return;
    
    const isLiked = current ? (post.likes || []).includes(current.id) : false;
    const postTime = post.createdAt || new Date(post.created_at).getTime();
    
    const avatarUrl = author.avatar_url || author.avatarUrl || "";
    const displayName = author.display_name || author.displayName || "Пользователь";
    const username = author.username || "unknown";
    
    const postEl = document.createElement("article");
    postEl.className = "post";
    postEl.dataset.postId = String(post.id);
    
    postEl.innerHTML = `
      <header class="post-header">
        <div class="post-avatar js-profile-link" data-user-id="${author.id}" style="cursor: pointer;">
          ${avatarUrl ? `<img src="${avatarUrl}" />` : displayName[0]?.toUpperCase() || "U"}
        </div>
        <div style="flex:1;">
          <div class="post-author js-profile-link" data-user-id="${author.id}" style="cursor: pointer; font-weight: bold;">
            ${displayName}
          </div>
          <div class="post-meta">
            ${timeAgo(postTime)} • @${username}
          </div>
        </div>
        ${current && current.id === author.id ? `<button class="post-delete-btn js-delete-post" title="Удалить пост">🗑️</button>` : ''}
      </header>
      <div class="post-content">
        <p class="post-text">${post.text || ""}</p>
      </div>
      <footer class="post-footer">
        <button class="js-like-btn">${isLiked ? "❤" : "🤍"} ${(post.likes || []).length}</button>
        <button class="js-comment-toggle">💬 ${(post.comments || []).length}</button>
      </footer>
      <div class="comments" style="display:none">
        <div class="comments-list">
          ${(post.comments || []).map(c => {
            const cu = getUser(c.authorId || c.author_id);
            const cuName = cu ? (cu.display_name || cu.displayName || "Пользователь") : "Пользователь";
            const cuId = c.authorId || c.author_id;
            return `<div class="comment-item">
              <span class="comment-author js-profile-link" data-user-id="${cuId}" style="cursor: pointer; font-weight: bold;">${cuName}</span>
              <span class="comment-text">${c.text || ""}</span>
            </div>`;
          }).join('')}
        </div>
        <div class="comment-input-row">
          <input type="text" placeholder="Написать комментарий..." />
          <button class="js-comment-send">Отправить</button>
        </div>
      </div>
    `;
    
    feedListEl.appendChild(postEl);
  });
}

function renderProfile() {
  const profileNameEl = document.getElementById("profile-name");
  const profileUsernameEl = document.getElementById("profile-username");
  const profileAvatarEl = document.getElementById("profile-avatar");
  const profileEditBtn = document.getElementById("profile-edit-btn");
  const profileFollowBtn = document.getElementById("profile-follow-btn");
  const current = getCurrentUser();
  const user = viewedProfileId ? getUser(viewedProfileId) : current;
  if (!user) return;
  
  if (profileNameEl) profileNameEl.textContent = user.display_name || user.displayName;
  if (profileUsernameEl) profileUsernameEl.textContent = `@${user.username}`;
  
  if (profileAvatarEl) {
    const avatarUrl = user.avatar_url || user.avatarUrl;
    if (avatarUrl) profileAvatarEl.innerHTML = `<img src="${avatarUrl}" />`;
    else profileAvatarEl.textContent = (user.display_name || user.displayName)[0]?.toUpperCase() || "U";
  }
  
  const profileClanEl = document.getElementById('profile-clan');
  if (profileClanEl) profileClanEl.textContent = user.clan || '';
  
  const profileRegdate = document.getElementById('profile-regdate');
  if (profileRegdate) {
    const date = new Date(user.createdAt || user.created_at);
    const months = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];
    profileRegdate.textContent = `Регистрация: ${months[date.getMonth()]} ${date.getFullYear()} г.`;
  }
  
  const followersCount = state.users.filter(u => (u.following || []).includes(user.id)).length;
  const followingCount = (user.following || []).length;
  const postsCount = state.posts.filter(p => (p.authorId || p.author_id) === user.id).length;
  
  document.getElementById('profile-posts-count') && (document.getElementById('profile-posts-count').textContent = postsCount);
  document.getElementById('profile-followers-count') && (document.getElementById('profile-followers-count').textContent = followersCount);
  document.getElementById('profile-following-count') && (document.getElementById('profile-following-count').textContent = followingCount);
  
  const isOwn = current && current.id === user.id;
  
  if (profileFollowBtn) {
    if (!current || isOwn) {
      profileFollowBtn.style.display = 'none';
    } else {
      profileFollowBtn.style.display = 'block';
      const isFollowing = (current.following || []).includes(user.id);
      profileFollowBtn.textContent = isFollowing ? 'Отписаться' : 'Подписаться';
    }
  }
  
  if (profileEditBtn) profileEditBtn.style.display = isOwn ? 'block' : 'none';
  const profileComposer = document.getElementById('profile-composer');
  if (profileComposer) profileComposer.style.display = isOwn ? 'flex' : 'none';
  
  // ============ ОБРАБОТЧИК КНОПКИ ПОДПИСКИ ============
  const followButton = document.getElementById('profile-follow-btn');
  if (followButton && !isOwn && current) {
    // Убираем старые обработчики
    const newFollowBtn = followButton.cloneNode(true);
    followButton.parentNode.replaceChild(newFollowBtn, followButton);
    
    newFollowBtn.addEventListener('click', async () => {
      const currentUser = getCurrentUser();
      const targetUser = user;
      
      if (!currentUser) return;
      if (currentUser.id === targetUser.id) return;
      
      const isFollowing = (currentUser.following || []).includes(targetUser.id);
      
      let newFollowing;
      if (isFollowing) {
        newFollowing = (currentUser.following || []).filter(id => id !== targetUser.id);
        newFollowBtn.textContent = 'Подписаться';
      } else {
        newFollowing = [...(currentUser.following || []), targetUser.id];
        newFollowBtn.textContent = 'Отписаться';
      }
      
      currentUser.following = newFollowing;
      
      if (useSupabase) {
        const { error } = await window.supabase
          .from('users')
          .update({ following: newFollowing })
          .eq('id', currentUser.id);
        
        if (error) {
          console.error('Ошибка подписки:', error);
          alert('Ошибка при подписке');
          return;
        }
      }
      
      saveStateLocally();
      renderProfile(); // Обновляем профиль для обновления счетчиков
    });
  }
  
  // ============ ОТРИСОВКА ПОСТОВ ============
  const profilePostsEl = document.getElementById('profile-posts');
  if (!profilePostsEl) return;
  
  const activeTab = document.querySelector('.profile-tab-active')?.dataset.profileTab || 'posts';
  let posts = [];
  
  if (activeTab === 'posts') {
    posts = state.posts.filter(p => (p.authorId || p.author_id) === user.id).sort((a,b) => (b.createdAt || new Date(b.created_at).getTime()) - (a.createdAt || new Date(a.created_at).getTime()));
  } else {
    posts = state.posts.filter(p => (p.likes || []).includes(user.id)).sort((a,b) => (b.createdAt || new Date(b.created_at).getTime()) - (a.createdAt || new Date(a.created_at).getTime()));
  }
  
  if (posts.length === 0) {
    profilePostsEl.innerHTML = `<div class="empty-state"><div class="empty-icon">📭</div><p class="empty-title">Нет ${activeTab === 'posts' ? 'постов' : 'лайков'}</p></div>`;
    return;
  }
  
  profilePostsEl.innerHTML = '';
  posts.forEach(post => {
    const authorId = post.authorId || post.author_id;
    const author = getUser(authorId);
    if (!author) return;
    const isLiked = current ? (post.likes || []).includes(current.id) : false;
    const postTime = post.createdAt || new Date(post.created_at).getTime();
    const avatarUrl = author.avatar_url || author.avatarUrl || "";
    const displayName = author.display_name || author.displayName || "Пользователь";
    const username = author.username || "unknown";
    
    const postEl = document.createElement('article');
    postEl.className = 'post';
    postEl.dataset.postId = String(post.id);
    
    postEl.innerHTML = `
      <header class="post-header">
        <div class="post-avatar js-profile-link" data-user-id="${author.id}" style="cursor: pointer;">
          ${avatarUrl ? `<img src="${avatarUrl}" />` : displayName[0]?.toUpperCase() || "U"}
        </div>
        <div style="flex:1;">
          <div class="post-author js-profile-link" data-user-id="${author.id}" style="cursor: pointer; font-weight: bold;">
            ${displayName}
          </div>
          <div class="post-meta">${timeAgo(postTime)} • @${username}</div>
        </div>
        ${current && current.id === author.id ? `<button class="post-delete-btn js-delete-post">🗑️</button>` : ''}
      </header>
      <div class="post-content"><p class="post-text">${post.text || ""}</p></div>
      <footer class="post-footer">
        <button class="js-like-btn">${isLiked ? "❤" : "🤍"} ${(post.likes || []).length}</button>
        <button class="js-comment-toggle">💬 ${(post.comments || []).length}</button>
      </footer>
      <div class="comments" style="display:none">
        <div class="comments-list">
          ${(post.comments || []).map(c => {
            const cu = getUser(c.authorId || c.author_id);
            const cuName = cu ? (cu.display_name || cu.displayName || "Пользователь") : "Пользователь";
            const cuId = c.authorId || c.author_id;
            return `<div class="comment-item">
              <span class="comment-author js-profile-link" data-user-id="${cuId}" style="cursor: pointer; font-weight: bold;">${cuName}</span>
              <span class="comment-text">${c.text || ""}</span>
            </div>`;
          }).join('')}
        </div>
        <div class="comment-input-row">
          <input type="text" placeholder="Написать комментарий..." />
          <button class="js-comment-send">Отправить</button>
        </div>
      </div>
    `;
    profilePostsEl.appendChild(postEl);
  });
}
function updateAllUI() { renderFeed(); renderProfile(); renderTopClans(); }

// ============ ОБРАБОТЧИКИ ============
let viewedProfileId = null;
let currentFeedFilter = "all";
let pendingAvatarRemove = false;

document.addEventListener("DOMContentLoaded", async () => {
  await initData();
  
  const navItems = document.querySelectorAll(".nav-item");
  const pages = document.querySelectorAll(".page");
  const authOverlay = document.getElementById("auth-overlay");
  const authTabs = document.querySelectorAll(".auth-tab");
  const loginForm = document.getElementById("login-form");
  const registerForm = document.getElementById("register-form");
  const loginError = document.getElementById("login-error");
  const registerError = document.getElementById("register-error");
  const feedListEl = document.getElementById("feed-list");
  const feedComposerInput = document.getElementById("feed-composer-input");
  const feedPublishBtn = document.getElementById("feed-publish-btn");
  const profileComposerSection = document.getElementById("profile-composer");
  const profileComposerInput = document.getElementById("profile-composer-input");
  const profilePostsEl = document.getElementById("profile-posts");
  const profileEditBtn = document.getElementById("profile-edit-btn");
  const profileFollowBtn = document.getElementById("profile-follow-btn");
  const profileModalBackdrop = document.getElementById("profile-modal-backdrop");
  const profileModalClose = document.getElementById("profile-modal-close");
  const profileModalCancel = document.getElementById("profile-modal-cancel");
  const profileEditForm = document.getElementById("profile-edit-form");
  const profileEditError = document.getElementById("profile-edit-error");
  const editDisplayInput = document.getElementById("edit-displayname");
  const editUsernameInput = document.getElementById("edit-username");
  const editClanSelect = document.getElementById("edit-clan");
  const editAvatarFileInput = document.getElementById("edit-avatar-file");
  const editAvatarRemoveBtn = document.getElementById("edit-avatar-remove");
  const feedTabs = document.querySelectorAll(".topbar-tab");
  
  setTheme(getCurrentTheme());
  
  function setActivePage(pageName) {
    navItems.forEach(btn => { if (btn.getAttribute("data-page") === pageName) btn.classList.add("active"); else btn.classList.remove("active"); });
    pages.forEach(page => { if (page.id === `page-${pageName}`) page.classList.add("page-active"); else page.classList.remove("page-active"); });
  }
  
  function showAuthTab(tab) {
    authTabs.forEach(btn => btn.classList.toggle("auth-tab-active", btn.dataset.authTab === tab));
    if (tab === "login") { loginForm.classList.add("auth-form-active"); registerForm.classList.remove("auth-form-active"); }
    else { registerForm.classList.add("auth-form-active"); loginForm.classList.remove("auth-form-active"); }
    loginError.textContent = ""; registerError.textContent = "";
  }
  
  navItems.forEach(btn => btn.addEventListener("click", () => { const pageId = btn.getAttribute("data-page"); if (pageId) { setActivePage(pageId); if (pageId === "profile") { viewedProfileId = state.currentUserId; renderProfile(); } } }));
  feedTabs.forEach(tab => tab.addEventListener("click", () => { feedTabs.forEach(t => t.classList.remove("topbar-tab-active")); tab.classList.add("topbar-tab-active"); const label = tab.textContent.trim(); if (label.startsWith("Лента друзей")) currentFeedFilter = "friends"; else if (label.startsWith("Подписки")) currentFeedFilter = "following"; else currentFeedFilter = "all"; renderFeed(); }));
  document.getElementById('theme-toggle')?.addEventListener('click', toggleTheme);
  document.querySelectorAll("[data-auth-tab-switch]").forEach(btn => btn.addEventListener("click", () => showAuthTab(btn.getAttribute("data-auth-tab-switch"))));
  authTabs.forEach(btn => btn.addEventListener("click", () => showAuthTab(btn.dataset.authTab)));
  
  loginForm?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const username = document.getElementById("login-username").value.trim();
    const password = document.getElementById("login-password").value.trim();
    loginError.textContent = "";
    const result = await loginUserSupabase(username, password);
    if (result.success) { authOverlay.classList.add("hidden"); viewedProfileId = state.currentUserId; updateAllUI(); }
    else loginError.textContent = result.error;
  });
  
  registerForm?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const displayName = document.getElementById("reg-displayname").value.trim();
    const username = document.getElementById("reg-username").value.trim();
    const email = `${username}@zachetka.com`;
    const password = document.getElementById("reg-password").value.trim();
    const avatarFile = document.getElementById("reg-avatar-file")?.files?.[0];
    registerError.textContent = "";
    if (!displayName || !username || !password) { registerError.textContent = "Заполните все поля"; return; }
    if (password.length < 6) { registerError.textContent = "Пароль минимум 6 символов"; return; }
    if (state.users.some(u => u.username === username)) { registerError.textContent = "Юзернейм уже занят"; return; }
    let avatarUrl = "";
    if (avatarFile) { if (avatarFile.size > 1024*1024) { registerError.textContent = "Аватарка не более 1 МБ"; return; } try { avatarUrl = await fileToDataUrl(avatarFile); } catch { registerError.textContent = "Ошибка загрузки аватарки"; return; } }
    const result = await registerUserSupabase(displayName, username, email, password, avatarUrl);
    if (result.success) { authOverlay.classList.add("hidden"); viewedProfileId = state.currentUserId; updateAllUI(); }
    else registerError.textContent = result.error;
  });
  
  async function handlePublishPost(source) {
    const current = getCurrentUser();
    if (!current) return;
    const textarea = source === "feed" ? feedComposerInput : profileComposerInput;
    const text = textarea?.value.trim();
    if (!text) return;
    const success = await createPostSupabase(text);
    if (success) { textarea.value = ""; updateAllUI(); }
  }
  
  feedPublishBtn?.addEventListener("click", () => handlePublishPost("feed"));
  profileComposerSection?.querySelector("#profile-publish-btn")?.addEventListener("click", () => handlePublishPost("profile"));
  
  async function toggleLike(postId) { await toggleLikeSupabase(postId); }
  async function addComment(postId, text) { await addCommentSupabase(postId, text); }
  async function deletePost(postId) { await deletePostSupabase(postId); }
  
  function handleFeedClick(container, event) {
    const target = event.target;
    const postEl = target.closest(".post");
    if (!postEl) return;
    const postId = Number(postEl.dataset.postId);
  
    // Лайк
    if (target.classList.contains("js-like-btn")) {
      toggleLike(postId);
      return;
    }
  
    // Удаление
    if (target.classList.contains("js-delete-post") || target.closest(".js-delete-post")) {
      deletePost(postId);
      return;
    }
  
    // Комментарии
    if (target.classList.contains("js-comment-toggle") || target.closest(".js-comment-toggle")) {
      const commentsEl = postEl.querySelector(".comments");
      if (commentsEl) {
        commentsEl.style.display = commentsEl.style.display === "none" ? "block" : "none";
      }
      return;
    }
  
    // Отправка комментария
    if (target.classList.contains("js-comment-send") || target.closest(".js-comment-send")) {
      const row = target.closest(".comment-input-row");
      const input = row?.querySelector("input");
      const text = input?.value.trim();
      if (text) {
        addComment(postId, text);
      }
      return;
    }
  
    // ПЕРЕХОД НА ПРОФИЛЬ - проверяем клик по аватарке или имени
    const profileLink = target.closest(".js-profile-link");
    if (profileLink) {
      const userId = profileLink.getAttribute("data-user-id");
      console.log("Клик по профилю, userId:", userId);
      if (userId) {
        viewedProfileId = userId;
        setActivePage("profile");
        renderProfile();
      }
      return;
    }
  }
  
  feedListEl?.addEventListener("click", e => handleFeedClick(feedListEl, e));
  profilePostsEl?.addEventListener("click", e => handleFeedClick(profilePostsEl, e));
  
  document.querySelectorAll('.profile-tab').forEach(tab => tab.addEventListener('click', () => { document.querySelectorAll('.profile-tab').forEach(t => t.classList.remove('profile-tab-active')); tab.classList.add('profile-tab-active'); renderProfile(); }));
  
  function openProfileModal() {
    const current = getCurrentUser();
    if (!current) return;
    editDisplayInput.value = current.display_name || current.displayName;
    editUsernameInput.value = current.username;
    if (editClanSelect) editClanSelect.value = current.clan || "";
    if (editAvatarFileInput) editAvatarFileInput.value = "";
    pendingAvatarRemove = false;
    profileEditError.textContent = "";
    
    // ========== СИНХРОНИЗАЦИЯ ПЕРЕКЛЮЧАТЕЛЯ ТЕМЫ ==========
    // const themeToggleCheckbox = document.getElementById('theme-switch-toggle');
    // if (themeToggleCheckbox) {
      //const isDark = document.documentElement.hasAttribute('data-theme');
     // themeToggleCheckbox.checked = isDark;
    //}
    // =====================================================
    
    profileModalBackdrop.classList.add("visible");
  }
  function closeProfileModal() { profileModalBackdrop.classList.remove("visible"); }
  profileEditBtn?.addEventListener("click", openProfileModal);
  profileModalClose?.addEventListener("click", closeProfileModal);
  profileModalCancel?.addEventListener("click", closeProfileModal);
  editAvatarRemoveBtn?.addEventListener("click", () => { pendingAvatarRemove = true; if (editAvatarFileInput) editAvatarFileInput.value = ""; });
  
  profileEditForm?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const current = getCurrentUser();
    if (!current) return;
    const displayName = editDisplayInput.value.trim();
    const username = editUsernameInput.value.trim();
    const clan = editClanSelect?.value || "";
    if (!displayName || !username) { profileEditError.textContent = "Имя и юзернейм обязательны"; return; }
    if (state.users.some(u => u.id !== current.id && u.username === username)) { profileEditError.textContent = "Юзернейм уже занят"; return; }
    const updateData = { display_name: displayName, username, clan: clan || null };
    if (pendingAvatarRemove) updateData.avatar_url = "";
    const avatarFile = editAvatarFileInput?.files?.[0];
    if (avatarFile && !pendingAvatarRemove) { if (avatarFile.size > 1024*1024) { profileEditError.textContent = "Аватарка не более 1 МБ"; return; } try { updateData.avatar_url = await fileToDataUrl(avatarFile); } catch { profileEditError.textContent = "Ошибка загрузки"; return; } }
    if (useSupabase) { await window.supabase.from('users').update(updateData).eq('id', current.id); }
    Object.assign(current, updateData);
    saveStateLocally();
    closeProfileModal();
    updateAllUI();
  });
  
  document.querySelector(".sidebar-logout")?.addEventListener("click", async () => { await logoutUserSupabase(); if (authOverlay) { authOverlay.classList.remove("hidden"); showAuthTab("login"); } updateAllUI(); });
  
  // Эмодзи
  function initEmojiPicker() {
    const emojiBtn = document.getElementById('emoji-picker-btn');
    if (!emojiBtn) return;
    const emojis = ['😊','😂','🤣','❤️','😍','😒','👌','👍','🔥','🎉','✨','⭐','💯','✅','❌','💔','😢','😭','😘','😁','🤔','😎','🙄','😴','🎓','📚','✏️','📝','💻','📱','🎮','🏀'];
    const panel = document.createElement('div');
    panel.className = 'emoji-panel';
    panel.style.display = 'none';
    emojis.forEach(e => { const btn = document.createElement('button'); btn.textContent = e; btn.addEventListener('click', (ev) => { ev.preventDefault(); ev.stopPropagation(); const inp = document.activeElement; if (inp === feedComposerInput || inp === profileComposerInput) { const s = inp.selectionStart; inp.value = inp.value.slice(0,s) + e + inp.value.slice(inp.selectionEnd); inp.selectionStart = inp.selectionEnd = s + e.length; inp.focus(); } else if (feedComposerInput) feedComposerInput.value += e; panel.style.display = 'none'; }); panel.appendChild(btn); });
    document.querySelector('.composer-main')?.appendChild(panel);
    emojiBtn.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); panel.style.display = panel.style.display === 'none' ? 'grid' : 'none'; });
    document.addEventListener('click', (e) => { if (!emojiBtn.contains(e.target) && !panel.contains(e.target)) panel.style.display = 'none'; });
  }
  initEmojiPicker();
    // ========== ОБРАБОТЧИК ПЕРЕКЛЮЧАТЕЛЯ ТЕМЫ В МОДАЛЬНОМ ОКНЕ ==========
    const themeToggleCheckbox = document.getElementById('theme-switch-toggle');
    if (themeToggleCheckbox) {
      themeToggleCheckbox.addEventListener('change', (e) => {
        if (e.target.checked) {
          // Включаем тёмную тему
          document.documentElement.setAttribute('data-theme', 'dark');
          localStorage.setItem('theme', 'dark');
          console.log('Тёмная тема включена');
        } else {
          // Включаем светлую тему
          document.documentElement.removeAttribute('data-theme');
          localStorage.setItem('theme', 'light');
          console.log('Светлая тема включена');
        }
      });
    }
  
  const loginUser = getCurrentUser();
  if (!loginUser) { authOverlay.classList.remove("hidden"); showAuthTab("login"); }
  else { authOverlay.classList.add("hidden"); viewedProfileId = loginUser.id; updateAllUI(); }
});
