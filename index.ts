import { loadMusicMetadata } from 'music-metadata';
import express from "express";
import Throttle from 'throttle';
import { PassThrough } from 'stream';
import {chooseAd, chooseMusic, configure, createFfmpegStream} from './lib/audio';

const app = express();
const state = new Map();
let intervalId : NodeJS.Timeout | undefined;
const LIMIT = 2;

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
}

app.use(express.static('public'));


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
    const file = chooseMusic()
    const {parseFile} = await loadMusicMetadata();
    const fileInfo = await parseFile(file);
    return {
        currentTrackIndex: 0,
        streams: new Map(),
        isPaused: false,
        trackDuration: Math.floor(fileInfo.format.duration ?? 0),
        elapsedTime: 0,
        intervalId: undefined,
        throttleTransformable: null,
        isPlaying: false,
        bitrate: Math.floor((fileInfo.format.bitrate ?? 0) / 8),
        songCount: 0,
        song: file,
        playedSongs: [],
        isAd: false
    };
};

const play = async () => {
    const state = await getOrCreateState();

    if(state.throttleTransformable){
        state.throttleTransformable.end();
        state.throttleTransformable.destroy();
    }

    // Verificar si ya se han reproducido 5 archivos
    if (state.playedSongs.length >= 6) {
        // Eliminar el más antiguo para mantener el tamaño máximo de 5
        state.playedSongs.shift();
    }

    console.log(`Reproduciendo ${state.song}`);
    const ffmpegProcess= createFfmpegStream(state.song,128)

    state.throttleTransformable = new Throttle(128 * 1024 / 8);

    ffmpegProcess.stdout.pipe(state.throttleTransformable);

    state.throttleTransformable.on("data", (chunk: Buffer) => {
        broadcastToPlayStream(state, chunk);
    });

    state.throttleTransformable.on("end", async () => {
        console.log("Canción terminada");
        if(state.songCount >= LIMIT){
            state.isAd = false;
        }
        state.songCount = state.songCount >= LIMIT ? 0 : state.songCount + 1;
    });

    state.throttleTransformable.on("error", (err) => {
        console.error(`Error en la transmisión: ${err.message}`);
    });

    startTimer(state);
};

const playNextTrack = async () => {
    const state = await getOrCreateState();

    let nextFile;
    while(state.playedSongs.includes(nextFile as string) || nextFile === undefined){
        console.log("Escogiendo otra cancion")
        if(state.songCount >= LIMIT){
            nextFile = chooseAd()
            state.songCount = 0;
        }
        else
            nextFile = chooseMusic()
        
        if(nextFile !== undefined) 
        await configure(state,nextFile)
    }

    state.song = nextFile;
    state.playedSongs.push(nextFile);
    console.log(`Preparando para reproducir la siguiente canción: ${nextFile}`);
    play();
};


const broadcastToPlayStream = (state: State, chunk: Buffer) => {
    for (let [id, stream] of state.streams) {
        stream.write(chunk); // Write to client stream
    }
};

const startTimer = (state: State) => {
    clearInterval(state.intervalId);
    intervalId = setInterval(() => {
        if (!state.isPaused) {
            state.elapsedTime++;
            console.log(`Tiempo transcurrido: ${state.elapsedTime}s / ${state.trackDuration}s`);
            if (state.elapsedTime >= state.trackDuration) {
                clearInterval(state.intervalId);
                playNextTrack()
            }
        }
    }, 1000);
    state.intervalId = intervalId;
};

const generateStream = () => {
    const id = Math.random().toString(36).slice(2);
    const stream = new PassThrough();
    return { id, stream };
};

init().then(async () => {
    app.listen(8080, () => {
        console.log("Server running on http://localhost:8080");
    });
    await play();
});
