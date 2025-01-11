import { parseFile } from 'music-metadata';
import express from "express";
import Throttle from 'throttle';
import Fs from 'fs';
import { PassThrough } from 'stream';
import path from "path"

const app = express();
let playlist = [path.resolve("./audio1.mp3"), path.resolve("./audio2.mp3")]; // Lista de reproducción
let currentTrackIndex = 0;
let bitRate = 0;
const streams = new Map();
let isPaused = false; // Estado para controlar la pausa del audio
let songReadable = null;
let throttleTransformable = null;
let trackDuration = 0; // Duración total de la pista actual en segundos
let elapsedTime = 0; // Tiempo transcurrido en segundos
let intervalId = null; // ID del intervalo para el contador

app.use(express.static('public'));

// Ruta para iniciar la transmisión
app.get("/stream", (req, res) => {
    const { id, stream } = generateStream(); // Creamos un nuevo stream para cada cliente
    res.setHeader("Content-Type", "audio/mpeg");
    stream.pipe(res); // Enlazamos el stream del cliente con la respuesta
    res.on('close', () => streams.delete(id));
});

// Ruta para pausar la transmisión
app.post("/pause", (req, res) => {
    isPaused = true;
    if (songReadable) {
        songReadable.pause(); // Pausa la lectura del archivo
    }
    if (throttleTransformable) {
        throttleTransformable.pause(); // Pausa el flujo de datos
    }
    clearInterval(intervalId); // Detenemos el contador
    res.send({ status: "paused", elapsedTime, remainingTime: trackDuration - elapsedTime });
});

// Ruta para reanudar la transmisión
app.post("/resume", (req, res) => {
    isPaused = false;
    if (songReadable) {
        songReadable.resume(); // Reanuda la lectura del archivo
    }
    if (throttleTransformable) {
        throttleTransformable.resume(); // Reanuda el flujo de datos
    }
    startTimer(); // Reiniciamos el contador
    res.send({ status: "resumed", elapsedTime, remainingTime: trackDuration - elapsedTime });
});

const init = async () => {
    const fileInfo = await parseFile(playlist[currentTrackIndex]);
    bitRate = fileInfo.format.bitrate / 8; // Convertimos el bitrate a bytes por segundo
    trackDuration = Math.floor(fileInfo.format.duration); // Duración total de la pista en segundos
    elapsedTime = 0; // Reiniciamos el tiempo transcurrido
};

const playFile = (filePath) => {
    songReadable = Fs.createReadStream(filePath);
    throttleTransformable = new Throttle(bitRate);

    songReadable.pipe(throttleTransformable);
    throttleTransformable.on('data', (chunk) => {
        if (!isPaused) {
            broadcastToEveryStreams(chunk); // Transmitimos datos solo si no está pausado
        }
    });

    throttleTransformable.on('error', (e) => console.log(e));

    songReadable.on('end', () => {
        console.log("El archivo de audio ha terminado.");
        clearInterval(intervalId); // Detenemos el contador al finalizar la pista
        playNextTrack(); // Inicia la siguiente pista al terminar la actual
    });

    startTimer(); // Iniciamos el contador
    displayProgress(); // Mostrar progreso en consola
};

const playNextTrack = () => {
    currentTrackIndex = (currentTrackIndex + 1) % playlist.length; // Avanza al siguiente archivo en la lista
    init().then(() => playFile(playlist[currentTrackIndex]));
};

const startTimer = () => {
    clearInterval(intervalId); // Aseguramos que no haya múltiples intervalos activos
    intervalId = setInterval(() => {
        if (!isPaused) {
            elapsedTime++;
            if (elapsedTime >= trackDuration) {
                clearInterval(intervalId); // Detenemos el contador cuando termina la pista
            }
        }
    }, 1000); // Incrementamos el tiempo transcurrido cada segundo
};

const formatTime = (seconds) => {
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = seconds % 60;
    return `${minutes}:${remainingSeconds.toString().padStart(2, '0')}`;
};

const displayProgress = () => {
    clearInterval(intervalId); // Aseguramos que no haya múltiples intervalos activos
    intervalId = setInterval(() => {
        if (!isPaused) {
            elapsedTime++;
            console.log(`Tiempo transcurrido: ${formatTime(elapsedTime)} / ${formatTime(trackDuration)}`);
            if (elapsedTime >= trackDuration) {
                clearInterval(intervalId); // Detenemos el contador cuando termina la pista
            }
        }
    }, 1000); // Actualizamos el progreso cada segundo
};

const broadcastToEveryStreams = (chunk) => {
    for (let [id, stream] of streams) {
        stream.write(chunk); // Escribimos el nuevo fragmento de datos en el stream del cliente
    }
};

const generateStream = () => {
    const id = Math.random().toString(36).slice(2);
    const stream = new PassThrough();
    streams.set(id, stream);
    return { id, stream };
};

init()
    .then(() => app.listen(8080, () => console.log("Server running on http://localhost:8080")))
    .then(() => playFile(playlist[currentTrackIndex]));


export default app;