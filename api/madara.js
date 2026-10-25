
const SYSTEM_PROMPT = `
Tu es MADARA AI, l'assistant intégré à NEXORA.
Réponds dans la langue de l'utilisateur, en français par défaut.
Sois utile, précis, professionnel et naturel.
Aide en programmation, éducation, rédaction, analyse et créativité.
Ne prétends jamais avoir exécuté une action que tu n'as pas effectuée.
`;

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Méthode non autorisée." });
  }

  const apiKey = process.env.OPENROUTER_API_KEY;
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_PUBLISHABLE_KEY;

  if (!apiKey || !supabaseUrl || !supabaseKey) {
    return res.status(500).json({
      error: "Configuration serveur incomplète."
    });
  }

  const authHeader = req.headers.authorization || "";
  const token = authHeader.startsWith("Bearer ")
    ? authHeader.slice(7)
    : "";

  if (!token) {
    return res.status(401).json({
      error: "Connecte-toi à NEXORA pour utiliser MADARA AI."
    });
  }

  try {
    const authResponse = await fetch(
      `${supabaseUrl}/auth/v1/user`,
      {
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
      messages.length > 30 ||
      messages[messages.length - 1]?.role !== "user" ||
      messages.some(m =>
        !m ||
        !["user", "assistant"].includes(m.role) ||
        typeof m.content !== "string" ||
        !m.content.trim() ||
        m.content.length > 8000
      )
    ) {
      return res.status(400).json({
        error: "Conversation invalide."
      });
    }

    const history = messages.slice(-10).map(m => ({
      role: m.role,
      content: m.content
    }));

    const upstream = await fetch(
      "https://openrouter.ai/api/v1/chat/completions",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
          "X-OpenRouter-Title": "NEXORA - MADARA AI"
        },
        body: JSON.stringify({
          model: "openrouter/free",
          messages: [
            { role: "system", content: SYSTEM_PROMPT },
            ...history
          ],
          temperature: 0.7,
          max_tokens: 1400,
          stream: false
        }),
        signal: AbortSignal.timeout(60000)
      }
    );

    const data = await upstream.json().catch(() => ({}));

    if (!upstream.ok) {
      console.error(
        "OpenRouter error:",
        upstream.status,
        data.error?.message || "Erreur inconnue"
      );

      return res.status(502).json({
        error: upstream.status === 429
          ? "Limite de requêtes atteinte. Réessaie plus tard."
          : "MADARA AI est temporairement indisponible."
      });
    }

    const reply = data.choices?.[0]?.message?.content;

    if (typeof reply !== "string" || !reply.trim()) {
      return res.status(502).json({
        error: "MADARA AI n'a pas renvoyé de texte."
      });
    }

    return res.status(200).json({
      reply: reply.trim(),
      model: data.model || "openrouter/free"
    });

  } catch (error) {
    console.error("NEXORA MADARA error:", error.message);

    return res.status(504).json({
      error: "Délai dépassé. Vérifie ta connexion et réessaie."
    });
  }
}
