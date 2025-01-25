import fs from 'fs';
import path from "path";
import { State } from '..';
import { loadMusicMetadata } from 'music-metadata';
import ffmpeg from "ffmpeg-static"
import { spawn } from 'child_process';

export function createFfmpegStream(filePath:string,bitrate:number){
    console.log(filePath)
    if(!ffmpeg) throw new Error("ffmpeg not found")
    return spawn(ffmpeg,[
        '-ss', '0',           // Start at 0 seconds
        '-i', filePath,       // Input file
        '-f', 'mp3',          // Output format
        '-ab', `${bitrate}k`, // Audio bitrate (constant)
        '-chunk_size', '8192', // Aumentar el tamaño de los chunks para evitar cortes
        'pipe:1'              // Output to stdout (pipe)
    ],{stdio:["ignore","pipe","pipe"]})
}

export function checkDirectories(){
    const music = fs.readdirSync(path.resolve(process.cwd(),"./musica")).map((file) => path.resolve(process.cwd(),"./musica",file))
    const ad = fs.readdirSync(path.resolve(process.cwd(),"./anuncios")).map((file) => path.resolve(process.cwd(),"./anuncios",file))

    return {
        music,
        ad
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

export async function configure(state:State,file:string){
    const { parseFile } = await loadMusicMetadata();
    const fileInfo = await parseFile(file);
    state.trackDuration = Math.floor(fileInfo.format.duration ?? 0);
    state.elapsedTime = 0;
    state.song = file;
}