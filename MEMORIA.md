# Memòria de «Mirall de veu» (per clonar-lo en una versió per a instrument)

Tot el que cal saber del videojoc de cant **Mirall de veu** per copiar el projecte i fer-ne un de semblant on l'alumnat, en lloc de cantar, toqui la frase amb el seu instrument. Escrit el 16 d'octubre de 2026, amb l'eina a la versió del commit `b782206`.

## 1. Qui, què i on

- **Què és**: una pàgina web on l'alumnat de secundària (sense coneixements de música) carrega una cançó, el programa en separa la veu, la talla en frases, i per a cada frase: l'escolta, la canta sobre la base mentre se'l grava, i veu la seva veu dibuixada sobre les notes de l'original a l'estil SingStar, amb «X / N notes encertades» i un consell.
- **On**: <https://rockin-cat.github.io/mirall-de-veu/> (repo públic `rockin-cat/mirall-de-veu`, GitHub Pages des de `main`). Fitxers: `index.html` (tota l'aplicació, ~177 KB), `coi.js` (service worker), `rockin-logo.svg`, `README.md`.
- **Flux de treball**: Claude clona el repo al seu espai, edita `index.html`, prova amb Playwright i fa commit + push directament. Els commits van signats com a `Rockin <info@rockin.cat>` i **sense** cap línia «Co-Authored-By: Claude» (ella ho va demanar explícitament). El navegador cacheja: recarregar amb Maj+recàrrega.
- **Per clonar**: fer un repo nou a `rockin-cat` (p. ex. `mirall-de-guitarra`), copiar els quatre fitxers, canviar el títol i els textos, activar GitHub Pages (branca `main`, arrel). No cal cap build.

## 2. Arquitectura general

Un sol fitxer HTML amb CSS i JavaScript «vanilla» (sense bundler ni framework). Canvas per a la forma d'ona i l'escenari de notes; Web Audio API per reproduir i gravar; dues llibreries externes carregades des de CDN només quan calen:

| Peça | Què és | On |
|---|---|---|
| `onnxruntime-web@1.21.0` (`ort.all.mjs`) | Motor que executa el model de separació (WebGPU o WebAssembly multifil) | `https://cdn.jsdelivr.net/npm/onnxruntime-web@1.21.0/dist/` |
| `demucs-web@1.0.2` | Embolcall de Demucs v4 (htdemucs) per a navegador: `new DemucsProcessor()`, `separate(L,R)` → `{vocals, drums, bass, other}` | `https://cdn.jsdelivr.net/npm/demucs-web@1.0.2/src/index.js` |
| Model `htdemucs_embedded.onnx` (~170 MB) | Pesos de Demucs; es descarrega de Hugging Face la primera vegada i es guarda amb la Cache API (`mirall-de-veu-models`) | `lib.CONSTANTS.DEFAULT_MODEL_URL`, reserva `timcsy/demucs-web-onnx` |
| `mpg123-decoder@1.0.3` | Descodificador MP3 en WASM, només si el navegador no pot amb el fitxer | CDN jsdelivr |
| `coi.js` | Service worker que afegeix les capçaleres COOP/COEP a totes les respostes perquè la pàgina quedi *cross-origin isolated* i el WASM pugui ser multifil (GitHub Pages no deixa posar capçaleres). Al primer accés la pàgina es recarrega sola un cop. Per això el logo és local. | arrel del repo |

**L'estat és un sol objecte `S`** (línia ~591): `mix {L,R,sr}` (cançó), `stem {L,R}` (veu separada), `vL/vR` (veu), `iL/iR` (base = mescla − veu), `det` (veu filtrada per detectar), `env/dom/voiced/stable/cons` (anàlisi per trames de 10 ms), `phrases[]`, `cur` (frase seleccionada), `take` (presa seleccionada), `beats/period/dbShift`, `semis` (to), `gv/ga/gyou/gbase` (volums), `range` (rang vocal), `pvL/pvR/piL/piR` (veu i base transposades si hi ha canvi de to).

