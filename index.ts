import { spawn } from 'child_process';
import express from "express";
import Throttle from 'throttle';
import { PassThrough } from 'stream';
import { chooseAd, chooseMusic, chooseTip, configure, createFfmpegStream, preloadDurations } from './lib/audio';

const app = express();
const state = new Map();

export interface State {
    currentTrackIndex: number;
    streams: Map<string, PassThrough>;
    isPaused: boolean;
    trackDuration: number;
    elapsedTime: number;
    intervalId: NodeJS.Timeout | undefined;
    throttleTransformable: Throttle | null;
    isPlaying: boolean;
    bitrate: number;
    songCount: number;
    song: string;
    playedSongs: string[];
    isAd: boolean;
    contentType: 'song' | 'ad' | 'tip';
    ffmpegProcess: ReturnType<typeof spawn> | null;
    isTransitioning?: boolean;
}

app.use(express.static('public'));

// Ruta para acceder a una playlist específica
app.get("/stream", async (req, res) => {
    const { id, stream } = generateStream();
    res.setHeader("Content-Type", "audio/mpeg");
    const state = await getOrCreateState();

    state.streams.set(id, stream);
    stream.pipe(res);
    res.on("close", () => {
        console.log(`Cerrando stream ${id}`);
        state.streams.delete(id);
    });
});

const getOrCreateState = async () : Promise<State> => {
    if (!state.has('default')) {
        state.set('default', await init());
    }
    return state.get('default');
}

const init = async () : Promise<State> => {
    const file = chooseMusic();
    const state: State = {
        currentTrackIndex: 0,
        streams: new Map(),
        isPaused: false,
        trackDuration: 0,
        elapsedTime: 0,
        intervalId: undefined,
        throttleTransformable: null,
        isPlaying: false,
        bitrate: 128 * 1024 / 8, // 128kbps fijo, igual que el throttle
        songCount: 0,
        song: file || "",
        playedSongs: [],
        isAd: false,
        contentType: 'song',
        ffmpegProcess: null,
        isTransitioning: false
    };
    if (file) {
        await configure(state, file);
    } else {
        console.warn("No se encontraron canciones en el directorio 'musica'.");
    }
    return state;
};

const play = async () => {
    const state = await getOrCreateState();

    if(state.throttleTransformable){
        state.throttleTransformable.removeAllListeners();
        state.throttleTransformable.end();
        state.throttleTransformable.destroy();
        state.throttleTransformable = null;
    }

    if(state.ffmpegProcess){
        state.ffmpegProcess.kill();
        state.ffmpegProcess = null;
    }

    if (!state.song) {
        console.warn("No hay canción activa para reproducir. Reintentando buscar en 5 segundos...");
        setTimeout(playNextTrack, 5000);
        return;
    }

    // Verificar si ya se han reproducido 5 archivos
    if (state.playedSongs.length >= 4) {
        // Eliminar el más antiguo para mantener el tamaño máximo de 5
        state.playedSongs.shift();
    }

    console.log(`Reproduciendo ${state.song}`);
    state.ffmpegProcess = createFfmpegStream(state.song, 128)
    const ffmpegStream = state.ffmpegProcess.stdout as NodeJS.ReadableStream;

    state.throttleTransformable = new Throttle(128 * 1024 / 8);

    ffmpegStream.pipe(state.throttleTransformable);

    state.throttleTransformable.on("data", (chunk: Buffer) => {
        broadcastToPlayStream(state, chunk);
    });

    state.throttleTransformable.on("end", async () => {
        playNextTrack();
    });

    state.throttleTransformable.on("error", (err) => {
        console.error(`Error en la transmisión: ${err.message}`);
    });

    startTimer(state);
};

const playNextTrack = async () => {
    const state = await getOrCreateState();

    // Prevenir transiciones concurrentes duplicadas
    if (state.isTransitioning) {
        console.log("Ya hay una transición en curso, ignorando solicitud duplicada.");
        return;
    }
    state.isTransitioning = true;

    try {
        // Limpiar inmediatamente el temporizador activo
        if (state.intervalId) {
            clearInterval(state.intervalId);
            state.intervalId = undefined;
        }

        // Limpiar y detener procesos/streams antes de la llamada asíncrona de configure
        if (state.throttleTransformable) {
            state.throttleTransformable.removeAllListeners();
            state.throttleTransformable.end();
            state.throttleTransformable.destroy();
            state.throttleTransformable = null;
        }

        if (state.ffmpegProcess) {
            state.ffmpegProcess.kill();
            state.ffmpegProcess = null;
        }

        let nextFile: string | undefined;
        let nextType: 'song' | 'ad' | 'tip';

        // Ciclo: canción → anuncio → tip → canción → ...
        if (state.contentType === 'song') {
            nextType = 'ad';
            nextFile = chooseAd();
            console.log("Escogiendo anuncio");
        } else if (state.contentType === 'ad') {
            nextType = 'tip';
            nextFile = chooseTip();
            console.log("Escogiendo tip");
        } else {
            // tip → canción (evitar repetir la misma)
            nextType = 'song';
            nextFile = chooseMusic();
            while (state.playedSongs.includes(nextFile as string)) {
                nextFile = chooseMusic();
            }
            console.log("Escogiendo canción");
        }

        if (nextFile === undefined) {
            console.error(`No se encontró archivo para tipo: ${nextType}. Reintentando en 5 segundos...`);
            setTimeout(playNextTrack, 5000);
            return;
        }

        await configure(state, nextFile);

        if (nextType === 'song') {
            if (state.playedSongs.length >= 4) {
                state.playedSongs.shift();
            }
            state.playedSongs.push(nextFile);
        }

        state.contentType = nextType;
        state.song = nextFile;
        console.log(`Reproduciendo [${nextType}]: ${nextFile}`);
        await play();
    } catch (err) {
        console.error("Error durante la transición de pista:", err);
    } finally {
        state.isTransitioning = false;
    }
};

const broadcastToPlayStream = (state: State, chunk: Buffer) => {
    for (let [id, stream] of state.streams) {
        try {
            stream.write(chunk);
        } catch (err) {
            console.error(`Error escribiendo a stream ${id}:`, err);
            state.streams.delete(id);
            try { stream.destroy(); } catch (_) {}
        }
    }
};

const startTimer = (state: State) => {
    if (state.intervalId) {
        clearInterval(state.intervalId);
    }
    state.intervalId = setInterval(() => {
        if (!state.isPaused) {
            state.elapsedTime++;
            console.log(`Tiempo transcurrido: ${state.elapsedTime}s / ${state.trackDuration}s`);
            // El cambio de pista se maneja exclusivamente a través del evento "end" de throttleTransformable.
            // Esto evita que se corten los frames de audio a mitad por imprecisiones del reloj de JS.
        }
    }, 1000);
};

const generateStream = () => {
    const id = Math.random().toString(36).slice(2);
    const stream = new PassThrough();
    return { id, stream };
};

init().then(async () => {
    // Pre-cargar la duración de todos los archivos al iniciar el servidor
    // para asegurar que las transiciones entre pistas sean 100% instantáneas y sin silencios
    await preloadDurations().catch(err => console.error("Error pre-cargando duraciones:", err));

    app.listen(8080, () => {
        console.log("Server running on http://localhost:8080");
    });
    await play();
});
