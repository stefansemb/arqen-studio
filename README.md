# Arqen AI Studio

Klistra in en artikel-URL, eller ditt eget färdiga manus, och få en färdig YouTube-video (1920×1080 MP4) med AI-manus, ElevenLabs-röst, tajmade scener, B-roll från Pexels och ordmarkerade undertexter.

```
URL → fetch → clips → script → scriptCheck → voice → scenes → assets → metadata → thumbnail → render → output.mp4
```

**Från manus:** välj "From script" i UI:t (eller `--script` i CLI). Texten läses upp ordagrant; fetch, script och scriptCheck hoppas över. Separera stycken med en tom rad.

**Titel, beskrivning och thumbnail:** stegen `metadata` och `thumbnail` körs före renderingen, så en omrendering efter zoom- eller scenändringar rör inte dina titlar. Claude föreslår 5 titlar, en beskrivning, taggar (max 500 tecken), 3 hashtags och 3 thumbnailtexter. Kapitlen räknas från rösten (0:00 först, minst 3 kapitel om minst 10 s); källa och Pexels krediteras automatiskt. Tre thumbnails (1280×720) renderas med Remotion: bildrutor ur klippen för tutorials, annars artikel- och B-rollbilder. Allt redigeras under fliken **Publish**: välj titel, redigera beskrivning och taggar, kopiera, välj och ladda ner thumbnail, ändra thumbnailtext och rendera om (gratis). "Regenerate with AI" skriver över ändringarna. Sparas i `publish.json` och `thumbs/`.

**Röstväljare:** "Change voice" på startsidan och under Script i ett projekt listar rösterna i ditt ElevenLabs-konto ("My voices") med sökning och filter. ▶ spelar ElevenLabs gratis provljud (cachas i `data/voice-previews/`). "Hear it read this" läser din egen text med vald röst och hastighet (kostar ungefär en kredit per tecken, max 250; upprepningar är gratis). **Speed** 0,7–1,2×. "Set as default" sparar standardrösten i `data/app-settings.json`; annars gäller `ELEVENLABS_VOICE_ID`. Byter du röst i ett befintligt projekt genereras rösten om och scenerna planeras om (manuella scenändringar försvinner). Fler röster: lägg till dem från Voice Library på elevenlabs.io.

**Från anteckningar:** välj "From notes", skriv en punktlista, välj mall och längd och lägg till klipp om du vill. Claude skriver manuset utifrån anteckningarna och det som syns i klippen; därför analyseras klippen före manuset. Med "Let me review the script" (på som standard) stannar pipelinen med status **review** efter faktagranskningen: redigera manuset under Script och tryck **Continue**, så genereras rösten först då. Manuset går att redigera i alla projekt (sedan "Regenerate voice"). I CLI: `--notes anteckningar.txt --duration 2 [--clips <mapp>] [--to scriptCheck]`.

**Tutorials med egna klipp:** välj "From script" och mallen "Tutorial", och dra in tysta skärminspelningar (MP4/MOV/WebM/MKV). Steget `clips` konverterar dem till H.264 med 30 fps. Claude beskriver sedan vad som syns när, och scenplaneringen visar rätt del av rätt klipp vid rätt replik. Klipp som är längre än repliken snabbas upp (max 2,5×) och klipp som är kortare fryser på sista bildrutan. I CLI: `--niche tutorial --clips <mapp>`.

**Automatisk zoom:** steget `clips` jämför bildrutor (320×180, 10 per sekund) och ser var på skärmen något händer: markörrörelser, skrivande, klick som ändrar något. Kameran zoomar in mot det (max 1,8×), följer mjukt och zoomar ut vid sidbyten och scrollning eller efter 2,5 s stillhet. Det kräver inga API-anrop. Under "Scene preview" finns reglagen **Strength** (1,2–2,5×) och **Tempo** (Calm–Snappy) per projekt. Klippsteget sparar aktivitetsdatan (`clips/<id>.activity.json`), så ändringar syns i förhandsvisningen inom någon sekund och **Render** ger en ny video utan API-kostnader. Zoomen kan stängas av per scen i scenredigeraren. Standardvärden och finjustering finns i `ZOOM` i `packages/core/src/zoom.ts`. Inspelningen innehåller ingen markörposition, så en markör som rör sig över en helt stillastående skärm följs, men väldigt små rörelser räknas som brus.

**Redigera scener:** klicka på en scen under "Scene preview" för att byta klipp, ändra klippets start och slut, byta till titelkort eller B-roll, eller ändra stegetiketten. **Save** uppdaterar förhandsvisningen och **Save & render** renderar om videon utan nya AI- eller TTS-anrop. Scenernas tider följer alltid rösten.

## Kom igång

Förutsätter Node 24+ och ffmpeg/ffprobe i PATH. Första renderingen laddar ner Chrome Headless Shell (~110 MB).

