# Boardroom Quiz

Juego de preguntas en directo, al estilo Kahoot. Tú proyectas la pantalla del anfitrión; el resto entra desde el móvil con un **enlace + PIN** o escaneando un **código QR**. Nadie tiene que registrarse ni iniciar sesión.

El contenido es el del tema "Strategy Implementation & Strategy Execution": eres el CEO de Walmart y en cada pregunta tomas una decisión. Solo una opción es la correcta.

---

## Cómo se juega

1. En el ordenador que proyecta, abre `https://TU-ENLACE/host`.
2. Aparecen el **PIN**, el **código QR** y el enlace. Los jugadores escanean el QR (o escriben el enlace y el PIN) y eligen un apodo.
3. Pulsa **Start game**. Cada decisión dura 30 segundos y tiene 4 respuestas de colores.
4. Acierto = de 500 a 1000 puntos (cuanto más rápido, más puntos). Fallo o sin respuesta = 0.
5. Después de cada pregunta se ve la respuesta correcta, el porqué y la clasificación. Al final sale el podio.

Detalles útiles:

- **Espacio** o **Enter** = botón principal de la pantalla (Start game, Next decision…).
- **Skip countdown** salta la cuenta atrás de 3 segundos. **Reveal answer** muestra la respuesta sin esperar.
- En la sala de espera puedes quitar a alguien con la ✕ de su nombre.
- Si cierras o recargas la pantalla del anfitrión por error, al volver a abrirla (en el mismo navegador) pulsa **Resume game**: la partida sigue donde estaba (hasta 12 horas) y los móviles se reconectan solos.
- **Play again** reinicia los puntos con los mismos jugadores y el mismo PIN.

---

## Publicarlo (elige una opción)

Necesitas que la web esté en Internet para que los móviles puedan abrirla. Hay dos formas.

### Opción A — Netlify (la más rápida, unos 3 minutos)

Usa el archivo **`quiz-web.zip`**.

1. Descomprímelo. Te queda una carpeta con `index.html`, `host.html`, etc.
2. Entra en <https://app.netlify.com/drop> y **arrastra esa carpeta** a la página.
3. Netlify te pedirá crear una cuenta gratuita (o entrar con una que ya tengas) para guardar el sitio. Hasta que lo hagas, el sitio no es público. **Solo lo haces tú una vez; los jugadores nunca necesitan cuenta.**
4. Netlify te da un enlace del tipo `https://nombre-aleatorio.netlify.app`. Ese es el enlace para jugadores. La pantalla del anfitrión es el mismo enlace terminado en `/host`.

En esta opción los móviles se conectan directamente con tu navegador y se "presentan" a través del servicio público y gratuito de PeerJS. Va bien con datos móviles y con la mayoría de redes Wi-Fi, pero algunas redes (colegios, empresas, wifis de invitados) bloquean este tipo de conexión. **Pruébalo antes de la clase** (ver más abajo). Si algún móvil no entra, usa la opción B.

### Opción B — Render (más fiable, unos 10–15 minutos)

Usa el archivo **`quiz-servidor.zip`**. Aquí los móviles se conectan a un pequeño servidor tuyo por una conexión web normal, que pasa por casi cualquier red.

1. Descomprime el ZIP y sube el contenido a un repositorio nuevo de GitHub (en GitHub: **New repository** y luego **uploading an existing file** para arrastrar los archivos y carpetas).
2. En <https://render.com> crea una cuenta gratuita y elige **New → Blueprint** (o **New → Web Service**) y conecta ese repositorio. Con *Blueprint* se configura solo con el archivo `render.yaml`; con *Web Service* usa `npm install` como build y `npm start` como start, plan **Free**.
3. Cuando termine, Render te da un enlace `https://algo.onrender.com`. Los jugadores usan ese enlace; el anfitrión, el mismo con `/host`.

Cosas a tener en cuenta de Render gratis:

- Tras 15 minutos sin uso el servidor se duerme y tarda alrededor de **1 minuto** en despertar. **Abre la pantalla del anfitrión 3–5 minutos antes de empezar.**
- Mientras la partida está en marcha no se duerme (el tráfico de los móviles lo mantiene despierto).
- Hay 750 horas gratuitas al mes, de sobra para esto.

### Probarlo en tu ordenador (opcional)

Con Node.js 18 o superior:

```
npm install
npm start
```

Abre <http://localhost:3000/host>. Para que entren otros móviles tienen que estar en la misma red y abrir la dirección de tu ordenador en esa red (por ejemplo `http://192.168.1.20:3000`).

---

## Antes de la clase (5 minutos que ahorran sustos)

1. Abre `/host` y mira que salgan el PIN y el QR.
2. Con **tu móvil con datos móviles** (sin Wi-Fi), escanea el QR y entra. Debe aparecer tu apodo en la pantalla.
3. Repite con el **Wi-Fi del aula** si puedes, y con un segundo móvil.
4. Haz una pregunta de prueba completa (pulsa Start game, responde, mira el resultado) y después **Start a new game** para empezar limpio.
5. Para la clase: pantalla completa (botón **Fullscreen**) y, si usas Render, abre `/host` con unos minutos de margen.

---

## Personalizar

Todo está en dos archivos de la carpeta `public/js` (o en la raíz del ZIP de la opción A):

- **`config.js`**: nombre de la aplicación (`APP_NAME`), frase bajo el nombre (`TAGLINE`), segundos por pregunta (`SECONDS_PER_QUESTION`), cuenta atrás (`READY_SECONDS`), longitud máxima del apodo y cuántos jugadores salen en el ranking tras cada pregunta (`TOP_N`).
- **`questions.js`**: las preguntas. Cada una tiene `topic`, `scenario`, `options` (de 2 a 4 respuestas), `correct` (posición de la correcta; 0 es la primera) y `why` (la explicación). Las respuestas se mezclan solas en cada partida, así que no importa el orden en que las escribas. Una pregunta puede llevar su propio tiempo con `seconds: 45`.

Después de editar, vuelve a subir la carpeta (opción A: arrástrala otra vez a Netlify, o desde el panel del sitio en *Deploys*; opción B: sube el cambio al repositorio y Render se actualiza solo).

El icono y los colores están en `public/img/logo.svg` y en `public/css/app.css` (variables al principio del archivo).

---

## Si algo falla

- **"We couldn't find a game with that PIN"**: el PIN está mal escrito o el anfitrión cerró la sala. Comprueba el número de la pantalla grande.
- **Un móvil se queda en "Reconnecting…"**: pasa si pierde cobertura; vuelve solo en unos segundos. Si no, recargar la página del móvil lo devuelve a la partida con su apodo y sus puntos.
- **Nadie puede entrar (opción A)**: la red bloquea las conexiones directas. Prueba con datos móviles o usa la opción B.
- **La pantalla del anfitrión dice "Could not open the room"**: sin Internet o el servicio no responde. Pulsa **Try again**.
- **Pantalla del anfitrión cerrada sin querer**: ábrela de nuevo y pulsa **Resume game**.

---

## Privacidad

No hay cuentas, ni cookies de seguimiento, ni analítica. Los apodos y las puntuaciones solo existen mientras dura la partida y se guardan en el navegador del anfitrión (y, para reconectarse, en el de cada jugador). El servidor de la opción B solo reenvía mensajes y no guarda nada.

Las licencias de las librerías incluidas están en `public/vendor/LICENSES.txt`.
