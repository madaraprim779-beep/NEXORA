
const SYSTEM_PROMPT = `
Tu es MADARA AI, l'assistant intelligent intégré à NEXORA.
Réponds en français par défaut et utilise la langue de l'utilisateur.
Sois utile, professionnel, clair et précis.
Aide en programmation, études, rédaction, analyse et créativité.
N'invente pas de résultats et ne prétends pas avoir effectué une action
que tu n'as pas réellement effectuée.
`;

export default async function handler(req, res) {
  res.setHeader("Content-Type", "application/json; charset=utf-8");

  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({
      error: "Méthode non autorisée."
    });
  }

  const apiKey = process.env.OPENROUTER_API_KEY;
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_PUBLISHABLE_KEY;

  if (!apiKey) {
    return res.status(500).json({
      error: "La variable OPENROUTER_API_KEY est manquante."
    });
  }

  if (!supabaseUrl || !supabaseKey) {
    return res.status(500).json({
      error: "La configuration Supabase est incomplète."
    });
  }

  const authorization = req.headers.authorization || "";
  const token = authorization.startsWith("Bearer ")
    ? authorization.slice(7).trim()
    : "";

  if (!token) {
    return res.status(401).json({
      error: "Connecte-toi à NEXORA pour utiliser MADARA AI."
    });
  }

  try {
    // Vérifier la session de l'utilisateur avec Supabase.
    const authResponse = await fetch(
      `${supabaseUrl.replace(/\/+$/, "")}/auth/v1/user`,
      {
        method: "GET",
        headers: {
          apikey: supabaseKey,
          Authorization: `Bearer ${token}`
        },
        signal: AbortSignal.timeout(10000)
      }
    );

    if (!authResponse.ok) {
      return res.status(401).json({
        error: "Session invalide. Reconnecte-toi à NEXORA."
      });
    }

    const body = req.body || {};
    const messages = body.messages;

    if (
      !Array.isArray(messages) ||
      messages.length === 0 ||
      messages.length > 30
    ) {
      return res.status(400).json({
        error: "La conversation est vide ou invalide."
      });
    }

    const validMessages = messages.every((message) =>
      message &&
      ["user", "assistant"].includes(message.role) &&
      typeof message.content === "string" &&
      message.content.trim().length > 0 &&
      message.content.length <= 8000
    );

    if (
      !validMessages ||
      messages[messages.length - 1].role !== "user"
    ) {
      return res.status(400).json({
        error: "Vérifie le format de ton message."
      });
    }

    const history = messages.slice(-10).map((message) => ({
      role: message.role,
      content: message.content
    }));

    const aiResponse = await fetch(
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
            {
              role: "system",
              content: SYSTEM_PROMPT
            },
            ...history
          ],
          temperature: 0.7,
          max_tokens: 1200,
          stream: false
        }),
        signal: AbortSignal.timeout(55000)
      }
    );

    const result = await aiResponse.json().catch(() => ({}));

    if (!aiResponse.ok) {
      console.error(
        "OpenRouter status:",
        aiResponse.status,
        result.error?.message || "Erreur inconnue"
      );

      return res.status(502).json({
        error: aiResponse.status === 429
          ? "Limite de requêtes atteinte. Réessaie plus tard."
          : "OpenRouter n'a pas pu répondre. Vérifie ta clé et la disponibilité du modèle."
      });
    }

    const reply = result.choices?.[0]?.message?.content;

    if (typeof reply !== "string" || !reply.trim()) {
      return res.status(502).json({
        error: "MADARA AI n'a pas renvoyé de réponse."
      });
    }

    return res.status(200).json({
      reply: reply.trim(),
      model: result.model || "openrouter/free"
    });

  } catch (error) {
    console.error("MADARA AI API error:", error.message);

    return res.status(500).json({
      error: "Erreur serveur pendant la demande à MADARA AI."
    });
  }
}