1. Kopiera `.env.example` till `.env`, sätt `CHANNEL_NAME` och fyll i nycklarna:
   - `ANTHROPIC_API_KEY`: https://console.anthropic.com
   - `ELEVENLABS_API_KEY`: https://elevenlabs.io/app/settings/api-keys
   - `PEXELS_API_KEY` (gratis): https://www.pexels.com/api/
   - Valfritt: `YOUTUBE_CLIENT_ID`/`YOUTUBE_CLIENT_SECRET` (se [YouTube-uppladdning](#youtube-uppladdning)) och `TELEGRAM_BOT_TOKEN`/`TELEGRAM_CHAT_ID` (notiser från nyhetsbevakaren).
2. `npm install`
3. `npm run dev` och öppna http://localhost:3000
4. Gå till **Settings** och fyll i din kanals beskrivning, standardtext i videobeskrivningen och prenumerationslänk.

Allt du skapar (projekt, videor, databas, YouTube-inloggning) sparas i `data/`, som aldrig checkas in.

## Kommandon

| Kommando | Vad |
|---|---|
| `npm run dev` | Webb-UI (port 3000) + worker som kör jobbkön |
| `npm run pipeline -- --url <url> --duration 4` | Kör hela kedjan i terminalen |
| `npm run pipeline -- --script manus.txt --title "Titel"` | Video från eget manus |
| `npm run pipeline -- --script manus.txt --niche tutorial --clips <mapp>` | Tutorial med egna skärminspelningar |
| `npm run pipeline -- --url <url> --to script` | Stanna efter ett steg (t.ex. för att granska manus innan du betalar för TTS) |
| `npm run pipeline -- --project <id> --from voice` | Kör om från ett visst steg |
| `npm test` / `npm run typecheck` | Enhetstester / typkontroll |

npm-skripten anropar `node <sökväg>` direkt i stället för `node_modules\.bin`-genvägarna, så att de fungerar även där grupprinciper blockerar `*.cmd`-filer.

## Struktur

```
apps/web/            Next.js-UI + API (projekt, kö, filservering med Range-stöd)
apps/worker/         Pollar jobbkön i SQLite och kör pipelinen
packages/core/       Pipeline-steg, providers (Claude, ElevenLabs, Pexels, ffmpeg), SQLite
packages/video/      Remotion-komposition (scentyper, undertexter, branding)
data/                studio.db + projects/<id>/ med alla artefakter (gitignorerad)
```

Varje steg läser och skriver filer i `data/projects/<id>/` (`article.json`, `script.json`, `script-check.json`, `voice.mp3`, `timings.json`, `scenes.json`, `assets/`, `output.mp4`). Därför kan du redigera till exempel `script.json` för hand och köra om från `voice`.

## Licens

Koden är MIT-licensierad (se `LICENSE`). Tredjepartsberoenden har egna villkor:

- **Remotion** är gratis för privatpersoner och företag med högst 3 anställda. Om du säljer appen som SaaS eller white-label krävs en företagslicens (https://remotion.dev/license).
- **Pexels**-bilder får användas kommersiellt. Artikelbilder (`article`-scener) är upphovsrättsskyddade och används som nyhetskommentar; håll nere antalet.

## YouTube-uppladdning

Uppladdning sker bara när du trycker **Upload to YouTube** i fliken Publish. Titel, beskrivning, taggar och vald thumbnail följer med. Du väljer synlighet (Private, Unlisted, Public eller schemalagd), kategori, om prenumeranter ska aviseras och YouTubes märkning för AI-genererat innehåll. Uppladdningen är återupptagbar, så stora filer skickas i bitar och fortsätter efter nätverksavbrott. Samma video laddas inte upp två gånger utan att du bekräftar.

### Engångsinställning i Google Cloud (cirka 10 minuter)

Varje användare skapar sin egen OAuth-klient; appen har ingen gemensam inloggning.

1. Gå till https://console.cloud.google.com och skapa ett projekt, till exempel "Arqen AI Studio".
2. **APIs & Services → Library**: sök upp **YouTube Data API v3** och tryck **Enable**.
3. **OAuth consent screen** (Google Auth Platform):
   - Välj User type **External** och fyll i appnamn och e-post.
   - Under **Data access / Scopes** lägger du till `.../auth/youtube.upload` och `.../auth/youtube.readonly`.
   - Under **Audience / Test users** lägger du till Google-kontot som äger kanalen.
4. **Clients → Create client**: välj typen **Web application** och lägg till följande under *Authorized redirect URIs*:
   `http://localhost:3000/api/youtube/callback`
5. Kopiera Client ID och Client secret till `.env`:
   ```
   YOUTUBE_CLIENT_ID=...apps.googleusercontent.com
   YOUTUBE_CLIENT_SECRET=...
   ```
6. Starta om appen och tryck **Connect YouTube** i fliken Publish. Logga in med kanalens konto och godkänn.

### Bra att veta

- **Videor blir privata tills Google har granskat ditt API-projekt.** YouTube låser API-uppladdningar från ogranskade projekt till "private". Publicera dem manuellt i YouTube Studio (knappen *Open in Studio*), eller ansök om granskning via YouTube API Services Audit.
- **Inloggningen gäller i 7 dagar** så länge OAuth-appen har statusen *Testing*. Anslut sedan igen, eller sätt appen till *In production*. Då visas en varning om overifierad app när du loggar in (välj *Advanced → Go to app*), men inloggningen går inte ut.
- **Kvot:** en uppladdning kostar cirka 1 600 av 10 000 enheter per dygn, alltså ungefär 6 uppladdningar per dag.
- **Egna thumbnails** kräver en telefonverifierad kanal (https://www.youtube.com/verify). Annars laddas videon upp ändå, och du får en varning i loggen.
- Inloggningen sparas i `data/youtube-token.json`. **Disconnect** återkallar den hos Google och tar bort filen.

## Kanalinställningar (sidan Settings)

- **Kanalprofil:** beskrivning (max 1000 tecken), nyckelord (max 500) och land. **Save & apply to YouTube** skickar dem till kanalen.
- **Kanalgrafik:** `npm run channel-art -- [--tagline "..."] [--topics "AI News,Tutorials"]` renderar profilbilder (bland annat 3D-"A") och en banner till `data/channel/`. Bannern kan laddas upp härifrån. Profilbilden laddar du upp själv i YouTube Studio (Customization → Branding), eftersom API:t inte kan sätta den.
- **Varje video:** standardtext i beskrivningen (efter kapitel och källor), en valfri kort intro (avstängd som standard) och en slutskärm på 5–20 s. Lägg till YouTubes rutor för prenumeration och nästa video ovanpå slutskärmen i Studio.
- **Spellistor:** uppladdningar läggs automatiskt i spellistan för mallen och skapas om den saknas.
- **Standardröst.**

Att hantera kanal och spellistor kräver behörigheten `https://www.googleapis.com/auth/youtube`. Lägg till den under Data Access i Google Cloud och tryck **Reconnect** på sidan Settings.

## Batch och nyhetsförslag (sidan Batch)

1. **Find today's AI stories** läser nyhetsflödena (TechCrunch, The Verge, Ars Technica, MIT Technology Review, Wired, The Decoder, OpenAI, Google AI och Hugging Face). Claude väljer de starkaste nyheterna, slår ihop samma nyhet från flera källor och hoppar över sådant kanalen redan gjort. Det kostar några cent och tar cirka 10–30 sekunder.
2. Bocka i nyheterna du vill ha, och klistra eventuellt in egna länkar. Välj längd och röst och tryck **Make videos**. Videorna görs en i taget hela vägen till färdig video, titel och thumbnail. Sidan visar ungefärlig kreditkostnad, och kvarvarande krediter om ElevenLabs-nyckeln har behörigheten *User: Read*.
3. Under **Ready for approval** hamnar färdiga videor som inte laddats upp än. Titta på dem, justera titel och thumbnail vid behov, bocka i och tryck **Approve & upload**. **Schedule** lägger en video per dag vid vald tid på nästa lediga dag.

Inget laddas upp utan att du godkänner det. Nyhetskällorna och maxåldern (standard 72 h) ligger i `data/app-settings.json` under `autopilot`.

**Veckosammanfattning:** välj flera nyheter på sidan Batch och **One roundup video** (8, 10 eller 13 minuter, 2–8 nyheter). Videon börjar med en inledning som lockar med de största nyheterna och får sedan ett avsnitt per nyhet med övergångar; varje nyhet blir ett eget kapitel. Märket i videon är "THIS WEEK IN AI", alla källor listas i beskrivningen och videon hamnar i spellistan "This Week in AI".

## Shorts (fliken Shorts i ett projekt)

**Find Shorts** låter Claude välja upp till 3 avsnitt på 20–59 s ur den färdiga videon som fungerar på egen hand. De återanvänder rösten, så de kostar inga ElevenLabs-krediter. Varje Short får en rubrik i bild och en titel, som du kan ändra tillsammans med start- och sluttid. **Render Shorts** gör vertikala videor i 1080×1920: rubrik överst, scenen i mitten mot suddig bakgrund, stora undertexter med två eller tre ord i taget, och tomt längst ner och till höger där YouTube lägger sina knappar. **Upload Short** laddar upp direkt, med "#Shorts" i titeln och en länk till den långa videon om den redan finns på YouTube.

## Nyhetsbevakare och autopilot (sidan Watcher)

Avstängd som standard. När den är på läser workern AI-labbens egna flöden och sidor, nyhetsflödena och Hacker News var 15:e minut. Claude ger varje ny artikel nivå 1 (video nu), 2 (veckosammanfattning) eller 0. En nyhet räknas först när den är bekräftad, alltså från en officiell källa eller minst två medier. Spärrar för max antal videor per vecka, väntetid mellan videor och minsta antal ElevenLabs-krediter kvar ställs in på sidan.

**Autopilot** (av som standard) bygger och schemalägger videon automatiskt för nivå 1-nyheter. Med Telegram kopplat får du en notis med en **Stop**-knapp som gör videon privat inom stoppperioden (standard 30 min). Koppla Telegram före autopiloten: skapa en bot hos @BotFather, lägg token i `TELEGRAM_BOT_TOKEN`, skicka /start till boten och lägg chat-id:t den svarar med i `TELEGRAM_CHAT_ID`. **Send test** på Watcher-sidan kontrollerar kopplingen.
