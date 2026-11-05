import path from 'path';
import webpack from 'webpack';
import CopyWebpackPlugin from 'copy-webpack-plugin';
import appConfig from './webpack.tauri.config.js';

export default {
    entry: './src-web/main-web.js',
    output: {
        filename: 'main.js',
        path: path.resolve('dist'),
        chunkFilename: '[name].[contenthash].bundle.js',
        clean: true,
    },
    devServer: {
        static: {
            directory: path.join('dist'),
        },
        hot: true,
        open: false
    },
    devtool: false,
    mode: 'production',
    module: {
        rules: [
            {
                test: /\.css$/i,
                use: ['style-loader', 'css-loader'],
            }
        ],
    },
    plugins: [
        new webpack.DefinePlugin({
            __PODCAST_PROXY_URL__: JSON.stringify(process.env.PODCAST_PROXY_URL ?? 'https://mp3chapters-podcast-proxy.mp3chapters.workers.dev'),
            __WEB_VERSION__: JSON.stringify(process.env.GITHUB_SHA || 'development'),
        }),
        new CopyWebpackPlugin({
            patterns: [
                { from: 'src-common/player.html', to: 'index.html', transform: content => content.toString()
                    .replace('<html lang="en">', '<html lang="en" data-platform="web">')
                    .replace('src="main.js"', `src="main.js?v=${process.env.GITHUB_SHA || 'development'}"`)
                    .replace('</head>', '<link rel="stylesheet" href="web.css" />\n</head>') },
                { from: 'src-web/web.css', to: 'web.css' },
                { from: 'src-common/vidstack', to: 'vidstack', globOptions: { ignore: ['**/.DS_Store'] } },
            ],
        }),
    ],
    resolve: appConfig.resolve,
};
