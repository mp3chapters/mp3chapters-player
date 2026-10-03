import path from 'path';
import webpack from 'webpack';
import CopyWebpackPlugin from 'copy-webpack-plugin';

const proxyUrl = process.env.PODCAST_PROXY_URL || '';
if (proxyUrl) {
    const url = new URL(proxyUrl);
    const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
    if ((url.protocol !== 'https:' && !(local && url.protocol === 'http:')) || url.username || url.password || url.search || url.hash) {
        throw new Error('PODCAST_PROXY_URL must be a public HTTPS URL or an HTTP loopback URL, without credentials, a query, or a fragment.');
    }
}

export default {
    entry: './src-app/main.js',
    output: {
        filename: 'main.js',
        path: path.resolve('dist-app'),
        clean: true,
    },
    mode: 'production',
    devtool: false,
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
            __PODCAST_PROXY_URL__: JSON.stringify(proxyUrl),
        }),
        new CopyWebpackPlugin({ patterns: [
            { from: 'src-app/index.html', to: 'index.html' },
            { from: 'src-app/vidstack', to: 'vidstack', globOptions: { ignore: ['**/.DS_Store'] } },
        ] }),
    ],
};
