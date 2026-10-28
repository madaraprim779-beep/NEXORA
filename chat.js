
"use strict";

/* =========================================
   NEXORA PRO — MESSAGERIE
   Authentification gérée par /api/auth
   ========================================= */

const API = Object.freeze({
  profile: "/api/profile",
  contacts: "/api/contacts",
  conversations: "/api/conversations",
  createConversation: "/api/conversation-create",
  messages: "/api/messages",
  logout: "/api/logout"
});

const sessionToken = sessionStorage.getItem("nexora_session");

let currentUser = readStoredUser();
let currentConversation = null;
let currentContact = null;
let refreshInterval = null;
let loadingMessages = false;
let messageRequestVersion = 0;
let lastMessageSignature = "";
let sendingMessage = false;
let isLoggingOut = false;

/* ---------- UTILITAIRES ---------- */

function readStoredUser() {
  try {
    return JSON.parse(sessionStorage.getItem("nexora_user") || "null");
  } catch {
    return null;
  }
}

function getElement(...ids) {
  for (const id of ids) {
    const element = document.getElementById(id);
    if (element) return element;
  }
  return null;
}

function setStatus(message, type = "info") {
  const element = getElement("statusMessage", "status", "notice");

  if (!element) {
    console.log(`[NEXORA ${type}] ${message}`);
    return;
  }

  element.textContent = message;
  element.dataset.type = type;
  element.hidden = false;
}

function clearStatus() {
  const element = getElement("statusMessage", "status", "notice");
  if (element) {
    element.textContent = "";
    element.hidden = true;
  }
}

function getUserId(user) {
  return user?.id ||
    user?.user_id ||
    user?.user?.id ||
    null;
}

function getUsername(user) {
  return user?.username ||
    user?.profile?.username ||
    user?.user?.user_metadata?.username ||
    "Membre NEXORA";
}

function getConversationId(conversation) {
  return conversation?.id ||
    conversation?.conversation_id ||
    conversation?.conversation?.id ||
    null;
}

function getContacts(data) {
  if (Array.isArray(data)) return data;
  if (Array.isArray(data?.contacts)) return data.contacts;
  if (Array.isArray(data?.profiles)) return data.profiles;
  if (Array.isArray(data?.results)) return data.results;
  if (Array.isArray(data?.data)) return data.data;
  return [];
}

function getMessages(data) {
  if (Array.isArray(data)) return data;
  if (Array.isArray(data?.messages)) return data.messages;
  if (Array.isArray(data?.data?.messages)) {
    return data.data.messages;
  }
  return [];
}

function getErrorMessage(error) {
  return error?.message || "Une erreur est survenue.";
}

/* ---------- REQUÊTES API ---------- */

