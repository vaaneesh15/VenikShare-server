// После currentUser добавим
let currentUserId = null;
let currentUserIsAdmin = false;

// Функция проверки админа
async function checkIsAdmin(username) {
  try {
    const res = await fetch(API_BASE + '/api/user/isadmin?username=' + username);
    const data = await res.json();
    return data.admin;
  } catch {
    return false;
  }
}

// Функция получения своего ID
async function fetchMyId(username) {
  try {
    const res = await fetch(API_BASE + '/api/user/id/' + username + '?requester=' + username);
    const data = await res.json();
    return data.id;
  } catch {
    return null;
  }
}

// В login после успешного входа
currentUser = { username };
const userData = await res.json(); // предположим, сервер возвращает userId
currentUserId = userData.userId;
currentUserIsAdmin = await checkIsAdmin(username);
// сохраняем в localStorage
localStorage.setItem('chatxUser', JSON.stringify({ username, userId: currentUserId, isAdmin: currentUserIsAdmin }));

// При загрузке из localStorage
const saved = JSON.parse(localStorage.getItem('chatxUser'));
if (saved) {
  currentUser = { username: saved.username };
  currentUserId = saved.userId;
  currentUserIsAdmin = saved.isAdmin;
}

// В профиле отображаем ID
// добавим элемент в HTML профиля
<div style="margin-bottom: 8px;">
  <span style="color: var(--text-primary);">ID: </span>
  <span style="color: var(--accent);" id="profile-user-id"></span>
</div>

// И заполняем
document.getElementById('profile-user-id').textContent = currentUserId;

// При открытии профиля другого пользователя
async function openUserProfile(username) {
  userProfileName.textContent = username;
  // Получаем статус и ID
  const isAdminViewer = currentUserIsAdmin;
  let userId = null;
  if (isAdminViewer || username === currentUser.username) {
    try {
      const res = await fetch(API_BASE + '/api/user/id/' + username + '?requester=' + currentUser.username);
      const data = await res.json();
      userId = data.id;
    } catch {}
  }
  // Отображаем ID только для админа или себя
  const userIdHtml = userId ? `<div><strong>ID:</strong> ${userId}</div>` : '';
  // ... остальной код
}
