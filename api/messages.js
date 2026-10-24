
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

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");

  if (!["GET", "POST"].includes(req.method)) {
    res.setHeader("Allow", "GET, POST");
    return reply(res, 405, {
      error: "Méthode non autorisée."
    });
  }

  const authorization = req.headers.authorization || "";
  const token = authorization.startsWith("Bearer ")
    ? authorization.slice(7)
    : "";

  if (!token) {
    return reply(res, 401, {
      error: "Connecte-toi pour accéder aux messages."
    });
  }

  if (
    !process.env.SUPABASE_URL ||
    !process.env.SUPABASE_PUBLISHABLE_KEY
  ) {
    return reply(res, 500, {
      error: "Configuration Supabase manquante."
    });
  }

  try {
    const supabase = createSupabase(token);

    const { data: auth, error: authError } =
      await supabase.auth.getUser(token);

    if (authError || !auth.user) {
      return reply(res, 401, {
        error: "Session invalide."
      });
    }

    const userId = auth.user.id;

    if (req.method === "GET") {
      const conversationId = String(
        req.query?.conversation_id || ""
      );

      if (
        !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
          conversationId
        )
      ) {
        return reply(res, 400, {
          error: "Identifiant de conversation invalide."
        });
      }

      const { data: conversation, error: conversationError } =
        await supabase
          .from("conversations")
          .select("id")
          .eq("id", conversationId)
          .maybeSingle();

      if (conversationError) {
        return reply(res, 500, {
          error: "Impossible de vérifier la conversation."
        });
      }

      if (!conversation) {
        return reply(res, 403, {
          error: "Conversation inaccessible."
        });
      }

      const { data: messages, error } = await supabase
        .from("messages")
        .select("id, conversation_id, sender_id, content, created_at")
        .eq("conversation_id", conversationId)
        .order("created_at", { ascending: true })
        .limit(100);

      if (error) {
        console.error("Erreur lecture messages:", error);

        return reply(res, 500, {
          error: "Impossible de charger les messages."
        });
      }

      return reply(res, 200, {
        success: true,
        messages: messages || []
      });
    }

    const conversationId = String(
      req.body?.conversation_id || ""
    );

    const content =
      typeof req.body?.content === "string"
        ? req.body.content.trim()
        : "";

    if (
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
        conversationId
      )
    ) {
      return reply(res, 400, {
        error: "Identifiant de conversation invalide."
      });
    }

    if (!content || content.length > 5000) {
      return reply(res, 400, {
        error: "Le message doit contenir entre 1 et 5000 caractères."
      });
    }

    const { data: conversation, error: conversationError } =
      await supabase
        .from("conversations")
        .select("id")
        .eq("id", conversationId)
        .maybeSingle();

    if (conversationError) {
      return reply(res, 500, {
        error: "Impossible de vérifier la conversation."
      });
    }

    if (!conversation) {
      return reply(res, 403, {
        error: "Conversation inaccessible."
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
      console.error("Erreur envoi message:", error);

      return reply(res, 500, {
        error: "Impossible d'envoyer le message."
      });
    }

    return reply(res, 201, {
      success: true,
      message
    });
  } catch (error) {
    console.error("Erreur API messages:", error);

    return reply(res, 500, {
      error: "Erreur serveur."
    });
  }
}
