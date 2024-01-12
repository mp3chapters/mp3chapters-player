import path from 'path';
import CopyWebpackPlugin from 'copy-webpack-plugin';

export default {
    entry: './src-web/main-web.js',
    output: {
        filename: 'main.js',
        path: path.resolve('dist'),
        chunkFilename: '[name].bundle.js',
    },
    devServer: {
        static: {
            directory: path.join('dist'),
        },
        hot: true,
        open: false
    },
    devtool: 'source-map',
    mode: 'development',
    module: {
        rules: [
            {
                test: /\.css$/i,
                use: ['style-loader', 'css-loader'],
            }
        ],
    },
    plugins: [
        new CopyWebpackPlugin({
            patterns: [
                { from: 'src-web/index.html', to: 'index.html' },
                { from: 'src-web/example.mp3', to: 'example.mp3' },
                { from: 'src-web/silence.mp3', to: 'silence.mp3' },
                { from: 'src-web/vidstack', to: 'vidstack' },
            ],
        }),
    ],
    resolve: {
        alias: {
            '@common': path.resolve('src-common/'),
        },
    },
};