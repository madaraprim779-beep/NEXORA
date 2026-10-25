
const API = {
  profile: "/api/profile",
  contacts: "/api/contacts",
  conversations: "/api/conversations",
  createConversation: "/api/conversation-create",
  messages: "/api/messages",
  logout: "/api/logout"
};

const sessionToken = sessionStorage.getItem("nexora_session");
let currentUser = readStoredUser();
let currentConversation = null;
let currentContact = null;
let refreshInterval = null;
let loadingMessages = false;
let lastMessageSignature = "";

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
    console.log(`[NEXORA ${type}]`, message);
    return;
  }

  element.textContent = message;
  element.dataset.type = type;
  element.hidden = false;
}

function escapeText(value) {
  return String(value ?? "");
}

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

  if (!response.ok || data.success === false) {
    throw new Error(data.error || "Une erreur est survenue.");
  }

  return data;
}

function getUserId(user) {
  return user?.id || user?.user_id || user?.user?.id || null;
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

function getMessages(data) {
  if (Array.isArray(data.messages)) return data.messages;
  if (Array.isArray(data.data?.messages)) return data.data.messages;
  return [];
}

function getContacts(data) {
  if (Array.isArray(data.contacts)) return data.contacts;
  if (Array.isArray(data.profiles)) return data.profiles;
  if (Array.isArray(data.results)) return data.results;
  if (Array.isArray(data.data)) return data.data;
  return [];
}

function renderMessage(message) {
  const list = getElement("messagesList", "messages", "chatMessages");
  if (!list) return;

  const item = document.createElement("article");
  const senderId = message.sender_id || message.senderId;
  const ownMessage = senderId === getUserId(currentUser);

  item.className = ownMessage ? "message message-own" : "message message-other";

  const body = document.createElement("p");
  body.textContent = escapeText(message.content);
  item.appendChild(body);

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
  item.appendChild(time);
  list.appendChild(item);
}

function renderMessages(messages) {
  const list = getElement("messagesList", "messages", "chatMessages");
  if (!list) return;

  const signature = messages
    .map(message => `${message.id || ""}:${message.created_at || ""}`)
    .join("|");

  if (signature === lastMessageSignature) return;

  const wasNearBottom =
    list.scrollHeight - list.scrollTop - list.clientHeight < 100;

  list.replaceChildren();

  if (messages.length === 0) {
    const empty = document.createElement("p");
    empty.className = "empty-messages";
    empty.textContent = "Aucun message pour le moment. Envoie le premier message !";
    list.appendChild(empty);
  } else {
    for (const message of messages) renderMessage(message);
  }

  lastMessageSignature = signature;

  if (wasNearBottom || messages.length <= 1) {
    list.scrollTop = list.scrollHeight;
  }
}

function renderContact(contact) {
  const list = getElement("contactsList", "contacts", "contactList");
  if (!list) return;

  const button = document.createElement("button");
  button.type = "button";
  button.className = "contact-item";

  const username = getUsername(contact);
  const displayName = contact.display_name || username;
  const id = getUserId(contact);

  button.textContent = displayName;
  button.addEventListener("click", () => {
    if (!id) {
      setStatus("Identifiant de membre manquant.", "error");
      return;
    }
    startConversation(id, contact);
  });

  list.appendChild(button);
}

async function loadProfile() {
  const data = await apiRequest(API.profile);
  currentUser = data.profile || data.user || data;
  const username = getUsername(currentUser);

  const profileElement = getElement("profileUsername", "currentUsername", "myUsername");
  if (profileElement) profileElement.textContent = username;
}

async function searchContacts(query) {
  const normalized = query.trim();

  if (normalized.length < 3) {
    setStatus("Saisis au moins 3 caractères pour rechercher un membre.");
    return;
  }

  try {
    const url = `${API.contacts}?q=${encodeURIComponent(normalized)}`;
    const data = await apiRequest(url);
    const contacts = getContacts(data);

    const list = getElement("contactsList", "contacts", "contactList");
    if (list) list.replaceChildren();

    if (contacts.length === 0) {
      setStatus("Aucun membre trouvé. Vérifie l'identifiant ou le nom.");
      return;
    }

    contacts.forEach(renderContact);
    setStatus(`${contacts.length} membre(s) trouvé(s).`);
  } catch (error) {
    setStatus(error.message, "error");
  }
}

async function startConversation(contactId, contact) {
  try {
    setStatus("Ouverture de la conversation…");

    const data = await apiRequest(API.createConversation, {
      method: "POST",
      body: JSON.stringify({ contact_id: contactId })
    });

    const conversation = data.conversation || data;
    const conversationId = getConversationId(conversation);

    if (!conversationId) {
      throw new Error("L'API n'a pas renvoyé l'identifiant de la conversation.");
    }

    currentConversation = conversationId;
    currentContact = contact;
    lastMessageSignature = "";

    const title = getElement("chatTitle", "conversationTitle", "contactName");
    if (title) title.textContent = contact.display_name || getUsername(contact);

    const list = getElement("messagesList", "messages", "chatMessages");
    if (list) list.replaceChildren();

    await loadMessages();
    setStatus("Conversation ouverte.");
  } catch (error) {
    setStatus(error.message, "error");
  }
}

async function loadMessages() {
  if (!currentConversation || loadingMessages) return;

  loadingMessages = true;

  try {
    const url = `${API.messages}?conversation_id=${encodeURIComponent(currentConversation)}`;
    const data = await apiRequest(url);
    renderMessages(getMessages(data));
  } catch (error) {
    setStatus(error.message, "error");
  } finally {
    loadingMessages = false;
  }
}

async function sendMessage(event) {
  event?.preventDefault();

  const input = getElement("messageInput", "message", "messageText");
  const content = input?.value?.trim();

  if (!currentConversation) {
    setStatus("Choisis d'abord un membre et ouvre une conversation.");
    return;
  }

  if (!content) return;

  if (content.length > 5000) {
    setStatus("Le message ne peut pas dépasser 5000 caractères.", "error");
    return;
  }

  const sendButton = getElement("sendButton", "sendMessageButton");
  if (sendButton) sendButton.disabled = true;

  try {
    await apiRequest(API.messages, {
      method: "POST",
      body: JSON.stringify({
        conversation_id: currentConversation,
        content
      })
    });

    if (input) input.value = "";
    await loadMessages();
  } catch (error) {
    setStatus(error.message, "error");
  } finally {
    if (sendButton) sendButton.disabled = false;
  }
}

async function loadConversations() {
  try {
    const data = await apiRequest(API.conversations);
    const conversations = Array.isArray(data.conversations)
      ? data.conversations
      : [];

    const list = getElement("conversationsList", "conversationList");
    if (!list) return;

    list.replaceChildren();

    for (const conversation of conversations) {
      const id = getConversationId(conversation);
      if (!id) continue;

      const button = document.createElement("button");
      button.type = "button";
      button.className = "contact-item";
      button.textContent =
        conversation.display_name ||
        conversation.username ||
        "Conversation";

      button.addEventListener("click", () => {
        currentConversation = id;
        currentContact = conversation;
        lastMessageSignature = "";
        const title = getElement("chatTitle", "conversationTitle", "contactName");
        if (title) title.textContent = button.textContent;
        loadMessages();
      });

      list.appendChild(button);
    }
  } catch (error) {
    console.warn("Chargement des conversations :", error.message);
  }
}

async function logout() {
  try {
    await apiRequest(API.logout, { method: "POST", body: "{}" });
  } catch (error) {
    console.warn("Déconnexion serveur :", error.message);
  }

  if (refreshInterval) clearInterval(refreshInterval);
  sessionStorage.removeItem("nexora_session");
  sessionStorage.removeItem("nexora_user");
  window.location.replace("/");
}

function connectEvents() {
  const searchForm = getElement("contactSearchForm", "searchContactForm");
  const searchInput = getElement("contactSearchInput", "searchContactInput", "contactInput");

  if (searchForm && searchInput) {
    searchForm.addEventListener("submit", event => {
      event.preventDefault();
      searchContacts(searchInput.value);
    });
  }

  const sendForm = getElement("messageForm", "sendMessageForm");
  if (sendForm) sendForm.addEventListener("submit", sendMessage);

  const sendButton = getElement("sendButton", "sendMessageButton");
  if (sendButton && !sendForm) {
    sendButton.addEventListener("click", sendMessage);
  }

  const logoutButton = getElement("logoutButton", "logoutBtn");
  if (logoutButton) logoutButton.addEventListener("click", logout);
}

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
      loadMessages();
      loadConversations();
    }, 5000);
  } catch (error) {
    setStatus(error.message, "error");
  }
}

document.addEventListener("DOMContentLoaded", initChat);
