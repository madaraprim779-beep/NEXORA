
import { createClient } from "@supabase/supabase-js";

function respond(res, status, body) {
  return res.status(status).json(body);
}

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");

  if (!["GET", "POST"].includes(req.method)) {
    res.setHeader("Allow", "GET, POST");
    return respond(res, 405, {
      error: "Méthode non autorisée."
    });
  }

  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_PUBLISHABLE_KEY;
  const authorization = req.headers.authorization || "";
  const token = authorization.startsWith("Bearer ")
    ? authorization.slice(7)
    : "";

  if (!url || !key) {
    return respond(res, 500, {
      error: "Configuration Supabase manquante."
    });
  }

  if (!token) {
    return respond(res, 401, {
      error: "Connecte-toi pour accéder aux messages du groupe."
    });
  }

  const groupId = String(
    req.method === "GET"
      ? req.query?.group_id || ""
      : req.body?.group_id || ""
  );

  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      groupId
    )
  ) {
    return respond(res, 400, {
      error: "Identifiant de groupe invalide."
    });
  }

  try {
    const supabase = createClient(url, key, {
      auth: {
        persistSession: false,
        autoRefreshToken: false
      }
    });

    const { data: authData, error: authError } =
      await supabase.auth.getUser(token);

    if (authError || !authData.user) {
      return respond(res, 401, {
        error: "Session invalide."
      });
    }

    const userId = authData.user.id;

    const { data: membership, error: memberError } = await supabase
      .from("group_members")
      .select("group_id")
      .eq("group_id", groupId)
      .eq("user_id", userId)
      .maybeSingle();

    if (memberError) {
      return respond(res, 500, {
        error: "Impossible de vérifier ton appartenance au groupe."
      });
    }

    if (!membership) {
      return respond(res, 403, {
        error: "Tu ne fais pas partie de ce groupe."
      });
    }

    if (req.method === "GET") {
      const { data, error } = await supabase
        .from("group_messages")
        .select("id, group_id, sender_id, content, created_at")
        .eq("group_id", groupId)
        .order("created_at", { ascending: true })
        .limit(100);

      if (error) {
        console.error("Chargement messages groupe:", error);

        return respond(res, 500, {
          error: "Impossible de charger les messages."
        });
      }

      return respond(res, 200, {
        success: true,
        messages: data || []
      });
    }

    const content =
      typeof req.body?.content === "string"
        ? req.body.content.trim()
        : "";

    if (!content || content.length > 5000) {
      return respond(res, 400, {
        error: "Le message doit contenir entre 1 et 5000 caractères."
      });
    }

    const { data, error } = await supabase
      .from("group_messages")
      .insert({
        group_id: groupId,
        sender_id: userId,
        content
      })
      .select("id, group_id, sender_id, content, created_at")
      .single();

    if (error) {
      console.error("Envoi message groupe:", error);

      return respond(res, 500, {
        error: "Impossible d'envoyer le message."
      });
    }

    return respond(res, 201, {
      success: true,
      message: data
    });
  } catch (error) {
    console.error("Erreur API group-messages:", error);

    return respond(res, 500, {
      error: "Erreur serveur."
    });
  }
}
