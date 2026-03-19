import path from 'path';
import fs from 'fs';
import webpack from 'webpack';

// Read podcast index API credentials from secret file and lightly obfuscate
function xorObfuscate(str, xorKey) {
    return Array.from(str).map((c, i) => c.charCodeAt(0) ^ xorKey.charCodeAt(i % xorKey.length));
}

const XOR_KEY = 'mp3chapterplayer';
let podcastKeyObf = [];
let podcastSecretObf = [];
try {
    const secretFile = fs.readFileSync('src-app/podcast-index-secret.txt', 'utf-8');
    let apiKey = '', apiSecret = '';
    for (const line of secretFile.split('\n')) {
        const [key, ...rest] = line.split(':');
        const value = rest.join(':').trim();
        if (key.trim() === 'Key') apiKey = value;
        if (key.trim() === 'Secret') apiSecret = value;
    }
    podcastKeyObf = xorObfuscate(apiKey, XOR_KEY);
    podcastSecretObf = xorObfuscate(apiSecret, XOR_KEY);
} catch (e) {
    console.warn('Warning: podcast-index-secret.txt not found. Podcast search will not work.');
}

export default {
    entry: './src-app/main.js',
    output: {
        filename: 'main.js',
        path: path.resolve('src-app/dist'),
    },
    mode: 'development',
    module: {
        rules: [
            {
                test: /\.css$/i,
                use: ['style-loader', 'css-loader'],
            },
            {
                test: /\.m?js$/,
                resolve: {
                    fullySpecified: false,
                },
            }
        ],
    },
    resolve: {
        alias: {
            '@common': path.resolve('src-common/'),
        },
    },
    plugins: [
        new webpack.DefinePlugin({
            __PODCAST_KEY_OBF__: JSON.stringify(podcastKeyObf),
            __PODCAST_SECRET_OBF__: JSON.stringify(podcastSecretObf),
            __PODCAST_XOR_KEY__: JSON.stringify(XOR_KEY),
        }),
    ],
};
