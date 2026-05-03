const STORAGE_KEY = "zachetka-state-v1";

// ============ СОСТОЯНИЕ ============
let state = {
  users: [],
  posts: [],
  messages: [],
  notifications: [],
  currentUserId: null,
  nextUserId: 3,
  nextPostId: 3,
  nextCommentId: 2,
  nextMessageId: 1,
  nextNotificationId: 1
};

/** Открытые блоки комментариев (persist при перерисовке постов). */
const openCommentPostIds = new Set();

/** Свежевыложенный пост — усиленная анимация появления. */
let pendingFreshPostId = null;

function likesIncludes(likes, userId) {
  return (likes || []).some((id) => idsEqual(id, userId));
}

function findPostById(postId) {
  return state.posts.find((p) => String(p.id) === String(postId));
}

function feedSkeletonMarkup(count = 5) {
  const one = `
    <article class="post post-skeleton" aria-hidden="true">
      <div class="post-skeleton__header">
        <div class="post-skeleton__avatar shimmer"></div>
        <div class="post-skeleton__meta">
          <div class="post-skeleton__line shimmer" style="width:42%"></div>
          <div class="post-skeleton__line post-skeleton__line--sm shimmer" style="width:58%"></div>
        </div>
      </div>
      <div class="post-skeleton__body">
        <div class="post-skeleton__line shimmer"></div>
        <div class="post-skeleton__line shimmer" style="width:92%"></div>
        <div class="post-skeleton__line shimmer" style="width:66%"></div>
      </div>
      <div class="post-skeleton__footer">
        <div class="post-skeleton__pill shimmer"></div>
        <div class="post-skeleton__pill shimmer"></div>
      </div>
    </article>`;
  return Array.from({ length: count }, () => one).join("");
}

function syncLikeButtonsForPost(postId) {
  const post = findPostById(postId);
  const cur = getCurrentUser();
  if (!post) return;
  const count = (post.likes || []).length;
  const liked = cur ? likesIncludes(post.likes, cur.id) : false;
  document.querySelectorAll(".post[data-post-id]").forEach((postEl) => {
    if (postEl.dataset.postId !== String(post.id)) return;
    const btn = postEl.querySelector(".js-like-btn");
    if (!btn) return;
    const heart = btn.querySelector(".like-heart");
    const countEl = btn.querySelector(".like-count");
    btn.classList.toggle("is-liked", liked);
    btn.setAttribute("aria-pressed", liked ? "true" : "false");
    if (heart) heart.textContent = liked ? "❤️" : "🤍";
    if (countEl) countEl.textContent = String(count);
  });
}

function triggerLikeHeartBurst(postIdStr) {
  document.querySelectorAll(".post[data-post-id]").forEach((postEl) => {
    if (postEl.dataset.postId !== String(postIdStr)) return;
    const btn = postEl.querySelector(".js-like-btn");
    const heart = btn?.querySelector(".like-heart");
    if (btn) {
      btn.classList.remove("like-btn--ring");
      void btn.offsetWidth;
      btn.classList.add("like-btn--ring");
      setTimeout(() => btn.classList.remove("like-btn--ring"), 600);
    }
    if (heart) {
      heart.classList.remove("like-heart--pop");
      void heart.offsetWidth;
      heart.classList.add("like-heart--pop");
      setTimeout(() => heart.classList.remove("like-heart--pop"), 560);
    }
  });
}

// ============ ПРОВЕРКА SUPABASE ============
let useSupabase = typeof window.supabase !== 'undefined' && window.supabase;
/** Публичный bucket для JPG-аватаров (URL в таблице users, не base64 в БД) */
const SUPABASE_AVATARS_BUCKET = "avatars";
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

    const list = posts || [];
    const postIds = list.map((p) => p.id);

    const commentsByPost = {};
    if (postIds.length) {
      const { data: commentsData, error: commentsError } = await window.supabase
        .from("comments")
        .select("*")
        .in("post_id", postIds);
      if (commentsError) throw commentsError;
      for (const c of commentsData || []) {
        const k = c.post_id;
        if (!commentsByPost[k]) commentsByPost[k] = [];
        commentsByPost[k].push(c);
      }
    }

    const pollIds = list
      .filter((p) => postHasPollMeta(p.poll))
      .map((p) => p.id);
    const votesByPost = {};
    if (pollIds.length) {
      const { data: voteRows } = await window.supabase
        .from("post_poll_votes")
        .select("post_id,user_id,option_id")
        .in("post_id", pollIds);
      for (const row of voteRows || []) {
        const k = row.post_id;
        if (!votesByPost[k]) votesByPost[k] = [];
        votesByPost[k].push({
          uid: String(row.user_id),
          oid: String(row.option_id)
        });
      }
    }

    for (const post of list) {
      post.comments = commentsByPost[post.id] || [];
      if (postHasPollMeta(post.poll)) {
        post._pollBallots = votesByPost[post.id] || [];
      }
    }

    state.posts = list;
    console.log('Загружено постов:', state.posts.length);
    
    return true;
  } catch (error) {
    console.error('Ошибка загрузки:', error);
    return false;
  }
}

