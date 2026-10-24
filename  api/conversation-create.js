
import { createClient } from "@supabase/supabase-js";

function respond(res, status, body) {
  return res.status(status).json(body);
}

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");

  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
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
      error: "Connecte-toi pour démarrer une conversation."
    });
  }

  const contactId = String(req.body?.contact_id || "");

  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      contactId
    )
  ) {
    return respond(res, 400, {
      error: "Identifiant du contact invalide."
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
        error: "Session invalide. Reconnecte-toi."
      });
    }

    const userId = authData.user.id;

    if (userId === contactId) {
      return respond(res, 400, {
        error: "Tu ne peux pas démarrer une conversation avec toi-même."
      });
    }

    const { data: contact, error: contactError } = await supabase
      .from("profiles")
      .select("id")
      .eq("id", contactId)
      .maybeSingle();

    if (contactError) {
      return respond(res, 500, {
        error: "Impossible de vérifier ce membre."
      });
    }

    if (!contact) {
      return respond(res, 404, {
        error: "Membre introuvable."
      });
    }

    const [userOne, userTwo] =
      userId < contactId
        ? [userId, contactId]
        : [contactId, userId];

    const { data: existing, error: lookupError } = await supabase
      .from("conversations")
      .select("id, user_one, user_two, created_at")
      .eq("user_one", userOne)
      .eq("user_two", userTwo)
      .maybeSingle();

    if (lookupError) {
      return respond(res, 500, {
        error: "Impossible de vérifier les conversations existantes."
      });
    }

    if (existing) {
      return respond(res, 200, {
        success: true,
        conversation: existing,
        existing: true
      });
    }

    const { data: conversation, error: insertError } = await supabase
      .from("conversations")
      .insert({
        user_one: userOne,
        user_two: userTwo
      })
      .select("id, user_one, user_two, created_at")
      .single();

    if (insertError) {
      console.error("Création conversation:", insertError);

      return respond(res, 500, {
        error: "Création impossible. Vérifie les permissions Supabase."
      });
    }

    return respond(res, 201, {
      success: true,
      conversation,
      existing: false
    });
  } catch (error) {
    console.error("Erreur API conversation-create:", error);

    return respond(res, 500, {
      error: "Erreur serveur."
    });
  }
}
