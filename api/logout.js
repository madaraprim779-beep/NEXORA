
import { createClient } from "@supabase/supabase-js";

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");

  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
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
      error: "Aucune session fournie."
    });
  }

  try {
    const supabase = createClient(url, key, {
      auth: {
        persistSession: false,
        autoRefreshToken: false
      }
    });

    const { data, error: authError } =
      await supabase.auth.getUser(token);

    if (authError || !data.user) {
      return res.status(401).json({
        error: "Session invalide ou expirée."
      });
    }

    const { error } = await supabase.auth.admin
      .signOut();

    if (error) {
      return res.status(500).json({
        error: "Impossible de révoquer la session."
      });
    }

    return res.status(200).json({
      success: true,
      message: "Déconnexion effectuée."
    });
  } catch (error) {
    console.error("Erreur de déconnexion:", error);

    return res.status(500).json({
      error: "Erreur serveur."
    });
  }
}
