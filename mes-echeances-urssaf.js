#!/usr/bin/env bun
import { createHash, randomBytes } from "node:crypto";

// trousseau de clé pour la sauvegarde locale securisée des identifiants
const keychainKey = {
  service: "mes-echeances-urssaf",
  name: "credentials",
};

if (process.argv.includes("--help") || process.argv.includes("-h")) {
  console.log(`Usage: ./mes-echeances-urssaf.js [ANNEE|logout]

Récupère les échéances URSSAF pour l'année spécifiée (par défaut: année en cours).

Options:
  ANNEE         Année à consulter (ex: 2024)
  logout        Supprime les identifiants sauvegardés
`);
  process.exit(0);
}

if (process.argv.includes("logout")) {
  await Bun.secrets.delete(keychainKey);
  console.log("Identifiants supprimés du trousseau.");
  process.exit(0);
}

const headers = {
  "User-Agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:143.0) Gecko/20100101 Firefox/143.0",
};

const credentials = await getCredentials();
const auth = await login(credentials);
const echeances = await getEcheances(auth);
printEcheances(echeances);

async function getCredentials() {
  const stored = await Bun.secrets.get(keychainKey);
  if (stored) return JSON.parse(stored);

  const ask = () =>
    new Promise((r) =>
      process.stdin.once("data", (d) => r(d.toString().trim())),
    );
  const askPass = async () => {
    await Bun.$`stty -echo`;
    const pass = await ask();
    await Bun.$`stty echo`;
    process.stdout.write("\n");
    return pass;
  };

  process.stdout.write("Login (SIRET): ");
  const identifiant = await ask();
  process.stdout.write("Mot de passe: ");
  const password = await askPass();
  process.stdin.pause();

  const creds = { identifiant, password };

  await Bun.secrets.set({
    ...keychainKey,
    value: JSON.stringify(creds),
  });
  console.log("\nIdentifiants sauvegardés dans le trousseau.");
  return creds;
}

async function login({ identifiant, password }) {
  const res = await fetch("https://mon.urssaf.fr/cnx", {
    method: "POST",
    headers: {
      ...headers,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: `identifiant=${encodeURIComponent(identifiant)}&Password=${encodeURIComponent(password)}`,
    redirect: "manual",
  });

  const cookies = res.headers
    .getSetCookie()
    .map((c) => c.split(";")[0].split("="));
  const ctxValue = cookies.find(([n]) => n === "ctxUrssaf")?.[1];
  const { compte } = JSON.parse(
    Buffer.from(decodeURIComponent(ctxValue), "base64").toString(),
  );

  const { clientId } = (
    await (
      await fetch(
        "https://webti.urssaf.fr/assets/configuration/configuration.json",
        { headers: { ...headers, Accept: "application/json" } },
      )
    ).json()
  ).oidc.annabel;

  const b64url = (b) => b.toString("base64url");
  const codeVerifier = b64url(randomBytes(32));

  const tokenBds = new URL(res.headers.get("Location")).searchParams.get(
    "tokenBds",
  );

  const authRes = await fetch(
    `https://login.urssaf.fr/api/oauth/v1/authorize?${new URLSearchParams({
      response_type: "code",
      client_id: clientId,
      state: b64url(randomBytes(32)) + "-0000000000-webti",
      redirect_uri: "https://webti.urssaf.fr/callback",
      scope:
        "openid webti.metier webti.metier.v2 deci.ti offline_access ods.cedito ods.session",
      code_challenge: b64url(
        createHash("sha256").update(codeVerifier).digest(),
      ),
      code_challenge_method: "S256",
      nonce: b64url(randomBytes(32)),
      prompt: "none",
      subject_token: tokenBds,
      subject_token_type: "urn:oauth2:180035016:acoss:token-bds",
    })}`,
    {
      headers: {
        ...headers,
        Cookie: cookies.map(([n, v]) => `${n}=${v}`).join("; "),
      },
      redirect: "manual",
    },
  );

  const { access_token } = await (
    await fetch("https://login.urssaf.fr/api/oauth/v1/token", {
      method: "POST",
      headers: {
        ...headers,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code: new URL(authRes.headers.get("Location")).searchParams.get("code"),
        redirect_uri: "https://webti.urssaf.fr/callback",
        code_verifier: codeVerifier,
        client_id: clientId,
      }),
    })
  ).json();

  return {
    compte,
    access_token,
  };
}

async function getEcheances({ compte, access_token }) {
  const annee = process.argv[2] || new Date().getFullYear();

  return (
    await fetch(
      `https://api.urssaf.fr/api-webti-be/v1/echeances?siret=${compte.siret}&categorie=TIPL&orga=${compte.orga}&numCot=${compte.numc}&view=ECHEANCIER_ANNUEL&annee=${annee}`,
      {
        headers: {
          Authorization: `Bearer ${access_token}`,
          "Correlation-ID": crypto.randomUUID(),
        },
      },
    )
  ).json();
}

function printEcheances(echeances) {
  let totaux = [0, 0, 0];

  const formatEuro = (m) => `${m.toLocaleString("fr-FR")} €`;
  const lignes = echeances.map((e) => {
    totaux[0] += e.montantTotal;
    totaux[1] += e.paiement.montantPaye;
    totaux[2] += e.montantNonPaye;

    const [y, m, d] = e.exigibilite.dateExigibilite.split("-");
    return {
      Date: `${d}/${m}/${y}`,
      "Montant Total": formatEuro(e.montantTotal),
      Payé: formatEuro(e.paiement.montantPaye),
      Restant: formatEuro(e.montantNonPaye),
      État: e.etatEcheance.toLowerCase().replace(/ee$/, "ée"),
    };
  });

  console.log("\n\x1b[96m 📅 ÉCHÉANCES\x1b[0m");
  console.table(lignes);

  const width = 12;
  console.log(`\n\x1b[96m 💰 TOTAUX\x1b[0m\n
  ${"Total :".padEnd(width)} ${formatEuro(totaux[0]).padStart(width)}
  ${"Payé :".padEnd(width)} ${formatEuro(totaux[1]).padStart(width)}
  ${"Restant dû :".padEnd(width)} ${formatEuro(totaux[2]).padStart(width)}
`);
}