async function apiRequest(url, options = {}) {
  if (!sessionToken) {
    throw new Error("Session absente. Reconnecte-toi.");
  }

  const response = await fetch(url, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${sessionToken}`,
      ...options.headers
    },
    cache: "no-store"
  });

  const data = await response.json().catch(() => ({}));

  if (response.status === 401 || response.status === 403) {
    throw new Error(
      data.error || "Session invalide ou accès refusé. Reconnecte-toi."
    );
  }

  if (!response.ok || data.success === false) {
    throw new Error(
      data.error || `Erreur serveur (${response.status}).`
    );
  }

  return data;
}

/* ---------- PROFIL ---------- */

async function loadProfile() {
  const data = await apiRequest(API.profile);

  currentUser = data.profile || data.user || data;

  if (!getUserId(currentUser)) {
    throw new Error("Le profil reçu ne contient aucun identifiant utilisateur.");
  }

  sessionStorage.setItem("nexora_user", JSON.stringify(currentUser));

  const username = getUsername(currentUser);

  const profileElement = getElement(
    "profileUsername",
    "currentUsername",
    "myUsername"
  );

  if (profileElement) {
    profileElement.textContent = username;
  }

  const avatar = getElement("profileAvatar", "myAvatar");
  if (avatar) {
    avatar.textContent = username.charAt(0).toUpperCase();
  }

  return currentUser;
}

/* ---------- RECHERCHE DE MEMBRES ---------- */

function renderContact(contact) {
  const list = getElement("contactsList", "contacts", "contactList");
  if (!list) return;

  const userId = getUserId(contact);

  if (!userId || userId === getUserId(currentUser)) return;

  const username = getUsername(contact);
  const displayName = contact.display_name || username;

  const button = document.createElement("button");
  button.type = "button";
  button.className = "contact-item";

  const avatar = document.createElement("span");
  avatar.className = "contact-avatar";
  avatar.textContent = displayName.charAt(0).toUpperCase();

  const details = document.createElement("span");
  details.className = "contact-details";

  const name = document.createElement("span");
  name.className = "contact-name";
  name.textContent = displayName;

  const handle = document.createElement("span");
  handle.className = "contact-username";
  handle.textContent = `@${username}`;

  details.append(name, handle);
  button.append(avatar, details);

  button.addEventListener("click", () => {
    startConversation(userId, contact);
  });

  list.appendChild(button);
}

async function searchContacts(query) {
  const normalized = String(query || "").trim();

  if (normalized.length < 3) {
    setStatus("Saisis au moins 3 caractères pour rechercher un membre.");
    return;
  }

  const list = getElement("contactsList", "contacts", "contactList");

  if (list) list.replaceChildren();

  setStatus("Recherche des membres…");

  try {
    const url = `${API.contacts}?q=${encodeURIComponent(normalized)}`;
    const data = await apiRequest(url);
    const contacts = getContacts(data).filter(
      contact => getUserId(contact) !== getUserId(currentUser)
    );

    if (!contacts.length) {
      setStatus("Aucun membre trouvé.");
      return;
    }

    contacts.forEach(renderContact);
    setStatus(`${contacts.length} membre(s) trouvé(s).`);
  } catch (error) {
    setStatus(getErrorMessage(error), "error");
  }
}

/* ---------- CONVERSATIONS ---------- */

async function startConversation(contactId, contact) {
  if (!contactId) {
    setStatus("Identifiant du membre manquant.", "error");
    return;
  }

  try {
    setStatus("Ouverture de la conversation…");

    const data = await apiRequest(API.createConversation, {
      method: "POST",
      body: JSON.stringify({ contact_id: contactId })
    });

    const conversation = data.conversation || data;
    const conversationId = getConversationId(conversation);

    if (!conversationId) {
      throw new Error(
        "L'API n'a pas renvoyé l'identifiant de la conversation."
      );
    }

    currentConversation = conversationId;
    currentContact = contact || conversation;

    lastMessageSignature = "";
    messageRequestVersion++;

    const title = getElement(
      "chatTitle",
      "conversationTitle",
      "contactName"
    );

    if (title) {
      title.textContent =
        currentContact.display_name ||
        getUsername(currentContact);
    }

    const list = getElement(
      "messagesList",
      "messages",
      "chatMessages"
    );

    if (list) list.replaceChildren();

    await loadMessages();
    await loadConversations();

    setStatus("Conversation ouverte.");
  } catch (error) {
    setStatus(getErrorMessage(error), "error");
  }
}

function renderConversation(conversation) {
  const list = getElement(
    "conversationsList",
    "conversationList"
  );

  if (!list) return;

  const conversationId = getConversationId(conversation);
  if (!conversationId) return;

  const button = document.createElement("button");
  button.type = "button";
  button.className = "contact-item";

  const name =
    conversation.display_name ||
    conversation.username ||
    conversation.other_username ||
    "Conversation";

  const avatar = document.createElement("span");
  avatar.className = "contact-avatar";
  avatar.textContent = name.charAt(0).toUpperCase();

  const details = document.createElement("span");
  details.className = "contact-details";

  const title = document.createElement("span");
  title.className = "contact-name";
  title.textContent = name;

  details.appendChild(title);
  button.append(avatar, details);

  if (String(conversationId) === String(currentConversation)) {
    button.classList.add("active");
    button.setAttribute("aria-current", "true");
  }

  button.addEventListener("click", async () => {
    currentConversation = conversationId;
    currentContact = conversation;
    lastMessageSignature = "";
    messageRequestVersion++;

    const chatTitle = getElement(
      "chatTitle",
      "conversationTitle",
      "contactName"
    );

    if (chatTitle) chatTitle.textContent = name;

    const messagesList = getElement(
      "messagesList",
      "messages",
      "chatMessages"
    );

    if (messagesList) messagesList.replaceChildren();

    await loadMessages();
    await loadConversations();
  });

  list.appendChild(button);
}

async function loadConversations() {
  try {
    const data = await apiRequest(API.conversations);
    const conversations = Array.isArray(data.conversations)
      ? data.conversations
      : [];

    const list = getElement(
      "conversationsList",
      "conversationList"
    );

    if (!list) return;

    list.replaceChildren();

    if (!conversations.length) {
      const empty = document.createElement("p");
      empty.className = "empty-conversations";
      empty.textContent = "Aucune conversation pour le moment.";
      list.appendChild(empty);
      return;
    }

    conversations.forEach(renderConversation);
  } catch (error) {
    console.warn("Chargement des conversations :", error.message);
  }
}

/* ---------- MESSAGES ---------- */

function renderMessage(message) {
  const list = getElement(
    "messagesList",
    "messages",
    "chatMessages"
  );

  if (!list) return;

  const senderId = message.sender_id || message.senderId;
  const ownMessage =
    String(senderId) === String(getUserId(currentUser));

  const article = document.createElement("article");
  article.className = ownMessage
    ? "message message-own"
    : "message message-other";

  const body = document.createElement("p");
  body.className = "message-content";
  body.textContent = String(message.content ?? "");

  const time = document.createElement("time");

  if (message.created_at) {
    const date = new Date(message.created_at);

    if (!Number.isNaN(date.getTime())) {
      time.textContent = date.toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit"
      });

      time.dateTime = date.toISOString();
    }
  }

  article.append(body, time);
  list.appendChild(article);
}

function renderMessages(messages) {
  const list = getElement(
    "messagesList",
    "messages",
    "chatMessages"
  );

  if (!list) return;

  const signature = messages
    .map(message =>
      `${message.id || ""}:${message.created_at || ""}:${message.content || ""}`
    )
    .join("|");

  if (signature === lastMessageSignature) return;

  const wasNearBottom =
    list.scrollHeight - list.scrollTop - list.clientHeight < 120;

  list.replaceChildren();

  if (!messages.length) {
    const empty = document.createElement("p");
    empty.className = "empty-messages";
    empty.textContent =
      "Aucun message pour le moment. Envoie le premier message !";

    list.appendChild(empty);
  } else {
    messages.forEach(renderMessage);
  }

  lastMessageSignature = signature;

  if (wasNearBottom || messages.length <= 1) {
    list.scrollTop = list.scrollHeight;
  }
}

async function loadMessages() {
  if (!currentConversation || loadingMessages) return;

  const conversationAtStart = currentConversation;
  const requestVersion = messageRequestVersion;

  loadingMessages = true;

  try {
    const url =
      `${API.messages}?conversation_id=` +
      encodeURIComponent(conversationAtStart);

    const data = await apiRequest(url);

    // Empêche une ancienne réponse d'écraser la conversation ouverte ensuite.
    if (
      requestVersion !== messageRequestVersion ||
      String(conversationAtStart) !== String(currentConversation)
    ) {
      return;
    }

    const messages = getMessages(data);
    renderMessages(messages);
  } catch (error) {
    setStatus(getErrorMessage(error), "error");
  } finally {
    loadingMessages = false;
  }
}

async function sendMessage(event) {
  if (event) event.preventDefault();

  if (sendingMessage) return;

  const input = getElement(
    "messageInput",
    "message",
    "messageText"
  );

  const content = input?.value?.trim();

  if (!currentConversation) {
    setStatus("Choisis d'abord une conversation.");
    return;
  }

  if (!content) return;

  if (content.length > 5000) {
    setStatus("Le message ne peut pas dépasser 5000 caractères.", "error");
    return;
  }

  const conversationAtSend = currentConversation;
  const sendButton = getElement(
    "sendButton",
    "sendMessageButton"
  );

  sendingMessage = true;
  if (sendButton) sendButton.disabled = true;

  try {
    await apiRequest(API.messages, {
      method: "POST",
      body: JSON.stringify({
        conversation_id: conversationAtSend,
        content
      })
    });

    if (
      input &&
      input.value.trim() === content &&
      currentConversation === conversationAtSend
    ) {
      input.value = "";
    }

    if (currentConversation === conversationAtSend) {
      lastMessageSignature = "";
      await loadMessages();
    }

    clearStatus();
  } catch (error) {
    setStatus(getErrorMessage(error), "error");
  } finally {
    sendingMessage = false;
    if (sendButton) sendButton.disabled = false;
  }
}

/* ---------- DÉCONNEXION ---------- */

async function logout() {
  if (isLoggingOut) return;
  isLoggingOut = true;

  if (refreshInterval) {
    clearInterval(refreshInterval);
    refreshInterval = null;
  }

  const logoutButton = getElement("logoutButton", "logoutBtn");
  if (logoutButton) logoutButton.disabled = true;

  try {
    await apiRequest(API.logout, {
      method: "POST",
      body: JSON.stringify({})
    });
  } catch (error) {
    console.warn("Déconnexion serveur :", error.message);
  } finally {
    sessionStorage.removeItem("nexora_session");
    sessionStorage.removeItem("nexora_user");
    window.location.replace("/");
  }
}

/* ---------- ÉVÉNEMENTS ---------- */

function connectEvents() {
  const searchForm = getElement(
    "contactSearchForm",
    "searchContactForm"
  );

  const searchInput = getElement(
    "contactSearchInput",
    "searchContactInput",
    "contactInput"
  );

  if (searchForm && searchInput) {
    searchForm.addEventListener("submit", event => {
      event.preventDefault();
      searchContacts(searchInput.value);
    });
  }

  const sendForm = getElement(
    "messageForm",
    "sendMessageForm"
  );

  if (sendForm) {
    sendForm.addEventListener("submit", sendMessage);
  } else {
    const sendButton = getElement(
      "sendButton",
      "sendMessageButton"
    );

    if (sendButton) {
      sendButton.addEventListener("click", sendMessage);
    }
  }

  const logoutButton = getElement(
    "logoutButton",
    "logoutBtn"
  );

  if (logoutButton) {
    logoutButton.addEventListener("click", logout);
  }

  const searchClear = getElement("clearSearch", "clearSearchButton");

  if (searchClear && searchInput) {
    searchClear.addEventListener("click", () => {
      searchInput.value = "";
      const list = getElement("contactsList", "contacts", "contactList");
      if (list) list.replaceChildren();
      clearStatus();
    });
  }
}

/* ---------- DÉMARRAGE ---------- */

async function initChat() {
  if (!sessionToken || !currentUser) {
    window.location.replace("/");
    return;
  }

  connectEvents();

  try {
    await loadProfile();
    await loadConversations();

    refreshInterval = setInterval(() => {
      if (document.visibilityState === "visible") {
        loadMessages();
        loadConversations();
      }
    }, 5000);
  } catch (error) {
    setStatus(getErrorMessage(error), "error");
  }
}

document.addEventListener("DOMContentLoaded", initChat);
