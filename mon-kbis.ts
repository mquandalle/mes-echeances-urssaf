#!/usr/bin/env bun

import { join } from "node:path";
import {
  getOrPromptCredentials,
  deleteCredentials,
  getSessionToken,
  setSessionToken,
  deleteSessionToken,
  DEFAULT_HEADERS,
  parseCookies,
  ask,
} from "./utils.ts";

interface Entreprise {
  id: string;
  denomination: string;
  siren: string;
  formeJuridique: string;
}

if (process.argv.includes("--help") || process.argv.includes("-h")) {
  console.log(`Usage: ./download-kbis.ts [SIREN] [logout]

Télécharge le KBIS d'une entreprise depuis monidenum.fr.

Options:
  SIREN     SIREN de l'entreprise (optionnel si une seule entreprise)
  logout    Supprime les identifiants et la session du trousseau
`);
  process.exit(0);
}

if (process.argv.includes("logout")) {
  await deleteCredentials("kbis");
  await deleteSessionToken("kbis");
  console.log("Identifiants et session supprimés du trousseau.");
  process.exit(0);
}

downloadKbis();

async function downloadKbis(): Promise<void> {
  const phpsessid = await authenticate();

  const entreprises = await getEntreprises(phpsessid);
  const sirenArg = process.argv.find((arg) =>
    /^\d{9}$/.test(arg.replace(/\s/g, "")),
  );
  const entreprise = await selectEntreprise(entreprises, sirenArg);

  console.log(`Téléchargement du KBIS de ${entreprise.denomination}...`);

  const kbisRes = await fetch(
    "https://monidenum.fr/mon-espace/gestion-kbis-scoring/kbis/get",
    {
      method: "POST",
      headers: {
        ...DEFAULT_HEADERS,
        "Content-Type": "application/x-www-form-urlencoded",
        Cookie: `PHPSESSID=${phpsessid}`,
        "X-Requested-With": "XMLHttpRequest",
      },
      body: `idEntreprise=${entreprise.id}`,
    },
  );

  const kbisJson = await kbisRes.json();
  if (!kbisJson.success) {
    throw new Error(`Échec de la demande KBIS: ${kbisJson.message}`);
  }

  const pdfRes = await fetch(`https://monidenum.fr${kbisJson.url}`, {
    headers: { ...DEFAULT_HEADERS, Cookie: `PHPSESSID=${phpsessid}` },
  });

  if (!pdfRes.ok) {
    throw new Error(`Échec du téléchargement du PDF: ${pdfRes.status}`);
  }

  const outputPath = join(import.meta.dir, `kbis_${entreprise.siren}.pdf`);
  await Bun.write(outputPath, await pdfRes.arrayBuffer());
  console.log(`KBIS téléchargé: ${outputPath}`);
}

async function login(email: string, password: string): Promise<string> {
  const loginPageRes = await fetch("https://monidenum.fr/login", {
    redirect: "manual",
  });
  const keycloakUrl = loginPageRes.headers.get("location")!;

  const keycloakRes = await fetch(keycloakUrl);
  const keycloakHtml = await keycloakRes.text();

  const authCookies = keycloakRes.headers
    .getSetCookie()
    .map((c) => c.split(";")[0])
    .filter((c) => c.startsWith("AUTH_SESSION_ID"))
    .join("; ");

  const actionMatch = keycloakHtml.match(/action="([^"]+)"/);
  if (!actionMatch)
    throw new Error(
      "Impossible de trouver l'URL d'action du formulaire Keycloak",
    );
  const actionUrl = actionMatch[1].replace(/&amp;/g, "&");

  const loginRes = await fetch(actionUrl, {
    method: "POST",
    headers: {
      ...DEFAULT_HEADERS,
      "Content-Type": "application/x-www-form-urlencoded",
      Cookie: authCookies,
    },
    body: `username=${encodeURIComponent(email)}&password=${encodeURIComponent(password)}&credentialId=`,
    redirect: "manual",
  });

  const redirectUrl = loginRes.headers.get("location");
  if (loginRes.status !== 302) {
    const body = await loginRes.text();
    const errorMatch = body.match(/class="alert[^"]*"[^>]*>([^<]+)/);
    const errorMessage = errorMatch
      ? errorMatch[1].replace(/&#39;/g, "'").trim()
      : "Erreur inconnue";
    throw new Error(`Authentification: ${errorMessage}`);
  }
  if (!redirectUrl || !redirectUrl.includes("monidenum.fr")) {
    throw new Error("Redirection inattendue après authentification");
  }

  let currentUrl = redirectUrl;
  let phpsessid = "";

  for (let i = 0; i < 5; i++) {
    const res = await fetch(currentUrl, { redirect: "manual" });
    const cookies = parseCookies(res);
    const sessionCookie = cookies.get("PHPSESSID");
    if (sessionCookie) {
      phpsessid = sessionCookie;
      break;
    }
    const nextUrl = res.headers.get("location");
    if (!nextUrl || res.status !== 302) break;
    currentUrl = nextUrl.startsWith("http")
      ? nextUrl
      : `https://monidenum.fr${nextUrl}`;
  }

  if (!phpsessid)
    throw new Error("PHPSESSID non trouvé après les redirections");
  return phpsessid;
}

