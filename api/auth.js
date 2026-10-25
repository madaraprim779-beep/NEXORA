
import { createClient } from "@supabase/supabase-js";

const USERNAME_REGEX = /^[a-zA-Z0-9_]{3,24}$/;

function send(res, status, data) {
  return res.status(status).json(data);
}

function getAdminClient() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !key) {
    throw new Error("Configuration serveur manquante.");
  }

  return createClient(url, key, {
    auth: {
      autoRefreshToken: false,
      persistSession: false
    }
  });
}

function getPublicClient() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_PUBLISHABLE_KEY;

  if (!url || !key) {
    throw new Error("Configuration Supabase manquante.");
  }

  return createClient(url, key, {
    auth: {
      autoRefreshToken: false,
      persistSession: false
    }
  });
}

function normalizeUsername(value) {
  return String(value || "").trim().toLowerCase();
}

function syntheticEmail(username) {
  return `${username}@users.nexora.invalid`;
}

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");

  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return send(res, 405, {
      error: "Méthode non autorisée."
    });
  }

  try {
    const action = String(req.body?.action || "");
    const username = normalizeUsername(req.body?.username);
    const password = String(req.body?.password || "");

    if (!["register", "login"].includes(action)) {
      return send(res, 400, {
        error: "Action inconnue."
      });
    }

    if (!USERNAME_REGEX.test(username)) {
      return send(res, 400, {
        error: "Le pseudo doit contenir 3 à 24 caractères : lettres, chiffres ou _."
      });
    }

    if (password.length < 8 || password.length > 128) {
      return send(res, 400, {
        error: "Le mot de passe doit contenir entre 8 et 128 caractères."
      });
    }

    const email = syntheticEmail(username);

    if (action === "register") {
      const admin = getAdminClient();

      const { data: created, error: createError } =
        await admin.auth.admin.createUser({
          email,
          password,
          email_confirm: true,
          user_metadata: { username }
        });

      if (createError || !created?.user) {
        return send(res, 400, {
          error: "Inscription impossible. Ce pseudo est peut-être déjà utilisé."
        });
      }

      const { error: profileError } = await admin
        .from("profiles")
        .insert({
          id: created.user.id,
          username
        });

      if (profileError) {
        await admin.auth.admin.deleteUser(created.user.id);
        console.error("Création du profil impossible:", profileError);

        return send(res, 500, {
          error: "Impossible de créer le profil. Réessaie plus tard."
        });
      }

      // Connexion automatique après création.
      const supabase = getPublicClient();

      const { data: loginData, error: loginError } =
        await supabase.auth.signInWithPassword({
          email,
          password
        });

      if (loginError || !loginData.session) {
        return send(res, 201, {
          success: true,
          requires_login: true,
          message: "Compte créé. Connecte-toi pour continuer."
        });
      }

      return send(res, 201, {
        success: true,
        requires_login: false,
        message: "Bienvenue sur NEXORA !",
        session: loginData.session,
        user: {
          id: loginData.user.id,
          username
        }
      });
    }

    // Connexion normale d'un compte existant.
    const supabase = getPublicClient();

    const { data, error } =
      await supabase.auth.signInWithPassword({
        email,
        password
      });

    if (error || !data.session) {
      return send(res, 401, {
        error: "Pseudo ou mot de passe incorrect."
      });
    }

    return send(res, 200, {
      success: true,
      session: data.session,
      user: {
        id: data.user.id,
        username
      }
    });
  } catch (error) {
    console.error("Erreur API NEXORA:", error);

    return send(res, 500, {
      error: "Erreur serveur. Vérifie la configuration Supabase."
    });
  }
}