**Una frase** és `{id, start, end, raw:{s,e}, lyr (títol lliure), takes:[], ref (caché de la melodia)}`. **Una presa** és `{id, n, data: Float32Array, sr, withAcc, mode ('guide'|'base'|'none'|'full'), rate, semis, lat (latència), nudge, track (pitch), score, autoOff}`.

**Ordre del codi dins `index.html`** (línies aproximades): CSS → HTML (barra superior amb pestanyes, vista Cançó, vista Canta, vista Rang vocal, vista Ajuda, barra inferior) → JS: utilitats i estat (570–600) · DSP: `bandpass`, `pitchTrack`, `noteSeg` (598–665, 1957) · `buildSources`, `analyse`, `detect`, `refTrack` (668–790) · ritme: `onsetEnvelope`, `estimatePeriod`, `trackBeats`, `snapPhrases`, `entryFor` (790–880) · sessions: IndexedDB i `.mirall` (879–970) · pestanyes `showView/setTabs` (973–990) · lectura d'àudio `decodeAny`, `loadMixFile`, `loadSong` (991–1105) · separació `separateVoice` (1166–1278) · reproducció, reverb, *time-stretch*, canvi de to (1290–1416) · control d'execució, micròfon, accions `listen/recordOnly/cycle/doRecord` (1419–1527) · rang vocal (1528–1745) · cançó sencera (1746–1821) · comparació `compareData` (1822) · canvases: forma d'ona i escenari `drawCompare` (1859–2000) · `renderPhrases/renderDesk` i esdeveniments (2002 en endavant) · mode senzill/complet al final.

## 3. Pipeline d'àudio

