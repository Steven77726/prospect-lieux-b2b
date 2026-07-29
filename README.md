# Prospect Lieux B2B

Premiere version fonctionnelle d'un CRM de prospection pour Steven et Gabriel.

## Lancer l'application

```bash
cd "/Users/stevenohayon/Documents/New project/prospect-lieux-b2b"
npm start
```

Ouvrir ensuite `http://localhost:4317`.

## Fonctions de cette version

- Actualisation gratuite via OpenStreetMap / Overpass API, limitee a 20 lieux.
- Recherche ciblee sur salles, restaurants, auditoriums, hotels, salles de reunion, lofts, rooftops et espaces evenementiels.
- Anti-doublon conserve par identifiant externe OSM, telephone, nom normalise et adresse normalisee.
- Ajout manuel d'un lieu depuis l'interface.
- Champ `Lien Google Maps`.
- Champ `Statut Kactus` a verifier manuellement.
- Bouton de recherche Google `nom du lieu Kactus` dans chaque fiche.
- Donnees commerciales conservees et jamais ecrasees par la synchronisation.

## Configuration gratuite

Copier `.env.example` vers `.env`, puis renseigner les cles si besoin.

- Aucune cle API n'est obligatoire.
- La synchronisation bascule automatiquement entre trois serveurs Overpass gratuits.
- `SYNC_LIMIT=20` garde le premier test limite a 20 lieux.
- L'application n'utilise aucun service demandant une carte bancaire.
- Si l'endpoint public Overpass est surcharge, l'application affiche un message clair et ne modifie aucune donnee commerciale.

## Donnees

La base SQLite locale est creee automatiquement dans `data/prospect-lieux-b2b.sqlite`.

Les donnees publiques synchronisables sont separees des donnees commerciales privees :

- `venues` : nom, adresse, telephone, site, photos, categories, identifiant externe OSM, lien Google Maps, Kactus, sources.
- `commercial_data` : responsable, statut, commentaires, contact, relances, interet.
- `history` : journal chronologique par lieu.
- `sync_runs` : bilan des synchronisations.
- `users` : Steven et Gabriel.

## Mise en ligne pour 2 postes

Etat actuel: l'application fonctionne comme serveur Node avec SQLite local.

Pour travailler depuis deux postes avec les memes donnees, utiliser une seule instance serveur accessible par les deux postes:

1. Publier le code sur un depot GitHub dedie.
2. Heberger le serveur Node sur une machine commune ou un hebergeur Node.
3. Garder une base unique:
   - soit SQLite sur le serveur commun;
   - soit migration vers Supabase Postgres pour une base distante partagee.

Important: le fichier SQLite est ignore par Git pour ne pas publier les donnees commerciales.

Supabase: le projet doit etre actif avant migration. Les tables exposees via API doivent utiliser RLS et des droits explicites.

### Preparation Supabase

Le dossier `supabase/migrations` contient le schema Postgres pret pour Supabase.

Quand le projet Supabase est actif:

1. Appliquer `supabase/migrations/0001_initial_schema.sql`.
2. Exporter les donnees SQLite:

```bash
npm run export:supabase
```

3. Importer le fichier genere `supabase/seed-from-sqlite.sql` dans Supabase.

Ne jamais publier `.env` ni `data/*.sqlite` sur GitHub.

## Limites de cette V1

- L'actualisation OpenStreetMap/Overpass est limitee a 20 lieux pour ce premier test.
- Le statut Kactus est a verifier manuellement. Un bouton ouvre une recherche Google `nom du lieu Kactus`.
- L'application ne supprime jamais automatiquement un lieu.
