# Design: grafvisualisering i Claudes sidopanel

Datum: 2026-11-26. Bakgrund: [spike-findings.md](spike-findings.md).

**[val]** markerar sådant som inte diskuterats uttryckligen utan är ett förslag att ändra.

## Syfte

Open source-showcase (Apache-2.0): en MCP-server som kopplar en grafdatabas över Bolt till
Claude Desktop och visar frågeresultat som en interaktiv graf i sidopanelen. Användaren frågar
i chatten, Claude skriver Cypher, servern kör den och panelen visar resultatet utan att det
scrollar bort.

## Mål för v1

- Neo4j och Memgraph, en databas per serverpost i Claude Desktops konfiguration.
- Graf, tabell eller stort tal beroende på resultatet.
- Klick på en nod visar detaljer; noden kan expanderas; Claude kan ta reda på vad som är markerat.
- Går att prova med `docker compose up` och medföljande testdata.
- `normalizer` kan återanvändas av andra.

## Inte i v1

- Egna skrivverktyg. Skrivningar går bara att slå på för `run_cypher`, se Säkerhet.
- Extra bekräftelseflagga i `.env` för skrivläget (tas senare).
- Egen historik eller bakåt/framåt-knappar. Historiken är de tidigare vyerna i chatten.
- `sendMessage` och `updateModelContext` från vyn.
- Streamable HTTP, andra databaser (ArcadeDB, Apache AGE), publicering på npm **[val]**.
- Markering av flera noder; bakgrundskarta. (Kartlayout utan bakgrund lades till efter v1.)

## Andra hosts

v1 byggs och testas för Claude Desktop. Vyn och servern håller sig till MCP Apps-specen där
det går; `preferredDisplayMode` är ett Claude-tillägg som inget får vara beroende av.
ChatGPT är otestat och README lovar inget om det **[val]**.

## Misslyckande, även om allt "fungerar"

- Hela grafen skickas till modellen i text.
- En fråga kan ändra data utan att användaren uttryckligen slagit på skrivläget.
- Resultat kapas utan att det syns.
- Repot sväller: extra paket, abstraktioner eller tester som inte behövs.

## Begränsningar (verifierade i spiken)

- Claude Desktop startar två serverprocesser: modellens anrop går till en, vyns till en annan.
  Inget får förutsätta delat minne.
- Varje modellanrop ger en ny vy som tar över panelen; den gamla ligger kvar inline.
- En gammal vy får sitt sparade verktygsresultat igen, även efter omstart.
- Vyn får `structuredContent`; modellen ska få allt den behöver i `content`.
- Inget chatt-id skickas till servern.
- `resources/read` cachas av hosten.
- `updateModelContext` når inte modellen.
- Enligt Claudes dokumentation kan stora verktygsresultat (cirka 150 000 tecken) hindra vyn från att ladda.
- Sidopanelen finns inte för alla; vyn måste fungera inline och i helskärm.

## Vägval

| Fråga | Alternativ | Valt och varför |
|---|---|---|
| Hur får vyn sin data? | A: allt i verktygsresultatet. B: ögonblicksbilder på disk. C: gemensam bakgrundsprocess. | **A.** Enklast, inga resultat på disk, historiken finns ändå i chatten. |
| Hur får Claude veta markeringen? | `updateModelContext`; `sendMessage`; fil + verktyg. | **Fil + `get_selection`.** Det första når inte fram, det andra syns i chattrutan. |
| Visualisering | Cytoscape.js; Sigma.js; G6; force-graph. | **Sigma 4 + graphology.** Modernare, bra händelser, klarar stora grafer. |
| Rena värdesvar | Alltid i panelen; separat verktyg utan vy. | **Alltid i panelen.** Ett verktyg, förutsägbart. |

## Stack och struktur

TypeScript, Node 22, pnpm-monorepo, Vitest. MCP: `@modelcontextprotocol/server` 2.x och
`@modelcontextprotocol/ext-apps` 2.x. Databas: `neo4j-driver`. Vy: Vite +
`vite-plugin-singlefile`, en självständig HTML-fil. UI: React, Tailwind och shadcn/ui; bara de
komponenter som används tas in.

```
packages/normalizer   resultat → noder, kanter, tabell (inga MCP-beroenden)
packages/server       verktyg, dialekter, auto-connect, markering
packages/view         vyn; Sigma bakom ett litet renderer-interface
docker/               compose för Neo4j och Memgraph, testdata
docs/
```

Interfacet är bara så stort som Sigma-implementationen behöver.

