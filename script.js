const STORAGE_KEY = "zachetka-state-v1";

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function saveState(state) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function createInitialState() {
  const now = Date.now();
  const user1 = {
    id: 1,
    displayName: "Ванек Зонт",
    username: "zachetka",
    avatarUrl: "",
    createdAt: now - 1000 * 60 * 60 * 24 * 10,
    passwordHash: null,
    passwordSalt: null,
    following: [2],
    clan: "Клан ФТК",
  };
  const user2 = {
    id: 2,
    displayName: "seriqas",
    username: "seriqas",
    avatarUrl: "",
    createdAt: now - 1000 * 60 * 60 * 24 * 30,
    passwordHash: null,
    passwordSalt: null,
    following: [1],
    clan: null,
  };

  const posts = [
    {
      id: 1,
      authorId: 2,
      text: "Пример поста в вашей социальной сети Zachetka.",
      createdAt: now - 1000 * 60 * 53,
      likes: [1],
      comments: [
        {
          id: 1,
          authorId: 1,
          text: "Круто выглядит!",
          createdAt: now - 1000 * 60 * 10,
        },
      ],
    },
    {
      id: 2,
      authorId: 1,
      text: "Добро пожаловать в Социальную Сеть Zachetka!",
      createdAt: now - 1000 * 60 * 60,
      likes: [2],
      comments: [],
    },
  ];

  return {
    users: [user1, user2],
    posts,
    currentUserId: null,
    nextUserId: 3,
    nextPostId: 3,
    nextCommentId: 2,
  };
}

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

