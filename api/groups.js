
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
      error: "Connecte-toi pour accéder aux groupes."
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

    if (req.method === "POST") {
      const name =
        typeof req.body?.name === "string"
          ? req.body.name.trim()
          : "";

      const description =
        typeof req.body?.description === "string"
          ? req.body.description.trim()
          : "";

      if (name.length < 2 || name.length > 60) {
        return respond(res, 400, {
          error: "Le nom du groupe doit contenir entre 2 et 60 caractères."
        });
      }

      if (description.length > 500) {
        return respond(res, 400, {
          error: "La description ne peut pas dépasser 500 caractères."
        });
      }

      const { data: group, error } = await supabase
        .from("groups")
        .insert({
          name,
          description: description || null,
          created_by: userId
        })
        .select("id, name, description, created_by, created_at")
        .single();

      if (error) {
        console.error("Création groupe:", error);

        return respond(res, 500, {
          error: "Impossible de créer le groupe. Vérifie la table et les permissions Supabase."
        });
      }

      return respond(res, 201, {
        success: true,
        group
      });
    }

    const { data, error } = await supabase
      .from("group_members")
      .select("role, group:groups(id, name, description, created_by, created_at)")
      .eq("user_id", userId)
      .order("created_at", { ascending: false });

    if (error) {
      console.error("Chargement groupes:", error);

      return respond(res, 500, {
        error: "Impossible de charger les groupes."
      });
    }

    return respond(res, 200, {
      success: true,
      groups: data || []
    });
  } catch (error) {
    console.error("Erreur API groups:", error);

    return respond(res, 500, {
      error: "Erreur serveur."
    });
  }
}