Kod, verktygsbeskrivningar, UI-texter och README skrivs på engelska **[val]**.

## Konfiguration **[val]**

Miljövariabler: `GRAPH_URI`, `GRAPH_USER`, `GRAPH_PASSWORD`, `GRAPH_DATABASE` (valfri),
`GRAPH_DIALECT` (`neo4j` eller `memgraph`), `GRAPH_ACCESS_MODE` (`read`, förval, eller `write`).

## Normaliserat format

```
{ nodes: [{ id, labels, props, placeholder? }],
  edges: [{ id, type, source, target, props }],
  table: { columns, rows },
  meta:  { danglingEdges, truncated, autoConnectedEdges, dialect } }
```

- Går rekursivt igenom alla värden: Node, Relationship, Path, listor, maps.
- Deduplicerar noder och kanter på id. Alla id är strängar.
- Heltal, temporala och spatiala typer blir JSON-säkra. Heltal utanför JavaScripts säkra
  intervall blir strängar **[val]**.
- Saknad ändpunkt: en platshållarnod (`placeholder: true`) läggs till och räknas i
  `meta.danglingEdges` **[val]**.
- Tabellen har de kolumner som innehåller något annat än grafobjekt. Grafobjekt inuti en
  sådan cell ersätts av en referens med id **[val]**.

## Dialekter

En dialekt ger id-uttryck (`elementId()` i Neo4j, `id()` i Memgraph), hur id skickas som
parameter och hur schemat läses. Gränssnittet utgår från "drivrutin → normaliserat format",
inte från Bolt.

## Verktyg

Synliga för modellen:

**`get_schema`**: labels, relationstyper och properties med några exempelvärden, samt dialekt.

**`run_cypher`** (har vy): `answer_query` (krävs), `context_query` (valfri subgraf), `params`
(valfri) **[val]**, `connect`: `"auto"` (förval), `true`, `false`.

- Grafen är unionen av båda frågornas grafobjekt; tabellen kommer från `answer_query`.
- Verktygsbeskrivningen innehåller visualiseringskontraktet: returnera noder, relationer eller
  paths (`RETURN p`) hellre än projektioner, skalärer i egna kolumner, och lägg till
  `context_query` när svaret saknar noder.
- `content` till modellen: antal per label och relationstyp, några välkopplade noder,
  tabellrader (högst 50) **[val]** och vad som kapats. Aldrig hela grafen.
- `structuredContent` till vyn: det normaliserade formatet.
- Frågefel returneras som verktygsfel med databasens meddelande, så att Claude kan rätta frågan.
- Servern skriver inte om användarens Cypher.

**`get_selection`**: den senast klickade noden med labels, properties, grannar ett hopp
(högst 25) **[val]** och hur gammal markeringen är. Beskrivningen säger att verktyget ska
anropas när användaren syftar på något utan att namnge det ("this", "den här", "härifrån").

Bara för vyn (`visibility: ["app"]`):

**`select_node`**: sparar eller rensar markeringen.

**`expand_node`**: grannarna till en nod i normaliserat format (högst 50 kanter) **[val]**.

`get_canvas` från ursprungsförslaget utgår.

## Auto-connect

Efter normaliseringen hämtas riktade relationer `(a)-[r]->(b)` där båda id:n finns i
resultatet, med taket `maxEdges`. `"auto"` betyder: hämta bara om resultatet har minst två
noder och inga egna relationer **[val]**. `true` hämtar alltid.

## Markeringen

En liten JSON-fil i användarens datakatalog, en per anslutning (URI + databas) **[val]**,
skriven atomiskt. Den innehåller nodens id och en tidsstämpel, inget annat; `get_selection`
slår upp resten i databasen. Den är gemensam för alla chattar: senaste klicket vinner.
Klick på bakgrunden rensar. Finns noden inte längre säger verktyget det.

## Säkerhet och gränser

- **Förval `read`:** READ-session, explicit transaktion som alltid rullas tillbaka. Ingen
  regex-kontroll av frågor.
- Verifierat 2026-11-26: Neo4j avvisar skrivningar i läsläge. Memgraph gör det **bara i en
  explicit transaktion**; en fristående fråga i en READ-session skriver. Kör därför aldrig
  fristående frågor.
- **`write` är användarens uttryckliga val.** Då får `run_cypher`s `answer_query` skriva och
  ändringen committas. Allt annat (context, schema, auto-connect, markering, expandering) läser.
  Verktyget märks som destruktivt, och beskrivningen och startloggen säger att skrivning är på.
