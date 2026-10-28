
import { createClient } from "@supabase/supabase-js";

function createSupabase(token) {
  return createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_PUBLISHABLE_KEY,
    {
      auth: {
        persistSession: false,
        autoRefreshToken: false
      },
      global: {
        headers: {
          Authorization: `Bearer ${token}`
        }
      }
    }
  );
}

function reply(res, status, body) {
  return res.status(status).json(body);
}

function isUuid(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
    value
  );
}

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");

  if (!["GET", "POST"].includes(req.method)) {
    res.setHeader("Allow", "GET, POST");
    return reply(res, 405, {
      success: false,
      error: "Méthode non autorisée."
    });
  }

  const authorization = req.headers.authorization || "";
  const token = authorization.startsWith("Bearer ")
    ? authorization.slice(7).trim()
    : "";

  if (!token) {
    return reply(res, 401, {
      success: false,
      error: "Connecte-toi pour accéder aux messages."
    });
  }

  if (
    !process.env.SUPABASE_URL ||
    !process.env.SUPABASE_PUBLISHABLE_KEY
  ) {
    return reply(res, 500, {
      success: false,
      error: "Configuration Supabase manquante."
    });
  }

  try {
    const supabase = createSupabase(token);

    const { data: auth, error: authError } =
      await supabase.auth.getUser(token);

    if (authError || !auth?.user) {
      return reply(res, 401, {
        success: false,
        error: "Session invalide. Reconnecte-toi."
      });
    }

    const userId = auth.user.id;

    // Vérifie que l'utilisateur connecté participe à la conversation.
    async function getAuthorizedConversation(conversationId) {
      if (!isUuid(conversationId)) {
        return {
          error: "Identifiant de conversation invalide.",
          status: 400
        };
      }

      const { data, error } = await supabase
        .from("conversations")
        .select("id, user_one, user_two")
        .eq("id", conversationId)
        .maybeSingle();

      if (error) {
        console.error("Vérification conversation :", error);
        return {
          error: "Impossible de vérifier la conversation.",
          status: 500
        };
      }

      if (
        !data ||
        (data.user_one !== userId && data.user_two !== userId)
      ) {
        return {
          error: "Conversation inaccessible.",
          status: 403
        };
      }

      return { conversation: data };
    }

    if (req.method === "GET") {
      const conversationId = String(
        req.query?.conversation_id || ""
      );

      const result = await getAuthorizedConversation(conversationId);

      if (result.error) {
        return reply(res, result.status, {
          success: false,
          error: result.error
        });
      }

      const { data: messages, error } = await supabase
        .from("messages")
        .select("id, conversation_id, sender_id, content, created_at")
        .eq("conversation_id", conversationId)
        .order("created_at", { ascending: true })
        .limit(100);

      if (error) {
        console.error("Lecture messages :", error);
        return reply(res, 500, {
          success: false,
          error: "Impossible de charger les messages."
        });
      }

      return reply(res, 200, {
        success: true,
        messages: messages || []
      });
    }

    // POST : envoi d'un message.
    const conversationId = String(
      req.body?.conversation_id || ""
    );

    const content =
      typeof req.body?.content === "string"
        ? req.body.content.trim()
        : "";

    if (!content || content.length > 5000) {
      return reply(res, 400, {
        success: false,
        error: "Le message doit contenir entre 1 et 5000 caractères."
      });
    }

    const result = await getAuthorizedConversation(conversationId);

    if (result.error) {
      return reply(res, result.status, {
        success: false,
        error: result.error
      });
    }

    const { data: message, error } = await supabase
      .from("messages")
      .insert({
        conversation_id: conversationId,
        sender_id: userId,
        content
      })
      .select("id, conversation_id, sender_id, content, created_at")
      .single();

    if (error) {
      console.error("Envoi message :", error);
      return reply(res, 500, {
        success: false,
        error: "Impossible d'envoyer le message."
      });
    }

    return reply(res, 201, {
      success: true,
      message
    });
  } catch (error) {
    console.error("API messages :", error);

    return reply(res, 500, {
      success: false,
      error: "Erreur serveur."
    });
  }
}
