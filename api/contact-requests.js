
import { createClient } from "@supabase/supabase-js";

function respond(res, status, body) {
  return res.status(status).json(body);
}

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");

  if (!["GET", "POST", "PATCH"].includes(req.method)) {
    res.setHeader("Allow", "GET, POST, PATCH");
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
      error: "Connecte-toi pour gérer tes invitations."
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
        .from("contact_requests")
        .select("id, sender_id, receiver_id, status, created_at")
        .or(`sender_id.eq.${userId},receiver_id.eq.${userId}`)
        .order("created_at", { ascending: false })
        .limit(100);

      if (error) {
        console.error("Chargement des invitations:", error);

        return respond(res, 500, {
          error: "Impossible de charger les invitations."
        });
      }

      return respond(res, 200, {
        success: true,
        requests: data || []
      });
    }

    if (req.method === "POST") {
      const receiverId = String(req.body?.receiver_id || "");

      if (
        !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
          receiverId
        )
      ) {
        return respond(res, 400, {
          error: "Identifiant du destinataire invalide."
        });
      }

      if (receiverId === userId) {
        return respond(res, 400, {
          error: "Tu ne peux pas t'envoyer une invitation."
        });
      }

      const { data, error } = await supabase
        .from("contact_requests")
        .insert({
          sender_id: userId,
          receiver_id: receiverId,
          status: "pending"
        })
        .select("id, sender_id, receiver_id, status, created_at")
        .single();

      if (error) {
        console.error("Envoi invitation:", error);

        return respond(res, 400, {
          error: "Invitation impossible. Vérifie que le membre existe et qu'aucune demande identique n'est déjà présente."
        });
      }

      return respond(res, 201, {
        success: true,
        request: data
      });
    }

    const requestId = String(req.body?.request_id || "");
    const decision = String(req.body?.decision || "");

    if (
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
        requestId
      ) ||
      !["accepted", "rejected"].includes(decision)
    ) {
      return respond(res, 400, {
        error: "Demande ou décision invalide."
      });
    }

    const { data, error } = await supabase
      .from("contact_requests")
      .update({ status: decision })
      .eq("id", requestId)
      .eq("receiver_id", userId)
      .eq("status", "pending")
      .select("id, sender_id, receiver_id, status, created_at")
      .maybeSingle();

    if (error) {
      return respond(res, 500, {
        error: "Impossible de traiter cette invitation."
      });
    }

    if (!data) {
      return respond(res, 404, {
        error: "Invitation introuvable ou déjà traitée."
      });
    }

    return respond(res, 200, {
      success: true,
      request: data
    });
  } catch (error) {
    console.error("Erreur API contact-requests:", error);

    return respond(res, 500, {
      error: "Erreur serveur."
    });
  }
}