- README förklarar varför `read` är förval (frågorna skrivs av Claude, och text i datan kan
  påverka vad Claude gör) och vad `write` innebär: ändringar och raderingar utan ångra, och
  utan fråga om verktyget är tillåtet med "Always allow".
- `LOAD CSV` kan även i läsläge läsa filer (Memgraph) eller nätverksadresser (Neo4j) från
  databasservern. README säger det.
- Gränser **[val]**: 1 000 rader, 500 noder, 2 000 kanter, 30 s timeout. Radgränsen sätts
  genom att sluta läsa resultatet, inte genom att lägga `LIMIT` i frågan.
- `structuredContent` hålls under cirka 140 000 tecken: långa strängar kortas först, sedan
  tas noder bort **[val]**.
- All kapning syns i `meta.truncated`, i texten till modellen och i vyn.
- README säger att schemaexempel och resultatsammanfattningar skickas till Claude.

## Vyn

```
┌ Graf │ Tabell ──────── sök, filter  [Öppna i panel] ┐
│        ●───●───●                                    │
│             ╲  ●                                    │
├ Falun C · Station ──────────────────────────────────┤
│ egenskaper …                             [Expandera]│
└─────────────────────────────────────────────────────┘
```

| Resultat | Visas |
|---|---|
| Noder eller kanter | Graf; tabellflik om det finns värden |
| Bara värden | Tabell |
| En rad, en kolumn, ingen graf | Stort tal eller värde |
| Inga rader | Meddelande om att frågan gav inga träffar |

- Färg och form per label (stödet för former i Sigma 4 kontrolleras; annars bara färg),
  tooltip med properties, sökning och filter på label.
- Layout: ForceAtlas2 (förval), geografisk (när noderna har koordinater) eller cirkulär.
  Noder kan dras. (Tillagt 2026-11-26 efter v1.)
- Expanderade noder finns bara i den öppna vyn och försvinner om den laddas om.
- Deklarerar `inline` och `fullscreen`; resursen sätter `preferredDisplayMode: "fullscreen"`.
  "Öppna i panel" anropar `requestDisplayMode` i klickhanteraren.
- Eget neutralt, modernt och minimalistiskt utseende, som inte efterliknar någon viss host.
  shadcn:s neutrala bas; grafens färger, kanter, etiketter och markering utformas för sig.
- Följer hostens storlek, ljust/mörkt tema och safe areas, och lyssnar på
  `host-context-changed`. Hostens style-variabler för färg och typsnitt används inte **[val]**.
- Resursens URI innehåller en hash av vyn, så att cachen inte ger gammal HTML **[val]**.
- **Tidigt test i Claude Desktop:** järnvägsnätet är läsbart i en smal panel, och tio gamla
  vyer i samma chatt visas fortfarande (gräns för antalet WebGL-ytor). Misslyckas testet görs
  först små åtgärder (t.ex. skapa och släppa renderaren efter synlighet). Räcker inte det
  stannar arbetet för beslut **[val]**.

## Testdata

Urval ur RINF (EU:s järnvägsregister) för Dalarna och Gävle: 82 driftplatser (`Station` och
`Junction`) och 84 bandelar: `(a)-[:CONNECTS]->(:TrackSection)-[:CONNECTS]->(b)`. Genereras
med `docker/make-seed.mjs`. Samma data i båda databaserna. (Ändrat 2026-11-26 från
handskriven data; användaren utgår från att RINF får återpubliceras som öppna data.)

## Tester

Bara nödvändiga: enhetstester för normaliseraren (ett fall per krav ovan, skrivna först),
dialekternas id-hantering och gränserna. Ett litet integrationstest mot båda databaserna för
läsläget, som körs när compose är uppe **[val]**.

## Faser

1. Verifiera läsläget. Monorepo, docker compose, testdata.
2. Normaliseraren, testdrivet.
3. Server: `get_schema`, `run_cypher`, gränser, auto-connect.
4. Vy: graf, tabell, stort tal, tema. WebGL- och läsbarhetstestet.
5. Detaljer, markering, expandering, sök och filter.
6. README med gif eller skärmdump, konfiguration för Claude Desktop, CI.

Spikkoden tas bort. Små commits med tydliga meddelanden.

## Lämnat till den som bygger

Intern modulindelning, färgpalett, ForceAtlas2-inställningar, hur schemat samplas, hur
testdatan laddas i respektive databas och CI-leverantör (GitHub Actions om inget annat sägs).
