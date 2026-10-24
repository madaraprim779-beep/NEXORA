
import { createClient } from "@supabase/supabase-js";

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");

  if (req.method !== "PATCH") {
    res.setHeader("Allow", "PATCH");
    return res.status(405).json({
      error: "Méthode non autorisée."
    });
  }

  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_PUBLISHABLE_KEY;

  if (!url || !key) {
    return res.status(500).json({
      error: "Configuration Supabase manquante."
    });
  }

  const authorization = req.headers.authorization || "";
  const token = authorization.startsWith("Bearer ")
    ? authorization.slice(7)
    : "";

  if (!token) {
    return res.status(401).json({
      error: "Connecte-toi pour modifier ton profil."
    });
  }

  const displayName =
    typeof req.body?.display_name === "string"
      ? req.body.display_name.trim()
      : "";

  if (displayName.length < 1 || displayName.length > 40) {
    return res.status(400).json({
      error: "Le nom affiché doit contenir entre 1 et 40 caractères."
    });
  }

  try {
    const supabase = createClient(url, key, {
      auth: {
        persistSession: false,
        autoRefreshToken: false
      },
      global: {
        headers: {
          Authorization: `Bearer ${token}`
        }
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
      .update({
        display_name: displayName
      })
      .eq("id", authData.user.id)
      .select("id, username, nexora_id, display_name, created_at")
      .single();

    if (error) {
      console.error("Erreur de modification du profil:", error);

      return res.status(500).json({
        error: "Modification impossible. Vérifie les permissions Supabase."
      });
    }

    return res.status(200).json({
      success: true,
      message: "Profil mis à jour.",
      profile: data
    });
  } catch (error) {
    console.error("Erreur API profile-update:", error);

    return res.status(500).json({
      error: "Erreur serveur."
    });
  }
}
