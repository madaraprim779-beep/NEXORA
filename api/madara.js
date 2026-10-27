const SYSTEM_PROMPT = `
Tu es MADARA AI, l'assistant intelligent intégré à NEXORA.
Réponds en français par défaut et utilise la langue de l'utilisateur.
Sois utile, professionnel, clair et précis.
Aide en programmation, études, rédaction, analyse et créativité.
N'invente pas de résultats.
`;

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8"
    }
  });
}

export async function onRequestPost({ request, env }) {
  const apiKey = env.OPENROUTER_API_KEY;
  const supabaseUrl = env.SUPABASE_URL;
  const supabaseKey = env.SUPABASE_PUBLISHABLE_KEY;

  if (!apiKey || !supabaseUrl || !supabaseKey) {
    return json({ error: "Configuration serveur incomplète." }, 500);
  }

  const authorization = request.headers.get("Authorization") || "";
  const token = authorization.startsWith("Bearer ")
    ? authorization.slice(7).trim()
    : "";

  if (!token) {
    return json({ error: "Connecte-toi à NEXORA." }, 401);
  }

  try {
    const authResponse = await fetch(
      `${supabaseUrl.replace(/\/+$/, "")}/auth/v1/user`,
      {
        headers: {
          apikey: supabaseKey,
          Authorization: `Bearer ${token}`
        }
      }
    );

    if (!authResponse.ok) {
      return json({ error: "Session invalide. Reconnecte-toi." }, 401);
    }

    let body;

    try {
      body = await request.json();
    } catch {
      return json({ error: "Requête JSON invalide." }, 400);
    }

    const messages = body?.messages;

    if (
      !Array.isArray(messages) ||
      messages.length === 0 ||
      messages.length > 30
    ) {
      return json({ error: "Conversation invalide." }, 400);
    }

    const valid = messages.every(message =>
      message &&
      ["user", "assistant"].includes(message.role) &&
      typeof message.content === "string" &&
      message.content.trim().length > 0 &&
      message.content.length <= 8000
    );

    if (!valid || messages[messages.length - 1].role !== "user") {
      return json({ error: "Format de message invalide." }, 400);
    }

    const history = messages.slice(-10).map(message => ({
      role: message.role,
      content: message.content
    }));

    const response = await fetch(
      "https://openrouter.ai/api/v1/chat/completions",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
          "X-OpenRouter-Title": "NEXORA MADARA AI"
        },
        body: JSON.stringify({
          model: "openrouter/free",
          messages: [
            { role: "system", content: SYSTEM_PROMPT },
            ...history
          ],
          temperature: 0.7,
          max_tokens: 1200
        })
      }
    );

    const result = await response.json().catch(() => ({}));

    if (!response.ok) {
      console.error("OpenRouter:", response.status, result.error?.message);

      return json({
        error: response.status === 429
          ? "Limite de requêtes atteinte. Réessaie plus tard."
          : "OpenRouter n'a pas pu répondre."
      }, 502);
    }

    const reply = result.choices?.[0]?.message?.content;

    if (typeof reply !== "string" || !reply.trim()) {
      return json({ error: "Réponse IA vide." }, 502);
    }

    return json({
      reply: reply.trim(),
      model: result.model || "openrouter/free"
    });
  } catch (error) {
    console.error("MADARA AI:", error.message);
    return json({ error: "Erreur serveur MADARA AI." }, 500);
  }
}

export async function onRequest(context) {
  if (context.request.method !== "POST") {
    return json({ error: "Méthode non autorisée." }, 405);
  }

  return onRequestPost(context);
}