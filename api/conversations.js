
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
      error: "Connecte-toi pour afficher tes conversations."
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

    const userId = authData.user.id;

    const { data, error } = await supabase
      .from("conversations")
      .select("id, user_one, user_two, created_at")
      .or(`user_one.eq.${userId},user_two.eq.${userId}`)
      .order("created_at", { ascending: false });

    if (error) {
      console.error("Erreur de chargement:", error);

      return res.status(500).json({
        error: "Impossible de charger les conversations."
      });
    }

    return res.status(200).json({
      success: true,
      conversations: data || []
    });
  } catch (error) {
    console.error("Erreur API conversations:", error);

    return res.status(500).json({
      error: "Erreur serveur."
    });
  }
}
