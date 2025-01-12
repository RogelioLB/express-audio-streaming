import { parseBlob } from 'music-metadata';
import express from "express";
import Throttle from 'throttle';
import https from "https";
import { PassThrough } from 'stream';

const app = express();
const playlists = {
    1: ["https://example.nyc3.cdn.digitaloceanspaces.com/audio1.mp3", "https://example.nyc3.cdn.digitaloceanspaces.com/audio2.mp3"],
    2: ["https://example.nyc3.cdn.digitaloceanspaces.com/Aunque%20s%C3%B3lo%20dure%2010%20segundos%20es%20lo%20m%C3%A1s%20cute%20que%20oir%C3%A1s.mp3", "https://example.nyc3.cdn.digitaloceanspaces.com/Stromae,%20Pomme%20-%20Ma%20Meilleure%20Ennemie%20(%20Espa%C3%B1ol%20)%20%20Arcane_%20Season%202.mp3"]
};

const playlistStates = new Map();

app.use(express.static('public'));

// Ruta para acceder a una playlist específica
app.get("/playlist/:id/stream", async (req, res) => {
    const playlistId = parseInt(req.params.id, 10);
    if (!playlists[playlistId]) {
        res.status(404).send("Playlist no encontrada");
        return;
    }

    const state = await getOrCreatePlaylistState(playlistId);
    console.log(`Nueva conexión a la playlist ${playlistId}`);
    console.log(state)
    const { id, stream } = generateStream(state);
    res.setHeader("Content-Type", "audio/mpeg");
    stream.pipe(res);

    res.on('close', () => {
        state.streams.delete(id);
    });

    if (!state.isPlaying) {
        state.isPlaying = true;
        playPlaylist(playlistId);
        console.log(`Reproduciendo la playlist ${playlistId}`);
        console.log(state)
    }
});

const getOrCreatePlaylistState = async (playlistId) => {
    if (!playlistStates.has(playlistId)) {
        const state = await initPlaylist(playlistId);
        playlistStates.set(playlistId, state);
    }
    return playlistStates.get(playlistId);
};

const initPlaylist = async (playlistId) => {
    const playlist = playlists[playlistId];
    const currentTrackIndex = 0;
    const res = await fetch(playlist[currentTrackIndex]);
    const blob = await res.blob();
    const fileInfo = await parseBlob(blob);
    console.log(`Duración de la pista: ${Math.floor(fileInfo.format.duration)} segundos`);
    return {
        currentTrackIndex: 0,
        streams: new Map(),
        isPaused: false,
        trackDuration: Math.floor(fileInfo.format.duration),
        elapsedTime: 0,
        intervalId: null,
        throttleTransformable: null,
        isPlaying: false,
        bitrate: Math.floor(fileInfo.format.bitrate / 8),
        playlistId
    };
};

const playPlaylist = async (playlistId) => {
    const state = await getOrCreatePlaylistState(playlistId);
    const playlist = playlists[playlistId];

    https.get(playlist[state.currentTrackIndex], (res) => {
        state.throttleTransformable = new Throttle(state.bitrate);
        console.log(`Reproduciendo la pista: ${playlist[state.currentTrackIndex]}`);
        console.log(state)

        res.pipe(state.throttleTransformable);

        state.throttleTransformable.on('data', (chunk) => {
            if (!state.isPaused) {
                broadcastToPlaylistStreams(state, chunk); // Enviar datos a todos los streams
            }
        });

        state.throttleTransformable.on('end', () => {
            clearInterval(state.intervalId); // Asegura que el timer anterior termine
            playNextTrack(playlistId); // Reproducir la siguiente canción
        });

        state.throttleTransformable.on('error', (err) => {
            console.error(`Error en la transmisión: ${err.message}`);
        });

        startTimer(state); // Iniciar el temporizador para el progreso
    }).on('error', (err) => {
        console.error(`Error al obtener la pista: ${err.message}`);
        playNextTrack(playlistId); // Pasar a la siguiente pista en caso de error
    });
};

const playNextTrack = async (playlistId) => {
    const state = await getOrCreatePlaylistState(playlistId);
    console.log(`Cambiando a la siguiente canción en la playlist ${playlistId}`);
    console.log(state)
    const playlist = playlists[playlistId];
    state.currentTrackIndex = (state.currentTrackIndex + 1) % playlist.length;
    console.log(`Cambiando a la siguiente canción: ${playlist[state.currentTrackIndex]}`);

    try {
        const res = await fetch(playlist[state.currentTrackIndex]);
        const blob = await res.blob();
        const fileInfo = await parseBlob(blob);
        state.trackDuration = Math.floor(fileInfo.format.duration);
        state.elapsedTime = 0;
        state.bitrate = Math.floor(fileInfo.format.bitrate / 8);
        playPlaylist(playlistId);
    } catch (err) {
        console.error(`Error al inicializar la siguiente canción: ${err.message}`);
        playNextTrack(playlistId); // Intentar la siguiente canción en caso de error
    }
};


const broadcastToPlaylistStreams = (state, chunk) => {
    for (let [id, stream] of state.streams) {
        stream.write(chunk);
    }
};

const startTimer = (state) => {
    clearInterval(state.intervalId);
    state.intervalId = setInterval(() => {
        if (!state.isPaused) {
            state.elapsedTime++;
            console.log(`Tiempo transcurrido: ${state.elapsedTime}s / ${state.trackDuration}s`);
            if (state.elapsedTime >= state.trackDuration) {
                clearInterval(state.intervalId);
            }
        }
    }, 1000);
};

const generateStream = (state) => {
    const id = Math.random().toString(36).slice(2);
    const stream = new PassThrough();
    state.streams.set(id, stream);
    return { id, stream };
};

app.listen(8080, () => console.log("Server running on http://localhost:8080"));