1. **Lectura** (`decodeAny`): `decodeAudioData`; si falla, olora el contenidor real (`sniffAudio`: WAV/FLAC/Ogg/M4A/MP3/AAC…), neteja etiquetes ID3/APE i brossa inicial (`stripMp3Tags`), prova el descodificador WASM, i si res funciona diu quin format és de debò i què fer. Tot es remostreja a 44,1 kHz estèreo (`toLR`).
2. **Separació** (`separateVoice`): carrega ORT i demucs-web amb temps límit (45 s), baixa el model amb progrés, i tria motor: amb `#oEngine` = automàtic prova un tros de 8 s a la GPU i a la CPU i es queda el més ràpid (`benchProc`); comprova que les pistes no siguin NaN/buides (`checkStem`) i si la GPU falla cau a CPU. Mostra «Motor: … · GPU: … · fils: …» a `#engineInfo`. Resultat: `S.stem` = vocals; **la base és `mix − vocals`** (no les altres tres pistes sumades, per no perdre res). També es pot carregar una pista de veu pròpia (`#fStem`) o treballar «aproximat» sense separar (veu = centre de l'estèreo, base = laterals).
3. **Fonts** (`buildSources`) i **anàlisi** (`analyse`), per trames de 10 ms (`S.hop`) amb finestra de 40 ms:
   - `env`: energia en dB de la veu passada per un pas-banda 120–3500 Hz.
   - `dom`: domini de la veu sobre la mescla en dB, suavitzat ±150 ms (rebutja instruments que s'han colat a la pista de veu).
   - `voiced`/`stable`: trames amb altura detectada dins del rang vocal (MIDI 43–86) i trames dins d'una nota mantinguda ≥ 120 ms («cantat»).
   - `cons`: transitòries d'alta freqüència (consonants). Existeix però ve **desactivat per defecte** (`#dCons` = 0): en cançons en directe rebutjava cant real.

## 4. Detecció de frases (`detect`)

- Una trama és «activa» si `env > p95 + sensibilitat` (`#dSens`, −22 dB), la veu domina la mescla (`#dDom`, −18 dB) i hi ha altura a ±100 ms.
- Trams actius → unió si el silenci entre ells < `#dGap` (0,35 s) → segona passada que uneix veïns separats < 0,8 s si el resultat no passa del 85 % de la durada màxima.
- Filtre de «cant»: cal ≥ 0,25 s de trames `stable` i que siguin ≥ `#dSing` (15 %) del tram. El que no passa queda com a **tram dubtós** («ghost», gris a la forma d'ona, un clic el converteix en frase).
- Trams més llargs que `#dMax` (7 s) es tallen on la cantant **respira**: puntuació = profunditat de la caiguda d'energia respecte al màxim local (±0,5 s) ×0,5 + 8 si hi ha ≥ 6 trames sense altura (3 si ≥ 3) + 4 × centralitat; es busca entre el 25 % i el 75 % del tram (mínim 1,5 s de cada vora).
- Marges: −0,08 s a l'inici, +0,18 s al final; si hi ha pulsació detectada, `snapPhrases` ajusta les vores a la graella de corxeres (`#oSnap`).
- Després, una frase sencera amb mediana d'altura **≥ 12 semitons per sota** de la mediana de tota la cançó passa a dubtosa («sembla un instrument, no veu»): és un violoncel o un baix que Demucs ha deixat a la pista de veu.
- **Ritme** (`analyseRhythm`): envolupant d'onsets → autocorrelació per al període (60–200 BPM, amb ÷2/×2 manuals) → programació dinàmica per als temps → `bestDownbeat` tria el temps 1. Serveix per a l'**entrada** (`entryFor`): la base comença 1 o 2 compassos abans de la frase, amb un 1-2-3-4 visual gran (no sonor: ella no vol metrònom).

## 5. Altura i melodia de referència

- `pitchTrack(x, sr)`: YIN propi. Submostreig a ~11 kHz, finestra 25 ms, salt 10 ms, període de 1 ms a 14 ms (70–1000 Hz), llindar 0,15 (o mínim global < 0,3), interpolació parabòlica, porta d'energia al 7 % del màxim. **Continuïtat d'octava**: si la millor candidata és a > 7 semitons de les 3 trames anteriors i hi ha una candidata a l'octava amb `d < 0,35` que queda > 3 semitons més a prop, es queda aquesta. Després, mediana de 5 i eliminació de trams sonors < 60 ms que salten > 7 semitons respecte als dos veïns.
- `noteSeg(tr)`: segmenta en notes (desviació < 0,75 semitons, forats ≤ 4 trames, mínim 80 ms), uneix repeticions, i **descarta** notes > 10 semitons per sobre de la mediana ponderada si duren < 0,35 s, i qualsevol nota > 10 semitons per sota (instrument filtrat).
- `refTrack(ph)`: altura de la veu dins la frase; amb veu separada, posa a NaN les trames amb `dom < −12 dB` o energia < 12 % del màxim. `refFor(ph, semis)` la desplaça quan hi ha canvi de to.
- Noms de nota: `NOTE[pc] + (octava)`, amb Do4 = MIDI 60 (notació llatina).

## 6. Escoltar, gravar, comparar

- **Micròfon** (`ensureMic`): `getUserMedia` sense cancel·lació d'eco, ni supressió de soroll, ni control de guany; captura amb un `AudioWorklet` (blob o `data:` URL) i `ScriptProcessor` de reserva; cada bloc porta el temps de l'AudioContext (`t`) per alinear-lo amb la reproducció.
- **Accions**: `listen` (frase amb veu guia + base, des de l'entrada), `recordOnly` (R), `cycle` (Intro: escolta N vegades → entra la base → grava → compara). Mentre cantes sona, segons `#oBack`, la base + veu guia al 30 %, només la base, o res. La gravació dura la frase + 1,3 s perquè l'última nota no quedi tallada. Latència inicial = `outputLatency + baseLatency + 10 ms`.
- **Comparació** (`compareData`): alinea la presa buscant el desplaçament entre ±0,5 s (pas 10 ms) que maximitza les trames a menys de mig semitò (amb plec d'octava si `#oOct` està marcat, que ho està per defecte: un noi pot cantar la cançó d'una dona una octava avall). Calcula octava mediana, percentatge de temps afinat, desviació mitjana en cèntims, durada cantada vs. original.
- **Nota**: `noteHits(notes, punts)` → una nota és encertada si, dins la seva finestra ±50 ms, la fracció de trames a ≤ `tol` semitons arriba a `cover`. Nivells `LEVELS`: fàcil (1,0 st, 30 %) **per defecte**, mitjà (0,6 / 45 %), exigent (0,35 / 55 %). El resultat és «**ok / nn notes encertades**» + **un sol consell**, per aquest ordre: tot bé → massa lenta (durada > 125 % + 0,5 s) → massa ràpida → vas alta (> +30 cèntims) → vas baixa → «fixa't en la nota k, la primera que se t'escapa». Sense estrelles ni puntuació gamificada.
- **Escenari** (`drawCompare`, `STAGE`): fons fosc, barres arrodonides per a les notes de l'original (grises; grogues amb halo quan s'encerten), la veu de l'alumne com a traç taronja, graella per semitons amb noms a les notes naturals (amagats en mode senzill), eix de temps, capçal de reproducció. Clicar una barra fa sonar aquella nota: primer l'original i després tu (`playNote`); clicar un espai buit mou el cursor de reproducció; doble clic el torna a l'inici. «▶ Tu» sona sempre amb la base al volum `gbase` (80 %) i **reverb** (convolució amb una resposta sintètica de 2,2 s; `#oVerb`).
- **Cançó sencera** (`fullStart/fullStop`): grava de seguit des del cursor amb la base; en aturar, cada frase coberta rep una presa retallada (`mode:'full'`), i la presa sencera es pot escoltar amb la base.

## 7. Transformacions

- **Velocitat** (`stretchChannels`, WSOLA: finestra 2048, salt 512, cerca ±360 mostres): 85 / 70 / 55 % sense canviar el to; per segments, amb caché. La versió `Async` (per trossos amb `await sleep(0)`) és per a tota la cançó.
- **Canvi de to** (`setKey`, ±6 semitons): remostreig per 2^(semis/12) (canvia to i durada) i *stretch* de tornada a la durada original, per a la veu i la base senceres (`S.pvL…`); la melodia de referència es desplaça igual (`refFor`). Cada presa recorda `semis` i `rate`. Qualitat suficient fins a ±6; més enllà s'embruta (per a un instrument potser cal un *pitch-shifter* millor, p. ex. per vocoder de fase).
- `segmentShifted(s,e,gv,ga,semis)`: la mateixa idea per a un sol segment i qualsevol nombre de semitons (ho fa servir el rang vocal).

## 8. Rang vocal (pestanya pròpia)

- Tria la frase que arriba més amunt i la que arriba més avall (`pickPhrase`: puntua l'extrem, penalitza frases > 6 s o < 1,2 s).
- Cerca cap amunt: 0, +2, +4… fins que falla; després el semitò del mig. Si ja falla a l'original, baixa de 2 en 2 fins que surt bé. Límit ±14. Cap avall, igual amb la frase greu.
- A cada pas (`rangeCycle`): sona la frase transposada amb la veu guia → sona la base (veu guia al 30 % o res) i es grava → `rangeCheck`: alinea amb `compareData`, estima l'**octava** en què canta l'alumne amb la part «còmoda» de la frase (fora de la nota extrema), i mira la mediana del que ha cantat mentre l'original aguanta la nota extrema: compta si queda a ≤ 90 cèntims. Veredicte automàtic (verd → passa sol al cap de 2,2 s si a més encerta ≥ 40 % de notes); si no, botons «Torna-ho a provar · Sí que hi arribo · No hi arribo».
- Resultat: «Et va bé cantar entre X i Y», teclat dibuixat (rang en groc, cançó en verd, en l'octava de l'alumne), i `bestKey`: el to entre −6 i +6 que fica la cançó dins del rang (o en deixa menys fora), amb botó per aplicar-lo. Es desa a la sessió (`S.range`).

## 9. Sessions

- **Autodesat** a IndexedDB (`mirall-de-veu` / `sessions` / clau `last`) 1,5 s després de cada canvi: fitxer original (Blob), veu separada en Int16, frases, preses en Int16, preses senceres, opcions, rang. A l'inici, «Recupera la sessió anterior».
- **Fitxer `.mirall`** (`exportSession/importSession`): `MIRALL1\n` + Uint32 nombre de parts + Uint32 mides + capçalera JSON (amb `{__bin: índex}` on hi havia un Int16Array) + bytes del fitxer original + parts binàries. Es pot obrir un altre dia o en un altre ordinador.

## 10. Interfície

- **Marca Rockin**: variables `--rk-groc #FDBE10`, `--rk-tinta #221F20`, `--rk-fons #FAF8F3`, `--rk-suau`, `--rk-linia`, `--rk-gris`; tipografies Lora (títols) + Ubuntu (text) + JetBrains Mono (nombres); logo `rockin-logo.svg`; verd `--ref #0CA678` per a l'original i taronja `--you #E0632A` per a l'alumne.
- **Aplicació d'una pantalla** (commit `b782206`): barra superior groga amb pestanyes **Cançó · Canta · Rang vocal · Ajuda** (desactivades fins que la veu està separada; salta sola a Canta quan les frases són a punt), vistes que omplen la finestra sense desplaçament (si la finestra fa ≥ 861 × 700 px; si no, cada vista fa scroll), barra inferior amb transport (▶ Cançó / Només veu / Només base / ■ Atura / rellotge) i selectors globals de **To** i **Velocitat**.
- **Mode senzill** (per defecte, `localStorage mirall-mode`): amaga tot el que porta `.adv-only` (edició de frases, nudges, mescla, nivell, ajustos, consonants…); només queda Escolta / Canta-la, To, Velocitat, Original / Tu. `body.simple` i `.simple-only` per a textos alternatius.
- **Dreceres**: Espai escolta, R repeteix, Intro cicle, ← → frase, Esc atura, + − zoom. Dins la pestanya de rang les tecles van als botons.
- Forma d'ona editable: arrossegar sobre un buit crea una frase, les vores s'arrosseguen, roda amb Ctrl/⌘ fa zoom, Maj desplaça; botons Divideix / Uneix / Nova / Elimina (amb «Desfés» al toast).

## 11. Proves

- Playwright amb Chromium *headless* servint el repo amb `http.server` (cal http, no `file://`, per al service worker i IndexedDB). Opcions útils: `--use-fake-device-for-media-stream --use-fake-ui-for-media-stream`, permís `microphone`.
- El més fiable és **injectar preses sintètiques** (sinus que segueix `refFor(ph, semis)` amb un desplaçament, una octava avall, una nota curta…) i cridar `compareData` / `rangeCheck` directament, en lloc de confiar en el micròfon fals.
- Una sessió real de prova: `_Sonqollay_ (live) — Ana Rossi & Marta Roma` (3:13, violoncel que es cola a la pista de veu). Amb ella es van ajustar els llindars actuals: 22 frases, 5 dubtosos, cap nota espúria.
- Sempre comprovar `pageerror` buit i fer captures de cada vista (1366×800, 900×640, 420×800).

## 12. Decisions pedagògiques que han funcionat

1. Tot el pes a la pista de veu: frases i melodia només d'allà; la base és el complement exacte.
2. Resposta senzilla: un nombre («7 / 9 notes encertades») i un consell, en aquest ordre de prioritat tempo → afinació → nota concreta. Res d'estrelles. Nivell «fàcil» per defecte (un semitò de marge).
3. L'octava no compta (per defecte): les veus canviants dels nois.
4. Per defecte, en cantar sona la base amb la veu guia fluixa, i en escoltar-te sona la base; una sola escolta al cicle; sense metrònom sonor, només el compte visual.
5. Entrada a temps: la base comença un compàs abans; les frases s'ajusten a la graella.
6. Mode senzill per defecte; el complet per a qui vulgui editar frases, mesclar o afinar llindars.
7. Si l'alumne va enrere al navegador o tanca, no perd res (autodesat); sessió exportable.
8. Es pot clicar nota a nota per sentir «la nota 5» original i pròpia.
9. Canvi de to i velocitat perquè la cançó s'adapti a la veu (i no al revés); la prova de rang ho recomana sola.

## 13. Errors que no cal repetir

- Un filtre de «consonants» per treure saxos i efectes va acabar rebutjant cant real: deixar-lo apagat o molt tou.
- Les frases llargues tallades «al mig» cauen enmig d'una paraula: tallar per respiracions.
- El baix / violoncel filtrat a la pista de veu apareix com a notes greus fantasma: cal el domini de la veu sobre la mescla, la continuïtat d'octava al YIN i el descart de notes 10 semitons sota la melodia.
- Els consells «massa lent / massa ràpid» saltaven per culpa del retard dels auriculars Bluetooth: calcular la durada cantada només amb notes reals (≥ 120 ms) dins la finestra, i exigir un 25 % + 0,5 s de diferència.
- A GitHub Pages el WASM va amb un sol fil (30 minuts per separar) si no hi ha COOP/COEP: el service worker `coi.js` ho arregla; i algunes GPU van més lentes que la CPU: cal mesurar abans de triar.
- `Decoding failed` amb MP3 legítims: etiquetes ID3 grans o brossa al principi; olorar i netejar abans de rendir-se.
- Un `[hidden]` sense `display:none!important` es mostrava quan l'element tenia un `display` propi.
- Quan l'escenari és en una pestanya oculta fa 0 px: cal redibuixar en mostrar la pestanya i en redimensionar (`redrawView`).

## 14. Com fer-ne la versió per a instrument

**El que es pot reutilitzar tal qual**: tota l'estructura (pestanyes, estat `S`, frases, preses, sessions `.mirall`, autodesat), la lectura d'àudio, la separació amb Demucs, la forma d'ona editable, la pulsació i l'entrada, el *time-stretch* i el canvi de to, la reproducció amb mescla, la comparació i l'escenari, el mode senzill, la marca.

**El que cal canviar, per ordre d'importància:**

1. **Quina pista és «la teva»**. Demucs ja torna `{vocals, drums, bass, other}`: per al **baix** la pista ve donada; per a **guitarra i teclat** queden dins `other` barrejades (htdemucs de 4 pistes). Opcions: (a) demanar la pista separada a part (`#fStem` ja existeix) o fer-la amb el model de 6 pistes `htdemucs_6s` (guitarra i piano) si es converteix a ONNX i demucs-web el carrega; (b) partir d'`other` i deixar que el professorat marqui les frases a mà; (c) per a cançons de Rockin, fer servir directament la pista de l'instrument gravada a part. La base és sempre `mix − la teva pista`. Guardar-ho a `S.sepBy` i als textos.
2. **Entrada d'àudio**. El micròfon serveix per a instruments acústics; per a guitarra/baix elèctrics i teclat, deixar triar el dispositiu (`navigator.mediaDevices.enumerateDevices()` + `deviceId` a `getUserMedia`, interfície USB) i mantenir `echoCancellation/noiseSuppression/autoGainControl` a `false`. Per a **teclat**, afegir Web MIDI (`navigator.requestMIDIAccess`): notes exactes, sense detecció d'altura; al mateix format de punts `{t, m}` que `youPoints`, i `noteHits` funciona igual.
3. **Detector d'altura**. `pitchTrack` està limitat a 70–1000 Hz (període 1–14 ms) i `analyse` a MIDI 43–86. Per a **baix** cal baixar fins a ~30 Hz (període 33 ms → finestra ≥ 50 ms, submostreig a 11 kHz encara va bé) i pujar la finestra de YIN; per a **guitarra** 80–1300 Hz. El YIN és monofònic: amb **acords** o rasgueig no funciona; per a aquestes frases cal passar a un jutge rítmic (onsets, com l'`evaluator.js` del joc de teclat) o a cromagrama. Decidir des del principi si el joc és de **línies melòdiques** (riffs, baixos, melodies de teclat: tot el pipeline serveix) o també d'**acompanyament** (cal un segon jutge).
4. **Detecció de frases**. Treure els criteris de veu: `stable` passa a ser «dins una nota ≥ 80 ms» amb el rang de l'instrument, sense filtre de consonants ni de respiració; tallar per **silencis** i per **frases de 2 o 4 compassos** amb la pulsació (`eighthGrid`, `downbeats`), que per a un instrument és més natural que la respiració. El filtre «12 semitons sota la mediana = instrument» s'ha de treure (ara la pista *és* l'instrument) i substituir pel rang de l'instrument.
5. **Octava**. Per a un instrument, el plec d'octava (`#oOct`) hauria de ser **desactivat per defecte**: tocar una octava avall és un error (o una elecció que cal veure). Per a baix, afegir una tolerància per a l'octava només si el professorat ho marca.
6. **Ritme pesa més**. A l'instrument, l'entrada i la durada són part de la consigna: afegir a `noteHits` una comprovació d'**inici** (onset a ±1/3 de corxera) i no només de contingut; i a l'escenari, marcar en vermell l'inici si va avançat/endarrerit. El consell «massa lent/ràpid» ja existeix.
7. **Transposició**. Canvi de to té sentit (celleta, afinació diferent) però amb l'etiqueta de l'instrument («celleta al trast 2» en lloc de «+2 semitons»). El **rang** no cal: substituir la pestanya «Rang vocal» per una de «Posició» o «Corda / registre» (en quina octava o corda convé tocar la frase), o treure-la.
8. **Escenari**. Les barres i els noms de nota ja van bé; per a guitarra/baix afegir, opcionalment, el **trast suggerit** sota la nota (una taula nota → corda/trast per afinació estàndard), i per a teclat un teclat petit a sota amb les notes de la frase.
9. **Textos i ajuda**: tot el que diu «canta», «veu», «respirar», «auriculars» (per a un elèctric no cal l'avís d'altaveus si entra per línia). Cercar «veu» i «canta» a `index.html` i revisar-ho frase a frase. Nom nou, `README`, títol, `DB_NAME` i nom de la caché (perquè no trepitgi la sessió del joc de veu al mateix navegador), extensió del fitxer de sessió si es vol (`.mirall` pot quedar).
10. **Reverb**: innecessària per a un instrument elèctric; per a un acústic pot quedar com a opció.

**Proposta de progressió (si es vol fer «joc» i no només eina)**: frase a frase com ara → tocar dues frases seguides → part sencera (A, B) amb la base → cançó sencera; i enllaçar amb la biblioteca compartida del Generador de diagrames (cançons amb estructura i acords) perquè una cançó de Rockin porti ja les frases marcades.

## 15. Pendents de Mirall de veu (per no oblidar)

- Encara no sabem quin motor fa servir el Mac de la Laia per separar (la línia «Motor: … · GPU: … · fils: …»): si segueix lent, cal mirar-ho.
- Afinar amb veus reals d'adolescents els llindars del rang (90 cèntims, 40 % de notes) i de la detecció.
- *Pitch-shifter* de més qualitat per a transposicions grans.
- Transcripció automàtica de la lletra (Whisper al navegador) per posar títol a les frases: descartat de moment per complexitat; els títols es posen a mà.
- Un document pedagògic / «cartes de veu» per a l'aula.
