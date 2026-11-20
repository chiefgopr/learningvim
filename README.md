# VIMQUEST

An interactive, arcade-paced web game that teaches authentic Vim motions, search, operators, and text objects.

**Play Live:** https://chiefgopr.github.io/learningvim/

## Features

- **6-Chapter Campaign (24 Levels):** Progress from home-row navigation (`h j k l`) through word warping (`w b e W B E`), line anchors & sniper finds (`0 ^ $ f F t T ; ,`), vertical teleports (`gg G {count}j/k { } %`), search (`/` `? n N * #`), and Vimblade combat (`x r dw dd D di" ci" di( di{ u`).
- **Boss Encounters:** Timed boss stages at the end of every chapter (`WARDEN-01`, `TOKEN-SENTINEL`, `PRISM-GRID`, `SPIRE-OVERSEER`, `LOG-DAEMON`, `REFACTOR-DRAGON`).
- **Arcade Blitz (60s):** Endless waves across Apprentice, Adept, and Master difficulties.
- **Free Sandbox & Motion Mastery:** Practice freely on realistic code snippets and track how many times you use each motion (`F1` Cheat Sheet).

## Local Development

```bash
npm start
```

Open `http://127.0.0.1:4173` in your browser.

## Tests

```bash
npm test
```