function saveStateLocally() {
  const payload = {
    users: state.users,
    posts: state.posts,
    messages: state.messages,
    notifications: state.notifications,
    nextNotificationId: state.nextNotificationId,
    currentUserId: state.currentUserId,
    nextUserId: state.nextUserId,
    nextPostId: state.nextPostId,
    nextCommentId: state.nextCommentId,
    nextMessageId: state.nextMessageId
  };
  if (useSupabase) {
    delete payload.notifications;
    delete payload.nextNotificationId;
  }
  localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
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
      state.notifications = saved.notifications || [];
      state.nextNotificationId = saved.nextNotificationId || 1;
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

    let avatarForDb = null;
    const rawAv = typeof avatarUrl === 'string' ? avatarUrl.trim() : '';
    if (rawAv.startsWith('data:image')) {
      let sess = null;
      const { data: sessWrap } = await window.supabase.auth.getSession();
      sess = sessWrap?.session ?? null;
      if (!sess) {
        const { data: pwdIn, error: pwdErr } = await window.supabase.auth.signInWithPassword({ email, password });
        if (!pwdErr) sess = pwdIn.session;
      }
      if (sess) {
        const { publicUrl, error: upAvErr } = await uploadAvatarJpegForUser(authData.user.id, rawAv);
        if (upAvErr) throw new Error(`Аватар: ${upAvErr.message}`);
        avatarForDb = publicUrl;
      } else {
        console.warn('Загрузка аватара в Storage пропущена: нет сессии (проверьте подтверждение email).');
        avatarForDb = null;
      }
    } else if (rawAv.startsWith('http')) {
      avatarForDb = rawAv;
    }

    const { data: userData, error: profileUpdateError } = await window.supabase
      .from('users')
      .update({
        email,
        username,
        display_name: displayName,
        avatar_url: avatarForDb
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

function escapeHtml(str) {
  if (!str) return '';
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function mentionTokenRegex() {
  return /@([^\s@#!?.,:;()\[\]{}"'<>]+)/gu;
}

function findUserByUsernameToken(raw) {
  const n = String(raw || "")
    .trim()
    .toLowerCase()
    .replace(/^@+/, "");
  if (!n) return null;
  return state.users.find((u) => (u.username || "").toLowerCase() === n) || null;
}

/** HTML для постов/комментариев: безопасный текст + кликабельные @username */
function htmlFromPlainWithMentions(text) {
  if (!text) return "";
  const re = mentionTokenRegex();
  let out = "";
  let last = 0;
  let m;
  while ((m = re.exec(text)) !== null) {
    out += escapeHtml(text.slice(last, m.index));
    const full = m[0];
    const token = m[1];
    const user = findUserByUsernameToken(token);
    if (user) {
      out += `<a href="#" class="mention-link js-profile-link" data-user-id="${escapeHtml(String(user.id))}">@${escapeHtml(user.username)}</a>`;
    } else {
      out += escapeHtml(full);
    }
    last = m.index + full.length;
  }
  out += escapeHtml(text.slice(last));
  return out;
}

function extractMentionUserIdsFromText(text) {
  if (!text) return [];
  const re = mentionTokenRegex();
  const seen = new Set();
  const out = [];
  let m;
  while ((m = re.exec(text)) !== null) {
    const u = findUserByUsernameToken(m[1]);
    if (u && !seen.has(String(u.id))) {
      seen.add(String(u.id));
      out.push(String(u.id));
    }
  }
  return out;
}

function pushLocalNotification(recipientId, actorId, type) {
  if (!recipientId || !actorId || idsEqual(recipientId, actorId)) return;
  if (!state.notifications) state.notifications = [];
  state.notifications.unshift({
    id: String(state.nextNotificationId++),
    recipient_id: recipientId,
    actor_id: actorId,
    type: type || "follow",
    read: false,
    created_at: new Date().toISOString()
  });
  saveStateLocally();
}

async function notifyMention(recipientUserId, actorUserId) {
  if (!recipientUserId || !actorUserId || idsEqual(recipientUserId, actorUserId)) return;
  if (!useSupabase) {
    pushLocalNotification(recipientUserId, actorUserId, "mention");
    updateNotificationsNavBadge();
    renderNotificationsIfActivePage();
    return;
  }
  const { error } = await window.supabase.from("notifications").insert([
    { recipient_id: recipientUserId, actor_id: actorUserId, type: "mention", read: false }
  ]);
  if (error) console.warn("Уведомление об упоминании:", error.message);
}

async function notifyMentionsInText(actorUserId, text) {
  if (!text || !actorUserId) return;
  const ids = extractMentionUserIdsFromText(text);
  for (const uid of ids) {
    if (idsEqual(uid, actorUserId)) continue;
    await notifyMention(uid, actorUserId);
  }
}

function resetPollOptionsWrap(wrap) {
  if (!wrap) return;
  wrap.innerHTML = `<label class="composer-poll-opt"><input type="text" class="js-poll-opt-input" maxlength="140" placeholder="Вариант 1" /></label><label class="composer-poll-opt"><input type="text" class="js-poll-opt-input" maxlength="140" placeholder="Вариант 2" /></label>`;
}

function clearPollComposer(root) {
  if (!root) return;
  root.querySelectorAll(".js-poll-toggle-btn").forEach((b) => b.setAttribute("aria-expanded", "false"));
  const panel = root.querySelector(".composer-poll");
  if (!panel) return;
  panel.hidden = true;
  const q = panel.querySelector(".js-poll-question-input");
  if (q) q.value = "";
  const anon = panel.querySelector(".js-poll-anonymous-input");
  if (anon) anon.checked = false;
  resetPollOptionsWrap(panel.querySelector(".js-poll-options-wrap"));
}

function readPollDraftFromComposerRoot(root) {
  const panel = root?.querySelector(".composer-poll");
  if (!panel || panel.hidden) return null;
  const q = panel.querySelector(".js-poll-question-input")?.value?.trim() ?? "";
  const anon = !!panel.querySelector(".js-poll-anonymous-input")?.checked;
  const opts = [...panel.querySelectorAll(".js-poll-opt-input")]
    .map((el) => el.value.trim())
    .filter(Boolean);
  if (!q || opts.length < 2) return null;
  return { question: q, anonymous: anon, options: opts };
}

/** Метаданные опроса в posts.poll (без голосов — они в post_poll_votes при Supabase) */
function buildPollMetadata(draft) {
  return {
    question: draft.question.trim(),
    anonymous: !!draft.anonymous,
    options: draft.options.map((t, i) => ({ id: "o" + i, text: t }))
  };
}

function finalizeNewPoll(draft) {
  return { ...buildPollMetadata(draft), ballots: [] };
}

function postHasPollMeta(poll) {
  return !!(poll &&
    typeof poll === "object" &&
    poll.question &&
    Array.isArray(poll.options) &&
    poll.options.length >= 2);
}

/** Голоса: локально в poll.ballots; в Supabase в post._pollBallots после загрузки */
function getPollBallotsArray(post) {
  if (!post) return [];
  if (useSupabase) {
    if (Array.isArray(post._pollBallots)) return post._pollBallots;
    const legacy = post.poll?.ballots;
    return Array.isArray(legacy) ? legacy : [];
  }
  const b = post.poll?.ballots;
  return Array.isArray(b) ? b : [];
}

function normalizePoll(post) {
  const p = post?.poll;
  if (!p || typeof p !== "object") return null;
  if (!p.question || !Array.isArray(p.options) || p.options.length < 2) return null;
  return {
    question: String(p.question),
    anonymous: !!p.anonymous,
    options: p.options.map((o, i) => ({
      id: String(o.id != null ? o.id : "o" + i),
      text: String(o.text || "")
    })),
    ballots: getPollBallotsArray(post)
  };
}

function pollCounts(poll) {
  const counts = {};
  for (const o of poll.options) counts[o.id] = 0;
  for (const b of poll.ballots || []) {
    const oid = b.oid != null ? b.oid : b.option_id;
    if (oid != null && counts[String(oid)] != null) counts[String(oid)]++;
  }
  return counts;
}

function pollTotalVotes(counts) {
  return Object.values(counts).reduce((a, n) => a + n, 0);
}

function userPollChoice(poll, userId) {
  if (!userId) return null;
  const b = (poll.ballots || []).find((x) => idsEqual(x.uid, userId));
  if (!b) return null;
  return String(b.oid != null ? b.oid : b.option_id);
}

function formatPollVotersButtons(poll, optionId) {
  const ids = (poll.ballots || [])
    .filter((b) => String(b.oid != null ? b.oid : b.option_id) === String(optionId))
    .map((b) => String(b.uid));
  if (!ids.length) return "";
  const shown = ids.slice(0, 10);
  const parts = shown.map((uid) => {
    const u = getUser(uid);
    const dn = escapeHtml(u ? u.display_name || u.displayName || u.username || "?" : "?");
    return `<button type="button" class="post-poll-voter js-profile-link" data-user-id="${escapeHtml(uid)}">${dn}</button>`;
  });
  if (ids.length > 10) {
    parts.push(`<span class="post-poll-voter-more">+${ids.length - 10}</span>`);
  }
  return parts.join("");
}

function buildPostPollMarkup(post, current) {
  const poll = normalizePoll(post);
  if (!poll) return "";
  const counts = pollCounts(poll);
  const total = pollTotalVotes(counts);
  const myPick = current ? userPollChoice(poll, current.id) : null;
  const anon = poll.anonymous;
  const badges = anon
    ? `<span class="post-poll-badge post-poll-badge--anon">Анонимный</span>`
    : `<span class="post-poll-badge post-poll-badge--pub">Публичный</span>`;
  const bars = poll.options
    .map((o) => {
      const c = counts[o.id] || 0;
      const pct = total ? Math.round((c / total) * 1000) / 10 : 0;
      const active = myPick === o.id ? " post-poll-option--mine" : "";
      const votersLine =
        !anon && c > 0
          ? `<div class="post-poll-voters">${formatPollVotersButtons(poll, o.id)}</div>`
          : "";
      return `<div class="post-poll-option${active}">
        <button type="button" class="post-poll-vote js-poll-vote" data-poll-option-id="${escapeHtml(String(o.id))}"${!current ? " disabled" : ""}>
          <span class="post-poll-option-text">${escapeHtml(o.text)}</span>
          <span class="post-poll-count">${c} · ${pct}%</span>
        </button>
        <div class="post-poll-bar" style="--poll-p:${pct}%"></div>
        ${votersLine}
      </div>`;
    })
    .join("");
  const statLine = `<p class="post-poll-stats">Всего голосов: <strong>${total}</strong></p>`;
  return `<section class="post-poll-wrap" aria-label="Опрос">${badges}<h3 class="post-poll-q">${escapeHtml(poll.question)}</h3>${bars}${statLine}</section>`;
}

function refreshPostPollInDom(postId) {
  const post = findPostById(postId);
  const cur = getCurrentUser();
  document.querySelectorAll(`.post[data-post-id="${String(postId)}"]`).forEach((article) => {
    const host = article.querySelector(".post-poll-host");
    if (!host || !post) return;
    host.outerHTML = `<div class="post-poll-host">${buildPostPollMarkup(post, cur)}</div>`;
  });
}

async function voteOnPoll(postId, optionId) {
  const cur = getCurrentUser();
  if (!cur) {
    alert("Войдите в аккаунт, чтобы голосовать");
    return;
  }
  const post = findPostById(postId);
  const poll = normalizePoll(post);
  if (!poll || !post) return;
  const valid = poll.options.some((o) => String(o.id) === String(optionId));
  if (!valid) return;
  const nextRow = { uid: String(cur.id), oid: String(optionId) };
  if (!useSupabase) {
    const ballots = getPollBallotsArray(post).filter((b) => !idsEqual(b.uid, cur.id));
    ballots.push(nextRow);
    post.poll = {
      question: poll.question,
      anonymous: poll.anonymous,
      options: poll.options,
      ballots
    };
    saveStateLocally();
    refreshPostPollInDom(postId);
    return;
  }
  if (!Array.isArray(post._pollBallots)) post._pollBallots = getPollBallotsArray(post);
  post._pollBallots = post._pollBallots.filter((b) => !idsEqual(b.uid, cur.id));
  post._pollBallots.push(nextRow);
  refreshPostPollInDom(postId);
  try {
    const { error } = await window.supabase.from("post_poll_votes").upsert(
      {
        post_id: post.id,
        user_id: cur.id,
        option_id: String(optionId)
      },
      { onConflict: "post_id,user_id" }
    );
    if (error) throw error;
  } catch (e) {
    console.error("Ошибка голосования:", e);
    await loadFromSupabase();
    updateAllUI();
  }
}

function wireComposerPollInteractions(root) {
  if (!root) return;
  const panel = root.querySelector(".composer-poll");
  const toggleBtn = root.querySelector(".js-poll-toggle-btn");
  const wrap = panel?.querySelector(".js-poll-options-wrap");
  const addBtn = panel?.querySelector(".js-poll-add-option");
  toggleBtn?.addEventListener("click", () => {
    if (!panel) return;
    const open = panel.hidden;
    panel.hidden = !open;
    toggleBtn.setAttribute("aria-expanded", open ? "true" : "false");
  });
  addBtn?.addEventListener("click", () => {
    if (!wrap) return;
    const n = wrap.querySelectorAll(".js-poll-opt-input").length + 1;
    if (n > 12) return;
    const lab = document.createElement("label");
    lab.className = "composer-poll-opt";
    lab.innerHTML = `<input type="text" class="js-poll-opt-input" maxlength="140" placeholder="Вариант ${n}" />`;
    wrap.appendChild(lab);
    lab.querySelector("input")?.focus();
  });
}

async function createPostSupabase(text, pollDraft = null) {
  const currentUser = getCurrentUser();
  if (!currentUser) return false;

  const trimmed = (text || "").trim();
  const hasPoll =
    pollDraft &&
    pollDraft.question &&
    Array.isArray(pollDraft.options) &&
    pollDraft.options.length >= 2;
  if (!trimmed && !hasPoll) return false;

  const pollLocal = hasPoll ? finalizeNewPoll(pollDraft) : null;
  const pollDb = hasPoll ? buildPollMetadata(pollDraft) : null;

  if (!useSupabase) {
    const newPost = {
      id: state.nextPostId++,
      authorId: currentUser.id,
      text: trimmed,
      poll: pollLocal,
      createdAt: Date.now(),
      likes: [],
      comments: []
    };
    state.posts.unshift(newPost);
    saveStateLocally();
    if (trimmed) await notifyMentionsInText(currentUser.id, trimmed);
    return newPost.id;
  }

  try {
    const { data, error } = await window.supabase
      .from("posts")
      .insert([
        {
          author_id: currentUser.id,
          text: trimmed,
          created_at: new Date(),
          likes: [],
          poll: pollDb
        }
      ])
      .select()
      .single();

    if (error) throw error;

    data.comments = [];
    if (pollDb && postHasPollMeta(data.poll)) data._pollBallots = [];
    state.posts.unshift(data);
    if (trimmed) await notifyMentionsInText(currentUser.id, trimmed);
    return data.id;
  } catch (error) {
    console.error("Ошибка создания поста:", error);
    return false;
  }
}

async function deletePostSupabase(postId) {
  const currentUser = getCurrentUser();
  if (!currentUser) return false;
  const post = findPostById(postId);
  const isAuthor = useSupabase ? idsEqual(post?.author_id, currentUser.id) : idsEqual(post?.authorId, currentUser.id);
  if (!post || !isAuthor) { alert("Нельзя удалить чужой пост!"); return false; }
  if (!confirm("Удалить пост?")) return false;
  openCommentPostIds.delete(String(post.id));
  if (!useSupabase) {
    state.posts = state.posts.filter((p) => String(p.id) !== String(post.id));
    saveStateLocally();
    updateAllUI();
    return true;
  }
  try {
    await window.supabase.from('posts').delete().eq('id', post.id);
    state.posts = state.posts.filter((p) => String(p.id) !== String(post.id));
    updateAllUI();
    return true;
  } catch (error) {
    console.error('Ошибка удаления:', error);
    return false;
  }
}

function openPostEditModal(postIdStr) {
  const backdrop = document.getElementById("post-edit-modal-backdrop");
  const ta = document.getElementById("post-edit-textarea");
  const err = document.getElementById("post-edit-error");
  const hint = document.getElementById("post-edit-hint");
  const post = findPostById(postIdStr);
  const cur = getCurrentUser();
  if (!backdrop || !ta || !post || !cur) return;
  const authorId = post.author_id ?? post.authorId;
  if (!idsEqual(cur.id, authorId)) return;
  if (err) err.textContent = "";
  ta.value = post.text ?? "";
  if (hint) {
    hint.textContent = postHasPollMeta(post.poll)
      ? "Текст можно оставить пустым — у поста есть опрос. Опрос здесь не редактируется."
      : "";
  }
  backdrop.dataset.editingPostId = String(postIdStr);
  backdrop.classList.add("visible");
  backdrop.setAttribute("aria-hidden", "false");
  ta.focus();
}

function closePostEditModal() {
  const backdrop = document.getElementById("post-edit-modal-backdrop");
  if (!backdrop) return;
  backdrop.classList.remove("visible");
  backdrop.setAttribute("aria-hidden", "true");
  delete backdrop.dataset.editingPostId;
  const ta = document.getElementById("post-edit-textarea");
  if (ta) ta.value = "";
  const err = document.getElementById("post-edit-error");
  if (err) err.textContent = "";
}

/** Только текст поста (опрос и комментарии не трогаем). */
async function updatePostTextSupabase(postId, newTextRaw) {
  const currentUser = getCurrentUser();
  if (!currentUser) return false;
  const post = findPostById(postId);
  if (!post) return false;
  const isAuthor = useSupabase
    ? idsEqual(post.author_id, currentUser.id)
    : idsEqual(post.authorId, currentUser.id);
  if (!isAuthor) {
    alert("Можно редактировать только свои посты.");
    return false;
  }
  const trimmed = String(newTextRaw ?? "").trim();
  const hasPoll = postHasPollMeta(post.poll);
  if (!trimmed && !hasPoll) {
    alert("Нужен непустой текст или сохраните пост с опросом.");
    return false;
  }

  if (!useSupabase) {
    post.text = trimmed;
    saveStateLocally();
    updateAllUI();
    return true;
  }

  try {
    const { error } = await window.supabase
      .from("posts")
      .update({ text: trimmed })
      .eq("id", post.id);
    if (error) throw error;
    post.text = trimmed;
    updateAllUI();
    return true;
  } catch (e) {
    console.error("Ошибка сохранения поста:", e);
    alert("Не удалось сохранить изменения.");
    return false;
  }
}

/** @returns {boolean|null} true если после клика лайк стоит; null при ошибке/отмене */
async function toggleLikeSupabase(postId) {
  const currentUser = getCurrentUser();
  if (!currentUser) return null;
  const post = findPostById(postId);
  if (!post) return null;
  const likes = post.likes || [];
  const hasLiked = likesIncludes(likes, currentUser.id);
  const newLikes = hasLiked
    ? likes.filter((id) => !idsEqual(id, currentUser.id))
    : [...likes, currentUser.id];
  const nowLiked = !hasLiked;
  if (!useSupabase) {
    post.likes = newLikes;
    saveStateLocally();
    syncLikeButtonsForPost(postId);
    return nowLiked;
  }
  try {
    await window.supabase.from('posts').update({ likes: newLikes }).eq('id', post.id);
    post.likes = newLikes;
    syncLikeButtonsForPost(postId);
    return nowLiked;
  } catch (error) {
    console.error('Ошибка лайка:', error);
    return null;
  }
}

async function addCommentSupabase(postId, text) {
  const currentUser = getCurrentUser();
  if (!currentUser) return;
  const post = findPostById(postId);
  if (!post) return;
  openCommentPostIds.add(String(post.id));
  if (!useSupabase) {
    if (!post.comments) post.comments = [];
    post.comments.push({
      id: state.nextCommentId++,
      authorId: currentUser.id,
      text,
      createdAt: Date.now()
    });
    saveStateLocally();
    await notifyMentionsInText(currentUser.id, text);
    updateAllUI();
    return;
  }
  try {
    const { data, error } = await window.supabase
      .from("comments")
      .insert([
        {
          post_id: post.id,
          author_id: currentUser.id,
          text,
          created_at: new Date()
        }
      ])
      .select()
      .single();
    if (!error && data) {
      if (!post.comments) post.comments = [];
      post.comments.push(data);
      await notifyMentionsInText(currentUser.id, text);
      updateAllUI();
    }
  } catch (error) {
    console.error("Ошибка комментария:", error);
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
let notificationsRealtimeChannel = null;

function isMessagesMobileLayout() {
  return window.matchMedia('(max-width: 768px)').matches;
}

function setMessagesMobileView(mode) {
  const page = document.getElementById('page-messages');
  if (!page) return;
  page.classList.remove('messages-mobile-list', 'messages-mobile-chat');
  if (!isMessagesMobileLayout()) return;
  if (mode === 'chat') page.classList.add('messages-mobile-chat');
  else page.classList.add('messages-mobile-list');
}

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
  setMessagesMobileView('chat');
  
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

/** Исходник с телефона (до клиентского JPEG); лимит БД сохраняем за счёт обрезки + сжатия */
const AVATAR_MAX_SOURCE_BYTES = 20 * 1024 * 1024;
const AVATAR_EXPORT_PX = 512;
const AVATAR_JPEG_QUALITY = 0.9;

/**
 * Instagram-подобный круглый кроп: перетаскивание + масштаб, экспорт JPEG.
 */
function openAvatarCropper(sourceFile) {
  return new Promise((resolve, reject) => {
    const backdrop = document.getElementById("avatar-crop-backdrop");
    const viewport = document.getElementById("avatar-crop-viewport");
    const wrap = document.getElementById("avatar-crop-img-wrap");
    const imgEl = document.getElementById("avatar-crop-img");
    const zoomSlider = document.getElementById("avatar-crop-zoom");
    const btnOk = document.getElementById("avatar-crop-ok");
    const btnCancel = document.getElementById("avatar-crop-cancel");
    const btnClose = document.getElementById("avatar-crop-close");
    if (!backdrop || !viewport || !wrap || !imgEl || !zoomSlider || !btnOk || !btnCancel || !btnClose) {
      reject(new Error("Окно обрезки недоступно"));
      return;
    }
    const mime = (sourceFile.type || "").toLowerCase();
    if (mime && !mime.startsWith("image/")) {
      reject(new Error("Выберите файл изображения"));
      return;
    }
    if (sourceFile.size > AVATAR_MAX_SOURCE_BYTES) {
      reject(new Error(`Файл слишком большой (макс. ${Math.round(AVATAR_MAX_SOURCE_BYTES / (1024 * 1024))} МБ)`));
      return;
    }

    let objectUrl = null;
    let iw = 0;
    let ih = 0;
    let baseScale = 1;
    let panX = 0;
    let panY = 0;
    let dragging = false;
    let lastPx = 0;
    let lastPy = 0;

    function removeListeners(list) {
      list.forEach(({ el, evt, fn, opts }) => el.removeEventListener(evt, fn, opts));
    }

    function finish(teardownHandlers, result, isError) {
      removeListeners(teardownHandlers);
      backdrop.removeEventListener("click", onBackdropClick);
      document.removeEventListener("keydown", onKey);
      if (objectUrl) {
        URL.revokeObjectURL(objectUrl);
        objectUrl = null;
      }
      imgEl.removeAttribute("src");
      backdrop.classList.remove("visible");
      backdrop.setAttribute("aria-hidden", "true");
      zoomSlider.value = "100";
      if (isError) reject(result); else resolve(result);
    }

    function viewSize() {
      const r = viewport.getBoundingClientRect();
      return Math.max(120, Math.min(r.width, r.height));
    }

    function layout() {
      const v = viewSize();
      const zoomMul = Math.max(1, Number(zoomSlider.value) / 100);
      const displayScale = baseScale * zoomMul;
      const W = iw * displayScale;
      const H = ih * displayScale;
      const maxPanX = Math.max(0, (W - v) / 2);
      const maxPanY = Math.max(0, (H - v) / 2);
      panX = Math.max(-maxPanX, Math.min(maxPanX, panX));
      panY = Math.max(-maxPanY, Math.min(maxPanY, panY));
      imgEl.style.width = `${W}px`;
      imgEl.style.height = `${H}px`;
      wrap.style.transform = `translate(calc(-50% + ${panX}px), calc(-50% + ${panY}px))`;
    }

    function exportJpegDataUrl() {
      const v = viewSize();
      const zoomMul = Math.max(1, Number(zoomSlider.value) / 100);
      const displayScale = baseScale * zoomMul;
      const W = iw * displayScale;
      const H = ih * displayScale;
      const x0 = v / 2 + panX - W / 2;
      const y0 = v / 2 + panY - H / 2;
      const out = AVATAR_EXPORT_PX;
      const canvas = document.createElement("canvas");
      canvas.width = out;
      canvas.height = out;
      const ctx = canvas.getContext("2d");
      ctx.fillStyle = "#000";
      ctx.fillRect(0, 0, out, out);
      ctx.beginPath();
      ctx.arc(out / 2, out / 2, out / 2, 0, Math.PI * 2);
      ctx.closePath();
      ctx.clip();
      const k = out / v;
      ctx.drawImage(imgEl, 0, 0, iw, ih, x0 * k, y0 * k, W * k, H * k);
      try {
        return canvas.toDataURL("image/jpeg", AVATAR_JPEG_QUALITY);
      } catch {
        throw new Error("Не удалось сохранить изображение в JPEG");
      }
    }

    const handlers = [];

    function onZoom() { layout(); }

    function onPointerDown(e) {
      if (e.button !== undefined && e.button !== 0) return;
      dragging = true;
      lastPx = e.clientX;
      lastPy = e.clientY;
      try { viewport.setPointerCapture(e.pointerId); } catch { /* noop */ }
    }

    function onPointerMove(e) {
      if (!dragging) return;
      panX += e.clientX - lastPx;
      panY += e.clientY - lastPy;
      lastPx = e.clientX;
      lastPy = e.clientY;
      layout();
    }

    function onPointerEnd() {
      dragging = false;
    }

    function onWheel(e) {
      e.preventDefault();
      let val = Number(zoomSlider.value);
      val += e.deltaY < 0 ? 12 : -12;
      val = Math.max(100, Math.min(400, val));
      zoomSlider.value = String(val);
      layout();
    }

    function onOk() {
      try {
        const dataUrl = exportJpegDataUrl();
        finish(handlers, dataUrl, false);
      } catch (err) {
        finish(handlers, err instanceof Error ? err : new Error(String(err)), true);
      }
    }

    function onCancel() {
      finish(handlers, new Error("Отмена"), true);
    }

    function onKey(e) {
      if (e.key === "Escape") onCancel();
    }

    function onBackdropClick(e) {
      if (e.target === backdrop) onCancel();
    }

    handlers.push(
      { el: zoomSlider, evt: "input", fn: onZoom },
      { el: viewport, evt: "pointerdown", fn: onPointerDown },
      { el: viewport, evt: "pointermove", fn: onPointerMove },
      { el: viewport, evt: "pointerup", fn: onPointerEnd },
      { el: viewport, evt: "pointercancel", fn: onPointerEnd },
      { el: viewport, evt: "wheel", fn: onWheel, opts: { passive: false } },
      { el: btnOk, evt: "click", fn: onOk },
      { el: btnCancel, evt: "click", fn: onCancel },
      { el: btnClose, evt: "click", fn: onCancel }
    );
    handlers.forEach(({ el, evt, fn, opts }) => el.addEventListener(evt, fn, opts));

    backdrop.addEventListener("click", onBackdropClick);
    document.addEventListener("keydown", onKey);

    objectUrl = URL.createObjectURL(sourceFile);
    imgEl.onload = () => {
      iw = imgEl.naturalWidth;
      ih = imgEl.naturalHeight;
      if (!iw || !ih) {
        finish(handlers, new Error("Не удалось прочитать размер изображения"), true);
        return;
      }
      const v = viewSize();
      baseScale = Math.max(v / iw, v / ih);
      zoomSlider.value = "100";
      panX = 0;
      panY = 0;
      layout();
      backdrop.classList.add("visible");
      backdrop.setAttribute("aria-hidden", "false");
    };
    imgEl.onerror = () => {
      finish(handlers, new Error("Формат изображения не поддерживается в браузере. Сохраните как JPG."), true);
    };
    imgEl.src = objectUrl;
  });
}

async function jpegDataUrlToBlob(dataUrl) {
  const res = await fetch(dataUrl);
  return res.blob();
}

/**
 * Обрезанный JPEG из data URL → Supabase Storage, в профиль пишется только public URL.
 */
async function uploadAvatarJpegForUser(userId, jpegDataUrl) {
  if (!useSupabase || !userId || typeof jpegDataUrl !== "string" || !jpegDataUrl.startsWith("data:image")) {
    return { publicUrl: null, error: new Error("Нет изображения для загрузки") };
  }
  try {
    const blob = await jpegDataUrlToBlob(jpegDataUrl);
    const path = `${userId}/avatar.jpg`;
    const { error: uploadError } = await window.supabase.storage.from(SUPABASE_AVATARS_BUCKET).upload(path, blob, {
      contentType: "image/jpeg",
      upsert: true,
      cacheControl: "86400",
    });
    if (uploadError) return { publicUrl: null, error: uploadError };
    const { data: pub } = window.supabase.storage.from(SUPABASE_AVATARS_BUCKET).getPublicUrl(path);
    const publicUrl = `${pub.publicUrl}?v=${Date.now()}`;
    return { publicUrl, error: null };
  } catch (e) {
    return { publicUrl: null, error: e instanceof Error ? e : new Error(String(e)) };
  }
}

async function deleteAvatarFromStorage(userId) {
  if (!useSupabase || !userId) return;
  const { error } = await window.supabase.storage.from(SUPABASE_AVATARS_BUCKET).remove([`${userId}/avatar.jpg`]);
  if (error) console.warn("Не удалось удалить аватар из Storage:", error.message);
}

// ============ ТЕМА ============
function getCurrentTheme() { return localStorage.getItem('theme') || 'light'; }
function setTheme(theme, options = {}) {
  const isDark = theme === 'dark';
  if (isDark) { document.documentElement.setAttribute('data-theme', 'dark'); localStorage.setItem('theme', 'dark'); }
  else { document.documentElement.removeAttribute('data-theme'); localStorage.setItem('theme', 'light'); }
  if (!options.skipCheckbox) {
    const themeToggleCheckbox = document.getElementById('theme-switch-toggle');
    if (themeToggleCheckbox) themeToggleCheckbox.checked = isDark;
  }
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

/** Лёгкая анимация на кнопках подписки / отписки */
function animateFollowButtonTap(el) {
  if (!el) return;
  if (typeof window.matchMedia === "function" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    return;
  }
  el.classList.remove("follow-btn--flash");
  void el.offsetWidth;
  el.classList.add("follow-btn--flash");
  window.setTimeout(() => el.classList.remove("follow-btn--flash"), 520);
}

// ============ УВЕДОМЛЕНИЯ (Supabase `notifications`) ============
function pushLocalFollowNotification(recipientId, actorId) {
  pushLocalNotification(recipientId, actorId, "follow");
}

async function notifyNewFollow(recipientUserId, actorUserId) {
  if (!recipientUserId || !actorUserId || idsEqual(recipientUserId, actorUserId)) return;
  if (!useSupabase) {
    pushLocalFollowNotification(recipientUserId, actorUserId);
    updateNotificationsNavBadge();
    renderNotificationsIfActivePage();
    return;
  }
  const { error } = await window.supabase.from("notifications").insert([
    { recipient_id: recipientUserId, actor_id: actorUserId, type: "follow", read: false }
  ]);
  if (error) console.warn("Не удалось создать уведомление о подписке:", error.message);
}

function unsubscribeNotificationsRealtime() {
  if (!notificationsRealtimeChannel || !useSupabase) return;
  try {
    window.supabase.removeChannel(notificationsRealtimeChannel);
  } catch (_) { /* ignore */ }
  notificationsRealtimeChannel = null;
}

function subscribeNotificationsRealtime(userId) {
  if (!useSupabase || !userId) return;
  unsubscribeNotificationsRealtime();
  notificationsRealtimeChannel = window.supabase
    .channel("notifications-realtime-" + String(userId))
    .on(
      "postgres_changes",
      {
        event: "INSERT",
        schema: "public",
        table: "notifications",
        filter: "recipient_id=eq." + String(userId)
      },
      () => {
        fetchNotificationsIntoState().then(() => {
          updateNotificationsNavBadge();
          renderNotificationsIfActivePage();
        });
      }
    )
    .subscribe();
}

async function fetchNotificationsIntoState() {
  const cur = getCurrentUser();
  if (!cur) {
    state.notifications = [];
    return;
  }
  if (!useSupabase) {
    state.notifications = (state.notifications || []).filter((n) => idsEqual(n.recipient_id, cur.id));
    return;
  }
  const { data, error } = await window.supabase
    .from("notifications")
    .select("*")
    .eq("recipient_id", cur.id)
    .order("created_at", { ascending: false })
    .limit(100);
  if (error) {
    console.warn("Загрузка уведомлений:", error.message);
    return;
  }
  state.notifications = data || [];
}

async function markAllNotificationsRead() {
  const cur = getCurrentUser();
  if (!cur) return;
  if (!useSupabase) {
    (state.notifications || []).forEach((n) => {
      if (idsEqual(n.recipient_id, cur.id)) n.read = true;
    });
    saveStateLocally();
    updateNotificationsNavBadge();
    renderNotificationsIfActivePage();
    return;
  }
  const { error } = await window.supabase
    .from("notifications")
    .update({ read: true })
    .eq("recipient_id", cur.id)
    .eq("read", false);
  if (error) console.warn("Пометка уведомлений прочитанными:", error.message);
  (state.notifications || []).forEach((n) => {
    n.read = true;
  });
  updateNotificationsNavBadge();
}

function updateNotificationsNavBadge() {
  const dot = document.getElementById("nav-notifications-dot");
  if (!dot) return;
  const cur = getCurrentUser();
  let n = 0;
  if (cur) {
    n = (state.notifications || []).filter(
      (x) => !x.read && idsEqual(x.recipient_id, cur.id)
    ).length;
  }
  dot.hidden = n === 0;
}

function notificationsTimeLabel(isoStr) {
  if (!isoStr) return "";
  const t = new Date(isoStr).getTime();
  if (Number.isNaN(t)) return "";
  return timeAgo(t);
}

function notificationLineHtml(type, actorDisplayName, actorUsername) {
  const name = escapeHtml(actorDisplayName || "Пользователь");
  const at = actorUsername ? ` <span class="notification-username">@${escapeHtml(actorUsername)}</span>` : "";
  if (type === "follow") {
    return `<span class="notification-line"><strong>${name}</strong>${at} подписался на вас.</span>`;
  }
  if (type === "mention") {
    return `<span class="notification-line"><strong>${name}</strong>${at} упомянул вас в посте или комментарии.</span>`;
  }
  return `<span class="notification-line"><strong>${name}</strong> — активность</span>`;
}

function renderNotificationsIfActivePage() {
  const page = document.getElementById("page-notifications");
  if (page?.classList.contains("page-active")) renderNotificationsList();
}

function renderNotificationsList() {
  const wrap = document.getElementById("notifications-list");
  if (!wrap) return;
  const cur = getCurrentUser();
  if (!cur) {
    wrap.innerHTML = `<div class="empty-state notifications-empty"><div class="empty-icon">🔕</div><p class="empty-title">Уведомления</p><p class="empty-text">Войдите в аккаунт — здесь будут новые подписчики.</p></div>`;
    return;
  }

  let list = (state.notifications || []).filter((n) =>
    idsEqual(n.recipient_id, cur.id)
  );
  list = [...list].sort(
    (a, b) =>
      new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
  );

  if (list.length === 0) {
    wrap.innerHTML = `<div class="empty-state notifications-empty"><div class="empty-icon">✅</div><p class="empty-title">Нет новых уведомлений</p><p class="empty-text">Здесь появятся подписки и упоминания @username в постах и комментариях.</p></div>`;
    return;
  }

  wrap.innerHTML = list
    .map((n) => {
      const actor = getUser(n.actor_id);
      if (!actor)
        return `<div class="notification-item notification-item--muted" role="listitem"><p class="notification-fallback">Пользователь недоступен</p></div>`;

      const av = actor.avatar_url || actor.avatarUrl || "";
      const dn = actor.display_name || actor.displayName || "Пользователь";
      const un = actor.username || "";
      const initials = dn[0]?.toUpperCase() || "U";
      const unread = !n.read;
      const avatarHtml = av
        ? `<img src="${av}" alt="" decoding="async" />`
        : escapeHtml(initials);
      const tLabel = notificationsTimeLabel(n.created_at);
      const lineInner = notificationLineHtml(n.type || "follow", dn, un);
      return `<button type="button" class="notification-item${unread ? " notification-item--unread" : ""}" role="listitem" data-notification-actor="${String(actor.id)}">
        <span class="notification-avatar">${avatarHtml}</span>
        <span class="notification-body">
          ${lineInner}
          <span class="notification-meta">${escapeHtml(tLabel)}</span>
        </span>
      </button>`;
    })
    .join("");
}

async function bootstrapNotificationsUi() {
  const cur = getCurrentUser();
  if (!cur) {
    unsubscribeNotificationsRealtime();
    state.notifications = [];
    updateNotificationsNavBadge();
    renderNotificationsIfActivePage();
    return;
  }
  await fetchNotificationsIntoState();
  updateNotificationsNavBadge();
  renderNotificationsIfActivePage();
  subscribeNotificationsRealtime(cur.id);
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
        viewedProfileId = userId;
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
        animateFollowButtonTap(newBtn);
        const targetUserId = newBtn.dataset.userId;
        const currentUser = getCurrentUser();
        
        if (!currentUser) { alert('Войдите в аккаунт'); return; }
        if (idsEqual(currentUser.id, targetUserId)) return;
        
        const isFollowing = (currentUser.following || []).some(id => idsEqual(id, targetUserId));
        const becomingFollow = !isFollowing;
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
        if (becomingFollow) await notifyNewFollow(targetUserId, currentUser.id);
        saveStateLocally();
        
        const searchInput = document.getElementById('search-input');
        if (searchInput && searchInput.value) renderSearchResults(searchUsers(searchInput.value));
      });
    }
  });
}

function createPostArticleElement(post, current) {
  const authorId = post.authorId || post.author_id;
  const author = getUser(authorId);
  if (!author) return null;

  const isLiked = current ? likesIncludes(post.likes, current.id) : false;
  const postTime = post.createdAt || new Date(post.created_at).getTime();
  const avatarUrl = author.avatar_url || author.avatarUrl || "";
  const displayName = author.display_name || author.displayName || "Пользователь";
  const username = author.username || "unknown";
  const pid = String(post.id);
  const commentsOpen = openCommentPostIds.has(pid);
  const likeCount = (post.likes || []).length;
  const commentCount = (post.comments || []).length;

  const postEl = document.createElement("article");
  postEl.className = "post";
  if (pendingFreshPostId != null && String(pendingFreshPostId) === pid) postEl.classList.add("post--fresh");
  postEl.dataset.postId = pid;

  const commentsListHtml = (post.comments || [])
    .map((c) => {
      const cu = getUser(c.authorId || c.author_id);
      const cuName = cu ? cu.display_name || cu.displayName || "Пользователь" : "Пользователь";
      const cuId = c.authorId || c.author_id;
      return `<div class="comment-item"><span class="comment-author js-profile-link" data-user-id="${cuId}" style="cursor: pointer; font-weight: bold;">${escapeHtml(cuName)}</span>: <span class="comment-text">${htmlFromPlainWithMentions(c.text || "")}</span></div>`;
    })
    .join("");

  const authorActions =
    current && idsEqual(current.id, author.id)
      ? `<div class="post-header-actions"><button type="button" class="post-edit-btn js-edit-post" title="Редактировать текст">✏️</button><button type="button" class="post-delete-btn js-delete-post" title="Удалить пост">🗑️</button></div>`
      : "";

  const bodyTextTrim = (post.text || "").trim();
  const textBlock = bodyTextTrim
    ? `<div class="post-content"><p class="post-text">${htmlFromPlainWithMentions(post.text || "")}</p></div>`
    : "";
  const pollBlock = normalizePoll(post)
    ? `<div class="post-poll-host">${buildPostPollMarkup(post, current)}</div>`
    : "";

  postEl.innerHTML = `
    <header class="post-header">
      <div class="post-avatar js-profile-link" data-user-id="${author.id}" style="cursor: pointer;">
        ${avatarUrl ? `<img src="${avatarUrl}" alt="" decoding="async" />` : displayName[0]?.toUpperCase() || "U"}
      </div>
      <div style="flex:1;">
        <div class="post-author js-profile-link" data-user-id="${author.id}" style="cursor: pointer; font-weight: bold;">${escapeHtml(displayName)}</div>
        <div class="post-meta">${timeAgo(postTime)} • @${escapeHtml(username)}</div>
      </div>
      ${authorActions}
    </header>
    ${textBlock}${pollBlock}
    <footer class="post-footer">
      <button type="button" class="post-footer-btn js-like-btn${isLiked ? " is-liked" : ""}" aria-pressed="${isLiked ? "true" : "false"}">
        <span class="like-heart" aria-hidden="true">${isLiked ? "❤️" : "🤍"}</span>
        <span class="like-count">${likeCount}</span>
      </button>
      <button type="button" class="post-footer-btn js-comment-toggle${commentsOpen ? " is-comments-open" : ""}" aria-expanded="${commentsOpen ? "true" : "false"}">
        <span class="comment-toggle-icon" aria-hidden="true">💬</span>
        <span class="comment-count">${commentCount}</span>
      </button>
    </footer>
    <div class="comments${commentsOpen ? " is-open" : ""}">
      <div class="comments__inner">
        <div class="comments-list">${commentsListHtml}</div>
        <div class="comment-input-row"><input type="text" placeholder="Написать комментарий..." /><button type="button" class="js-comment-send">Отправить</button></div>
      </div>
    </div>
  `;

  return postEl;
}

/**
 * Отфильтровать посты под выбранную подвкладку ленты.
 * «Подписки» — автор в ваших подписках или вы сами.
 * «Лента друзей» — взаимные подписки (вы подписаны на автора и он на вас), плюс ваши посты.
 */
function filterFeedPostsByTab(sortedPosts, current) {
  if (currentFeedFilter === "all") return sortedPosts;
  if (!current) return [];

  const myId = current.id;
  const followingList = current.following || [];

  return sortedPosts.filter((post) => {
    const authorId = post.authorId || post.author_id;

    if (currentFeedFilter === "following") {
      return idsEqual(authorId, myId) || followingList.some((id) => idsEqual(id, authorId));
    }

    if (currentFeedFilter === "friends") {
      if (idsEqual(authorId, myId)) return true;
      if (!followingList.some((id) => idsEqual(id, authorId))) return false;
      const author = getUser(authorId);
      if (!author) return false;
      return (author.following || []).some((id) => idsEqual(id, myId));
    }

    return true;
  });
}

/** Пользователи, у которых в following есть этот профиль */
function getFollowersUsersFor(profileUser) {
  if (!profileUser) return [];
  return state.users.filter((u) =>
    (u.following || []).some((fid) => idsEqual(fid, profileUser.id))
  );
}

/** Объекты пользователей по списку following выбранного профиля */
function getFollowingUsersFor(profileUser) {
  if (!profileUser) return [];
  const out = [];
  for (const fid of profileUser.following || []) {
    const u = getUser(fid);
    if (u) out.push(u);
  }
  return out;
}

function sortUsersAlphabetical(users) {
  return [...users].sort((a, b) =>
    String(a.display_name || a.displayName || "").localeCompare(
      String(b.display_name || b.displayName || ""),
      "ru",
      { sensitivity: "base" }
    )
  );
}

async function toggleFollowFromListModal(targetUserId) {
  const currentUser = getCurrentUser();
  if (!currentUser || idsEqual(currentUser.id, targetUserId)) return;
  const wasFollowing = (currentUser.following || []).some((id) =>
    idsEqual(id, targetUserId)
  );
  let newFollowing;
  if (wasFollowing) {
    newFollowing = (currentUser.following || []).filter(
      (id) => !idsEqual(id, targetUserId)
    );
  } else {
    newFollowing = [...(currentUser.following || []), targetUserId];
  }
  currentUser.following = newFollowing;
  if (useSupabase) {
    await window.supabase
      .from("users")
      .update({ following: newFollowing })
      .eq("id", currentUser.id);
  }
  if (!wasFollowing) await notifyNewFollow(targetUserId, currentUser.id);
  saveStateLocally();
}

function refreshVisibleProfileUsersModal() {
  const backdrop = document.getElementById("profile-list-modal-backdrop");
  if (!backdrop?.classList.contains("visible")) return;
  const mode = backdrop.dataset.listMode;
  if (mode !== "followers" && mode !== "following") return;
  const pid = viewedProfileId || getCurrentUser()?.id;
  const profileUser = pid ? getUser(pid) : null;
  if (!profileUser) return;
  const users =
    mode === "followers"
      ? getFollowersUsersFor(profileUser)
      : getFollowingUsersFor(profileUser);
  renderProfileUsersListToModal(users);
}

function renderProfileUsersListToModal(users) {
  const ul = document.getElementById("profile-list-modal-users");
  if (!ul) return;
  const sorted = sortUsersAlphabetical(users);
  const current = getCurrentUser();
  if (!sorted.length) {
    ul.innerHTML =
      '<li class="profile-list-empty" role="status">Здесь пока никого нет.</li>';
    return;
  }
  ul.innerHTML = sorted
    .map((u) => {
      const avatarUrl = u.avatar_url || u.avatarUrl || "";
      const dn = u.display_name || u.displayName || "Пользователь";
      const un = u.username || "";
      const letter = dn[0]?.toUpperCase() || "?";
      const avInner = avatarUrl
        ? `<img src="${avatarUrl}" alt="" decoding="async" />`
        : escapeHtml(letter);
      const uidAttr = escapeHtml(String(u.id));
      const isSelf = current && idsEqual(current.id, u.id);
      const isFollowing =
        current && (current.following || []).some((id) => idsEqual(id, u.id));

      let rightCol = "";
      if (current && !isSelf) {
        rightCol = `<div class="profile-list-row-actions"><button type="button" class="profile-list-follow-btn user-card-follow-btn${isFollowing ? " following" : ""}" data-profile-list-follow="${uidAttr}" aria-label="${isFollowing ? "Отписаться от пользователя" : "Подписаться на пользователя"}">${isFollowing ? "Отписаться" : "Подписаться"}</button></div>`;
      } else if (current) {
        rightCol = `<div class="profile-list-row-actions profile-list-row-actions--empty" aria-hidden="true"></div>`;
      }

      return `<li class="profile-list-item">
        <button type="button" class="profile-list-row-main" data-profile-list-user="${uidAttr}">
          <span class="profile-list-row-avatar">${avInner}</span>
          <span class="profile-list-row-names">
            <span class="profile-list-row-name">${escapeHtml(dn)}</span>
            <span class="profile-list-row-username">@${escapeHtml(un)}</span>
          </span>
        </button>
        ${rightCol}
      </li>`;
    })
    .join("");
}

function openProfileUsersModal(mode) {
  const backdrop = document.getElementById("profile-list-modal-backdrop");
  const titleEl = document.getElementById("profile-list-modal-title");
  if (!backdrop || !titleEl) return;
  const pid = viewedProfileId || getCurrentUser()?.id;
  const profileUser = pid ? getUser(pid) : null;
  if (!profileUser) return;

  titleEl.textContent = mode === "followers" ? "Подписчики" : "Подписки";
  const users =
    mode === "followers"
      ? getFollowersUsersFor(profileUser)
      : getFollowingUsersFor(profileUser);
  renderProfileUsersListToModal(users);
  backdrop.dataset.listMode = mode;
  backdrop.setAttribute("aria-hidden", "false");
  backdrop.classList.add("visible");
}

function closeProfileUsersModal() {
  const backdrop = document.getElementById("profile-list-modal-backdrop");
  if (!backdrop) return;
  backdrop.classList.remove("visible");
  backdrop.setAttribute("aria-hidden", "true");
}

function renderFeed() {
  const feedListEl = document.getElementById("feed-list");
  if (!feedListEl) return;
  
  const current = getCurrentUser();
  let posts = [...state.posts];
  posts.sort((a, b) => (b.createdAt || new Date(b.created_at).getTime()) - (a.createdAt || new Date(a.created_at).getTime()));
  
  const globalEmpty = posts.length === 0;
  posts = filterFeedPostsByTab(posts, current);

  feedListEl.innerHTML = "";

  if (globalEmpty) {
    feedListEl.innerHTML = `<div class="feed-empty-state empty-state"><div class="empty-icon">📋</div><p class="empty-title">Лента пока пустая</p><p class="empty-text">Напишите первый пост выше или загляните позже</p></div>`;
    return;
  }

  if (posts.length === 0) {
    let title = "Здесь пока тихо";
    let hint = "";
    if (!current && (currentFeedFilter === "friends" || currentFeedFilter === "following")) {
      title = "Войдите в аккаунт";
      hint = "После входа здесь будет лента друзей или людей из подписок.";
    } else if (currentFeedFilter === "following") {
      title = "Никого в этой ленте";
      hint = "Подпишитесь на пользователей через поиск — появятся их посты. Свои посты тоже отображаются во вкладке «Подписки».";
    } else if (currentFeedFilter === "friends") {
      title = "Пока нет друзей в ленте";
      hint = "Друзья — те, на кого вы подписаны и кто подписан на вас. Подпишитесь друг на друга, чтобы видеть общую ленту.";
    }
    feedListEl.innerHTML = `<div class="feed-empty-state empty-state"><div class="empty-icon">🪴</div><p class="empty-title">${escapeHtml(title)}</p><p class="empty-text">${escapeHtml(hint)}</p></div>`;
    return;
  }

  const runIntro = !feedIntroAnimationDone;
  feedIntroAnimationDone = true;

  posts.forEach((post, index) => {
    const postEl = createPostArticleElement(post, current);
    if (!postEl) return;
    if (runIntro && pendingFreshPostId == null) {
      postEl.style.setProperty("--post-i", String(Math.min(index, 14)));
      postEl.classList.add("post--enter");
    }
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
  
  const followersCount = state.users.filter((u) =>
    (u.following || []).some((fid) => idsEqual(fid, user.id))
  ).length;
  const followingCount = (user.following || []).length;
  const postsCount = state.posts.filter((p) =>
    idsEqual(p.authorId || p.author_id, user.id)
  ).length;
  
  document.getElementById('profile-posts-count') && (document.getElementById('profile-posts-count').textContent = postsCount);
  document.getElementById('profile-followers-count') && (document.getElementById('profile-followers-count').textContent = followersCount);
  document.getElementById('profile-following-count') && (document.getElementById('profile-following-count').textContent = followingCount);
  
  const isOwn = current && idsEqual(current.id, user.id);
  
  if (profileFollowBtn) {
    if (!current || isOwn) profileFollowBtn.style.display = 'none';
    else {
      profileFollowBtn.style.display = 'block';
      const amFollowing = (current.following || []).some((id) =>
        idsEqual(id, user.id)
      );
      profileFollowBtn.textContent = amFollowing ? "Отписаться" : "Подписаться";
      profileFollowBtn.classList.toggle("following", amFollowing);
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
      animateFollowButtonTap(newFollowBtn);
      const currentUser = getCurrentUser();
      const targetUser = user;
      if (!currentUser || idsEqual(currentUser.id, targetUser.id)) return;
      const isFollowing = (currentUser.following || []).some((id) => idsEqual(id, targetUser.id));
      const becomingFollow = !isFollowing;
      let newFollowing;
      if (isFollowing) {
        newFollowing = (currentUser.following || []).filter((id) => !idsEqual(id, targetUser.id));
        newFollowBtn.textContent = 'Подписаться';
        newFollowBtn.classList.remove('following');
      } else {
        newFollowing = [...(currentUser.following || []), targetUser.id];
        newFollowBtn.textContent = 'Отписаться';
        newFollowBtn.classList.add('following');
      }
      currentUser.following = newFollowing;
      if (useSupabase) await window.supabase.from('users').update({ following: newFollowing }).eq('id', currentUser.id);
      if (becomingFollow) await notifyNewFollow(targetUser.id, currentUser.id);
      saveStateLocally();
      renderProfile();
    });
  }
  
  const profilePostsEl = document.getElementById('profile-posts');
  if (!profilePostsEl) return;
  
  const activeTab = document.querySelector('.profile-tab-active')?.dataset.profileTab || 'posts';
  let posts = [];
  if (activeTab === 'posts') posts = state.posts.filter(p => (p.authorId || p.author_id) === user.id).sort((a,b) => (b.createdAt || new Date(b.created_at).getTime()) - (a.createdAt || new Date(a.created_at).getTime()));
  else posts = state.posts.filter(p => likesIncludes(p.likes, user.id)).sort((a,b) => (b.createdAt || new Date(b.created_at).getTime()) - (a.createdAt || new Date(a.created_at).getTime()));
  
  if (posts.length === 0) {
    profilePostsEl.innerHTML = `<div class="empty-state"><div class="empty-icon">📭</div><p class="empty-title">Нет ${activeTab === 'posts' ? 'постов' : 'лайков'}</p></div>`;
    return;
  }
  
  profilePostsEl.innerHTML = '';
  posts.forEach((post) => {
    const postEl = createPostArticleElement(post, current);
    if (!postEl) return;
    profilePostsEl.appendChild(postEl);
  });
}

function updateAllUI() {
  renderFeed();
  renderProfile();
  renderTopClans();
  renderNotificationsIfActivePage();
  updateNotificationsNavBadge();
}

// ============ ГЛОБАЛЬНЫЕ ПЕРЕМЕННЫЕ ============
let viewedProfileId = null;
let currentFeedFilter = "all";
/** Один раз за сессию: мягкое появление карточек при первой отрисовке ленты */
let feedIntroAnimationDone = false;
let pendingAvatarRemove = false;
let pendingRegAvatarDataUrl = null;
let pendingProfileAvatarDataUrl = null;

// ============ ОСНОВНОЙ КОД ============
document.addEventListener("DOMContentLoaded", async () => {
  const feedListBoot = document.getElementById("feed-list");
  if (feedListBoot) feedListBoot.innerHTML = feedSkeletonMarkup(5);

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
  const feedTabs = document.querySelectorAll("#page-feed .topbar-tab[data-feed-tab]");
  
  const searchInput = document.getElementById('search-input');
  const searchResults = document.getElementById('search-results');
  const pageMessages = document.getElementById('page-messages');
  setTheme(getCurrentTheme());
  
  window.setActivePage = function(pageName) {
    navItems.forEach(btn => { if (btn.getAttribute("data-page") === pageName) btn.classList.add("active"); else btn.classList.remove("active"); });
    pages.forEach(page => { if (page.id === `page-${pageName}`) page.classList.add("page-active"); else page.classList.remove("page-active"); });
    if (pageName === 'messages') {
      setMessagesMobileView('list');
      setTimeout(() => renderConversationsList(), 100);
    }
    if (pageName === "notifications") {
      (async () => {
        await fetchNotificationsIntoState();
        renderNotificationsList();
        await markAllNotificationsRead();
        renderNotificationsList();
        updateNotificationsNavBadge();
      })();
    }
  };
  
  window.renderProfile = renderProfile;
  window.viewedProfileId = viewedProfileId;
  window.openChatWithUser = openChatWithUser;
  
  function showAuthTab(tab) {
    authTabs.forEach(btn => btn.classList.toggle("auth-tab-active", btn.dataset.authTab === tab));
    if (tab === "login") { loginForm.classList.add("auth-form-active"); registerForm.classList.remove("auth-form-active"); }
    else { registerForm.classList.add("auth-form-active"); loginForm.classList.remove("auth-form-active"); }
    loginError.textContent = ""; registerError.textContent = "";
    if (tab !== "register") pendingRegAvatarDataUrl = null;
  }
  
  navItems.forEach(btn => btn.addEventListener("click", () => { const pageId = btn.getAttribute("data-page"); if (pageId) { setActivePage(pageId); if (pageId === "profile") { viewedProfileId = state.currentUserId; renderProfile(); } } }));
  feedTabs.forEach((tab) => {
    tab.addEventListener("click", () => {
      const mode = tab.dataset.feedTab;
      if (!mode) return;
      currentFeedFilter = mode;
      feedTabs.forEach((t) => {
        const active = t === tab;
        t.classList.toggle("topbar-tab-active", active);
        t.setAttribute("aria-selected", active ? "true" : "false");
      });
      renderFeed();
    });
  });
  document.getElementById('theme-toggle')?.addEventListener('click', toggleTheme);
  document.querySelectorAll("[data-auth-tab-switch]").forEach(btn => btn.addEventListener("click", () => showAuthTab(btn.getAttribute("data-auth-tab-switch"))));
  authTabs.forEach(btn => btn.addEventListener("click", () => showAuthTab(btn.dataset.authTab)));
  
  loginForm?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const username = document.getElementById("login-username").value.trim();
    const password = document.getElementById("login-password").value.trim();
    loginError.textContent = "";
    const result = await loginUserSupabase(username, password);
    if (result.success) {
      authOverlay.classList.add("hidden");
      viewedProfileId = state.currentUserId;
      updateAllUI();
      void bootstrapNotificationsUi();
    }
    else loginError.textContent = result.error;
  });
  
  registerForm?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const displayName = document.getElementById("reg-displayname").value.trim();
    const username = document.getElementById("reg-username").value.trim();
    const email = `${username}@zachetka.com`;
    const password = document.getElementById("reg-password").value.trim();
    const passwordConfirm = document.getElementById("reg-password-confirm")?.value.trim() ?? "";
    registerError.textContent = "";
    if (!displayName || !username || !password || !passwordConfirm) { registerError.textContent = "Заполните все поля"; return; }
    if (password.length < 6) { registerError.textContent = "Пароль минимум 6 символов"; return; }
    if (password !== passwordConfirm) { registerError.textContent = "Пароли не совпадают"; return; }
    if (state.users.some(u => u.username === username)) { registerError.textContent = "Юзернейм уже занят"; return; }
    const avatarUrl = pendingRegAvatarDataUrl || "";
    const result = await registerUserSupabase(displayName, username, email, password, avatarUrl);
    if (result.success) {
      pendingRegAvatarDataUrl = null;
      authOverlay.classList.add("hidden");
      viewedProfileId = state.currentUserId;
      updateAllUI();
      void bootstrapNotificationsUi();
    }
    else registerError.textContent = result.error;
  });

  document.getElementById("reg-avatar-file")?.addEventListener("change", async (e) => {
    const input = e.target;
    const f = input.files?.[0];
    registerError.textContent = "";
    if (!f) return;
    try {
      pendingRegAvatarDataUrl = await openAvatarCropper(f);
      input.value = "";
    } catch (err) {
      if (err instanceof Error && err.message !== "Отмена") registerError.textContent = err.message || "Не удалось обработать фото";
      pendingRegAvatarDataUrl = null;
      input.value = "";
    }
  });
  
  async function handlePublishPost(source) {
    const current = getCurrentUser();
    if (!current) return;
    const textarea = source === "feed" ? feedComposerInput : profileComposerInput;
    const text = textarea?.value.trim() ?? "";
    const root =
      source === "feed"
        ? document.querySelector("#page-feed .composer")
        : document.getElementById("profile-composer");
    const pollPanel = root?.querySelector(".composer-poll");
    let pollDraft = null;
    if (pollPanel && !pollPanel.hidden) {
      pollDraft = readPollDraftFromComposerRoot(root);
      if (!pollDraft) {
        alert("Укажите вопрос и минимум два непустых варианта опроса либо скройте блок опроса кнопкой 📊.");
        return;
      }
    }
    if (!text && !pollDraft) return;
    const pid = await createPostSupabase(text, pollDraft);
    if (pid === false || pid == null) return;
    textarea.value = "";
    clearPollComposer(root);
    pendingFreshPostId = pid;
    updateAllUI();
    pendingFreshPostId = null;
    const pulseBtn =
      source === "feed" ? feedPublishBtn : document.getElementById("profile-publish-btn");
    if (pulseBtn) {
      pulseBtn.classList.remove("btn-publish-flash");
      void pulseBtn.offsetWidth;
      pulseBtn.classList.add("btn-publish-flash");
      setTimeout(() => pulseBtn.classList.remove("btn-publish-flash"), 650);
    }
  }

  wireComposerPollInteractions(document.querySelector("#page-feed .composer"));
  wireComposerPollInteractions(document.getElementById("profile-composer"));
  
  feedPublishBtn?.addEventListener("click", () => handlePublishPost("feed"));
  profileComposerSection?.querySelector("#profile-publish-btn")?.addEventListener("click", () => handlePublishPost("profile"));
  
  async function toggleLike(postId) {
    const r = await toggleLikeSupabase(postId);
    return r;
  }
  async function addComment(postId, text) { await addCommentSupabase(postId, text); }
  async function deletePost(postId) { await deletePostSupabase(postId); }
  
  function handleFeedClick(container, event) {
    const target = event.target;
    const postEl = target.closest(".post");
    if (!postEl || postEl.classList.contains("post-skeleton")) return;
    const postIdKey = postEl.dataset.postId;
    if (!postIdKey || !findPostById(postIdKey)) return;

    if (target.closest(".js-poll-vote")) {
      event.preventDefault();
      const btn = target.closest(".js-poll-vote");
      if (btn?.disabled) return;
      const oid = btn?.getAttribute("data-poll-option-id");
      if (oid) void voteOnPoll(postIdKey, oid);
      return;
    }

    if (target.closest(".js-like-btn")) {
      toggleLike(postIdKey).then((nowLiked) => {
        if (nowLiked === true) triggerLikeHeartBurst(postIdKey);
      });
      return;
    }
    if (target.closest(".js-edit-post")) {
      event.preventDefault();
      event.stopPropagation();
      openPostEditModal(postIdKey);
      return;
    }
    if (target.closest(".js-delete-post")) { deletePost(postIdKey); return; }
    if (target.closest(".js-comment-toggle")) {
      const commentsEl = postEl.querySelector(".comments");
      const toggleBtn = postEl.querySelector(".js-comment-toggle");
      if (!commentsEl || !toggleBtn) return;
      const open = !commentsEl.classList.contains("is-open");
      if (open) openCommentPostIds.add(String(postIdKey));
      else openCommentPostIds.delete(String(postIdKey));
      commentsEl.classList.toggle("is-open", open);
      toggleBtn.classList.toggle("is-comments-open", open);
      toggleBtn.setAttribute("aria-expanded", open ? "true" : "false");
      return;
    }
    if (target.closest(".js-comment-send")) {
      const row = target.closest(".comment-input-row");
      const input = row?.querySelector("input");
      const text = input?.value.trim();
      if (text) {
        addComment(postIdKey, text).then(() => {
          if (input) input.value = "";
        });
      }
      return;
    }
    const profileLink = target.closest(".js-profile-link");
    if (profileLink) {
      event.preventDefault();
      const userId = profileLink.getAttribute("data-user-id");
      if (userId) {
        viewedProfileId = userId;
        window.viewedProfileId = viewedProfileId;
        setActivePage("profile");
        renderProfile();
      }
      return;
    }
  }
  
  feedListEl?.addEventListener("click", e => handleFeedClick(feedListEl, e));
  profilePostsEl?.addEventListener("click", e => handleFeedClick(profilePostsEl, e));

  document.getElementById("notifications-list")?.addEventListener("click", (e) => {
    const row = e.target.closest(".notification-item[data-notification-actor]");
    if (!row) return;
    const uid = row.getAttribute("data-notification-actor");
    if (!uid) return;
    viewedProfileId = uid;
    window.viewedProfileId = uid;
    setActivePage("profile");
    renderProfile();
  });

  document.getElementById("profile-open-followers-btn")?.addEventListener("click", () => {
    openProfileUsersModal("followers");
  });
  document.getElementById("profile-open-following-btn")?.addEventListener("click", () => {
    openProfileUsersModal("following");
  });
  document.getElementById("profile-list-modal-close")?.addEventListener("click", () => {
    closeProfileUsersModal();
  });
  document.getElementById("profile-list-modal-backdrop")?.addEventListener("click", (e) => {
    if (e.target.id === "profile-list-modal-backdrop") closeProfileUsersModal();
  });
  document.getElementById("profile-list-modal-users")?.addEventListener("click", async (e) => {
    const followBtn = e.target.closest(
      ".profile-list-follow-btn[data-profile-list-follow]"
    );
    if (followBtn) {
      e.preventDefault();
      e.stopPropagation();
      animateFollowButtonTap(followBtn);
      if (!getCurrentUser()) {
        alert("Войдите в аккаунт");
        return;
      }
      const fuid = followBtn.getAttribute("data-profile-list-follow");
      if (!fuid) return;
      await toggleFollowFromListModal(fuid);
      refreshVisibleProfileUsersModal();
      renderProfile();
      const si = document.getElementById("search-input");
      if (si && si.value.trim().length >= 2) {
        renderSearchResults(searchUsers(si.value.trim()));
      }
      return;
    }
    const row = e.target.closest(".profile-list-row-main[data-profile-list-user]");
    if (!row) return;
    const uid = row.getAttribute("data-profile-list-user");
    if (!uid) return;
    closeProfileUsersModal();
    viewedProfileId = uid;
    window.viewedProfileId = uid;
    renderProfile();
  });
  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;
    if (document.getElementById("post-edit-modal-backdrop")?.classList.contains("visible")) {
      closePostEditModal();
      return;
    }
    document.getElementById("profile-list-modal-backdrop")?.classList.contains("visible") &&
      closeProfileUsersModal();
  });

  document.getElementById("post-edit-modal-backdrop")?.addEventListener("click", (e) => {
    if (e.target.id === "post-edit-modal-backdrop") closePostEditModal();
  });
  document.getElementById("post-edit-close")?.addEventListener("click", () => closePostEditModal());
  document.getElementById("post-edit-cancel")?.addEventListener("click", () => closePostEditModal());
  document.getElementById("post-edit-save")?.addEventListener("click", async () => {
    const backdrop = document.getElementById("post-edit-modal-backdrop");
    const ta = document.getElementById("post-edit-textarea");
    const err = document.getElementById("post-edit-error");
    const pid = backdrop?.dataset?.editingPostId;
    if (!pid || !ta) return;
    if (err) err.textContent = "";
    const ok = await updatePostTextSupabase(pid, ta.value);
    if (ok) closePostEditModal();
  });
  
  document.querySelectorAll('.profile-tab').forEach(tab => tab.addEventListener('click', () => { document.querySelectorAll('.profile-tab').forEach(t => t.classList.remove('profile-tab-active')); tab.classList.add('profile-tab-active'); renderProfile(); }));
  
  function openProfileModal() {
    const current = getCurrentUser();
    if (!current) return;
    editDisplayInput.value = current.display_name || current.displayName;
    editUsernameInput.value = current.username;
    if (editClanSelect) editClanSelect.value = current.clan || "";
    if (editAvatarFileInput) editAvatarFileInput.value = "";
    pendingAvatarRemove = false;
    pendingProfileAvatarDataUrl = null;
    profileEditError.textContent = "";
    profileModalBackdrop.classList.add("visible");
  }
  function closeProfileModal() { profileModalBackdrop.classList.remove("visible"); }
  profileEditBtn?.addEventListener("click", openProfileModal);
  profileModalClose?.addEventListener("click", closeProfileModal);
  profileModalCancel?.addEventListener("click", closeProfileModal);
  editAvatarRemoveBtn?.addEventListener("click", () => {
    pendingAvatarRemove = true;
    pendingProfileAvatarDataUrl = null;
    if (editAvatarFileInput) editAvatarFileInput.value = "";
  });

  editAvatarFileInput?.addEventListener("change", async (e) => {
    const input = e.target;
    const f = input.files?.[0];
    profileEditError.textContent = "";
    if (!f) return;
    pendingAvatarRemove = false;
    try {
      pendingProfileAvatarDataUrl = await openAvatarCropper(f);
      input.value = "";
    } catch (err) {
      if (err instanceof Error && err.message !== "Отмена") profileEditError.textContent = err.message || "Не удалось обработать фото";
      pendingProfileAvatarDataUrl = null;
      input.value = "";
    }
  });
  
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
    if (pendingAvatarRemove) {
      updateData.avatar_url = "";
      if (useSupabase) await deleteAvatarFromStorage(current.id);
    } else if (pendingProfileAvatarDataUrl) {
      if (useSupabase && pendingProfileAvatarDataUrl.startsWith("data:image")) {
        const { publicUrl, error: upErr } = await uploadAvatarJpegForUser(current.id, pendingProfileAvatarDataUrl);
        if (upErr) { profileEditError.textContent = `Аватар: ${upErr.message}`; return; }
        updateData.avatar_url = publicUrl;
      } else {
        updateData.avatar_url = pendingProfileAvatarDataUrl;
      }
    }
    if (useSupabase) { await window.supabase.from('users').update(updateData).eq('id', current.id); }
    Object.assign(current, updateData);
    pendingProfileAvatarDataUrl = null;
    saveStateLocally();
    closeProfileModal();
    updateAllUI();
  });
  
  document.getElementById("profile-modal-logout-btn")?.addEventListener("click", async () => {
    if (messagesSubscription && useSupabase) {
      await window.supabase.removeChannel(messagesSubscription);
      messagesSubscription = null;
    }
    await logoutUserSupabase();
    closeProfileModal();
    feedIntroAnimationDone = false;
    unsubscribeNotificationsRealtime();
    state.notifications = [];
    updateNotificationsNavBadge();
    if (authOverlay) { authOverlay.classList.remove("hidden"); showAuthTab("login"); }
    updateAllUI();
  });
  
  const themeToggleCheckbox = document.getElementById('theme-switch-toggle');
  if (themeToggleCheckbox) {
    themeToggleCheckbox.checked = getCurrentTheme() === 'dark';
    themeToggleCheckbox.addEventListener('change', (e) => {
      setTheme(e.target.checked ? 'dark' : 'light', { skipCheckbox: true });
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
  const chatHeader = document.getElementById('chat-header');

  if (chatHeader && !document.getElementById('chat-back-btn')) {
    const backBtn = document.createElement('button');
    backBtn.id = 'chat-back-btn';
    backBtn.type = 'button';
    backBtn.textContent = '←';
    backBtn.setAttribute('aria-label', 'Назад к чатам');
    backBtn.addEventListener('click', () => setMessagesMobileView('list'));
    chatHeader.prepend(backBtn);
  }
  
  function searchUsersForMessages(query) {
    if (!query || query.trim().length < 2) {
      if (searchUsersResults) searchUsersResults.style.display = 'none';
      if (conversationsListEl) conversationsListEl.style.display = 'block';
      setMessagesMobileView('list');
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
      setMessagesMobileView('list');
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
    setMessagesMobileView('list');
    
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
        setMessagesMobileView('list');
      }
    });
  }

  window.addEventListener('resize', () => {
    if (!pageMessages || !pageMessages.classList.contains('page-active')) return;
    if (!isMessagesMobileLayout()) {
      pageMessages.classList.remove('messages-mobile-list', 'messages-mobile-chat');
      return;
    }
    if (currentChatUserId !== null && currentChatUserId !== undefined && currentChatUserId !== '') {
      setMessagesMobileView('chat');
    } else {
      setMessagesMobileView('list');
    }
  });
  
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
  if (!loginUser) {
    authOverlay.classList.remove("hidden");
    showAuthTab("login");
  } else {
    authOverlay.classList.add("hidden");
    viewedProfileId = loginUser.id;
    updateAllUI();
    void bootstrapNotificationsUi();
  }
});