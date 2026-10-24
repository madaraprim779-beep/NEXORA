
import { createClient } from "@supabase/supabase-js";

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");

  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({
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
    return res.status(500).json({
      error: "Configuration Supabase manquante."
    });
  }

  if (!token) {
    return res.status(401).json({
      error: "Connecte-toi pour rechercher un membre."
    });
  }

  const nexoraId = String(req.query?.id || "")
    .trim()
    .toUpperCase();

  if (!/^NXR-[A-F0-9]{9}$/.test(nexoraId)) {
    return res.status(400).json({
      error: "Identifiant NEXORA invalide."
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
      return res.status(401).json({
        error: "Session invalide. Reconnecte-toi."
      });
    }

    const { data, error } = await supabase
      .from("profiles")
      .select("nexora_id, username, display_name")
      .eq("nexora_id", nexoraId)
      .maybeSingle();

    if (error) {
      console.error("Erreur de recherche:", error);

      return res.status(500).json({
        error: "Recherche impossible pour le moment."
      });
    }

    if (!data) {
      return res.status(404).json({
        error: "Aucun membre trouvé avec cet identifiant."
      });
    }

    return res.status(200).json({
      success: true,
      contact: data
    });
  } catch (error) {
    console.error("Erreur API contacts:", error);

    return res.status(500).json({
      error: "Erreur serveur."
    });
  }
}
