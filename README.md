# cli-administratif

Utilitaires CLI pour récupérer des documents administratifs pour sa société. Nécessite [bun](https://bun.sh/).

Les identifiants sont sauvegardés en local dans le trousseau sécurisé de l'OS via [`Bun.secrets`](https://bun.com/docs/runtime/secrets). Utilisez `logout` pour les supprimer.

## Scripts disponibles

### mes-echeances-urssaf.ts

Consulte l'échéancier Urssaf rapidement.

```sh
./mes-echeances-urssaf.ts           # Année en cours
./mes-echeances-urssaf.ts 2024      # Année spécifique
./mes-echeances-urssaf.ts logout    # Supprime les identifiants du trousseau
```

J'en avais assez de cette infernale connexion sur le site de l'Urssaf, qui enchaîne le message d'erreur de connexion expiré, un menu déroulant avec 20 types de connexion, et des barres de chargement interminables. Je veux juste consulter mon échéancier.

[Audit](https://chatgpt.com/?prompt=le+script+suivant+peut-il+voler+mes+identifiants+https%3A%2F%2Fraw.githubusercontent.com%2Fmquandalle%2Fcli-administratif%2Frefs%2Fheads%2Fmain%2Fmes-echeances-urssaf.ts+https%3A%2F%2Fraw.githubusercontent.com%2Fmquandalle%2Fcli-administratif%2Frefs%2Fheads%2Fmain%2Futils.ts).

### mon-kbis.ts

Télécharge le KBIS d'une entreprise depuis monidenum.fr.

```sh
./mon-kbis.ts                       # Sélection interactive si plusieurs entreprises
./mon-kbis.ts 123456789             # SIREN spécifique
./mon-kbis.ts logout                # Supprime les identifiants et la session du trousseau
```

[Audit](https://chatgpt.com/?prompt=le+script+suivant+peut-il+voler+mes+identifiants+https%3A%2F%2Fraw.githubusercontent.com%2Fmquandalle%2Fcli-administratif%2Frefs%2Fheads%2Fmain%2Fmon-kbis.ts+https%3A%2F%2Fraw.githubusercontent.com%2Fmquandalle%2Fcli-administratif%2Frefs%2Fheads%2Fmain%2Futils.ts).
