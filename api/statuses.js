
import { createClient } from "@supabase/supabase-js";

function respond(res, status, body) {
  return res.status(status).json(body);
}

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");

  if (!["GET", "POST", "DELETE"].includes(req.method)) {
    res.setHeader("Allow", "GET, POST, DELETE");
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
      error: "Connecte-toi pour accéder aux statuts."
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

    if (req.method === "GET") {
      const { data, error } = await supabase
        .from("statuses")
        .select("id, user_id, text_content, media_url, media_type, created_at, expires_at")
        .gt("expires_at", new Date().toISOString())
        .order("created_at", { ascending: false })
        .limit(100);

      if (error) {
        console.error("Chargement des statuts:", error);

        return respond(res, 500, {
          error: "Impossible de charger les statuts."
        });
      }

      return respond(res, 200, {
        success: true,
        statuses: data || []
      });
    }

    if (req.method === "POST") {
      const textContent =
        typeof req.body?.text_content === "string"
          ? req.body.text_content.trim()
          : "";

      const mediaUrl =
        typeof req.body?.media_url === "string"
          ? req.body.media_url.trim()
          : "";

      const mediaType = String(req.body?.media_type || "text");

      if (!["text", "image", "video"].includes(mediaType)) {
        return respond(res, 400, {
          error: "Type de statut invalide."
        });
      }

      if (textContent.length > 1000) {
        return respond(res, 400, {
          error: "Le texte ne peut pas dépasser 1000 caractères."
        });
      }

      if (mediaType === "text" && !textContent) {
        return respond(res, 400, {
          error: "Ajoute un texte à ton statut."
        });
      }

      if (
        mediaType !== "text" &&
        (!mediaUrl || mediaUrl.length > 2048)
      ) {
        return respond(res, 400, {
          error: "Le média est manquant ou son adresse est invalide."
        });
      }

      const now = Date.now();

      const { data, error } = await supabase
        .from("statuses")
        .insert({
          user_id: userId,
          text_content: textContent || null,
          media_url: mediaUrl || null,
          media_type: mediaType,
          created_at: new Date(now).toISOString(),
          expires_at: new Date(now + 24 * 60 * 60 * 1000).toISOString()
        })
        .select("id, user_id, text_content, media_url, media_type, created_at, expires_at")
        .single();

      if (error) {
        console.error("Création du statut:", error);

        return respond(res, 500, {
          error: "Impossible de publier le statut."
        });
      }

      return respond(res, 201, {
        success: true,
        status: data
      });
    }

    const statusId = String(req.query?.id || "");

    if (
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
        statusId
      )
    ) {
      return respond(res, 400, {
        error: "Identifiant de statut invalide."
      });
    }

    const { data, error } = await supabase
      .from("statuses")
      .delete()
      .eq("id", statusId)
      .eq("user_id", userId)
      .select("id")
      .maybeSingle();

    if (error) {
      return respond(res, 500, {
        error: "Impossible de supprimer le statut."
      });
    }

    if (!data) {
      return respond(res, 404, {
        error: "Statut introuvable ou non autorisé."
      });
    }

    return respond(res, 200, {
      success: true,
      message: "Statut supprimé."
    });
  } catch (error) {
    console.error("Erreur API statuses:", error);

    return respond(res, 500, {
      error: "Erreur serveur."
    });
  }
}
