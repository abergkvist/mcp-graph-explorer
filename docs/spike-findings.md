# Spike: MCP Apps i Claude Desktop

Testat 2026-11-26. Koden i `spike/` är engångskod.

## Uppställning

- Claude Desktop 6.28899.6 (macOS)
- Lokal stdio-server, `@modelcontextprotocol/server` 2.4.0, `ext-apps` 2.0.4
- Underlag: `spike/spike.log` (anrop till servern och händelser från vyn) från flera
  testomgångar. Tabellerna om processer och visningslägen kommer från den första (a, b, a).

## Viktigast: modellen och vyn pratar med olika serverprocesser

Claude Desktop startade **två** processer av samma server:

| Process | `clientInfo.name` | Tar emot |
|---|---|---|
| 64647 | `claude-ai` | `resources/read` och vyns verktygsanrop |
| 64656 | `local-agent-mode-graph-spike` | modellens verktygsanrop |

Efter tre modellanrop svarade processen som vyn når att den hade sett noll anrop.
**State i serverns minne delas alltså inte mellan modellens verktyg och vyns verktyg.**

## Frågor och resultat

| Fråga | Resultat |
|---|---|
| Visas vyn över stdio vid första anropet? | Ja. `resources/read` skedde redan före första anropet. |
| Öppnas sidopanelen utan klick? | Ja. `displayMode` gick till `fullscreen` direkt efter resultatet, vid alla tre anropen. Panelmått 623×904. |
| Fungerar "Öppna i panel"? | Anropet returnerade `fullscreen`, men vyn var redan i panelen. Inte testat från inline. |
| Andra anropet med öppen panel? | Ny vy-instans som tar över panelen. |
| Vad händer med den gamla vyn? | Byter till `inline` och ligger kvar i chatten. Ingen `teardown`. |
| Kan en gammal vy läsa nytt serverstate? | Gammal vy testades inte, men inte ens den nyaste vyn ser modellens state (se ovan). |
| Delar två chattar samma serverprocess? | Inte testat. Processerna startade en gång, vid inläsning av konfigurationen. |
| Skickar Claude något chatt-id? | Nej. `tools/call` innehöll bara `name` och `arguments`, inget `_meta`. |
| Får vyn `structuredContent`? | Ja. |
| Får modellen `structuredContent`? | Troligen inte: Claude i chatten uppgav att den bara fick textraden. |

## Vyn till chatten

| Fråga | Resultat |
|---|---|
| Annonserar hosten stödet? | Ja: `hostCapabilities` innehåller `updateModelContext` och `message`. |
| `updateModelContext` vid klick | Vyn anropade det två gånger och fick `{}` (inget fel). **Claude fick inget:** `widget_context_v0` svarade "No widget in this chat can be read right now". |
| `sendMessage` | Anropet returnerade `{}`. Vad som syntes i chatten är inte noterat. |
| Kan Claude anropa vyns egna verktyg? | Nej, inte för lokala servrar (Claudes dokumentation och `list_widget_tools`). |

Claudes dokumentation säger att modellkontext läses av Claude med ett verktygsanrop; den följer
inte med användarens meddelande. Liknande fel är rapporterade i
[anthropics/claude-ai-mcp#826](https://github.com/anthropics/claude-ai-mcp/issues/826) och
[#1217](https://github.com/anthropics/claude-ai-mcp/issues/1217). Om det beror på att servern
är lokal vet vi inte; vi har inte testat som fjärr-connector.

## Markering via `get_selection`

Vyn sparar klickad nod med ett verktyg som bara vyn ser; servern skriver den till en fil, och
modellen läser filen med `get_selection`. Behövs eftersom de två går till olika processer.

| Fråga | Resultat |
|---|---|
| "vilken station har jag markerat?" | Claude anropade `get_selection` och fick rätt nod. |
| "berätta om den här" | Claude anropade verktyget utan att markeringen nämndes. |
| Räcker nodens egna fält? | Nej. Claude efterfrågade egenskaper, kanter och grannar. |
| Tillåtelsefrågor för verktygen | Upplevdes som smidigt. |

## Historik utan sparade resultat

| Fråga | Resultat |
|---|---|
| Kan en gammal vy öppnas i panelen igen? | Ja, panelen visar då bara den grafen. |
| Även efter omstart av Claude Desktop? | Ja. Hosten gav den nya vy-instansen det sparade verktygsresultatet. |

## Övrigt

- `resources/read` skedde en gång och återanvändes för alla tre vyerna. Efter ombyggnad av
  vyn behöver MCP-konfigurationen laddas om.
- Vyn får tema, style-variabler, `containerDimensions` och `safeAreaInsets` i
  `host-context-changed` efter anslutningen.

## Slutsatser för canvas-designen

- Canvas-state i minnet per MCP-session fungerar inte.
- Vyn måste få sitt innehåll antingen i verktygsresultatet eller från ett lager som båda
  processerna når (t.ex. disk).
- En vy behöver inte bevaka nyare state: varje modellanrop ger en ny vy som tar över panelen.
- Sammanfattningen till modellen måste ligga i `content`, inte bara i `structuredContent`.

## Beslut (2026-11-26)

- Grafen skickas till vyn i `structuredContent`. Servern sparar inga frågeresultat.
- Historik är de tidigare vyerna i chatten; inga bakåt/framåt-knappar i v1.
- Markering når Claude via `get_selection`, som ska returnera egenskaper och grannar (ett hopp).
- `sendMessage` används inte (allt syns i chattrutan). `updateModelContext` nådde inte Claude.
- stdio först.