function generateSalt(length = 16) {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

async function hashPassword(password, salt) {
  const enc = new TextEncoder();
  const data = enc.encode(`${salt}:${password}`);
  const buf = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

async function hashPasswordLegacy(password) {
  const enc = new TextEncoder();
  const data = enc.encode(password);
  const buf = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

// Функции для переключения темы
function getCurrentTheme() {
  return localStorage.getItem('theme') || 'light';
}

function setTheme(theme) {
  if (theme === 'dark') {
    document.documentElement.setAttribute('data-theme', 'dark');
    localStorage.setItem('theme', 'dark');
    const themeBtn = document.getElementById('theme-toggle');
    if (themeBtn) themeBtn.textContent = '☀️';
  } else {
    document.documentElement.removeAttribute('data-theme');
    localStorage.setItem('theme', 'light');
    const themeBtn = document.getElementById('theme-toggle');
    if (themeBtn) themeBtn.textContent = '🌙';
  }
}

function toggleTheme() {
  const currentTheme = getCurrentTheme();
  setTheme(currentTheme === 'light' ? 'dark' : 'light');
}

document.addEventListener("DOMContentLoaded", () => {
  (async () => {
    let state = loadState() || createInitialState();

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

    const profileNameEl = document.getElementById("profile-name");
    const profileUsernameEl = document.getElementById("profile-username");
    const profileAvatarEl = document.getElementById("profile-avatar");
    const profileEditBtn = document.getElementById("profile-edit-btn");
    const profileFollowBtn = document.getElementById("profile-follow-btn");
    const profilePostsEl = document.getElementById("profile-posts");
    const profileComposerSection = document.getElementById("profile-composer");
    const profileComposerInput = document.getElementById("profile-composer-input");

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
    const clanTopListEl = document.getElementById("clan-top-list");

    let viewedProfileId = null;
    let currentFeedFilter = "all";
    let pendingAvatarRemove = false;

    // Инициализация темы
    const savedTheme = localStorage.getItem('theme') || 'light';
    setTheme(savedTheme);

    function getUser(id) {
      return state.users.find((u) => u.id === id) || null;
    }

    function getCurrentUser() {
      if (!state.currentUserId) return null;
      return getUser(state.currentUserId);
    }

    function setCurrentUser(userId) {
      state.currentUserId = userId;
      saveState(state);
      if (authOverlay) {
        authOverlay.classList.add("hidden");
      }
      viewedProfileId = userId;
      updateAllUI();
    }

    function setActivePage(pageName) {
      navItems.forEach((btn) => {
        const pageId = btn.getAttribute("data-page");
        if (pageId === pageName) {
          btn.classList.add("active");
        } else {
          btn.classList.remove("active");
        }
      });

      pages.forEach((page) => {
        if (page.id === `page-${pageName}`) {
          page.classList.add("page-active");
        } else {
          page.classList.remove("page-active");
        }
      });
    }

    function showAuthTab(tab) {
      authTabs.forEach((btn) => {
        const isActive = btn.dataset.authTab === tab;
        btn.classList.toggle("auth-tab-active", isActive);
      });
      if (!loginForm || !registerForm) return;
      if (tab === "login") {
        loginForm.classList.add("auth-form-active");
        registerForm.classList.remove("auth-form-active");
      } else {
        registerForm.classList.add("auth-form-active");
        loginForm.classList.remove("auth-form-active");
      }
      loginError.textContent = "";
      registerError.textContent = "";
    }

    function getFollowersCount(userId) {
      return state.users.filter((u) => (u.following || []).includes(userId)).length;
    }

    function getFriendIds(userId) {
      const user = getUser(userId);
      if (!user) return [];
      const following = user.following || [];
      return following.filter((fid) => {
        const other = getUser(fid);
        return other && (other.following || []).includes(userId);
      });
    }

    function renderTopClans() {
      if (!clanTopListEl) return;
      const counts = {};
      state.users.forEach((u) => {
        if (u.clan) {
          counts[u.clan] = (counts[u.clan] || 0) + 1;
        }
      });
      const entries = Object.entries(counts).sort((a, b) => b[1] - a[1]);

      clanTopListEl.innerHTML = "";
      if (!entries.length) {
        const span = document.createElement("span");
        span.className = "empty-text";
        span.textContent = "Пока никто не выбрал клан";
        clanTopListEl.appendChild(span);
        return;
      }

      entries.forEach(([name, count]) => {
        const btn = document.createElement("button");
        btn.className = "tag-pill";
        btn.textContent = `${name} · ${count} чел.`;
        clanTopListEl.appendChild(btn);
      });
    }

    function renderFeed() {
      if (!feedListEl) return;
      const current = getCurrentUser();
      let posts = [...state.posts];

      if (current) {
        const currentId = current.id;
        const followingSet = new Set(current.following || []);
        const friendsSet = new Set(getFriendIds(currentId));

        if (currentFeedFilter === "friends") {
          posts = posts.filter(
            (p) => friendsSet.has(p.authorId) || p.authorId === currentId
          );
        } else if (currentFeedFilter === "following") {
          posts = posts.filter(
            (p) => followingSet.has(p.authorId) || p.authorId === currentId
          );
        }
      }

      posts.sort((a, b) => b.createdAt - a.createdAt);

      feedListEl.innerHTML = "";

      posts.forEach((post) => {
        const author = getUser(post.authorId);
        if (!author) return;
        const isLiked = current ? post.likes.includes(current.id) : false;

        const postEl = document.createElement("article");
        postEl.className = "post";
        postEl.dataset.postId = String(post.id);

        postEl.innerHTML = `
        <header class="post-header">
          <div class="post-avatar js-profile-link" data-user-id="${author.id}">
            ${author.avatarUrl ? `<img src="${author.avatarUrl}" alt="" />` : author.displayName[0]?.toUpperCase() || "U"}
          </div>
          <div>
            <div class="post-author js-profile-link" data-user-id="${author.id}">
              ${author.displayName}
            </div>
            <div class="post-meta">
              ${timeAgo(post.createdAt)} • @${author.username}
            </div>
          </div>
          ${current && current.id === author.id ? `
            <button class="post-delete-btn js-delete-post" title="Удалить пост">🗑️</button>
          ` : ''}
        </header>
        <div class="post-content">
          <p class="post-text">${post.text}</p>
        </div>
        <footer class="post-footer">
          <button class="js-like-btn">${isLiked ? "❤" : "🤍"} ${post.likes.length}</button>
          <button class="js-comment-toggle">💬 ${post.comments.length}</button>
        </footer>
        <div class="comments" style="display:none">
          <div class="comments-list">
            ${post.comments
              .map((c) => {
                const cu = getUser(c.authorId);
                const name = cu ? cu.displayName : "Пользователь";
                return `<div class="comment-item">
                    <span class="comment-author js-profile-link" data-user-id="${c.authorId}">${name}</span>
                    <span class="comment-text">${c.text}</span>
                  </div>`;
              })
              .join("")}
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
      const current = getCurrentUser();
      const user = viewedProfileId ? getUser(viewedProfileId) : current;
      if (!user) return;

      if (profileNameEl) profileNameEl.textContent = user.displayName;
      if (profileUsernameEl) profileUsernameEl.textContent = `@${user.username}`;
      
      if (profileAvatarEl) {
        if (user.avatarUrl) {
          profileAvatarEl.innerHTML = `<img src="${user.avatarUrl}" alt="" />`;
        } else {
          profileAvatarEl.textContent = user.displayName[0]?.toUpperCase() || "U";
        }
      }

      const profileClanEl = document.getElementById('profile-clan');
      if (profileClanEl) {
        profileClanEl.textContent = user.clan ? user.clan : '';
      }

      const profileRegdate = document.getElementById('profile-regdate');
      if (profileRegdate) {
        const date = new Date(user.createdAt);
        const months = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 
                        'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];
        const month = months[date.getMonth()];
        const year = date.getFullYear();
        profileRegdate.textContent = `Регистрация: ${month} ${year} г.`;
      }

      const followersCount = getFollowersCount(user.id);
      const followingCount = (user.following || []).length;
      const postsCount = state.posts.filter(p => p.authorId === user.id).length;

      const postsCountEl = document.getElementById('profile-posts-count');
      const followersCountEl = document.getElementById('profile-followers-count');
      const followingCountEl = document.getElementById('profile-following-count');
      
      if (postsCountEl) postsCountEl.textContent = postsCount;
      if (followersCountEl) followersCountEl.textContent = followersCount;
      if (followingCountEl) followingCountEl.textContent = followingCount;

      const isOwn = current && current.id === user.id;
      
      const followBtn = document.getElementById('profile-follow-btn');
      const editBtn = document.getElementById('profile-edit-btn');
      const profileComposer = document.getElementById('profile-composer');
      
      if (followBtn) {
        if (!current || isOwn) {
          followBtn.style.display = 'none';
        } else {
          followBtn.style.display = 'block';
          const isFollowing = (current.following || []).includes(user.id);
          followBtn.textContent = isFollowing ? 'Отписаться' : 'Подписаться';
        }
      }
      
      if (editBtn) {
        editBtn.style.display = isOwn ? 'block' : 'none';
      }

      if (profileComposer) {
        profileComposer.style.display = isOwn ? 'flex' : 'none';
      }

      const profilePostsEl = document.getElementById('profile-posts');
      if (!profilePostsEl) return;

      const activeTab = document.querySelector('.profile-tab-active')?.dataset.profileTab || 'posts';
      
      let posts = [];
      if (activeTab === 'posts') {
        posts = state.posts
          .filter(p => p.authorId === user.id)
          .sort((a, b) => b.createdAt - a.createdAt);
      } else {
        posts = state.posts
          .filter(p => p.likes.includes(user.id))
          .sort((a, b) => b.createdAt - a.createdAt);
      }

      if (posts.length === 0) {
        profilePostsEl.innerHTML = `
          <div class="empty-state">
            <div class="empty-icon">📭</div>
            <p class="empty-title">Нет ${activeTab === 'posts' ? 'постов' : 'лайков'}</p>
            <p class="empty-text">
              ${current && current.id === user.id 
                ? activeTab === 'posts' 
                  ? 'Поделитесь своим первым постом!' 
                  : 'Здесь будут посты, которые вы лайкнули'
                : activeTab === 'posts'
                  ? 'У пользователя пока нет постов'
                  : 'Пользователь пока ничего не лайкнул'}
            </p>
          </div>
        `;
        return;
      }

      profilePostsEl.innerHTML = '';
      posts.forEach((post) => {
        const author = getUser(post.authorId);
        if (!author) return;
        
        const isLiked = current ? post.likes.includes(current.id) : false;
        
        const postEl = document.createElement('article');
        postEl.className = 'post';
        postEl.dataset.postId = String(post.id);

        postEl.innerHTML = `
          <header class="post-header">
            <div class="post-avatar js-profile-link" data-user-id="${author.id}">
              ${author.avatarUrl ? `<img src="${author.avatarUrl}" alt="" />` : author.displayName[0]?.toUpperCase() || "U"}
            </div>
            <div>
              <div class="post-author js-profile-link" data-user-id="${author.id}">
                ${author.displayName}
              </div>
              <div class="post-meta">
                ${timeAgo(post.createdAt)} • @${author.username}
              </div>
            </div>
            ${current && current.id === author.id ? `
              <button class="post-delete-btn js-delete-post" title="Удалить пост">🗑️</button>
            ` : ''}
          </header>
          <div class="post-content">
            <p class="post-text">${post.text}</p>
          </div>
          <footer class="post-footer">
            <button class="js-like-btn">${isLiked ? "❤" : "🤍"} ${post.likes.length}</button>
            <button class="js-comment-toggle">💬 ${post.comments.length}</button>
          </footer>
          <div class="comments" style="display:none">
            <div class="comments-list">
              ${post.comments
                .map((c) => {
                  const cu = getUser(c.authorId);
                  const name = cu ? cu.displayName : "Пользователь";
                  return `<div class="comment-item">
                      <span class="comment-author js-profile-link" data-user-id="${c.authorId}">${name}</span>
                      <span class="comment-text">${c.text}</span>
                    </div>`;
                })
                .join("")}
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

    function updateAllUI() {
      renderFeed();
      renderProfile();
      renderTopClans();
    }

    // Обработчики навигации
    navItems.forEach((btn) => {
      btn.addEventListener("click", () => {
        const pageId = btn.getAttribute("data-page");
        if (!pageId) return;
        setActivePage(pageId);
        if (pageId === "profile") {
          viewedProfileId = state.currentUserId;
          renderProfile();
        }
      });
    });

    // Обработчики вкладок ленты
    feedTabs.forEach((tab) => {
      tab.addEventListener("click", () => {
        feedTabs.forEach((t) => t.classList.remove("topbar-tab-active"));
        tab.classList.add("topbar-tab-active");
        const label = tab.textContent.trim();
        if (label.startsWith("Лента друзей")) {
          currentFeedFilter = "friends";
        } else if (label.startsWith("Подписки")) {
          currentFeedFilter = "following";
        } else {
          currentFeedFilter = "all";
        }
        renderFeed();
      });
    });

    // Обработчики темы
    const themeToggle = document.getElementById('theme-toggle');
    if (themeToggle) {
      themeToggle.addEventListener('click', toggleTheme);
    }

    // Обработчики авторизации
    document
      .querySelectorAll("[data-auth-tab-switch]")
      .forEach((btn) =>
        btn.addEventListener("click", () =>
          showAuthTab(btn.getAttribute("data-auth-tab-switch"))
        )
      );

    authTabs.forEach((btn) => {
      btn.addEventListener("click", () => {
        showAuthTab(btn.dataset.authTab);
      });
    });

    loginForm?.addEventListener("submit", async (e) => {
      e.preventDefault();
      if (!loginForm) return;
      const username = document.getElementById("login-username").value.trim();
      const password = document.getElementById("login-password").value.trim();
      loginError.textContent = "";

      const user = state.users.find(
        (u) => u.username.toLowerCase() === username.toLowerCase()
      );
      if (!user) {
        loginError.textContent = "Пользователь не найден";
        return;
      }

      if (!password || password.length < 6) {
        loginError.textContent = "Пароль слишком короткий.";
        return;
      }

      if (user.passwordSalt) {
        const hash = await hashPassword(password, user.passwordSalt);
        if (user.passwordHash !== hash) {
          loginError.textContent = "Неверный пароль";
          return;
        }
      } else if (user.passwordHash) {
        const legacyHash = await hashPasswordLegacy(password);
        if (legacyHash !== user.passwordHash) {
          loginError.textContent = "Неверный пароль";
          return;
        }
        const salt = generateSalt();
        user.passwordSalt = salt;
        user.passwordHash = await hashPassword(password, salt);
        saveState(state);
      } else {
        const salt = generateSalt();
        user.passwordSalt = salt;
        user.passwordHash = await hashPassword(password, salt);
        saveState(state);
      }
      setCurrentUser(user.id);
    });

    registerForm?.addEventListener("submit", async (e) => {
      e.preventDefault();
      const displayName = document.getElementById("reg-displayname").value.trim();
      const username = document.getElementById("reg-username").value.trim();
      const avatarFileInput = document.getElementById("reg-avatar-file");
      const avatarFile = avatarFileInput?.files?.[0] || null;
      const password = document.getElementById("reg-password").value.trim();
      registerError.textContent = "";

      if (!displayName || !username || !password) {
        registerError.textContent = "Заполните все обязательные поля.";
        return;
      }

      if (password.length < 6) {
        registerError.textContent = "Пароль должен быть не короче 6 символов.";
        return;
      }

      if (!/[A-Za-zА-Яа-я]/.test(password) || !/\d/.test(password)) {
        registerError.textContent =
          "Пароль должен содержать буквы и цифры.";
        return;
      }

      if (state.users.some((u) => u.username.toLowerCase() === username.toLowerCase())) {
        registerError.textContent = "Этот юзернейм уже занят.";
        return;
      }

      let avatarUrl = "";
      if (avatarFile) {
        if (avatarFile.size > 1024 * 1024) {
          registerError.textContent = "Размер аватарки не должен превышать 1 МБ.";
          return;
        }
        try {
          avatarUrl = await fileToDataUrl(avatarFile);
        } catch {
          registerError.textContent = "Не удалось загрузить аватарку.";
          return;
        }
      }

      const salt = generateSalt();
      const passwordHash = await hashPassword(password, salt);

      const newUser = {
        id: state.nextUserId++,
        displayName,
        username,
        avatarUrl,
        createdAt: Date.now(),
        passwordHash,
        passwordSalt: salt,
        following: [],
      };
      state.users.push(newUser);
      saveState(state);
      setCurrentUser(newUser.id);
    });

    function handlePublishPost(source) {
      const current = getCurrentUser();
      if (!current) return;
      const textarea =
        source === "feed" ? feedComposerInput : profileComposerInput;
      if (!textarea) return;
      const text = textarea.value.trim();
      if (!text) return;

      const post = {
        id: state.nextPostId++,
        authorId: current.id,
        text,
        createdAt: Date.now(),
        likes: [],
        comments: [],
      };
      state.posts.push(post);
      saveState(state);
      textarea.value = "";
      updateAllUI();
    }

    feedPublishBtn?.addEventListener("click", () => handlePublishPost("feed"));
    profileComposerSection
      ?.querySelector("#profile-publish-btn")
      ?.addEventListener("click", () => handlePublishPost("profile"));

    function toggleLike(postId) {
      const current = getCurrentUser();
      if (!current) return;
      const post = state.posts.find((p) => p.id === postId);
      if (!post) return;
      const idx = post.likes.indexOf(current.id);
      if (idx === -1) post.likes.push(current.id);
      else post.likes.splice(idx, 1);
      saveState(state);
      updateAllUI();
    }
    
    function addComment(postId, text) {
      const current = getCurrentUser();
      if (!current) return;
      const post = state.posts.find((p) => p.id === postId);
      if (!post) return;
      post.comments.push({
        id: state.nextCommentId++,
        authorId: current.id,
        text,
        createdAt: Date.now(),
      });
      saveState(state);
      updateAllUI();
    }
    
    function deletePost(postId) {
      const current = getCurrentUser();
      if (!current) return;
      
      const postIndex = state.posts.findIndex(p => p.id === postId);
      if (postIndex === -1) return;
      
      const post = state.posts[postIndex];
      
      if (post.authorId !== current.id) {
        alert("Нельзя удалить чужой пост!");
        return;
      }
      
      if (confirm("Вы уверены, что хотите удалить этот пост?")) {
        state.posts.splice(postIndex, 1);
        saveState(state);
        updateAllUI();
      }
    }

    function handleFeedClick(container, event) {
      const target = event.target;
      const postEl = target.closest(".post");
      if (!postEl) return;
      const postId = Number(postEl.dataset.postId);

      if (target.classList.contains("js-like-btn")) {
        toggleLike(postId);
        return;
      }

      if (target.classList.contains("js-delete-post") || target.closest(".js-delete-post")) {
        deletePost(postId);
        return;
      }

      if (
        target.classList.contains("js-comment-toggle") ||
        target.closest(".js-comment-toggle")
      ) {
        const commentsEl = postEl.querySelector(".comments");
        if (commentsEl) {
          commentsEl.style.display =
            commentsEl.style.display === "none" || !commentsEl.style.display
              ? "block"
              : "none";
        }
        return;
      }

      if (
        target.classList.contains("js-comment-send") ||
        target.closest(".js-comment-send")
      ) {
        const row = target.closest(".comment-input-row");
        const input = row?.querySelector("input");
        const text = input?.value.trim();
        if (text) {
          addComment(postId, text);
        }
        return;
      }

      if (
        target.classList.contains("js-profile-link") ||
        target.closest(".js-profile-link")
      ) {
        const el = target.closest(".js-profile-link");
        const userId = Number(el.dataset.userId);
        if (userId) {
          viewedProfileId = userId;
          setActivePage("profile");
          renderProfile();
        }
      }
    }

    feedListEl?.addEventListener("click", (e) => handleFeedClick(feedListEl, e));
    profilePostsEl?.addEventListener("click", (e) =>
      handleFeedClick(profilePostsEl, e)
    );

    // Обработчики для вкладок профиля
    const profileTabs = document.querySelectorAll('.profile-tab');
    if (profileTabs.length > 0) {
      profileTabs.forEach(tab => {
        tab.addEventListener('click', () => {
          profileTabs.forEach(t => t.classList.remove('profile-tab-active'));
          tab.classList.add('profile-tab-active');
          renderProfile();
        });
      });
    }

    function openProfileModal() {
      const current = getCurrentUser();
      if (!current) return;
      editDisplayInput.value = current.displayName;
      editUsernameInput.value = current.username;
      if (editClanSelect) {
        editClanSelect.value = current.clan || "";
      }
      if (editAvatarFileInput) {
        editAvatarFileInput.value = "";
      }
      pendingAvatarRemove = false;
      profileEditError.textContent = "";
      profileModalBackdrop.classList.add("visible");
    }

    function closeProfileModal() {
      profileModalBackdrop.classList.remove("visible");
    }

    profileEditBtn?.addEventListener("click", openProfileModal);
    profileModalClose?.addEventListener("click", closeProfileModal);
    profileModalCancel?.addEventListener("click", closeProfileModal);

    editAvatarRemoveBtn?.addEventListener("click", () => {
      pendingAvatarRemove = true;
      if (editAvatarFileInput) {
        editAvatarFileInput.value = "";
      }
    });

    profileEditForm?.addEventListener("submit", (e) => {
      e.preventDefault();
      const current = getCurrentUser();
      if (!current) return;
      const displayName = editDisplayInput.value.trim();
      const username = editUsernameInput.value.trim();
      const clan = editClanSelect ? editClanSelect.value : "";
      profileEditError.textContent = "";

      if (!displayName || !username) {
        profileEditError.textContent = "Имя и юзернейм обязательны.";
        return;
      }

      if (
        state.users.some(
          (u) =>
            u.id !== current.id && u.username.toLowerCase() === username.toLowerCase()
        )
      ) {
        profileEditError.textContent = "Такой юзернейм уже занят.";
        return;
      }

      const clearAvatar = pendingAvatarRemove;

      const applyUpdate = (avatarUrl) => {
        current.displayName = displayName;
        current.username = username;
        current.clan = clan || null;
        if (clearAvatar) {
          current.avatarUrl = "";
        } else if (avatarUrl !== null) {
          current.avatarUrl = avatarUrl;
        }
        saveState(state);
        closeProfileModal();
        updateAllUI();
      };

      const avatarFile = editAvatarFileInput?.files?.[0] || null;
      if (avatarFile && !clearAvatar) {
        if (avatarFile.size > 1024 * 1024) {
          profileEditError.textContent = "Размер аватарки не должен превышать 1 МБ.";
          return;
        }
        fileToDataUrl(avatarFile)
          .then((url) => applyUpdate(url))
          .catch(() => {
            profileEditError.textContent = "Не удалось загрузить аватарку.";
          });
      } else {
        applyUpdate(null);
      }
    });

    const sidebarLogout = document.querySelector(".sidebar-logout");
    sidebarLogout?.addEventListener("click", () => {
      state.currentUserId = null;
      saveState(state);
      if (authOverlay) {
        authOverlay.classList.remove("hidden");
        showAuthTab("login");
      }
    });

    // Функционал эмодзи
    function initEmojiPicker() {
      const emojiBtn = document.getElementById('emoji-picker-btn');
      if (!emojiBtn) return;
      
      const emojis = [
        '😊', '😂', '🤣', '❤️', '😍', '😒', '👌', '👍',
        '🔥', '🎉', '✨', '⭐', '💯', '✅', '❌', '💔',
        '😢', '😭', '😘', '😁', '🤔', '😎', '🙄', '😴',
        '🎓', '📚', '✏️', '📝', '💻', '📱', '🎮', '🏀'
      ];
      
      const emojiPanel = document.createElement('div');
      emojiPanel.className = 'emoji-panel';
      emojiPanel.style.display = 'none';
      
      emojis.forEach(emoji => {
        const btn = document.createElement('button');
        btn.textContent = emoji;
        btn.type = 'button';
        btn.addEventListener('click', (e) => {
          e.preventDefault();
          e.stopPropagation();
          insertEmoji(emoji);
        });
        emojiPanel.appendChild(btn);
      });
      
      const composerMain = document.querySelector('.composer-main');
      if (composerMain) {
        composerMain.appendChild(emojiPanel);
      }
      
      emojiBtn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (emojiPanel.style.display === 'none') {
          emojiPanel.style.display = 'grid';
        } else {
          emojiPanel.style.display = 'none';
        }
      });
      
      document.addEventListener('click', (e) => {
        if (!emojiBtn.contains(e.target) && !emojiPanel.contains(e.target)) {
          emojiPanel.style.display = 'none';
        }
      });
      
      function insertEmoji(emoji) {
        const activeInput = document.activeElement;
        if (activeInput === feedComposerInput || activeInput === profileComposerInput) {
          const start = activeInput.selectionStart;
          const end = activeInput.selectionEnd;
          const text = activeInput.value;
          activeInput.value = text.substring(0, start) + emoji + text.substring(end);
          activeInput.selectionStart = activeInput.selectionEnd = start + emoji.length;
          activeInput.focus();
        } else if (feedComposerInput) {
          feedComposerInput.value += emoji;
          feedComposerInput.focus();
        }
        emojiPanel.style.display = 'none';
      }
    }

    // Запускаем инициализацию эмодзи
    initEmojiPicker();

    const loginUser = getCurrentUser();
    if (!loginUser) {
      if (authOverlay) authOverlay.classList.remove("hidden");
      showAuthTab("login");
    } else {
      if (authOverlay) authOverlay.classList.add("hidden");
      viewedProfileId = loginUser.id;
      updateAllUI();
    }
  })();
});