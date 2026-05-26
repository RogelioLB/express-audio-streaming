import fs from 'fs';
import path from "path";
import { State } from '..';
import ffmpeg from "ffmpeg-static"
import { spawn } from 'child_process';

// Solo se aceptan estos formatos de audio
const AUDIO_EXTENSIONS = ['.mp3', '.wav', '.ogg', '.flac', '.aac', '.m4a'];

function isAudioFile(file: string): boolean {
    return AUDIO_EXTENSIONS.includes(path.extname(file).toLowerCase());
}

export function createFfmpegStream(filePath:string,bitrate:number){
    if(!ffmpeg) throw new Error("ffmpeg not found")
    return spawn(ffmpeg,[
        '-i', filePath,       // Input file
        '-f', 'mp3',          // Output format
        '-ab', `${bitrate}k`, // Audio bitrate (constant)
        '-ar', '44100',       // Audio sample rate (44.1 kHz, estándar para MP3)
        '-ac', '2',           // Stereo channels
        '-map_metadata', '-1', // Eliminar metadatos que podrían confundir al cliente
        '-write_xing', '0',    // Desactivar cabeceras Xing/Info para evitar desincronización en VLC
        '-id3v2_version', '0', // Desactivar cabeceras de ID3 para un stream de audio puro
        'pipe:1'              // Output to stdout (pipe)
    ],{stdio:["ignore","pipe","ignore"]})
}

export function checkDirectories(){
    const music = fs.readdirSync(path.resolve(process.cwd(),"./musica"))
        .filter(isAudioFile)
        .map((file) => path.resolve(process.cwd(),"./musica",file))

    const ad = fs.readdirSync(path.resolve(process.cwd(),"./anuncios"))
        .filter(isAudioFile)
        .map((file) => path.resolve(process.cwd(),"./anuncios",file))

    const tips = fs.readdirSync(path.resolve(process.cwd(),"./TIPS"))
        .filter(isAudioFile)
        .map((file) => path.resolve(process.cwd(),"./TIPS",file))

    return {
        music,
        ad,
        tips
    }
}

export function chooseMusic(){
    //Choose one music randomly
    const music = checkDirectories().music
    return music[Math.floor(Math.random() * music.length)]
}

export function chooseAd(){
    //Choose one ad randomly
    const ads = checkDirectories().ad
    return ads[Math.floor(Math.random() * ads.length)]
}

export function chooseTip(){
    //Choose one tip randomly
    const tips = checkDirectories().tips
    return tips[Math.floor(Math.random() * tips.length)]
}

// Caché en memoria para almacenar las duraciones y evitar llamar a FFmpeg en cada transición
const durationCache = new Map<string, number>();

/**
 * Obtiene la duración de un archivo de audio usando ffmpeg con soporte de caché.
 */
export function getDurationViaFfmpeg(filePath: string): Promise<number> {
    if (durationCache.has(filePath)) {
        return Promise.resolve(durationCache.get(filePath)!);
    }

    return new Promise((resolve) => {
        if (!ffmpeg) return resolve(0);

        const proc = spawn(ffmpeg, ['-i', filePath], {
            stdio: ['ignore', 'pipe', 'pipe']
        });

        let stderr = '';
        proc.stderr?.on('data', (chunk: Buffer) => {
            stderr += chunk.toString();
        });

        proc.on('close', () => {
            const match = /Duration:\s*(\d+):(\d+):(\d+)\.(\d+)/.exec(stderr);
            if (match) {
                const hours = parseInt(match[1], 10);
                const minutes = parseInt(match[2], 10);
                const seconds = parseInt(match[3], 10);
                const totalSeconds = hours * 3600 + minutes * 60 + seconds;
                durationCache.set(filePath, totalSeconds);
                resolve(totalSeconds);
            } else {
                resolve(0);
            }
        });

        proc.on('error', () => resolve(0));
    });
}

/**
 * Pre-carga las duraciones de todos los archivos disponibles en los directorios
 * para asegurar transiciones instantáneas y fluidas entre pistas.
 */
export async function preloadDurations() {
    const { music, ad, tips } = checkDirectories();
    const allFiles = [...music, ...ad, ...tips];
    console.log(`Pre-cargando duración de ${allFiles.length} archivos de audio...`);
    const promises = allFiles.map(file => getDurationViaFfmpeg(file));
    await Promise.all(promises);
    console.log("¡Duraciones pre-cargadas con éxito en caché!");
}

export async function configure(state:State, file:string){
    if (!file) {
        console.warn("configure: No se proporcionó archivo (ruta vacía o undefined)");
        state.trackDuration = 0;
        state.elapsedTime = 0;
        return;
    }
    const duration = await getDurationViaFfmpeg(file);
    state.trackDuration = duration;
    state.elapsedTime = 0;
    state.song = file;
    console.log(`Duración detectada: ${duration}s para ${path.basename(file)}`);
}