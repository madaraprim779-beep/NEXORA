
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
      error: "Connecte-toi pour accéder à ton profil."
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

    const { data: profile, error: profileError } = await supabase
      .from("profiles")
      .select("id, username, nexora_id, display_name, created_at")
      .eq("id", authData.user.id)
      .single();

    if (profileError || !profile) {
      return res.status(404).json({
        error: "Profil introuvable."
      });
    }

    return res.status(200).json({
      success: true,
      profile
    });
  } catch (error) {
    console.error("Erreur API profil:", error);

    return res.status(500).json({
      error: "Impossible de charger le profil."
    });
  }
}
