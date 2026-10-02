# Mirall de veu

Eina de Rockin per a l'entrenament de cant: carregues una cançó, el programa separa la veu de la banda (Demucs, dins del navegador), la divideix en frases i, frase a frase, l'escoltes, la repeteixes cantant sobre la base i veus quines notes has encertat, a l'estil SingStar.

**Prova-la:** https://rockin-cat.github.io/mirall-de-veu/

## Com funciona

1. **Carrega una cançó** (MP3, WAV, M4A). Tot es processa al teu ordinador; la cançó no s'envia enlloc.
2. **Separa la veu.** Fa servir el model Demucs v4 (htdemucs) amb ONNX Runtime Web. La primera vegada descarrega el model (uns 170 MB) i el navegador el recorda.
3. **Treballa frase a frase.** Les frases i la melodia es treuen només de la pista de veu. Escolta, repeteix amb la base, compara. També pots cantar la cançó sencera de seguit.

Cal un navegador actual (Chrome, Edge o Safari recents) i auriculars.

## Crèdits

- Separació de fonts: [Demucs](https://github.com/facebookresearch/demucs) (Meta AI, llicència MIT) a través de [demucs-web](https://github.com/timcsy/demucs-web) i [ONNX Runtime Web](https://onnxruntime.ai/).
- Detecció d'altura: algorisme YIN, implementat a la mateixa pàgina.

Una eina de [Rockin](https://rockin.cat).
