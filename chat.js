
const $ = id => document.getElementById(id);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

let session;
let me;
let activeConversation = null;
let activeContact = null;
let pollHandle = null;

function setStatus(text) {
  $("status").textContent = text;
}

function getToken() {
  return session?.access_token || "";
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(getToken() ? { Authorization: `Bearer ${getToken()}` } : {}),
      ...(options.headers || {})
    }
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || "Une erreur est survenue.");
  return data;
}

function showMessage(message, mine) {
  const bubble = document.createElement("div");
  bubble.className = "bubble" + (mine ? " mine" : "");

  const content = document.createElement("div");
  content.textContent = message.content || "";
  bubble.appendChild(content);

  const time = document.createElement("small");
  time.textContent = message.created_at
    ? new Date(message.created_at).toLocaleTimeString([], {
        hour: "2-digit", minute: "2-digit"
      })
    : "";
  bubble.appendChild(time);

  bubble.dataset.id = message.id || "";
  $("messages").appendChild(bubble);
}

function renderMessages(messages) {
  $("messages").replaceChildren();
  for (const message of messages) {
    showMessage(message, message.sender_id === me.id);
  }
  $("messages").scrollTop = $("messages").scrollHeight;
}

async function loadMessages() {
  if (!activeConversation) return;

  try {
    const data = await api(
      `/api/messages?conversation_id=${encodeURIComponent(activeConversation)}`
    );
    if (data.success) {
      renderMessages(data.messages || []);
    }
  } catch (error) {
    setStatus(error.message);
  }
}

async function openContact(username) {
  try {
    setStatus("Recherche du contact…");

    const profile = await api(
      `/api/profile?username=${encodeURIComponent(username)}`
    );

    const contact = profile.profile || profile.user || profile;
    const contactId = contact.id;

    if (!contactId || contactId === me.id) {
      throw new Error("Contact invalide ou identique à ton compte.");
    }

    const result = await api("/api/conversation-create", {
      method: "POST",
      body: JSON.stringify({ user_id: contactId })
    });

    const conversation = result.conversation || result;
    const conversationId = conversation.id || conversation.conversation_id;

    if (!UUID.test(conversationId || "")) {
      throw new Error("La réponse de création de conversation est invalide.");
    }

    activeConversation = conversationId;
    activeContact = username;
    $("chatTitle").textContent = username;
    $("chatSubtitle").textContent = "Discussion privée";
    $("messages").replaceChildren();

    if (pollHandle) clearInterval(pollHandle);
    await loadMessages();

    // Repli temporaire : vérifie les nouveaux messages toutes les 3 secondes.
    // Ce n'est pas encore Supabase Realtime.
    pollHandle = setInterval(loadMessages, 3000);
    setStatus("Discussion ouverte.");
  } catch (error) {
    setStatus(error.message);
  }
}

$("contactForm").addEventListener("submit", async event => {
  event.preventDefault();
  const username = $("contactUsername").value.trim().toLowerCase();
  if (!/^[a-z0-9_]{3,24}$/.test(username)) {
    setStatus("Pseudo invalide.");
    return;
  }
  await openContact(username);
});

$("composer").addEventListener("submit", async event => {
  event.preventDefault();

  if (!activeConversation) {
    setStatus("Ouvre d'abord une discussion.");
    return;
  }

  const content = $("messageInput").value.trim();
  if (!content) return;

  $("sendButton").disabled = true;

  try {
    const result = await api("/api/messages", {
      method: "POST",
      body: JSON.stringify({
        conversation_id: activeConversation,
        content
      })
    });

    $("messageInput").value = "";
    if (result.message) await loadMessages();
    setStatus("Message envoyé.");
  } catch (error) {
    setStatus(error.message);
  } finally {
    $("sendButton").disabled = false;
  }
});

$("logout").addEventListener("click", async () => {
  try {
    await api("/api/logout", { method: "POST", body: "{}" });
  } catch {}
  sessionStorage.removeItem("nexora_session");
  sessionStorage.removeItem("nexora_user");
  window.location.replace("/");
});

async function init() {
  try {
    session = JSON.parse(sessionStorage.getItem("nexora_session") || "null");
    me = JSON.parse(sessionStorage.getItem("nexora_user") || "null");

    if (!session?.access_token || !me?.id) {
      window.location.replace("/");
      return;
    }

    // Vérifie la session avec l'API de profil.
    const profileData = await api("/api/profile");
    const profile = profileData.profile || profileData.user || profileData;
    me = { ...me, ...profile };
    $("myUsername").textContent = me.username || "Utilisateur";
    setStatus("Connecté. Ouvre une discussion avec un pseudo.");

  } catch (error) {
    setStatus(error.message);
    if (/session|jeton|token|authentification/i.test(error.message)) {
      sessionStorage.removeItem("nexora_session");
      sessionStorage.removeItem("nexora_user");
      window.location.replace("/");
    }
  }
}

init();
