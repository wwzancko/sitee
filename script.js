const STORAGE_KEY = "zachetka-state-v1";

// ============ СОСТОЯНИЕ ============
let state = {
  users: [],
  posts: [],
  messages: [],
  currentUserId: null,
  nextUserId: 3,
  nextPostId: 3,
  nextCommentId: 2,
  nextMessageId: 1
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
    messages: state.messages,
    currentUserId: state.currentUserId,
    nextUserId: state.nextUserId,
    nextPostId: state.nextPostId,
    nextCommentId: state.nextCommentId,
    nextMessageId: state.nextMessageId
  }));
}

function loadStateLocally() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const saved = JSON.parse(raw);
      state.users = saved.users || [];
      state.posts = saved.posts || [];
      state.messages = saved.messages || [];
      state.currentUserId = saved.currentUserId;
      state.nextUserId = saved.nextUserId || 3;
      state.nextPostId = saved.nextPostId || 3;
      state.nextCommentId = saved.nextCommentId || 2;
      state.nextMessageId = saved.nextMessageId || 1;
    }
  } catch (e) {
    console.error('Ошибка загрузки из localStorage:', e);
  }
}

async function checkSession() {
  if (!useSupabase) return;
  
  try {
    const { data: { session }, error } = await window.supabase.auth.getSession();
    if (error) throw error;
    
    if (session) {
      console.log('Сессия найдена:', session.user.email);
      const ensuredUser = await ensureSupabaseUserRow(session.user);
      if (ensuredUser) {
        const idx = state.users.findIndex(u => idsEqual(u.id, ensuredUser.id));
        if (idx >= 0) state.users[idx] = ensuredUser;
        else state.users.push(ensuredUser);
        state.currentUserId = ensuredUser.id;
        console.log('Пользователь восстановлен:', ensuredUser.username);
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
    if (!state.users.length) {
      // В Supabase-режиме не подмешиваем локальных пользователей с числовыми id
      await loadFromSupabase();
    }
  }
  if (!useSupabase && !state.users.length) loadStateLocally();
  if (!useSupabase && !state.users.length) {
    const now = Date.now();
    state.users = [
      { id: 1, displayName: "Ванек Зонт", username: "zachetka", avatarUrl: "", createdAt: now - 1000 * 60 * 60 * 24 * 10, following: [2], clan: "Клан ФТК" },
      { id: 2, displayName: "seriqas", username: "seriqas", avatarUrl: "", createdAt: now - 1000 * 60 * 60 * 24 * 30, following: [1], clan: null }
    ];
    state.posts = [
      { id: 1, authorId: 2, text: "Пример поста в вашей социальной сети Zachetka.", createdAt: now - 1000 * 60 * 53, likes: [1], comments: [{ id: 1, authorId: 1, text: "Круто выглядит!", createdAt: now - 1000 * 60 * 10 }] },
      { id: 2, authorId: 1, text: "Добро пожаловать в Социальную Сеть Zachetka!", createdAt: now - 1000 * 60 * 60, likes: [2], comments: [] }
    ];
    state.messages = [];
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
    
    const ensuredUser = await ensureSupabaseUserRow(authData.user);
    if (!ensuredUser) throw new Error('Не удалось создать профиль пользователя в таблице users');

    const { data: userData, error: profileUpdateError } = await window.supabase
      .from('users')
      .update({
        email,
        username,
        display_name: displayName,
        avatar_url: avatarUrl || null
      })
      .eq('id', authData.user.id)
      .select()
      .single();

    if (profileUpdateError || !userData) {
      console.error('Ошибка обновления профиля после регистрации:', profileUpdateError);
      throw new Error('Не удалось сохранить профиль после регистрации');
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

    // Берем актуального пользователя из БД, а не только из локального state
    const { data: dbUser, error: userLoadError } = await window.supabase
      .from('users')
      .select('*')
      .ilike('username', username)
      .limit(1)
      .maybeSingle();

    if (userLoadError) {
      console.error('Ошибка поиска пользователя в users:', userLoadError);
      return { success: false, error: 'Ошибка поиска пользователя' };
    }

    const user = dbUser || state.users.find(u => (u.username || '').toLowerCase() === username.toLowerCase());
    if (!user) {
      console.log('Пользователь не найден в таблице users');
      return { success: false, error: 'Пользователь не найден' };
    }

    console.log('Найден пользователь в таблице, email:', user.email);

    const candidates = [];
    if (user.email) candidates.push(String(user.email).trim().toLowerCase());
    if (username.includes('@')) candidates.push(String(username).trim().toLowerCase());
    candidates.push(`${String(username).trim().toLowerCase()}@zachetka.com`);

    const loginEmails = [...new Set(candidates.filter(Boolean))];
    let authData = null;
    let lastAuthError = null;

    for (const emailCandidate of loginEmails) {
      const { data, error } = await window.supabase.auth.signInWithPassword({
        email: emailCandidate,
        password
      });

      if (!error && data?.user?.id) {
        authData = data;
        // Если вошли через fallback email, синхронизируем email в users
        if (!user.email || String(user.email).toLowerCase() !== emailCandidate) {
          await window.supabase.from('users').update({ email: emailCandidate }).eq('id', user.id);
        }
        break;
      }

      lastAuthError = error;
      const msg = (error?.message || '').toLowerCase();
      if (!msg.includes('invalid login credentials')) {
        // Нестандартную ошибку отдаём сразу
        console.error('Ошибка Auth:', error?.message);
        return { success: false, error: error?.message || 'Ошибка входа' };
      }
    }

    if (!authData?.user?.id) {
      console.error('Ошибка Auth:', lastAuthError?.message);
      return { success: false, error: 'Неверный пароль или старый email профиля. Попробуйте войти по email.' };
    }

    const ensuredUser = await ensureSupabaseUserRow(authData.user);
    if (ensuredUser) {
      const idx = state.users.findIndex(u => idsEqual(u.id, ensuredUser.id));
      if (idx >= 0) state.users[idx] = ensuredUser;
      else state.users.push(ensuredUser);
    }
    
    console.log('Вход успешен');
    state.currentUserId = authData.user.id;
    saveStateLocally();
    
    return { success: true, user: ensuredUser || user };
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

// ============ ФУНКЦИИ ДЛЯ ЛИЧНЫХ СООБЩЕНИЙ ============
function getMsgSenderId(msg) {
  return msg.sender_id ?? msg.senderId;
}

function getMsgReceiverId(msg) {
  return msg.receiver_id ?? msg.receiverId;
}

function getMsgText(msg) {
  return msg.text || "";
}

function getMsgCreatedAt(msg) {
  return msg.created_at ?? msg.createdAt;
}

function getMsgIsRead(msg) {
  return Boolean(msg.is_read ?? msg.isRead);
}

function markMsgAsRead(msg) {
  if ("is_read" in msg) {
    msg.is_read = true;
  } else {
    msg.isRead = true;
  }
}

function idsEqual(a, b) {
  if (a === null || a === undefined || b === null || b === undefined) return false;
  return String(a) === String(b);
}

function isUuid(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(value || ""));
}

function resolveUuidUserId(userId) {
  const user = getUser(userId);
  const candidate = user?.id ?? userId;
  if (!isUuid(candidate)) return null;
  return String(candidate);
}

async function ensureSupabaseUserRow(authUser) {
  if (!useSupabase || !authUser?.id) return null;

  const userId = String(authUser.id);
  const email = authUser.email || null;
  const metadataUsername = authUser.user_metadata?.username;
  const metadataDisplayName = authUser.user_metadata?.display_name;
  const emailPrefix = email ? email.split('@')[0] : 'user';
  const safeSuffix = userId.slice(0, 8);
  const baseUsername = (metadataUsername || emailPrefix || 'user').toLowerCase().replace(/[^a-z0-9_]/g, '_');
  const fallbackUsername = `${baseUsername}_${safeSuffix}`;
  const displayName = metadataDisplayName || metadataUsername || emailPrefix || `user_${safeSuffix}`;

  const { data: existing, error: existingError } = await window.supabase
    .from('users')
    .select('*')
    .eq('id', userId)
    .maybeSingle();

  if (existingError) {
    console.error('Ошибка чтения users по id:', existingError);
    return null;
  }

  if (existing) {
    const merged = {
      ...existing,
      email: existing.email || email,
      username: existing.username || fallbackUsername,
      display_name: existing.display_name || displayName
    };

    const { data: updated, error: updateError } = await window.supabase
      .from('users')
      .update({
        email: merged.email,
        username: merged.username,
        display_name: merged.display_name
      })
      .eq('id', userId)
      .select()
      .single();

    if (updateError) {
      console.error('Ошибка обновления users:', updateError);
      return existing;
    }
    return updated;
  }

  const insertPayload = {
    id: userId,
    email,
    username: fallbackUsername,
    display_name: displayName,
    created_at: new Date(),
    following: []
  };

  const { data: inserted, error: insertError } = await window.supabase
    .from('users')
    .insert([insertPayload])
    .select()
    .single();

  if (insertError) {
    console.error('Ошибка создания строки users для auth-пользователя:', insertError);
    return null;
  }

  return inserted;
}

async function loadConversations() {
  const currentUser = getCurrentUser();
  if (!currentUser) return [];

  if (!useSupabase) {
    const conversationsMap = new Map();
    const allMessages = state.messages || [];

    allMessages
      .filter((msg) => {
        const senderId = getMsgSenderId(msg);
        const receiverId = getMsgReceiverId(msg);
        return idsEqual(senderId, currentUser.id) || idsEqual(receiverId, currentUser.id);
      })
      .sort((a, b) => new Date(getMsgCreatedAt(b)) - new Date(getMsgCreatedAt(a)))
      .forEach((msg) => {
        const senderId = getMsgSenderId(msg);
        const receiverId = getMsgReceiverId(msg);
        const otherId = idsEqual(senderId, currentUser.id) ? receiverId : senderId;

        if (!conversationsMap.has(otherId)) {
          conversationsMap.set(otherId, {
            userId: otherId,
            lastMessage: getMsgText(msg),
            lastTime: getMsgCreatedAt(msg),
            unread:
              !getMsgIsRead(msg) && idsEqual(receiverId, currentUser.id) ? 1 : 0,
          });
        } else if (!getMsgIsRead(msg) && idsEqual(receiverId, currentUser.id)) {
          const conv = conversationsMap.get(otherId);
          conv.unread += 1;
        }
      });

    return Array.from(conversationsMap.values()).sort(
      (a, b) => new Date(b.lastTime) - new Date(a.lastTime)
    );
  }
  
  try {
    const { data: messages, error } = await window.supabase
      .from('messages')
      .select('*')
      .or(`sender_id.eq.${currentUser.id},receiver_id.eq.${currentUser.id}`)
      .order('created_at', { ascending: false });
    
    if (error) throw error;
    
    const conversationsMap = new Map();
    
    messages.forEach(msg => {
      const otherId = idsEqual(msg.sender_id, currentUser.id) ? msg.receiver_id : msg.sender_id;
      if (!conversationsMap.has(otherId)) {
        conversationsMap.set(otherId, {
          userId: otherId,
          lastMessage: msg.text,
          lastTime: msg.created_at,
          unread: !msg.is_read && idsEqual(msg.receiver_id, currentUser.id) ? 1 : 0
        });
      } else {
        const conv = conversationsMap.get(otherId);
        if (new Date(msg.created_at) > new Date(conv.lastTime)) {
          conv.lastMessage = msg.text;
          conv.lastTime = msg.created_at;
        }
        if (!msg.is_read && idsEqual(msg.receiver_id, currentUser.id)) {
          conv.unread++;
        }
      }
    });
    
    return Array.from(conversationsMap.values()).sort((a, b) => new Date(b.lastTime) - new Date(a.lastTime));
  } catch (error) {
    console.error('Ошибка загрузки диалогов:', error);
    return [];
  }
}

async function loadMessagesWithUser(otherUserId) {
  const currentUser = getCurrentUser();
  if (!currentUser) return [];

  if (!useSupabase) {
    const chatMessages = (state.messages || [])
      .filter((msg) => {
        const senderId = getMsgSenderId(msg);
        const receiverId = getMsgReceiverId(msg);
        return (
          (idsEqual(senderId, currentUser.id) && idsEqual(receiverId, otherUserId)) ||
          (idsEqual(senderId, otherUserId) && idsEqual(receiverId, currentUser.id))
        );
      })
      .sort((a, b) => new Date(getMsgCreatedAt(a)) - new Date(getMsgCreatedAt(b)));

    let changed = false;
    chatMessages.forEach((msg) => {
      if (
        idsEqual(getMsgReceiverId(msg), currentUser.id) &&
        !getMsgIsRead(msg)
      ) {
        markMsgAsRead(msg);
        changed = true;
      }
    });
    if (changed) {
      saveStateLocally();
    }

    return chatMessages;
  }
  
  try {
    const { data, error } = await window.supabase
      .from('messages')
      .select('*')
      .or(`and(sender_id.eq.${currentUser.id},receiver_id.eq.${otherUserId}),and(sender_id.eq.${otherUserId},receiver_id.eq.${currentUser.id})`)
      .order('created_at', { ascending: true });
    
    if (error) throw error;
    
    const unreadMessages = data.filter(m => idsEqual(m.receiver_id, currentUser.id) && !m.is_read);
    for (let msg of unreadMessages) {
      await window.supabase.from('messages').update({ is_read: true }).eq('id', msg.id);
    }
    
    return data || [];
  } catch (error) {
    console.error('Ошибка загрузки сообщений:', error);
    return [];
  }
}

async function sendMessage(receiverId, text) {
  const currentUser = getCurrentUser();
  if (!currentUser || !text.trim()) return false;

  if (!useSupabase) {
    const newMessage = {
      id: state.nextMessageId++,
      senderId: currentUser.id,
      receiverId,
      text: text.trim(),
      createdAt: Date.now(),
      isRead: false,
    };
    state.messages.push(newMessage);
    saveStateLocally();
    return { success: true, data: newMessage };
  }
  
  try {
    const { data: sessionData, error: sessionError } = await window.supabase.auth.getSession();
    const senderId = sessionData?.session?.user?.id || null;
    if (sessionError || !senderId) {
      console.error('Ошибка получения сессии:', sessionError);
      return { success: false, error: 'Сессия не найдена. Войдите в аккаунт снова.' };
    }

    const normalizedReceiverId = resolveUuidUserId(receiverId);
    if (!normalizedReceiverId) {
      console.error('Некорректный получатель для сообщения:', receiverId);
      return { success: false, error: 'Получатель не найден в Supabase. Обновите страницу и выберите пользователя снова.' };
    }

    if (!isUuid(senderId) || !isUuid(normalizedReceiverId)) {
      console.error('Некорректный UUID для сообщения:', { senderId, receiverId: normalizedReceiverId });
      return { success: false, error: 'Ошибка формата ID. Перезайдите в аккаунт.' };
    }

    const ensuredSender = await ensureSupabaseUserRow(sessionData.session.user);
    if (!ensuredSender) {
      return { success: false, error: 'Не удалось синхронизировать профиль отправителя в users.' };
    }

    const senderExistsInState = state.users.some(u => idsEqual(u.id, ensuredSender.id));
    if (!senderExistsInState) {
      state.users.push(ensuredSender);
    }

    const { data, error } = await window.supabase
      .from('messages')
      .insert([{
        sender_id: senderId,
        receiver_id: normalizedReceiverId,
        text: text.trim(),
        created_at: new Date(),
        is_read: false
      }])
      .select()
      .single();
    
    if (error) {
      console.error('Supabase ошибка вставки сообщения:', error);
      return { success: false, error: error.message || 'Ошибка вставки сообщения в базу.' };
    }
    console.log('Сообщение отправлено:', data);
    return { success: true, data };
  } catch (error) {
    console.error('Ошибка отправки сообщения:', error);
    return { success: false, error: error.message || 'Неизвестная ошибка отправки' };
  }
}

async function renderConversationsList() {
  const container = document.getElementById('conversations-list');
  if (!container) return;
  
  const currentUser = getCurrentUser();
  if (!currentUser) {
    container.innerHTML = '<div class="empty-state"><div class="empty-icon">🔒</div><p class="empty-title">Войдите в аккаунт</p></div>';
    return;
  }
  
  const conversations = await loadConversations();
  
  if (conversations.length === 0) {
    container.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">💬</div>
        <p class="empty-title">Нет сообщений</p>
        <p class="empty-text">Начните диалог с пользователем</p>
      </div>
    `;
    return;
  }
  
  container.innerHTML = conversations.map(conv => {
    const otherUser = getUser(conv.userId);
    if (!otherUser) return '';
    
    const avatarUrl = otherUser.avatar_url || otherUser.avatarUrl || "";
    const displayName = otherUser.display_name || otherUser.displayName || "Пользователь";
    const lastMessage = conv.lastMessage.length > 50 ? conv.lastMessage.slice(0, 50) + '...' : conv.lastMessage;
    const time = new Date(conv.lastTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    
    return `
      <div class="conversation-item" data-user-id="${conv.userId}">
        <div class="conversation-avatar">
          ${avatarUrl ? `<img src="${avatarUrl}" />` : displayName[0]?.toUpperCase() || "U"}
        </div>
        <div class="conversation-info">
          <div class="conversation-name">${escapeHtml(displayName)}</div>
          <div class="conversation-last-message">${escapeHtml(lastMessage)}</div>
        </div>
        <div class="conversation-time">${time}</div>
        ${conv.unread > 0 ? `<div class="conversation-unread">${conv.unread}</div>` : ''}
      </div>
    `;
  }).join('');
  
  document.querySelectorAll('.conversation-item').forEach(item => {
    item.addEventListener('click', () => {
      const userId = item.dataset.userId;
      openChatWithUser(userId);
    });
  });
}

let currentChatUserId = null;
let messagesSubscription = null;

async function openChatWithUser(userId) {
  console.log('openChatWithUser вызван, userId:', userId);
  
  if (userId === null || userId === undefined || userId === '') {
    console.error('Некорректный userId:', userId);
    return;
  }
  
  currentChatUserId = userId;
  const user = getUser(userId);
  if (!user) {
    console.error('Пользователь не найден, userId:', userId);
    alert('Пользователь не найден');
    return;
  }
  
  // Обновляем заголовок чата
  const chatAvatar = document.getElementById('chat-avatar');
  const chatName = document.getElementById('chat-name');
  const chatUsername = document.getElementById('chat-username');
  const chatInputArea = document.getElementById('chat-input-area');
  const chatMessages = document.getElementById('chat-messages');
  
  const avatarUrl = user.avatar_url || user.avatarUrl || "";
  const displayName = user.display_name || user.displayName || "Пользователь";
  const username = user.username;
  
  if (chatAvatar) {
    chatAvatar.innerHTML = avatarUrl ? `<img src="${avatarUrl}" />` : displayName[0]?.toUpperCase() || "U";
  }
  if (chatName) chatName.textContent = displayName;
  if (chatUsername) chatUsername.textContent = `@${username}`;
  if (chatInputArea) chatInputArea.style.display = 'flex';
  if (chatMessages) chatMessages.innerHTML = '<div class="empty-chat"><div class="empty-icon">💬</div><p>Загрузка сообщений...</p></div>';
  
  await loadAndRenderMessages(userId);
  
  // Подписка на новые сообщения
  if (messagesSubscription && useSupabase) {
    await window.supabase.removeChannel(messagesSubscription);
  }
  
  if (!useSupabase) return;

  messagesSubscription = window.supabase
    .channel('messages-channel')
    .on('postgres_changes', {
      event: 'INSERT',
      schema: 'public',
      table: 'messages'
    }, (payload) => {
      const newMsg = payload.new;
      // Проверяем, относится ли сообщение к текущему чату
      const current = getCurrentUser();
      if (!current) return;
      if ((idsEqual(newMsg.sender_id, currentChatUserId) && idsEqual(newMsg.receiver_id, current.id)) ||
          (idsEqual(newMsg.sender_id, current.id) && idsEqual(newMsg.receiver_id, currentChatUserId))) {
        loadAndRenderMessages(currentChatUserId);
        renderConversationsList();
      }
    })
    .subscribe();
}

async function loadAndRenderMessages(userId) {
  const messages = await loadMessagesWithUser(userId);
  const container = document.getElementById('chat-messages');
  const currentUser = getCurrentUser();
  
  if (!container) return;
  
  if (messages.length === 0) {
    container.innerHTML = `
      <div class="empty-chat">
        <div class="empty-icon">💬</div>
        <p>Напишите первое сообщение</p>
      </div>
    `;
    return;
  }
  
  container.innerHTML = messages.map(msg => {
    const isOutgoing = idsEqual(getMsgSenderId(msg), currentUser.id);
    const time = new Date(getMsgCreatedAt(msg)).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    
    return `
      <div class="message ${isOutgoing ? 'outgoing' : 'incoming'}">
        <div class="message-bubble">${escapeHtml(getMsgText(msg))}</div>
        <div class="message-time">${time}</div>
      </div>
    `;
  }).join('');
  
  container.scrollTop = container.scrollHeight;
}

async function sendMessageFromChat() {
  const input = document.getElementById('message-input');
  const text = input?.value.trim();
  
  if (!text) {
    console.log('Нет текста сообщения');
    return;
  }
  
  if (currentChatUserId === null || currentChatUserId === undefined || currentChatUserId === '') {
    console.log('Нет активного чата');
    alert('Сначала выберите чат');
    return;
  }
  
  console.log('Отправка сообщения пользователю:', currentChatUserId, 'текст:', text);
  
  const result = await sendMessage(currentChatUserId, text);
  if (result && result.success) {
    input.value = '';
    await loadAndRenderMessages(currentChatUserId);
    renderConversationsList();
  } else {
    alert(result?.error || 'Ошибка отправки сообщения');
  }
}

// ============ ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ ============
function getUser(id) {
  return state.users.find(u => idsEqual(u.id, id)) || null;
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
  if (theme === 'dark') { document.documentElement.setAttribute('data-theme', 'dark'); localStorage.setItem('theme', 'dark'); }
  else { document.documentElement.removeAttribute('data-theme'); localStorage.setItem('theme', 'light'); }
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

// ============ ПОИСК ПОЛЬЗОВАТЕЛЕЙ ============
function searchUsers(query) {
  if (!query || query.trim().length < 2) return [];
  
  const lowerQuery = query.toLowerCase().trim();
  return state.users.filter(user => {
    const displayName = (user.display_name || user.displayName || '').toLowerCase();
    const username = (user.username || '').toLowerCase();
    return displayName.includes(lowerQuery) || username.includes(lowerQuery);
  });
}

function renderSearchResults(users) {
  const searchResults = document.getElementById('search-results');
  if (!searchResults) return;
  
  if (!users || users.length === 0) {
    searchResults.innerHTML = `<div class="search-placeholder"><div class="empty-icon">😕</div><p class="empty-title">Ничего не найдено</p><p class="empty-text">Попробуйте другой юзернейм или имя</p></div>`;
    return;
  }
  
  const currentUser = getCurrentUser();
  
  searchResults.innerHTML = users.map(user => {
    const avatarUrl = user.avatar_url || user.avatarUrl || "";
    const displayName = user.display_name || user.displayName || "Пользователь";
    const username = user.username || "unknown";
    const isFollowing = currentUser ? (currentUser.following || []).includes(user.id) : false;
    const isOwn = currentUser && currentUser.id === user.id;
    
    return `
      <div class="user-card" data-user-id="${user.id}">
        <div class="user-card-avatar">
          ${avatarUrl ? `<img src="${avatarUrl}" />` : displayName[0]?.toUpperCase() || "U"}
        </div>
        <div class="user-card-info">
          <div class="user-card-name-block">
            <div class="user-card-name">${escapeHtml(displayName)}</div>
            <div class="user-card-username">@${escapeHtml(username)}</div>
          </div>
          ${!isOwn && currentUser ? `<button class="user-card-chat-btn" data-user-id="${user.id}" title="Написать сообщение">💬</button>` : ''}
        </div>
        ${!isOwn && currentUser ? `<button class="user-card-follow-btn ${isFollowing ? 'following' : ''}" data-user-id="${user.id}">${isFollowing ? 'Отписаться' : 'Подписаться'}</button>` : ''}
      </div>
    `;
  }).join('');
  
  setTimeout(() => {
    initSearchHandlers();
    initChatButtons();
  }, 50);
}

function initChatButtons() {
  document.querySelectorAll('.user-card-chat-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const userId = btn.dataset.userId;
      console.log('Нажата кнопка чата, userId:', userId);
      setActivePage('messages');
      setTimeout(() => openChatWithUser(userId), 100);
    });
  });
}

function renderSearchPlaceholder() {
  const searchResults = document.getElementById('search-results');
  if (!searchResults) return;
  searchResults.innerHTML = `<div class="search-placeholder"><div class="empty-icon">🔍</div><p class="empty-title">Поиск пользователей</p><p class="empty-text">Введите юзернейм или имя для поиска (минимум 2 символа)</p></div>`;
}

function escapeHtml(str) {
  if (!str) return '';
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// ============ ОБРАБОТЧИКИ ДЛЯ КАРТОЧЕК ПОИСКА ============
function initSearchHandlers() {
  const cards = document.querySelectorAll('.user-card');
  
  cards.forEach(card => {
    const newCard = card.cloneNode(true);
    card.parentNode.replaceChild(newCard, card);
    
    newCard.addEventListener('click', function(e) {
      if (e.target.classList.contains('user-card-follow-btn') || e.target.classList.contains('user-card-chat-btn')) return;
      const userId = this.getAttribute('data-user-id');
      if (userId) {
        window.viewedProfileId = userId;
        setActivePage('profile');
        renderProfile();
      }
    });
    
    const followBtn = newCard.querySelector('.user-card-follow-btn');
    if (followBtn) {
      const newBtn = followBtn.cloneNode(true);
      followBtn.parentNode.replaceChild(newBtn, followBtn);
      
      newBtn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const targetUserId = newBtn.dataset.userId;
        const currentUser = getCurrentUser();
        
        if (!currentUser) { alert('Войдите в аккаунт'); return; }
        if (idsEqual(currentUser.id, targetUserId)) return;
        
        const isFollowing = (currentUser.following || []).some(id => idsEqual(id, targetUserId));
        let newFollowing;
        
        if (isFollowing) {
          newFollowing = (currentUser.following || []).filter(id => !idsEqual(id, targetUserId));
          newBtn.textContent = 'Подписаться';
          newBtn.classList.remove('following');
        } else {
          newFollowing = [...(currentUser.following || []), targetUserId];
          newBtn.textContent = 'Отписаться';
          newBtn.classList.add('following');
        }
        
        currentUser.following = newFollowing;
        if (useSupabase) await window.supabase.from('users').update({ following: newFollowing }).eq('id', currentUser.id);
        saveStateLocally();
        
        const searchInput = document.getElementById('search-input');
        if (searchInput && searchInput.value) renderSearchResults(searchUsers(searchInput.value));
      });
    }
  });
}

function renderFeed() {
  const feedListEl = document.getElementById("feed-list");
  if (!feedListEl) return;
  
  const current = getCurrentUser();
  let posts = [...state.posts];
  posts.sort((a, b) => (b.createdAt || new Date(b.created_at).getTime()) - (a.createdAt || new Date(a.created_at).getTime()));
  
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
          <div class="post-author js-profile-link" data-user-id="${author.id}" style="cursor: pointer; font-weight: bold;">${escapeHtml(displayName)}</div>
          <div class="post-meta">${timeAgo(postTime)} • @${escapeHtml(username)}</div>
        </div>
        ${current && current.id === author.id ? `<button class="post-delete-btn js-delete-post" title="Удалить пост">🗑️</button>` : ''}
      </header>
      <div class="post-content"><p class="post-text">${escapeHtml(post.text || "")}</p></div>
      <footer class="post-footer">
        <button class="js-like-btn">${isLiked ? "❤" : "🤍"} ${(post.likes || []).length}</button>
        <button class="js-comment-toggle">💬 ${(post.comments || []).length}</button>
      </footer>
      <div class="comments" style="display:none">
        <div class="comments-list">${(post.comments || []).map(c => {
          const cu = getUser(c.authorId || c.author_id);
          const cuName = cu ? (cu.display_name || cu.displayName || "Пользователь") : "Пользователь";
          const cuId = c.authorId || c.author_id;
          return `<div class="comment-item"><span class="comment-author js-profile-link" data-user-id="${cuId}" style="cursor: pointer; font-weight: bold;">${escapeHtml(cuName)}</span><span class="comment-text">${escapeHtml(c.text || "")}</span></div>`;
        }).join('')}</div>
        <div class="comment-input-row"><input type="text" placeholder="Написать комментарий..." /><button class="js-comment-send">Отправить</button></div>
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
    if (!current || isOwn) profileFollowBtn.style.display = 'none';
    else {
      profileFollowBtn.style.display = 'block';
      profileFollowBtn.textContent = (current.following || []).includes(user.id) ? 'Отписаться' : 'Подписаться';
    }
  }
  
  if (profileEditBtn) profileEditBtn.style.display = isOwn ? 'block' : 'none';
  const profileComposer = document.getElementById('profile-composer');
  if (profileComposer) profileComposer.style.display = isOwn ? 'flex' : 'none';
  
  const existingMessageBtn = document.getElementById('profile-message-btn');
  if (existingMessageBtn) existingMessageBtn.remove();
  
  if (!isOwn && current) {
    const messageBtn = document.createElement('button');
    messageBtn.id = 'profile-message-btn';
    messageBtn.className = 'btn-secondary';
    messageBtn.textContent = '💬 Написать';
    messageBtn.style.marginLeft = '8px';
    messageBtn.addEventListener('click', () => {
      setActivePage('messages');
      setTimeout(() => openChatWithUser(user.id), 100);
    });
    const actionsContainer = document.querySelector('.profile-actions');
    if (actionsContainer && !document.getElementById('profile-message-btn')) actionsContainer.appendChild(messageBtn);
  }
  
  const followButton = document.getElementById('profile-follow-btn');
  if (followButton && !isOwn && current) {
    const newFollowBtn = followButton.cloneNode(true);
    followButton.parentNode.replaceChild(newFollowBtn, followButton);
    newFollowBtn.addEventListener('click', async () => {
      const currentUser = getCurrentUser();
      const targetUser = user;
      if (!currentUser || currentUser.id === targetUser.id) return;
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
      if (useSupabase) await window.supabase.from('users').update({ following: newFollowing }).eq('id', currentUser.id);
      saveStateLocally();
      renderProfile();
    });
  }
  
  const profilePostsEl = document.getElementById('profile-posts');
  if (!profilePostsEl) return;
  
  const activeTab = document.querySelector('.profile-tab-active')?.dataset.profileTab || 'posts';
  let posts = [];
  if (activeTab === 'posts') posts = state.posts.filter(p => (p.authorId || p.author_id) === user.id).sort((a,b) => (b.createdAt || new Date(b.created_at).getTime()) - (a.createdAt || new Date(a.created_at).getTime()));
  else posts = state.posts.filter(p => (p.likes || []).includes(user.id)).sort((a,b) => (b.createdAt || new Date(b.created_at).getTime()) - (a.createdAt || new Date(a.created_at).getTime()));
  
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
          <div class="post-author js-profile-link" data-user-id="${author.id}" style="cursor: pointer; font-weight: bold;">${escapeHtml(displayName)}</div>
          <div class="post-meta">${timeAgo(postTime)} • @${escapeHtml(username)}</div>
        </div>
        ${current && current.id === author.id ? `<button class="post-delete-btn js-delete-post">🗑️</button>` : ''}
      </header>
      <div class="post-content"><p class="post-text">${escapeHtml(post.text || "")}</p></div>
      <footer class="post-footer">
        <button class="js-like-btn">${isLiked ? "❤" : "🤍"} ${(post.likes || []).length}</button>
        <button class="js-comment-toggle">💬 ${(post.comments || []).length}</button>
      </footer>
      <div class="comments" style="display:none">
        <div class="comments-list">${(post.comments || []).map(c => {
          const cu = getUser(c.authorId || c.author_id);
          const cuName = cu ? (cu.display_name || cu.displayName || "Пользователь") : "Пользователь";
          const cuId = c.authorId || c.author_id;
          return `<div class="comment-item"><span class="comment-author js-profile-link" data-user-id="${cuId}" style="cursor: pointer; font-weight: bold;">${escapeHtml(cuName)}</span><span class="comment-text">${escapeHtml(c.text || "")}</span></div>`;
        }).join('')}</div>
        <div class="comment-input-row"><input type="text" placeholder="Написать комментарий..." /><button class="js-comment-send">Отправить</button></div>
      </div>
    `;
    profilePostsEl.appendChild(postEl);
  });
}

function updateAllUI() { renderFeed(); renderProfile(); renderTopClans(); }

// ============ ГЛОБАЛЬНЫЕ ПЕРЕМЕННЫЕ ============
let viewedProfileId = null;
let currentFeedFilter = "all";
let pendingAvatarRemove = false;

// ============ ОСНОВНОЙ КОД ============
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
  
  const searchInput = document.getElementById('search-input');
  const searchResults = document.getElementById('search-results');
  setTheme(getCurrentTheme());
  
  window.setActivePage = function(pageName) {
    navItems.forEach(btn => { if (btn.getAttribute("data-page") === pageName) btn.classList.add("active"); else btn.classList.remove("active"); });
    pages.forEach(page => { if (page.id === `page-${pageName}`) page.classList.add("page-active"); else page.classList.remove("page-active"); });
    if (pageName === 'messages') setTimeout(() => renderConversationsList(), 100);
  };
  
  window.renderProfile = renderProfile;
  window.viewedProfileId = viewedProfileId;
  window.openChatWithUser = openChatWithUser;
  
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
  
    if (target.classList.contains("js-like-btn")) { toggleLike(postId); return; }
    if (target.classList.contains("js-delete-post") || target.closest(".js-delete-post")) { deletePost(postId); return; }
    if (target.classList.contains("js-comment-toggle") || target.closest(".js-comment-toggle")) {
      const commentsEl = postEl.querySelector(".comments");
      if (commentsEl) commentsEl.style.display = commentsEl.style.display === "none" ? "block" : "none";
      return;
    }
    if (target.classList.contains("js-comment-send") || target.closest(".js-comment-send")) {
      const row = target.closest(".comment-input-row");
      const input = row?.querySelector("input");
      const text = input?.value.trim();
      if (text) addComment(postId, text);
      return;
    }
    const profileLink = target.closest(".js-profile-link");
    if (profileLink) {
      const userId = profileLink.getAttribute("data-user-id");
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
  
  document.querySelector(".sidebar-logout")?.addEventListener("click", async () => {
    if (messagesSubscription && useSupabase) {
      await window.supabase.removeChannel(messagesSubscription);
      messagesSubscription = null;
    }
    await logoutUserSupabase();
    if (authOverlay) { authOverlay.classList.remove("hidden"); showAuthTab("login"); }
    updateAllUI();
  });
  
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
  
  const themeToggleCheckbox = document.getElementById('theme-switch-toggle');
  if (themeToggleCheckbox) {
    themeToggleCheckbox.addEventListener('change', (e) => {
      if (e.target.checked) { document.documentElement.setAttribute('data-theme', 'dark'); localStorage.setItem('theme', 'dark'); }
      else { document.documentElement.removeAttribute('data-theme'); localStorage.setItem('theme', 'light'); }
    });
  }
  
  const sendBtn = document.getElementById('send-message-btn');
  const messageInput = document.getElementById('message-input');
  if (sendBtn) {
    sendBtn.addEventListener('click', sendMessageFromChat);
    console.log('Обработчик кнопки отправки добавлен');
  }
  if (messageInput) {
    messageInput.addEventListener('keypress', (e) => { 
      if (e.key === 'Enter' && !e.shiftKey) { 
        e.preventDefault(); 
        sendMessageFromChat(); 
      } 
    });
    console.log('Обработчик Enter добавлен');
  }
  
  if (searchInput) {
    searchInput.addEventListener('input', (e) => {
      const query = e.target.value;
      if (query.length >= 2) renderSearchResults(searchUsers(query));
      else renderSearchPlaceholder();
    });
  }
  
  // ============ ПОИСК В СООБЩЕНИЯХ ============
  const messagesSearchInput = document.getElementById('messages-search-input');
  const searchUsersResults = document.getElementById('search-users-results');
  const conversationsListEl = document.getElementById('conversations-list');
  
  function searchUsersForMessages(query) {
    if (!query || query.trim().length < 2) {
      if (searchUsersResults) searchUsersResults.style.display = 'none';
      if (conversationsListEl) conversationsListEl.style.display = 'block';
      return [];
    }
    
    const lowerQuery = query.toLowerCase().trim();
    const currentUser = getCurrentUser();
    
    const results = state.users.filter(user => {
      if (useSupabase && !isUuid(user.id)) return false;
      if (idsEqual(user.id, currentUser?.id)) return false;
      const displayName = (user.display_name || user.displayName || '').toLowerCase();
      const username = (user.username || '').toLowerCase();
      return displayName.includes(lowerQuery) || username.includes(lowerQuery);
    });
    
    console.log('Найдено пользователей для чата:', results.length);
    return results;
  }
  
  function renderSearchUsersResults(users) {
    if (!searchUsersResults) return;
    
    if (users.length === 0) {
      searchUsersResults.innerHTML = `
        <div class="empty-state">
          <div class="empty-icon">😕</div>
          <p class="empty-title">Ничего не найдено</p>
          <p class="empty-text">Попробуйте другой юзернейм</p>
        </div>
      `;
      searchUsersResults.style.display = 'block';
      if (conversationsListEl) conversationsListEl.style.display = 'none';
      return;
    }
    
    searchUsersResults.innerHTML = users.map(user => {
      const avatarUrl = user.avatar_url || user.avatarUrl || "";
      const displayName = user.display_name || user.displayName || "Пользователь";
      const username = user.username;
      const userId = user.id;
      
      return `
        <div class="search-user-item" data-user-id="${userId}">
          <div class="search-user-avatar">
            ${avatarUrl ? `<img src="${avatarUrl}" />` : displayName[0]?.toUpperCase() || "U"}
          </div>
          <div class="search-user-info">
            <div class="search-user-name">${escapeHtml(displayName)}</div>
            <div class="search-user-username">@${escapeHtml(username)}</div>
          </div>
          <button class="search-user-start-btn" data-user-id="${userId}">Написать</button>
        </div>
      `;
    }).join('');
    
    searchUsersResults.style.display = 'block';
    if (conversationsListEl) conversationsListEl.style.display = 'none';
    
    document.querySelectorAll('.search-user-item').forEach(item => {
      item.addEventListener('click', (e) => {
        if (!e.target.classList.contains('search-user-start-btn')) {
          const userId = item.getAttribute('data-user-id');
          if (userId) startNewChat(userId);
        }
      });
    });
    
    document.querySelectorAll('.search-user-start-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const userId = btn.getAttribute('data-user-id');
        if (userId) startNewChat(userId);
      });
    });
  }
  
  function startNewChat(userId) {
    console.log('startNewChat, userId:', userId);
    
    const user = getUser(userId);
    if (!user) {
      console.error('Пользователь не найден');
      alert('Пользователь не найден');
      return;
    }
    
    if (messagesSearchInput) messagesSearchInput.value = '';
    if (searchUsersResults) searchUsersResults.style.display = 'none';
    if (conversationsListEl) conversationsListEl.style.display = 'block';
    
    openChatWithUser(userId);
    setTimeout(() => renderConversationsList(), 500);
  }
  
  if (messagesSearchInput) {
    messagesSearchInput.addEventListener('input', (e) => {
      const query = e.target.value;
      if (query.length >= 2) {
        const results = searchUsersForMessages(query);
        renderSearchUsersResults(results);
      } else {
        if (searchUsersResults) searchUsersResults.style.display = 'none';
        if (conversationsListEl) conversationsListEl.style.display = 'block';
      }
    });
  }
  
  const chatUserInfo = document.getElementById('chat-user-info');
  if (chatUserInfo) {
    chatUserInfo.addEventListener('click', () => {
      if (currentChatUserId !== null && currentChatUserId !== undefined && currentChatUserId !== '') {
        viewedProfileId = currentChatUserId;
        setActivePage('profile');
        renderProfile();
      }
    });
  }
  
  const loginUser = getCurrentUser();
  if (!loginUser) { authOverlay.classList.remove("hidden"); showAuthTab("login"); }
  else { authOverlay.classList.add("hidden"); viewedProfileId = loginUser.id; updateAllUI(); }
});