async function authenticate(): Promise<string> {
  const cached = await getSessionToken("kbis");
  if (cached) return cached;

  const { login: email, password } = await getOrPromptCredentials(
    "kbis",
    "Email monidenum.fr: ",
  );
  const phpsessid = await login(email, password);
  await setSessionToken("kbis", phpsessid, 30);
  return phpsessid;
}

async function getEntreprises(phpsessid: string): Promise<Entreprise[]> {
  const res = await fetch(
    "https://monidenum.fr/mon-espace/gestion-kbis-scoring/",
    {
      headers: { ...DEFAULT_HEADERS, Cookie: `PHPSESSID=${phpsessid}` },
    },
  );
  const html = await res.text();

  const entreprises: Entreprise[] = [];
  const regex =
    /id="lienKbis_(\d+)".*?data-ident="(\d+)".*?<\/div>\s*<\/div>/gs;
  const rowRegex = /<div class="row tr">([\s\S]*?)<\/div>\s*<\/div>\s*<\/div>/g;

  let match;
  while ((match = rowRegex.exec(html)) !== null) {
    const row = match[1];
    const idMatch = row.match(/data-ident="(\d+)"/);
    const denomMatch = row.match(
      /title="([^"]+)">\s*([^<]+)\s*<\/div>\s*<div class="col-lg-1-5/,
    );
    const sirenMatch = row.match(
      /title="([\d\s]+)">\s*([\d\s]+)\s*<\/div>\s*<div class="col-lg-2-5/,
    );
    const formeMatch = row.match(
      /col-lg-2-5 td"[^>]*>\s*(?:<span[^>]*>[^<]*<\/span>\s*)?(SARL|SAS|SA|EURL|SCI|SASU|[^<\n]+)/,
    );

    if (idMatch && denomMatch && sirenMatch) {
      entreprises.push({
        id: idMatch[1],
        denomination: denomMatch[2].trim(),
        siren: sirenMatch[2].replace(/\s/g, ""),
        formeJuridique: formeMatch ? formeMatch[1].trim() : "",
      });
    }
  }

  return entreprises;
}

async function selectEntreprise(
  entreprises: Entreprise[],
  sirenArg?: string,
): Promise<Entreprise> {
  if (entreprises.length === 0) {
    throw new Error("Aucune entreprise trouvée sur ce compte");
  }

  if (sirenArg) {
    const found = entreprises.find(
      (e) => e.siren === sirenArg.replace(/\s/g, ""),
    );
    if (!found) throw new Error(`SIREN ${sirenArg} non trouvé`);
    return found;
  }

  if (entreprises.length === 1) {
    return entreprises[0];
  }

  console.log("\nEntreprises disponibles :");
  entreprises.forEach((e, i) => {
    console.log(
      `  ${i + 1}. ${e.denomination} (${e.siren}) - ${e.formeJuridique}`,
    );
  });

  const choice = await ask("\nNuméro de l'entreprise: ");
  const index = parseInt(choice, 10) - 1;
  if (isNaN(index) || index < 0 || index >= entreprises.length) {
    throw new Error("Choix invalide");
  }
  return entreprises[index];
}
