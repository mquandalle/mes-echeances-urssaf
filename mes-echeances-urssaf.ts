#!/usr/bin/env bun

import { createHash, randomBytes } from "node:crypto";
import {
  getOrPromptCredentials,
  deleteCredentials,
  DEFAULT_HEADERS,
  parseCookies,
} from "./utils.ts";

if (process.argv.includes("--help") || process.argv.includes("-h")) {
  console.log(`Usage: ./mes-echeances-urssaf.ts [ANNEE|logout]

Récupère les échéances URSSAF pour l'année spécifiée (par défaut: année en cours).

Options:
  ANNEE         Année à consulter (ex: 2024)
  logout        Supprime les identifiants et la session du trousseau
`);
  process.exit(0);
}

if (process.argv.includes("logout")) {
  await deleteCredentials("urssaf");
  console.log("Identifiants supprimés du trousseau.");
  process.exit(0);
}

interface Compte {
  siret: string;
  orga: string;
  numc: string;
}

interface AuthResult {
  compte: Compte;
  access_token: string;
}

async function login(identifiant: string, password: string): Promise<AuthResult> {
  const res = await fetch("https://mon.urssaf.fr/cnx", {
    method: "POST",
    headers: {
      ...DEFAULT_HEADERS,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: `identifiant=${encodeURIComponent(identifiant)}&Password=${encodeURIComponent(password)}`,
    redirect: "manual",
  });

  const cookieMap = parseCookies(res);
  const ctxValue = cookieMap.get("ctxUrssaf");

  if (!ctxValue) {
    const body = await res.text();
    if (body.includes("Erreur d'identifiant ou de mot de passe")) {
      await deleteCredentials("urssaf");
      throw new Error(
        "Authentification échouée : identifiant ou mot de passe incorrect.\nLes identifiants ont été supprimés du trousseau. Relancez le script."
      );
    }
    throw new Error("Cookie ctxUrssaf non trouvé - l'API URSSAF a peut-être changé");
  }

  const { compte } = JSON.parse(Buffer.from(decodeURIComponent(ctxValue), "base64").toString());

  const { clientId } = (
    await (
      await fetch("https://webti.urssaf.fr/assets/configuration/configuration.json", {
        headers: { ...DEFAULT_HEADERS, Accept: "application/json" },
      })
    ).json()
  ).oidc.annabel;

  const b64url = (b: Buffer) => b.toString("base64url");
  const codeVerifier = b64url(randomBytes(32));

  const tokenBds = new URL(res.headers.get("Location")!).searchParams.get("tokenBds");

  const authRes = await fetch(
    `https://login.urssaf.fr/api/oauth/v1/authorize?${new URLSearchParams({
      response_type: "code",
      client_id: clientId,
      state: b64url(randomBytes(32)) + "-0000000000-webti",
      redirect_uri: "https://webti.urssaf.fr/callback",
      scope: "openid webti.metier webti.metier.v2 deci.ti offline_access ods.cedito ods.session",
      code_challenge: b64url(createHash("sha256").update(codeVerifier).digest()),
      code_challenge_method: "S256",
      nonce: b64url(randomBytes(32)),
      prompt: "none",
      subject_token: tokenBds!,
      subject_token_type: "urn:oauth2:180035016:acoss:token-bds",
    })}`,
    {
      headers: DEFAULT_HEADERS,
      redirect: "manual",
    }
  );

  const { access_token } = await (
    await fetch("https://login.urssaf.fr/api/oauth/v1/token", {
      method: "POST",
      headers: {
        ...DEFAULT_HEADERS,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code: new URL(authRes.headers.get("Location")!).searchParams.get("code")!,
        redirect_uri: "https://webti.urssaf.fr/callback",
        code_verifier: codeVerifier,
        client_id: clientId,
      }),
    })
  ).json();

  return { compte, access_token };
}

async function getEcheances({ compte, access_token }: AuthResult) {
  const annee = process.argv.find((arg) => /^\d{4}$/.test(arg)) || new Date().getFullYear();

  return (
    await fetch(
      `https://api.urssaf.fr/api-webti-be/v1/echeances?siret=${compte.siret}&categorie=TIPL&orga=${compte.orga}&numCot=${compte.numc}&view=ECHEANCIER_ANNUEL&annee=${annee}`,
      {
        headers: {
          ...DEFAULT_HEADERS,
          Authorization: `Bearer ${access_token}`,
          "Correlation-ID": crypto.randomUUID(),
        },
      }
    )
  ).json();
}

interface Echeance {
  montantTotal: number;
  montantNonPaye: number;
  paiement: { montantPaye: number };
  exigibilite: { dateExigibilite: string };
  etatEcheance: string;
}

function printEcheances(echeances: Echeance[]) {
  let totaux = [0, 0, 0];

  const formatEuro = (m: number) => `${m.toLocaleString("fr-FR")} €`;
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

// Main
const { login: identifiant, password } = await getOrPromptCredentials("urssaf", "Login (SIRET): ");
const auth = await login(identifiant, password);
const echeances = await getEcheances(auth);
printEcheances(echeances);
